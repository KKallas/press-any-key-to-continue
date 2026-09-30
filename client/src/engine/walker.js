// On foot. Movement is relative to the screen (W is up on the drone's
// picture), which stays right however the drone circles. Like the car, the
// walker sends its moves to the server and is drawn when they come back.

import { slide } from './collision.js';

const WALK = 2.0; // m/s
const RUN = 5.2;

export class WalkerControl {
  // free(x, z): may a person stand here. up(): screen-up on the ground, [x, z].
  constructor({ server, block, id, free, up }) {
    this.server = server;
    this.block = block;
    this.id = id;
    this.free = free;
    this.up = up;
    this.x = 0;
    this.z = 0;
    this.heading = 0;
    this.speed = 0;
    this.active = false;
    this.keys = new Set();
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // Put the walker down at (x, z), or at the nearest free spot around it.
  place(x, z, visible = true) {
    for (let r = 0; r < 6; r += 0.5) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (this.free(px, pz)) {
          this.x = px;
          this.z = pz;
          this.send(visible);
          return true;
        }
        if (r === 0) break;
      }
    }
    return false;
  }

  send(visible = true) {
    this.server.append({
      block: this.block,
      type: 'move',
      transient: true,
      id: this.id,
      props: { x: this.x, z: this.z, heading: this.heading, speed: this.speed, visible },
    });
  }

  // Walk (or run) a planned route; onArrive runs at the end.
  follow(pts, run, onArrive) {
    this.route = pts && pts.length > 1 ? { pts, i: 1, run, onArrive } : null;
    return !!this.route;
  }

  update(dt) {
    if (!this.active) return;
    const k = this.keys;
    const keysDown = ['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].some((c) => k.has(c));
    if (this.route && keysDown) this.route = null; // the keyboard takes over
    if (this.route) {
      const r = this.route;
      let [tx, tz] = r.pts[r.i];
      while (r.i < r.pts.length - 1 && Math.hypot(tx - this.x, tz - this.z) < 0.5) [tx, tz] = r.pts[++r.i];
      const dx = tx - this.x;
      const dz = tz - this.z;
      const L = Math.hypot(dx, dz);
      if (r.i === r.pts.length - 1 && L < 0.35) {
        this.speed = 0;
        this.route = null;
        this.send(true);
        r.onArrive?.();
        return;
      }
      this.speed = r.run ? RUN : WALK;
      const step = Math.min(L, this.speed * dt);
      this.heading = Math.atan2(dx, dz);
      const m = slide(this.free, this.x, this.z, (dx / L) * step, (dz / L) * step);
      this.x = m.x;
      this.z = m.z;
      this.send(true);
      return;
    }
    const [ux, uz] = this.up();
    const rx = -uz;
    const rz = ux;
    let mx = 0;
    let mz = 0;
    if (k.has('w') || k.has('arrowup')) { mx += ux; mz += uz; }
    if (k.has('s') || k.has('arrowdown')) { mx -= ux; mz -= uz; }
    if (k.has('d') || k.has('arrowright')) { mx += rx; mz += rz; }
    if (k.has('a') || k.has('arrowleft')) { mx -= rx; mz -= rz; }
    const len = Math.hypot(mx, mz);
    if (!len) {
      this.speed = 0;
      return;
    }
    this.speed = k.has('shift') ? RUN : WALK;
    mx /= len;
    mz /= len;
    this.heading = Math.atan2(mx, mz);
    const r = slide(this.free, this.x, this.z, mx * this.speed * dt, mz * this.speed * dt);
    this.x = r.x;
    this.z = r.z;
    this.send(true);
  }
}
