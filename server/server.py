# The game server: the shared truth for a city full of players.
#
# It does two jobs. It serves the client (so the whole thing runs from one
# origin), and it keeps the live world: who is playing, where their car or
# skin is, and hands every client a snapshot of everyone else a dozen times
# a second. The city itself is static (each client loads the same map file),
# so the server only has to relay bodies, which keeps it tiny.
#
# The event-log design of the client's local stub carries straight over: the
# server is the log, and a snapshot is just the transient move events for
# every player but you.
#
#   python3 server/server.py            # http://localhost:8000
#   PORT=9000 python3 server/server.py
#
# Needs aiohttp:  pip install -r server/requirements.txt

import asyncio
import json
import math
import os
import secrets
import time
from urllib.parse import unquote

from aiohttp import web

from auth import parse_login, parse_signup
from db import OperatorDB
from overrides import OverrideStore

# The admin booth: codes anyone can dial in-game. Only these fixed codes run —
# never arbitrary input — so it's a control panel, not a shell. Pulling the
# world is part of the game: anyone who finds the booth can rebuild it.
# `systemd-run` detaches the job so it survives the very restart it triggers.
RELOAD = {
    'what': 'REBUILD WORLD — PULLING FROM GITHUB',
    'run': 'systemd-run --quiet --collect /usr/local/bin/pak-update --force',
}
DIAL_CODES = {
    '#000*1': RELOAD,  # system reload
    '#99': RELOAD,  # kept as an alias
}
last_dial = 0.0  # a crude cooldown so the world can't be spammed into a restart loop

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.normpath(os.path.join(HERE, '..', 'client'))
PORT = int(os.environ.get('PORT') or 8000)
MAX_PLAYERS = 100
TICK = 0.08  # snapshot rate: 12.5 Hz
IDLE = 15.0  # drop a player we haven't heard from in this long
MAX_BUNDLE = 8 * 1024 * 1024

# The accounts that persist between sessions.
db = OperatorDB()
overrides = OverrideStore(os.path.join(HERE, 'data', 'overrides'))
# pending: token -> { name, color } minted at sign-up / login, claimed by the
# socket that connects with it, then spent.
pending = {}
# players: id -> live record.
players = {}
# Sends in flight, held so they aren't collected before they finish.
sends = set()


def mint_token(name, color):
    token = secrets.token_hex(16)
    pending[token] = {'name': name, 'color': color}
    asyncio.get_running_loop().call_later(60, pending.pop, token, None)
    return token


# Sign-up: an injection creates a persistent operator and hands back a key to
# keep. A known handle typed plainly is bounced to the key prompt. Anything
# else is turned away. The parser (auth.py) never runs the string against
# anything.
def signup(payload):
    live = len(players) + len(pending)
    r = parse_signup(payload.get('line'), db, live, MAX_PLAYERS)
    if not r['ok']:
        return r  # needKey or reason
    token = mint_token(r['handle'], r['color'])
    return {'ok': True, 'created': True, 'handle': r['handle'], 'key': r['key'], 'color': r['color'], 'token': token}


# Log in: a returning operator with their handle and key.
def login_returning(payload):
    live = len(players) + len(pending)
    r = parse_login(payload.get('handle'), payload.get('key'), db, live, MAX_PLAYERS)
    if not r['ok']:
        return r
    token = mint_token(r['handle'], r['color'])
    return {'ok': True, 'handle': r['handle'], 'color': r['color'], 'runs': r['runs'], 'token': token}


# ---- Static files -----------------------------------------------------------

TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
}


# Compact, as the wire wants it: a snapshot goes to everyone a dozen times a second.
def dumps(obj):
    return json.dumps(obj, separators=(',', ':'))


def end(code, body, type='text/plain'):
    return web.Response(status=code, body=body, headers={'content-type': type, 'cache-control': 'no-store'})


def as_json(code, obj):
    return end(code, dumps(obj), 'application/json')


def send_file(file):
    try:
        with open(file, 'rb') as f:
            data = f.read()
    except OSError:
        return end(404, 'not found')
    return end(200, data, TYPES.get(os.path.splitext(file)[1], 'application/octet-stream'))


def serve_static(request):
    p = unquote(request.path)
    if p == '/':
        p = '/index.html'
    file = os.path.normpath(os.path.join(CLIENT, p.lstrip('/')))
    if not file.startswith(CLIENT + os.sep):
        return end(403, 'no')
    return send_file(file)


async def read_json(request):
    try:
        body = await request.content.read(4001)
        payload = json.loads(body or b'{}') if len(body) <= 4000 else {}
    except ValueError:
        payload = {}
    return payload if isinstance(payload, dict) else {}


async def handle(request):
    q = request.query
    # A plain-URL account door: /?action=createuser&name=..&passw=.. returns
    # JSON you can read straight in the browser. A handle and a password you
    # pick, so you can log back in with them.
    action = q.get('action')
    passw = q.get('passw', q.get('pass'))
    if action == 'createuser':
        r = db.create_named(q.get('name'), passw)
        if r.get('error') == 'taken':
            return as_json(200, {'ok': False, 'reason': 'username taken'})
        if r.get('error'):
            return as_json(200, {'ok': False, 'reason': r['error']})
        return as_json(200, {'ok': True, 'created': True, 'name': r['handle']})
    if action == 'login':
        r = login_returning({'handle': q.get('name'), 'key': passw})
        return as_json(200, {'ok': True, 'name': r['handle']} if r['ok'] else {'ok': False, 'reason': r['reason']})
    path = request.path
    if path == '/api/signup' and request.method == 'POST':
        r = signup(await read_json(request))
        return as_json(200 if r['ok'] else 403, r)
    if path == '/api/login' and request.method == 'POST':
        r = login_returning(await read_json(request))
        return as_json(200 if r['ok'] else 403, r)
    if path == '/api/status':
        return as_json(200, {'players': len(players), 'max': MAX_PLAYERS, 'operators': db.size})
    # The override layer: the index every client loads at startup, the files it
    # serves, and the door a forged bundle comes back through.
    if path == '/api/overrides' and request.method == 'GET':
        return as_json(200, overrides.all())
    if path == '/api/overrides' and request.method == 'POST':
        # Read a binary request body (a forged bundle) up to a cap.
        buf = await request.content.read(MAX_BUNDLE + 1)
        r = overrides.ingest(buf)
        return as_json(200 if r.get('ok') else 400, r)
    if path.startswith('/overrides/'):
        file = overrides.resolve(path)
        return send_file(file) if file else end(404, 'not found')
    return serve_static(request)


# ---- The live world over WebSocket ------------------------------------------

async def _send(ws, text):
    try:
        await ws.send_str(text)
    except (ConnectionError, RuntimeError):
        pass  # gone mid-send: the close handler tidies up


# Queue a message for one socket without waiting on it, so one slow client
# can't hold up everyone else's. Order to a socket is kept.
def send(ws, obj):
    if ws.closed:
        return
    task = asyncio.ensure_future(_send(ws, dumps(obj)))
    sends.add(task)
    task.add_done_callback(sends.discard)
    return task


def roster():
    return {'t': 'roster', 'players': [{'id': p['id'], 'name': p['name'], 'color': p['color']} for p in players.values()]}


def broadcast(obj, skip=None):
    for p in list(players.values()):
        if p['ws'] is not skip:
            send(p['ws'], obj)


def drop(id):
    if id not in players:
        return
    del players[id]
    broadcast({'t': 'left', 'id': id})
    broadcast(roster())


# A number off the wire, or 0 for anything that isn't one.
def num(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0.0
    return n if math.isfinite(n) else 0.0


async def run_dial(code, cmd):
    try:
        proc = await asyncio.create_subprocess_shell(
            cmd['run'], stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        try:
            _, err = await asyncio.wait_for(proc.communicate(), 180)
        except asyncio.TimeoutError:
            proc.kill()
            raise RuntimeError('timed out')
        if proc.returncode:
            raise RuntimeError(err.decode('utf8', 'replace').strip() or f'exit {proc.returncode}')
    except Exception as e:
        broadcast({'t': 'notice', 'msg': f'DIAL {code} FAILED: {str(e)[:80]}'})


def on_message(player, m):
    global last_dial
    ws = player['ws']
    if m.get('t') == 'state':
        player['seen'] = time.monotonic()
        if m.get('mode') is not None:
            player['mode'] = m['mode']
        player['x'] = num(m.get('x'))
        player['z'] = num(m.get('z'))
        player['heading'] = num(m.get('heading'))
        player['speed'] = num(m.get('speed'))
        player['visible'] = m.get('visible') is not False
    elif m.get('t') == 'dial':
        code = str(m.get('code') or '')
        cmd = DIAL_CODES.get(code.strip())
        if not cmd:
            send(ws, {'t': 'dial', 'ok': False, 'msg': f'NO SUCH LINE: {code[:8]}'})
            return
        now = time.monotonic()
        if last_dial and now - last_dial < 20:
            send(ws, {'t': 'dial', 'ok': False, 'msg': 'LINE BUSY — TRY AGAIN SHORTLY'})
            return
        last_dial = now
        send(ws, {'t': 'dial', 'ok': True, 'msg': f"{cmd['what']}…"})
        broadcast({'t': 'notice', 'msg': f"{player['name']} DIALED {code} · {cmd['what']}"})
        task = asyncio.ensure_future(run_dial(code, cmd))
        sends.add(task)
        task.add_done_callback(sends.discard)


async def socket(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    token = request.query.get('token')
    claim = pending.get(token) if token else None
    if not claim:
        await ws.close(code=4001, message=b'no token')
        return ws
    if len(players) >= MAX_PLAYERS:
        await ws.close(code=4002, message=b'full')
        return ws
    del pending[token]
    id = token[:8]
    player = {'id': id, 'name': claim['name'], 'color': claim['color'], 'ws': ws, 'mode': 'car',
              'x': 0.0, 'z': 0.0, 'heading': 0.0, 'speed': 0.0, 'visible': True, 'seen': time.monotonic()}
    players[id] = player
    send(ws, {'t': 'welcome', 'id': id, 'name': player['name'], 'color': player['color'], 'count': len(players)})
    broadcast(roster())

    try:
        async for msg in ws:
            if msg.type != web.WSMsgType.TEXT:
                continue
            try:
                m = json.loads(msg.data)
            except ValueError:
                continue
            if isinstance(m, dict):
                on_message(player, m)
    finally:
        if players.get(id) is player:
            drop(id)
    return ws


MODES = {'car': 0, 'foot': 1}


# The snapshot: every player but you, a dozen times a second. Idle players
# (a shut laptop lid) are dropped so they don't stand frozen in the road.
async def tick():
    while True:
        await asyncio.sleep(TICK)
        now = time.monotonic()
        for p in list(players.values()):
            if now - p['seen'] > IDLE:
                drop(p['id'])
        everyone = list(players.values())
        rows = {p['id']: [p['id'], MODES.get(p['mode'], 2), round(p['x'], 1), round(p['z'], 1),
                          round(p['heading'], 2), round(p['speed'], 1)]
                for p in everyone if p['visible']}
        for me in everyone:
            # Still flushing the last snapshot: skip this one rather than queue behind it.
            if me.get('snap') and not me['snap'].done():
                continue
            others = [row for id, row in rows.items() if id != me['id']]
            me['snap'] = send(me['ws'], {'t': 'world', 'players': others})


async def start_tick(app):
    app['tick'] = asyncio.ensure_future(tick())
    yield
    app['tick'].cancel()


def make_app():
    app = web.Application(client_max_size=MAX_BUNDLE + 1024)
    app.cleanup_ctx.append(start_tick)
    app.router.add_get('/ws', socket)
    app.router.add_route('*', '/{tail:.*}', handle)
    return app


if __name__ == '__main__':
    print(f'Press Any Key to Continue — server on http://localhost:{PORT}', flush=True)
    print(f'Up to {MAX_PLAYERS} operators. The way in is an injection at the login.', flush=True)
    web.run_app(make_app(), port=PORT, print=None)
