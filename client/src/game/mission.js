// The link: somewhere to be, and a time to be there by. Nobody says what
// the link is for. The map monitor shows the place and the time; get the
// skin there (by car or on foot) before the clock reads it, and the link
// is made. Miss it and the window closes; another opens somewhere else.
//
// The clock only ever reads 23:59:SS, so deadlines are seconds on that
// loop. The window is set so that a careful drive won't quite make it:
// you'll have to cut across the grass, or speed.

const REACH = 9; // metres from the door that count as being there
const CAREFUL = 9.5; // m/s: a normal drive, lights and lanes and parking
const TIGHT = 0.82; // share of the careful time you get

export class Mission {
  // doors: world doors. route(from, to): a careful drive's length in metres,
  // or null.
  constructor({ doors, route, rng = Math.random }) {
    this.doors = doors.filter((d) => d.kind === 'street');
    this.route = route;
    this.rng = rng;
    this.state = 'idle';
    this.count = { made: 0, lost: 0 };
  }

  // A new window, from where the skin is now.
  next(now, from) {
    const far = this.doors.filter((d) => {
      const dist = Math.hypot(d.hx - from[0], d.hz - from[1]);
      return dist > 110 && dist < 280;
    });
    const pool = far.length ? far : this.doors;
    const door = pool[Math.floor(this.rng() * pool.length)];
    const len = this.route(from, [door.hx, door.hz]) ?? Math.hypot(door.hx - from[0], door.hz - from[1]) * 1.35;
    const secs = Math.max(12, Math.min(55, Math.round(((len / CAREFUL) + 6) * TIGHT)));
    this.target = door;
    this.opened = now;
    this.deadline = now + secs;
    this.state = 'open';
    return this;
  }

  // Seconds left on the window.
  left(now) {
    return Math.max(0, this.deadline - now);
  }

  // What the clock will read when the window shuts.
  get clock() {
    return `23:59:${String(Math.floor(this.deadline) % 60).padStart(2, '0')}`;
  }

  // player: { x, z, insidePlot }. Returns 'made', 'lost' or null.
  update(now, player) {
    if (this.state !== 'open') {
      if (now > this.until) return 'next';
      return null;
    }
    const d = this.target;
    const there = player.insidePlot === d.plot || Math.hypot(player.x - d.hx, player.z - d.hz) < REACH;
    if (there) {
      this.state = 'made';
      this.until = now + 5;
      this.count.made++;
      return 'made';
    }
    if (now >= this.deadline) {
      this.state = 'lost';
      this.until = now + 4;
      this.count.lost++;
      return 'lost';
    }
    return null;
  }
}
