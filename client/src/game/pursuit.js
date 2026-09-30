// The law, and what's behind it.
//
// Police cruise the streets like anyone else. Drive like anyone else and
// they don't care. Speed, or cut across the grass and the pavement, where a
// patrol car can see you, and the heat goes up:
//
//   heat 0.25  WANTED     the patrols that saw you give chase, sirens on
//   heat 0.55  ROADBLOCK  a car is parked across the road ahead of you
//   heat 0.75  AGENTS     a black car comes for you. It doesn't arrest.
//
// Out of sight, the heat cools. If an agent reaches you, the skin is lost:
// you come back in a new one somewhere else. (Skins are temporary. That's
// the point of them.)
//
// Everyone drives through the same car controls and autopilot as the
// player, and sees only what a line of sight allows.

import { CarControl } from '../engine/car.js';
import { Autopilot } from '../engine/autopilot.js';

const SPEEDING = 14.5; // m/s, about 52 km/h: anything faster is noticed
const SEE = 60; // metres a patrol can see an offence from
const COOL = 0.055; // heat lost per second out of sight
const WANTED = 0.25;
const ROADBLOCK = 0.55;
const AGENTS = 0.75;
const KILL = 3.4; // metres: an agent this close ends the skin
const CAR_R = 2.1; // cars keep this far apart

export class Pursuit {
  // player: { car, walker, mode(): 'car'|'foot'|'inside' }
  constructor({ server, block, world, roads, carNav, player, rng = Math.random }) {
    this.server = server;
    this.block = block;
    this.world = world;
    this.roads = roads;
    this.carNav = carNav;
    this.player = player;
    this.rng = rng;
    this.heat = 0;
    this.unseenFor = 99;
    this.offence = null;
    this.cars = [];
    this.events = [];
    this.losT = 0;
    this.seenBy = new Set();

    const spots = this.randomRoadSpots(3);
    const defs = [
      { id: 'pd1', kind: 'police', livery: 'police' },
      { id: 'pd2', kind: 'police', livery: 'police' },
      { id: 'ag1', kind: 'agent', livery: 'agent' },
    ];
    defs.forEach((d, i) => {
      const [x, z, heading] = spots[i];
      server.append({ block, type: 'spawn', kind: 'car', id: d.id, props: { x, z, heading, livery: d.livery, color: '#000' } });
      const car = new CarControl({ server, block, id: d.id, start: { x, z, heading }, free: this.freeFor(d.id), surface: world.surface, listen: false });
      const pilot = new Autopilot({
        car,
        plan: (from, to, m) => carNav.findPath(from, to, { offRoad: m.offRoad, green: m.green }),
        road: roads ? (from, h, to) => roads.route(from, h, to) : null,
        see: (a, b) => carNav.clear(a, b, 1),
      });
      this.cars.push({ ...d, car, pilot, active: d.kind === 'police', state: d.kind === 'agent' ? 'idle' : 'patrol', replanIn: 0, siren: false, until: 0 });
    });
    this.agent = this.cars.find((c) => c.kind === 'agent');
    this.hide(this.agent);
  }

  // Where the player's body is, and whether it can be seen at all.
  body() {
    const p = this.player;
    const mode = p.mode();
    if (mode === 'car') return { x: p.car.x, z: p.car.z, id: 'car1', visible: true };
    if (mode === 'foot') return { x: p.walker.x, z: p.walker.z, id: 'skin', visible: true };
    return { x: p.car.x, z: p.car.z, id: null, visible: false };
  }

  // Collision for one car against the world and all the other cars.
  freeFor(id) {
    return (x, z) => {
      if (!this.world.carFree(x, z)) return false;
      for (const c of this.cars) {
        if (c.id === id || !c.active) continue;
        if (Math.hypot(c.car.x - x, c.car.z - z) < CAR_R) return false;
      }
      if (id !== 'car1') {
        const pc = this.player.car;
        if (Math.hypot(pc.x - x, pc.z - z) < CAR_R) return false;
      }
      return true;
    };
  }

  // For the player's car: stay out of the NPC cars.
  playerFree() {
    return this.freeFor('car1');
  }

  randomRoadSpots(n, near = null, min = 0, max = Infinity) {
    const out = [];
    const R = this.roads;
    for (let t = 0; t < 400 && out.length < n; t++) {
      const E = R.edges[Math.floor(this.rng() * R.edges.length)];
      if (E.len < 12 || R.adj[E.a].length < 2 || R.adj[E.b].length < 2) continue;
      const a = R.nodes[E.a];
      const b = R.nodes[E.b];
      const u = 0.25 + this.rng() * 0.5;
      const x0 = a[0] + (b[0] - a[0]) * u;
      const z0 = a[1] + (b[1] - a[1]) * u;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dx = (b[0] - a[0]) / L;
      const dz = (b[1] - a[1]) / L;
      const off = E.width >= 8 ? E.width / 4 : 0.6;
      const x = x0 - dz * off;
      const z = z0 + dx * off;
      if (near) {
        const d = Math.hypot(x - near[0], z - near[1]);
        if (d < min || d > max) continue;
      }
      if (!this.world.carFree(x, z)) continue;
      out.push([x, z, Math.atan2(-dz, dx)]);
    }
    return out;
  }

  hide(c) {
    c.active = false;
    c.state = 'idle';
    c.pilot.cancel();
    c.car.place(-9999, -9999, 0, { visible: false, siren: false });
  }

  show(c, [x, z, heading]) {
    c.active = true;
    c.car.place(x, z, heading, { visible: true });
  }

  setSiren(c, on) {
    if (c.siren === on) return;
    c.siren = on;
    c.car.extra.siren = on;
    this.server.append({ block: this.block, type: 'move', transient: true, id: c.id, props: { x: c.car.x, z: c.car.z, siren: on } });
  }

  // Is there a line of sight from car c to the body?
  sees(c, body) {
    if (!c.active || !body.visible) return false;
    const dx = body.x - c.car.x;
    const dz = body.z - c.car.z;
    const d = Math.hypot(dx, dz);
    if (d > SEE) return false;
    const o = { x: c.car.x, y: 1.4, z: c.car.z };
    const dir = { x: dx / d, y: 0, z: dz / d };
    return !this.world.hitBuilding(o, dir, d - 1);
  }

  // What the player is doing wrong right now, if anything.
  offenceNow() {
    const p = this.player;
    if (p.mode() !== 'car') return null;
    const v = Math.abs(p.car.speed);
    if (p.car.air > 0) return 'AIRBORNE';
    if (v > SPEEDING) return 'SPEEDING';
    if (v > 3 && !this.world.surface(p.car.x, p.car.z)) return this.world.green?.(p.car.x, p.car.z) ? 'ON THE GRASS' : 'OFF THE ROAD';
    return null;
  }

  label() {
    if (this.heat >= AGENTS) return 'AGENTS';
    if (this.heat >= ROADBLOCK) return 'ROADBLOCK';
    if (this.heat >= WANTED) return 'WANTED';
    return this.offence && this.seenBy.size ? this.offence : '';
  }

  // Where the body will be in a moment.
  ahead(body, secs) {
    const p = this.player;
    if (p.mode() !== 'car') return [body.x, body.z];
    const v = p.car.speed;
    return [body.x + Math.cos(p.car.heading) * v * secs, body.z - Math.sin(p.car.heading) * v * secs];
  }

  update(dt, now) {
    this.events.length = 0;
    const body = this.body();
    const police = this.cars.filter((c) => c.kind === 'police');

    // Who can see the skin: checked a few times a second.
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.2;
      this.seenBy = new Set(this.cars.filter((c) => this.sees(c, body)).map((c) => c.id));
    }
    this.offence = this.offenceNow();
    const seen = this.seenBy.size > 0;
    const seenByPolice = police.some((c) => this.seenBy.has(c.id));
    if (seen) this.unseenFor = 0;
    else this.unseenFor += dt;

    const before = this.heat;
    const chasing = this.cars.some((c) => c.state === 'chase' && this.seenBy.has(c.id));
    if (this.offence && seenByPolice) this.heat = Math.min(1, this.heat + dt * 0.13);
    else if (chasing && this.heat >= WANTED) this.heat = Math.min(1, this.heat + dt * 0.035); // running from them
    else if (this.unseenFor > 3) this.heat = Math.max(0, this.heat - dt * COOL);
    if (before < WANTED && this.heat >= WANTED) this.events.push('wanted');
    if (before < ROADBLOCK && this.heat >= ROADBLOCK) this.events.push('roadblock');
    if (before < AGENTS && this.heat >= AGENTS) this.events.push('agents');
    if (before > 0 && this.heat === 0) this.events.push('clear');

    for (const c of this.cars) this.drive(c, dt, now, body);

    // Agents end skins.
    const a = this.agent;
    if (a.active && body.visible && Math.hypot(a.car.x - body.x, a.car.z - body.z) < KILL) this.events.push('killed');
  }

  drive(c, dt, now, body) {
    c.replanIn -= dt;
    const heat = this.heat;
    if (c.kind === 'police') {
      if (heat >= ROADBLOCK && c.id === 'pd2' && c.state !== 'block' && body.visible) this.roadblock(c, body, now);
      else if (heat >= WANTED && c.state !== 'block' && (c.state === 'chase' || this.seenBy.has(c.id))) c.state = 'chase';
      if (heat < WANTED * 0.5 && c.state !== 'patrol') {
        c.state = 'patrol';
        c.pilot.cancel();
      }
      if (c.state === 'block' && (now > c.until || heat < ROADBLOCK * 0.6)) {
        c.state = 'patrol';
        c.pilot.cancel();
      }
      this.setSiren(c, c.state !== 'patrol');
      if (c.state === 'patrol' && !c.pilot.route) {
        const [spot] = this.randomRoadSpots(1, [c.car.x, c.car.z], 60, 260);
        if (spot) c.pilot.go([spot[0], spot[1]], 'normal');
      }
      if (c.state === 'chase' && c.replanIn <= 0 && body.visible) {
        c.replanIn = 1.5;
        c.pilot.go(this.ahead(body, 1), 'stunt');
      }
    } else {
      // The agent.
      if (heat >= AGENTS && !c.active && body.visible) {
        const [spot] = this.randomRoadSpots(1, [body.x, body.z], 110, 170);
        if (spot) {
          this.show(c, spot);
          c.state = 'hunt';
        }
      }
      if (c.active && heat < AGENTS * 0.4 && this.unseenFor > 6) this.hide(c);
      if (c.state === 'hunt' && c.replanIn <= 0 && body.visible) {
        c.replanIn = 1.1;
        c.pilot.go(this.ahead(body, 0.8), 'stunt');
      }
    }
    if (!c.active) return;
    const input = c.state === 'block' ? { up: false, down: c.car.speed > 0.2, left: false, right: false, hand: true } : c.pilot.update(dt);
    c.car.update(dt, input ?? { up: false, down: c.car.speed > 0.2, left: false, right: false, hand: false });
  }

  // Park a patrol car across the road ahead of the skin, out of the drone's
  // sight if it can be managed.
  roadblock(c, body, now) {
    const p = this.player;
    const R = this.roads;
    const hx = Math.cos(p.car.heading);
    const hz = -Math.sin(p.car.heading);
    let best = null;
    for (let k = 0; k < R.nodes.length; k++) {
      if (R.adj[k].length < 2) continue;
      const [x, z] = R.nodes[k];
      const dx = x - body.x;
      const dz = z - body.z;
      const d = Math.hypot(dx, dz);
      if (d < 45 || d > 140) continue;
      const ahead = (dx * hx + dz * hz) / d;
      if (ahead < 0.55) continue;
      const score = ahead * 2 - Math.abs(d - 80) / 80;
      if (!best || score > best.score) best = { k, score, x, z };
    }
    if (!best) return;
    // Across the road: at right angles to the road the skin would come in on.
    const e = R.adj[best.k].map(({ edge }) => R.edges[edge]).find(Boolean);
    const other = e.a === best.k ? R.nodes[e.b] : R.nodes[e.a];
    const along = Math.atan2(-(other[1] - best.z), other[0] - best.x);
    c.pilot.cancel();
    this.show(c, [best.x, best.z, along + Math.PI / 2]);
    c.state = 'block';
    c.until = now + 25;
    this.events.push('roadblock-set');
  }

  // A fresh start: after a lost skin.
  reset() {
    this.heat = 0;
    this.unseenFor = 99;
    for (const c of this.cars) {
      if (c.kind === 'agent') this.hide(c);
      else {
        c.state = 'patrol';
        c.pilot.cancel();
        this.setSiren(c, false);
      }
    }
  }

  // For the HUD and the map.
  contacts() {
    return this.cars.filter((c) => c.active).map((c) => ({
      x: c.car.x, z: c.car.z, kind: c.kind, state: c.state,
      label: c.kind === 'agent' ? 'AGENT' : c.state === 'block' ? 'PD BLOCK' : c.state === 'chase' ? 'PD PURSUIT' : 'PD',
    }));
  }
}
