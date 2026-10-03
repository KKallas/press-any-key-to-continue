#!/usr/bin/env python3
# A seat at the rack for something that isn't a person.
#
# This drives the real client in a real browser and offers exactly what a
# human has: the picture on the screen, the keyboard and the mouse. There is
# no view into the game's state and no command the client doesn't already
# take from a hand. An agent playing through this is playing the same game.
#
#   play.py start [--url http://localhost:8000] [--show]   open the game
#   play.py look                                           what's on screen
#   play.py type "text"                                    type into whatever has focus
#   play.py key Enter            (--hold 1.5 to keep it down)
#   play.py click 640 300        (--double for flat out)
#   play.py drag 300 300 500 300
#   play.py wait 3
#   play.py stop
#
# Every command but stop answers with the path of a fresh screenshot and the
# text a person could read off the page. Coordinates are pixels in that
# screenshot. The browser lives in a background process between commands.
#
# Needs:  pip install -r tools/player/requirements.txt   (and Google Chrome)

import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

PORT = int(os.environ.get('PAK_PLAYER_PORT') or 8777)
SHOTS = os.path.join(tempfile.gettempdir(), 'pak-player')
KEEP = 20  # screenshots kept before the oldest are cleared away


# ---- The background process: one browser, one page ---------------------------

async def serve(args):
    from aiohttp import web
    from playwright.async_api import async_playwright

    os.makedirs(SHOTS, exist_ok=True)
    pw = await async_playwright().start()
    flags = ['--ignore-gpu-blocklist']
    if args.software:
        flags += ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    size = {'width': args.width, 'height': args.height}
    if args.profile:
        # A kept profile remembers the operator's key, so the next start walks
        # straight back in as the same handle.
        ctx = await pw.chromium.launch_persistent_context(args.profile, channel='chrome', headless=not args.show, args=flags, viewport=size)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
    else:
        browser = await pw.chromium.launch(channel='chrome', headless=not args.show, args=flags)
        ctx = await browser.new_context(viewport=size)
        page = await ctx.new_page()
    await page.goto(args.url)
    done = asyncio.Event()
    n = 0

    async def look():
        nonlocal n
        n += 1
        path = os.path.join(SHOTS, f'screen-{n:04d}.png')
        await page.screenshot(path=path)
        old = os.path.join(SHOTS, f'screen-{n - KEEP:04d}.png')
        if os.path.exists(old):
            os.remove(old)
        # What a person could read: the page's own text. Anything drawn on a
        # canvas (the feed, the map, the monitors) is only in the screenshot.
        text = await page.evaluate('document.body.innerText')
        return {'screenshot': path, 'text': '\n'.join(l for l in text.splitlines() if l.strip())}

    async def act(request):
        c = await request.json()
        do = c['do']
        if do == 'stop':
            done.set()
            return web.json_response({'ok': True})
        if do == 'type':
            await page.keyboard.type(c['text'], delay=20)
        elif do == 'key':
            if c.get('hold'):
                await page.keyboard.down(c['key'])
                await asyncio.sleep(c['hold'])
                await page.keyboard.up(c['key'])
            else:
                await page.keyboard.press(c['key'])
        elif do == 'click':
            await page.mouse.click(c['x'], c['y'], click_count=2 if c.get('double') else 1)
        elif do == 'drag':
            await page.mouse.move(c['x'], c['y'])
            await page.mouse.down()
            await page.mouse.move(c['x2'], c['y2'], steps=12)
            await page.mouse.up()
        elif do == 'wait':
            await asyncio.sleep(c['seconds'])
        if do != 'look':
            await asyncio.sleep(c.get('settle', 0.6))  # let the screen catch up with the hand
        return web.json_response(await look())

    app = web.Application()
    app.router.add_post('/', act)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, '127.0.0.1', PORT).start()
    await done.wait()
    await ctx.close()
    await pw.stop()
    await runner.cleanup()


# ---- The command line --------------------------------------------------------

def send(cmd, timeout=120):
    req = urllib.request.Request(f'http://127.0.0.1:{PORT}/', data=json.dumps(cmd).encode(), headers={'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def show(r):
    if 'screenshot' in r:
        print(f"screenshot: {r['screenshot']}")
        print('--- text on the page ---')
        print(r['text'])


def start(args):
    try:
        send({'do': 'look'}, timeout=3)
        sys.exit(f'already running on port {PORT} — "play.py stop" first')
    except (urllib.error.URLError, OSError):
        pass
    cmd = [sys.executable, os.path.abspath(__file__), '_serve', '--url', args.url, '--width', str(args.width), '--height', str(args.height)]
    cmd += ['--show'] if args.show else []
    cmd += ['--software'] if args.software else []
    cmd += ['--profile', os.path.abspath(args.profile)] if args.profile else []
    os.makedirs(SHOTS, exist_ok=True)
    log = open(os.path.join(SHOTS, 'player.log'), 'w')
    proc = subprocess.Popen(cmd, stdout=log, stderr=log, start_new_session=True)
    for _ in range(60):
        time.sleep(0.5)
        if proc.poll() is not None:
            sys.exit(f'could not start — see {log.name}')
        try:
            show(send({'do': 'wait', 'seconds': 2}))
            return
        except (urllib.error.URLError, OSError):
            pass
    sys.exit(f'timed out starting — see {log.name}')


def main():
    ap = argparse.ArgumentParser(description='Play Press Any Key to Continue through the real client: screen, keys and mouse only.')
    sub = ap.add_subparsers(dest='do', required=True)
    for name in ('start', '_serve'):
        p = sub.add_parser(name, help='open the game in a browser that stays up between commands' if name == 'start' else argparse.SUPPRESS)
        p.add_argument('--url', default='http://localhost:8000')
        p.add_argument('--show', action='store_true', help='a visible window, to watch it play')
        p.add_argument('--software', action='store_true', help='render without a GPU (slow)')
        p.add_argument('--profile', help='a folder to keep the browser profile in, so the login is remembered')
        p.add_argument('--width', type=int, default=1400)
        p.add_argument('--height', type=int, default=900)
    sub.add_parser('look', help='screenshot and page text')
    p = sub.add_parser('type', help='type text into whatever has focus')
    p.add_argument('text')
    p = sub.add_parser('key', help='press a key: Enter, Escape, Tab, e, 1, ArrowUp …')
    p.add_argument('key')
    p.add_argument('--hold', type=float, help='seconds to keep it down')
    p = sub.add_parser('click', help='click at a pixel of the screenshot')
    p.add_argument('x', type=float)
    p.add_argument('y', type=float)
    p.add_argument('--double', action='store_true')
    p = sub.add_parser('drag', help='press, move and release')
    for a in ('x', 'y', 'x2', 'y2'):
        p.add_argument(a, type=float)
    p = sub.add_parser('wait', help='let time pass, then look')
    p.add_argument('seconds', type=float)
    sub.add_parser('stop', help='close the browser')
    args = ap.parse_args()

    if args.do == '_serve':
        return asyncio.run(serve(args))
    if args.do == 'start':
        return start(args)
    try:
        show(send(vars(args)))
    except (urllib.error.URLError, OSError):
        sys.exit('not running — "play.py start" first' if args.do != 'stop' else 'not running')


if __name__ == '__main__':
    main()
