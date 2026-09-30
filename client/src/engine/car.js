// Driving. The client reads the keys and simulates the car, then sends its
// new position to the server as a move event, and the world only moves the
// car when that event comes back. With the local stub that round trip is
// instant; with a real server the same code path becomes the network.

const MAX_FWD = 22; // m/s, about 80 km/h
const MAX_REV = 6;
const ACCEL = 6.5; // 0 to 80 km/h in about 3.5 s
const BRAKE = 20;
const TURN = 1.7; // radians per second at full lock, at town speed

export class CarControl {
  // drivable(x, z) -> true where the car may be.
  constructor({ server, block, id, start, drivable }) {
    this.server = server;
    this.block = block;
    this.id = id;
    this.x = start.x;
    this.z = start.z;
    this.heading = start.heading;
    this.speed = 0;
    this.drivable = drivable;
    this.keys = new Set();
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onRoad(x, z) {
    return this.drivable(x, z);
  }

  update(dt) {
    const k = this.keys;
    const up = k.has('w') || k.has('arrowup');
    const down = k.has('s') || k.has('arrowdown');
    const left = k.has('a') || k.has('arrowleft');
    const right = k.has('d') || k.has('arrowright');
    const hand = k.has(' ');

    if (up) this.speed += (this.speed < 0 ? BRAKE : ACCEL) * dt;
    if (down) this.speed -= (this.speed > 0 ? BRAKE : ACCEL * 0.6) * dt;
    // Rolling resistance and drag.
    const drag = (hand ? 18 : 1.5) + Math.abs(this.speed) * 0.08;
    if (!up && !down) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), drag * dt);
    this.speed = Math.max(-MAX_REV, Math.min(MAX_FWD, this.speed));

    // Steering bites as the car moves, and calms down at speed.
    const steer = (left ? 1 : 0) - (right ? 1 : 0);
    const v = Math.abs(this.speed);
    const bite = Math.min(v / 5, 1) * (1 - 0.45 * (v / MAX_FWD));
    this.heading += steer * TURN * bite * Math.sign(this.speed) * dt * (hand ? 1.7 : 1);

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

    if (this.speed !== 0 || steer) {
      this.server.append({
        block: this.block,
        type: 'move',
        transient: true,
        id: this.id,
        props: { x: this.x, z: this.z, heading: this.heading, speed: this.speed },
      });
    }
  }

  get kmh() {
    return Math.round(Math.abs(this.speed) * 3.6);
  }
}
