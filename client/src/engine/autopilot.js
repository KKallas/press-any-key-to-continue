// The autopilot drives the car to a waypoint through the car's own
// controls. Each step it looks a little way down the route, steers towards
// that point, and picks a speed it can still stop or turn from.
//
//   normal  keeps to the road, slows for corners, stops at the waypoint
//   stunt   takes the fastest line over sidewalks and lots, handbrake
//           drifts through the sharp turns, and doesn't mind a kerb jump

import { pathLength } from './nav.js';

// top: speed on a straight. corner90: speed for a right-angle turn.
// brake: the deceleration the driver plans with (the car can do 20 m/s²).
const MODES = {
  normal: { top: 13, offRoadTop: 7, corner90: 4.5, brake: 6, stopDecel: 6, offRoad: 3 },
  stunt: { top: 22, offRoadTop: 22, corner90: 8, brake: 13, stopDecel: 12, offRoad: 1.15 },
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Autopilot {
  // plan(from, to, offRoad) -> [[x, z], ...] or null
  // blocked(x, z): tell the planner there is something in the way here.
  // see(a, b): can the car drive straight from a to b.
  constructor({ car, plan, blocked, see }) {
    this.car = car;
    this.plan = plan;
    this.blocked = blocked;
    this.see = see ?? (() => true);
    this.route = null;
  }

  get mode() {
    return this.route?.mode ?? null;
  }

  go(to, mode = 'normal') {
    const m = MODES[mode];
    const pts = this.plan([this.car.x, this.car.z], to, m.offRoad);
    if (!pts || pts.length < 2) {
      this.route = null;
      return false;
    }
    // The goal may be out of reach (boxed in): drive to the nearest point.
    const end = pts[pts.length - 1];
    this.route = { pts, goal: pts.reached ? to : end, wanted: to, reached: pts.reached, mode, m, i: 1, stuckFor: 0, recover: 0, since: 0 };
    return true;
  }

  cancel() {
    this.route = null;
  }

  // Distance left along the route from the car.
  remaining() {
    const r = this.route;
    if (!r) return 0;
    const car = this.car;
    const next = r.pts[r.i];
    return Math.hypot(next[0] - car.x, next[1] - car.z) + pathLength(r.pts.slice(r.i));
  }

  // The point `ahead` metres down the route from the car.
  lookahead(ahead) {
    const r = this.route;
    let px = this.car.x;
    let pz = this.car.z;
    let left = ahead;
    for (let k = r.i; k < r.pts.length; k++) {
      const [qx, qz] = r.pts[k];
      const L = Math.hypot(qx - px, qz - pz);
      if (L >= left) return [px + ((qx - px) * left) / L, pz + ((qz - pz) * left) / L];
      left -= L;
      px = qx;
      pz = qz;
    }
    return r.pts[r.pts.length - 1];
  }

  // The fastest speed from which every corner ahead can still be made:
  // each corner has a speed it can be taken at, and the car has to be able
  // to brake down to it in the distance left before it.
  cornerSpeed(m) {
    const r = this.route;
    const pts = [[this.car.x, this.car.z], ...r.pts.slice(r.i)];
    let dist = 0;
    let limit = Infinity;
    for (let k = 1; k < pts.length - 1 && dist < 120; k++) {
      dist += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      const a = Math.atan2(pts[k][1] - pts[k - 1][1], pts[k][0] - pts[k - 1][0]);
      const b = Math.atan2(pts[k + 1][1] - pts[k][1], pts[k + 1][0] - pts[k][0]);
      const turn = Math.abs(wrap(b - a));
      if (turn < 0.15) continue;
      const vTurn = m.top - (m.top - m.corner90) * Math.min(turn / (Math.PI / 2), 1.3);
      // Start braking a car length early.
      limit = Math.min(limit, Math.sqrt(Math.max(vTurn, 2) ** 2 + 2 * m.brake * Math.max(0, dist - 4)));
    }
    return limit;
  }

  // Controls for this step, or null when there's no route.
  update(dt) {
    const r = this.route;
    if (!r) return null;
    const car = this.car;
    const m = r.m;
    const v = car.speed;
    r.since += dt;

    // A route point counts as passed when the car is right on it, or past
    // it along the next leg. Passing corners early is how cars cut them.
    while (r.i < r.pts.length - 1) {
      const [px, pz] = r.pts[r.i];
      const [qx, qz] = r.pts[r.i + 1];
      const near = Math.hypot(px - car.x, pz - car.z) < 1.5 + Math.abs(v) * 0.1;
      const past = (car.x - px) * (qx - px) + (car.z - pz) * (qz - pz) > 0 && this.see([car.x, car.z], [qx, qz]);
      if (!near && !past) break;
      r.i++;
    }

    const left = this.remaining();
    if (left < 2.5) {
      // Arrived: stop (in stunt mode, with a flourish of handbrake).
      if (Math.abs(v) < 0.6) {
        this.route = null;
        return { up: false, down: false, left: false, right: false, hand: false };
      }
      return { up: v < 0, down: v > 0, left: false, right: false, hand: m === MODES.stunt };
    }

    // Stuck against something: back off with the wheel turned the other way.
    if (r.recover > 0) {
      r.recover -= dt;
      if (r.recover <= 0) this.go(r.wanted, r.mode);
      return { up: false, down: true, left: r.recoverSteer < 0, right: r.recoverSteer > 0, hand: false };
    }

    // Aim down the route, but only at a point the car can drive straight to;
    // otherwise at the next corner.
    let [tx, tz] = this.lookahead(5 + Math.abs(v) * 0.5);
    if (!this.see([car.x, car.z], [tx, tz])) [tx, tz] = r.pts[r.i];
    const want = Math.atan2(-(tz - car.z), tx - car.x);
    const err = wrap(want - car.heading);

    // Speed: the top speed for the ground, slower for corners, and slow
    // enough to stop at the waypoint.
    const offRoad = !car.surface(car.x, car.z);
    let target = offRoad ? m.offRoadTop : m.top;
    target = Math.min(target, this.cornerSpeed(m));
    target = Math.min(target, Math.sqrt(2 * m.stopDecel * Math.max(0, left - 2)));
    // Pointing the wrong way: slow right down first.
    if (Math.abs(err) > 1.2) target = Math.min(target, m === MODES.stunt ? 12 : 5);

    const c = { up: false, down: false, left: false, right: false, hand: false };
    const behind = Math.abs(err) > 2.0;
    if (behind && m !== MODES.stunt && Math.abs(v) < 4) {
      // Target behind and no room to swing round: reverse, wheel the other way.
      c.down = true;
      c.left = err < 0;
      c.right = err > 0;
    } else {
      c.left = err > 0.04;
      c.right = err < -0.04;
      if (v < target - 0.5) c.up = true;
      else if (v > target + 1) c.down = true;
      // Stunt: yank the handbrake for a sharp turn at speed.
      if (m === MODES.stunt && Math.abs(err) > 0.7 && v > 10) c.hand = true;
      // A J-turn when the target is behind at speed.
      if (m === MODES.stunt && behind && v > 6) c.hand = true;
    }

    // Stuck: pushing but not moving.
    if ((c.up || c.down) && Math.abs(v) < 0.4 && r.since > 1) r.stuckFor += dt;
    else r.stuckFor = 0;
    if (r.stuckFor > 1.2) {
      r.stuckFor = 0;
      r.recover = 0.9;
      r.recoverSteer = err > 0 ? 1 : -1;
      // Whatever we're pushing against, the planner should know about it.
      const dir = c.down ? -1 : 1;
      this.blocked?.(car.x + Math.cos(car.heading) * 2.4 * dir, car.z - Math.sin(car.heading) * 2.4 * dir);
    }

    // Drifted far off the route: plan again from here.
    const [nx, nz] = r.pts[r.i];
    const [px, pz] = r.pts[r.i - 1] ?? [car.x, car.z];
    const off = distToSegment(car.x, car.z, px, pz, nx, nz);
    if (off > 9 && r.since > 0.5) this.go(r.wanted, r.mode);

    return c;
  }
}

function distToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}
