// Driving. The car is driven through its controls (throttle, brake, steer,
// handbrake), whether they come from the keyboard or from the autopilot, so
// the autopilot can only do what a driver could. The client simulates the
// car and sends its new position to the server as a move event; the world
// only moves the car when that event comes back.

const MAX_FWD = 22; // m/s, about 80 km/h
const MAX_REV = 6;
const ACCEL = 6.5; // 0 to 80 km/h in about 3.5 s
const BRAKE = 20;
const TURN = 1.7; // radians per second at full lock, at town speed
const GRAVITY = 9.8;

export const NO_INPUT = { up: false, down: false, left: false, right: false, hand: false };

export class CarControl {
  // free(x, z): no barrier here (buildings, posts). surface(x, z): on
  // tarmac; anywhere else is kerbs and paving, and slower going.
  constructor({ server, block, id, start, free, surface }) {
    this.server = server;
    this.block = block;
    this.id = id;
    this.x = start.x;
    this.z = start.z;
    this.heading = start.heading;
    this.speed = 0;
    this.free = free;
    this.surface = surface ?? (() => true);
    this.occupied = true;
    this.air = 0; // metres off the ground
    this.vy = 0;
    this.airtime = 0; // seconds of the last jump, for the HUD
    this.keys = new Set();
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onRoad(x, z) {
    return this.free(x, z);
  }

  keyboard() {
    const k = this.keys;
    return {
      up: k.has('w') || k.has('arrowup'),
      down: k.has('s') || k.has('arrowdown'),
      left: k.has('a') || k.has('arrowleft'),
      right: k.has('d') || k.has('arrowright'),
      hand: k.has(' '),
    };
  }

  // Is the driver touching the keyboard at all? (It takes over from the autopilot.)
  get keyboardActive() {
    const i = this.keyboard();
    return i.up || i.down || i.left || i.right || i.hand;
  }

  // input: controls from the autopilot; without it the keyboard drives.
  update(dt, input) {
    // An empty car rolls to a stop.
    const c = !this.occupied ? NO_INPUT : input ?? this.keyboard();
    const flying = this.air > 0;

    if (!flying) {
      if (c.up) this.speed += (this.speed < 0 ? BRAKE : ACCEL) * dt;
      if (c.down) this.speed -= (this.speed > 0 ? BRAKE : ACCEL * 0.6) * dt;
    }
    // Rolling resistance and drag; paving, kerbs and yards are rougher.
    const rough = !this.surface(this.x, this.z);
    if (!flying) {
      const drag = (c.hand ? 18 : 1.5) + Math.abs(this.speed) * (rough ? 0.35 : 0.08);
      if (rough && Math.abs(this.speed) > MAX_FWD * 0.55) this.speed *= 1 - 1.5 * dt;
      if (!c.up && !c.down) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), drag * dt);
    }
    this.speed = Math.max(-MAX_REV, Math.min(MAX_FWD, this.speed));

    // Steering bites as the car moves, and calms down at speed. No grip in the air.
    const steer = flying ? 0 : (c.left ? 1 : 0) - (c.right ? 1 : 0);
    const v = Math.abs(this.speed);
    const bite = Math.min(v / 5, 1) * (1 - 0.45 * (v / MAX_FWD));
    this.heading += steer * TURN * bite * Math.sign(this.speed) * dt * (c.hand ? 1.7 : 1);

    const nx = this.x + Math.cos(this.heading) * this.speed * dt;
    const nz = this.z - Math.sin(this.heading) * this.speed * dt;
    if (this.onRoad(nx, nz)) {
      this.x = nx;
      this.z = nz;
    } else if (this.onRoad(nx, this.z)) {
      this.x = nx; // scrape along the kerb
      this.speed *= 1 - 1.2 * dt;
    } else if (this.onRoad(this.x, nz)) {
      this.z = nz;
      this.speed *= 1 - 1.2 * dt;
    } else {
      this.speed *= -0.25; // bounce off
    }

    // Hitting a kerb fast enough throws the car into the air.
    const nowRough = !this.surface(this.x, this.z);
    if (!flying && !rough && nowRough && Math.abs(this.speed) > 14) {
      this.vy = Math.min(Math.abs(this.speed) * 0.2, 5);
      this.air = 0.01;
      this.airtime = 0;
    }
    if (this.air > 0) {
      this.vy -= GRAVITY * dt;
      this.air += this.vy * dt;
      this.airtime += dt;
      if (this.air <= 0) {
        this.air = 0;
        this.vy = 0;
        this.speed *= 0.88; // landing costs a little
      }
    }

    if (this.speed !== 0 || steer || this.air > 0) {
      if (!this.occupied && Math.abs(this.speed) < 0.05) this.speed = 0;
      this.server.append({
        block: this.block,
        type: 'move',
        transient: true,
        id: this.id,
        props: { x: this.x, z: this.z, heading: this.heading, speed: this.speed, air: this.air, pitch: this.air > 0 ? this.vy * 0.04 : 0 },
      });
    }
  }

  get kmh() {
    return Math.round(Math.abs(this.speed) * 3.6);
  }
}
