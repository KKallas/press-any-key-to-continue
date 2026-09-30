// The game server: the shared truth for a city full of players.
//
// It does two jobs. It serves the client (so the whole thing runs from one
// origin), and it keeps the live world: who is playing, where their car or
// skin is, and hands every client a snapshot of everyone else a dozen times
// a second. The city itself is static (each client loads the same map file),
// so the server only has to relay bodies, which keeps it tiny.
//
// The event-log design of the client's local stub carries straight over: the
// server is the log, and a snapshot is just the transient move events for
// every player but you.
//
//   node server/server.mjs           # http://localhost:8000
//   PORT=9000 node server/server.mjs
//
// Needs `ws`:  cd server && npm install

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { parseSignup } from './auth.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, '..', 'client');
const PORT = Number(process.env.PORT) || 8000;
const MAX_PLAYERS = 100;
const TICK_MS = 80; // snapshot rate: 12.5 Hz
const IDLE_MS = 15000; // drop a player we haven't heard from in this long

// pending: token -> { name, color } minted at signup, claimed by the socket.
const pending = new Map();
// players: id -> live record.
const players = new Map();
let nextColor = 0;

// Sign-up is an injection at the login; the parser lives in auth.mjs and
// never touches a database. A plain login is turned away.
function signup(payload) {
  const r = parseSignup(payload?.line, players.size + pending.size, MAX_PLAYERS, nextColor);
  if (!r.ok) return r;
  nextColor++;
  pending.set(r.token, { name: r.name, color: r.color });
  setTimeout(() => pending.delete(r.token), 60000).unref?.();
  return r;
}

// ---- Static files -----------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

function serveStatic(req, res) {
  const u = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(CLIENT, p));
  if (!file.startsWith(CLIENT)) return end(res, 403, 'no');
  fs.readFile(file, (err, data) => {
    if (err) return end(res, 404, 'not found');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}

function end(res, code, body, type = 'text/plain') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const httpServer = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/signup' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 4000) req.destroy();
    });
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch {}
      const r = signup(payload);
      end(res, r.ok ? 200 : 403, JSON.stringify(r), 'application/json');
    });
    return;
  }
  if (u.pathname === '/api/status') {
    return end(res, 200, JSON.stringify({ players: players.size, max: MAX_PLAYERS }), 'application/json');
  }
  serveStatic(req, res);
});

// ---- The live world over WebSocket ------------------------------------------

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

function roster() {
  return { t: 'roster', players: [...players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })) };
}

function broadcast(obj, except) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) if (p.ws !== except && p.ws.readyState === 1) p.ws.send(s);
}

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://localhost').searchParams.get('token');
  const claim = token && pending.get(token);
  if (!claim) {
    ws.close(4001, 'no token');
    return;
  }
  if (players.size >= MAX_PLAYERS) {
    ws.close(4002, 'full');
    return;
  }
  pending.delete(token);
  const id = token.slice(0, 8);
  const player = { id, name: claim.name, color: claim.color, ws, mode: 'car', x: 0, z: 0, heading: 0, speed: 0, visible: true, seen: Date.now() };
  players.set(id, player);
  ws.send(JSON.stringify({ t: 'welcome', id, name: player.name, color: player.color, count: players.size }));
  broadcast(roster());

  ws.on('message', (data) => {
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m.t === 'state') {
      player.seen = Date.now();
      player.mode = m.mode ?? player.mode;
      player.x = +m.x || 0;
      player.z = +m.z || 0;
      player.heading = +m.heading || 0;
      player.speed = +m.speed || 0;
      player.visible = m.visible !== false;
    }
  });

  const drop = () => {
    if (!players.has(id)) return;
    players.delete(id);
    broadcast({ t: 'left', id });
    broadcast(roster());
  };
  ws.on('close', drop);
  ws.on('error', drop);
});

// The snapshot: every player but you, a dozen times a second. Idle players
// (a shut laptop lid) are dropped so they don't stand frozen in the road.
setInterval(() => {
  const now = Date.now();
  for (const p of [...players.values()]) {
    if (now - p.seen > IDLE_MS) {
      players.delete(p.id);
      broadcast({ t: 'left', id: p.id });
      broadcast(roster());
    }
  }
  const all = [...players.values()];
  for (const me of all) {
    if (me.ws.readyState !== 1) continue;
    const others = all
      .filter((p) => p !== me && p.visible)
      .map((p) => [p.id, p.mode === 'car' ? 0 : p.mode === 'foot' ? 1 : 2, r1(p.x), r1(p.z), r2(p.heading), r1(p.speed)]);
    me.ws.send(JSON.stringify({ t: 'world', players: others }));
  }
}, TICK_MS);

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

httpServer.listen(PORT, () => {
  console.log(`Press Any Key to Continue — server on http://localhost:${PORT}`);
  console.log(`Up to ${MAX_PLAYERS} operators. The way in is an injection at the login.`);
});
