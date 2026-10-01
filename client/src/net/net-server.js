// The networked server, seen from the client. It is a drop-in for
// LocalServer: same append() and subscribe(), so the world and the game code
// don't know the difference. On top of the local truth it does two things:
//
//   - forwards this player's own body (the car and the skin) to the server,
//     throttled, so everyone else can see it;
//   - turns the server's snapshots of every other player into ordinary
//     spawn / move / despawn events, so the world draws them like anything
//     else. A remote player is an entity `rp:<id>`, a car or a person
//     depending on what they're doing.
//
// If there's no server, or the socket drops, it behaves exactly like the
// local stub, so solo play still works.

import { LocalServer } from './local-server.js';

const SEND_HZ = 15; // how often we tell the server where we are

export class NetServer extends LocalServer {
  // block: the block remote players live in (the same city as you).
  // me: { car: 'car1', skin: 'skin' } — the ids of your own body.
  constructor({ log = [], block, token, me, onRoster, onNotice } = {}) {
    super(log);
    this.block = block;
    this.token = token;
    this.me = me;
    this.onRoster = onRoster;
    this.onNotice = onNotice; // server broadcasts and dial replies, as text lines
    this.ws = null;
    this.connected = false;
    this.roster = new Map(); // id -> { name, color }
    this.remoteKind = new Map(); // id -> 'car' | 'person' currently drawn
    this.remotePos = new Map(); // id -> { x, z } last seen, for the map
    this.mine = { mode: 'car', x: 0, z: 0, heading: 0, speed: 0, visible: true };
    this.lastSent = 0;
    this.selfId = null;
  }

  // Intercept our own body's move events to learn our latest position, then
  // hand everything to the local pipeline unchanged.
  append(event) {
    if (event.type === 'move' && (event.id === this.me.car || event.id === this.me.skin)) {
      const p = event.props;
      // Which of our bodies is the live one is decided by the caller through
      // `setMode`; here we just record coordinates from whichever moved.
      if (event.id === this.mine.bodyId || !this.mine.bodyId) {
        this.mine.x = p.x ?? this.mine.x;
        this.mine.z = p.z ?? this.mine.z;
        this.mine.heading = p.heading ?? this.mine.heading;
        this.mine.speed = p.speed ?? this.mine.speed;
      }
    }
    return super.append(event);
  }

  // The game tells us which body is live and whether it's on screen.
  setMode(mode) {
    this.mine.mode = mode;
    this.mine.bodyId = mode === 'foot' ? this.me.skin : this.me.car;
    this.mine.visible = mode !== 'inside';
  }

  connect() {
    return new Promise((resolve) => {
      let settled = false;
      try {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        this.ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}`);
      } catch (e) {
        resolve(false);
        return;
      }
      this.ws.addEventListener('open', () => {
        this.connected = true;
      });
      this.ws.addEventListener('message', (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          this.selfId = m.id;
          if (!settled) {
            settled = true;
            resolve(true);
          }
        } else if (m.t === 'roster') {
          this.roster = new Map(m.players.map((p) => [p.id, p]));
          this.onRoster?.(this.roster);
        } else if (m.t === 'world') {
          this.applyWorld(m.players);
        } else if (m.t === 'left') {
          this.dropRemote(m.id);
        } else if (m.t === 'notice' || m.t === 'dial') {
          this.onNotice?.(m.msg || '', m);
        }
      });
      this.ws.addEventListener('close', () => {
        this.connected = false;
        if (!settled) {
          settled = true;
          resolve(false);
        }
        for (const id of [...this.remoteKind.keys()]) this.dropRemote(id);
      });
      this.ws.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });
    });
  }

  // Called each frame: push our body to the server, at most SEND_HZ times a second.
  tick(now) {
    if (!this.connected) return;
    if (now - this.lastSent < 1000 / SEND_HZ) return;
    this.lastSent = now;
    this.ws.send(
      JSON.stringify({
        t: 'state',
        mode: this.mine.mode,
        x: this.mine.x,
        z: this.mine.z,
        heading: this.mine.heading,
        speed: this.mine.speed,
        visible: this.mine.visible,
      }),
    );
  }

  // Dial a code at the admin booth (e.g. '#99' to rebuild the world). The
  // server decides what each code does; here we just send it. Returns false if
  // there's no live connection (solo play).
  dial(code) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify({ t: 'dial', code: String(code) }));
    return true;
  }

  // A snapshot of everyone else. Each entry: [id, mode, x, z, heading, speed].
  applyWorld(list) {
    const here = new Set();
    for (const [id, modeN, x, z, heading, speed] of list) {
      if (id === this.selfId) continue;
      here.add(id);
      const mode = modeN === 0 ? 'car' : modeN === 1 ? 'foot' : 'inside';
      if (mode === 'inside') {
        this.dropRemote(id);
        continue;
      }
      const wantKind = mode === 'car' ? 'car' : 'person';
      const have = this.remoteKind.get(id);
      const eid = `rp:${id}`;
      if (have !== wantKind) {
        if (have) super.append({ block: this.block, type: 'despawn', id: eid });
        const info = this.roster.get(id) ?? { name: id, color: '#8a8a8a' };
        if (wantKind === 'car') {
          super.append({ block: this.block, type: 'spawn', kind: 'car', id: eid, props: { x, z, heading, color: info.color, lights: false, remote: true } });
        } else {
          super.append({ block: this.block, type: 'spawn', kind: 'person', id: eid, props: { x, z, heading, coat: info.color } });
        }
        this.remoteKind.set(id, wantKind);
      }
      super.append({ block: this.block, type: 'move', transient: true, id: eid, props: { x, z, heading, speed, visible: true } });
      this.remotePos.set(id, { x, z, kind: wantKind });
    }
    // Anyone in our list but not in this snapshot has gone (out of range or off).
    for (const id of [...this.remoteKind.keys()]) if (!here.has(id)) this.dropRemote(id);
  }

  dropRemote(id) {
    this.remotePos.delete(id);
    if (!this.remoteKind.has(id)) return;
    this.remoteKind.delete(id);
    super.append({ block: this.block, type: 'despawn', id: `rp:${id}` });
  }

  // Where every visible remote player is, for the map monitor and a count.
  contacts() {
    const out = [];
    for (const [id, p] of this.remotePos) out.push({ id, x: p.x, z: p.z, kind: p.kind, name: this.roster.get(id)?.name });
    return out;
  }

  get count() {
    return this.roster.size;
  }
}
