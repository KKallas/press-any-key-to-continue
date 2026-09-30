// The player's drone. It circles its aim point on its own, the way a
// surveillance drone holds an orbit over a target. By default it is locked
// on to the player (car or skin) and follows; dragging breaks the lock to
// look around, F locks back on. Z and X steer the orbit, scroll zooms.

import * as THREE from 'three';

const DEG = Math.PI / 180;
const LIMIT = 70; // metres from the centre the aim point may wander

export class DroneControl {
  constructor(entry, canvas) {
    this.entry = entry;
    this.enabled = true;
    this.target = new THREE.Vector2(entry.target[0], entry.target[2]);
    this.theta = 0.7;
    this.fov = entry.fov;
    this.baseFov = entry.fov;
    this.keys = new Set();
    this.drag = null;
    this.lock = null; // () => {x, z, vx, vz, speed} of whatever we follow
    this.limit = LIMIT;
    this.locked = true;
    this.climb = 0; // extra altitude, like GTA2's camera rising with speed

    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('button')) return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'f' || e.key === 'F') this.locked = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    // A press that barely moves is a click (onClick); one that moves is a
    // drag, which looks around and breaks the lock.
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
      d.moved = true;
      this.locked = false;
      this.pan(e.clientX - d.x, e.clientY - d.y);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved && performance.now() - d.t0 < 500) this.onClick?.(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointercancel', () => (this.drag = null));
    window.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.zoom(Math.exp(e.deltaY * 0.0012));
    }, { passive: true });
  }

  get altitude() {
    return this.entry.altitude + this.climb;
  }

  get distance() {
    return this.altitude / Math.tan(this.entry.elevation * DEG);
  }

  // Ground metres covered by one screen pixel at the aim point.
  metresPerPixel() {
    const slant = Math.hypot(this.altitude, this.distance);
    return (2 * slant * Math.tan((this.fov * DEG) / 2)) / window.innerHeight;
  }

  pan(dx, dy) {
    const k = this.metresPerPixel();
    const s = Math.sin(this.theta);
    const c = Math.cos(this.theta);
    // Screen right and screen up, projected onto the ground.
    const right = [c, -s];
    const fwd = [-s, -c];
    this.target.x += -dx * k * right[0] + dy * k * fwd[0] * 1.6;
    this.target.y += -dx * k * right[1] + dy * k * fwd[1] * 1.6;
    this.target.clampScalar(-this.limit, this.limit);
  }

  zoom(factor) {
    this.fov = THREE.MathUtils.clamp(this.fov * factor, 8, 70);
  }

  update(dt) {
    if (!this.enabled) return;
    this.theta += this.entry.orbitSpeed * dt;
    const k = this.keys;
    if (this.locked && this.lock) {
      // Aim a little ahead of a moving target, and ease towards it.
      const t = this.lock();
      const ax = t.x + t.vx * 0.8;
      const az = t.z + t.vz * 0.8;
      const ease = 1 - Math.exp(-dt * 3);
      this.target.x += (ax - this.target.x) * ease;
      this.target.y += (az - this.target.y) * ease;
      // The faster the car, the higher the drone climbs to keep the road ahead in view.
      // On foot the drone comes down closer; in a car it climbs with speed.
      const want = t.foot ? -this.entry.altitude * 0.4 : Math.abs(t.speed ?? 0) * (this.entry.climbPerSpeed ?? 0);
      this.climb += (want - this.climb) * (1 - Math.exp(-dt * 1.2));
    } else {
      this.climb += (0 - this.climb) * (1 - Math.exp(-dt * 1.2));
    }
    if (k.has('z')) this.theta -= 0.8 * dt;
    if (k.has('x')) this.theta += 0.8 * dt;
    if (k.has('+') || k.has('=')) this.zoom(Math.exp(-1.2 * dt));
    if (k.has('-') || k.has('_')) this.zoom(Math.exp(1.2 * dt));
  }

  // Place the camera for the next recorded frame.
  apply() {
    const cam = this.entry.camera;
    const d = this.distance;
    cam.position.set(
      this.target.x + Math.sin(this.theta) * d,
      this.altitude,
      this.target.y + Math.cos(this.theta) * d,
    );
    cam.lookAt(this.target.x, 0, this.target.y);
    if (cam.fov !== this.fov) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  telemetry() {
    const e = String(4400 + Math.round(this.target.x * 10)).padStart(5, '0');
    const n = String(1200 - Math.round(this.target.y * 10)).padStart(5, '0');
    return {
      alt: Math.round(this.altitude * 3.28084),
      // Screen-up direction on the ground, as a compass heading.
      hdg: ((((this.theta + Math.PI) / DEG) % 360) + 360) % 360,
      zoom: (this.baseFov / this.fov).toFixed(1),
      // A made-up grid reference; the city isn't on anyone's map.
      grid: `${e} ${n}`,
      mode: this.locked ? 'TRACK' : 'FREE',
    };
  }
}
