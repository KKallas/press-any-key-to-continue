// Route planning on a grid laid over the city. Each cell is free or
// blocked (from a collision map) and has a cost: tarmac is cheap, sidewalks
// and lots dearer, so a sensible driver keeps to the road and a reckless
// one cuts across. A* finds the cheapest route; string-pulling then throws
// away every point the body could skip in a straight line.

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p];
      k[p] = key; v[p] = val;
      i = p;
    }
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[i], k[m]] = [k[m], k[i]];
        [v[i], v[m]] = [v[m], v[i]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.k.length;
  }
}

export class NavGrid {
  // free(x, z): may the body be here. surface(x, z): on tarmac.
  constructor({ bounds, free, surface, cell }) {
    this.b = bounds;
    this.cell = cell;
    this.w = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.h = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    this.free = new Uint8Array(this.w * this.h);
    this.road = new Uint8Array(this.w * this.h);
    this.freeAt = free;
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const [x, z] = this.centre(i, j);
        const k = j * this.w + i;
        // Free only if the whole cell is: centre and corners. A route through
        // a cell that's only half clear is a route into a wall.
        const h = cell * 0.5;
        this.free[k] = free(x, z) && free(x - h, z - h) && free(x + h, z - h) && free(x - h, z + h) && free(x + h, z + h) ? 1 : 0;
        this.road[k] = surface(x, z) ? 1 : 0;
      }
    }
  }

  centre(i, j) {
    return [this.b.minX + (i + 0.5) * this.cell, this.b.minZ + (j + 0.5) * this.cell];
  }

  cellOf(x, z) {
    return [Math.floor((x - this.b.minX) / this.cell), Math.floor((z - this.b.minZ) / this.cell)];
  }

  inside(i, j) {
    return i >= 0 && j >= 0 && i < this.w && j < this.h;
  }

  // The free cell nearest to (x, z), searching outwards in rings.
  nearestFree(x, z, maxRing = 40) {
    const [ci, cj] = this.cellOf(x, z);
    for (let r = 0; r <= maxRing; r++) {
      let best = null;
      let bd = Infinity;
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !this.inside(i, j)) continue;
          if (!this.free[j * this.w + i]) continue;
          const [px, pz] = this.centre(i, j);
          const d = Math.hypot(px - x, pz - z);
          if (d < bd) {
            bd = d;
            best = [i, j];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // offRoad: cost of a cell that isn't tarmac, relative to 1 for tarmac.
  // If the goal can't be reached (a yard boxed in by buildings), the route
  // goes to the reachable spot closest to it instead; `reached` says which.
  findPath(from, to, { offRoad = 3 } = {}) {
    const s = this.nearestFree(from[0], from[1]);
    const g = this.nearestFree(to[0], to[1]);
    if (!s || !g) return null;
    const W = this.w;
    const start = s[1] * W + s[0];
    const goal = g[1] * W + g[0];
    const cost = new Float32Array(W * this.h).fill(Infinity);
    const came = new Int32Array(W * this.h).fill(-1);
    const open = new Heap();
    const H = (k) => Math.hypot((k % W) - g[0], Math.floor(k / W) - g[1]);
    cost[start] = 0;
    open.push(H(start), start);
    const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = false;
    let guard = 0;
    let best = start;
    let bestH = H(start);
    while (open.size && guard++ < 400000) {
      const k = open.pop();
      if (k === goal) {
        found = true;
        break;
      }
      const hk = H(k);
      if (hk < bestH) {
        bestH = hk;
        best = k;
      }
      const i = k % W;
      const j = (k - i) / W;
      for (const [di, dj, len] of steps) {
        const ni = i + di;
        const nj = j + dj;
        if (!this.inside(ni, nj)) continue;
        const nk = nj * W + ni;
        if (!this.free[nk]) continue;
        // No squeezing diagonally between two blocked cells.
        if (di && dj && (!this.free[j * W + ni] || !this.free[nj * W + i])) continue;
        const c = cost[k] + len * (this.road[nk] ? 1 : offRoad);
        if (c < cost[nk]) {
          cost[nk] = c;
          came[nk] = k;
          open.push(c + H(nk), nk);
        }
      }
    }
    const end = found ? goal : best;
    if (end === start) return null;
    const cells = [];
    for (let k = end; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => this.centre(k % W, Math.floor(k / W)));
    pts[0] = [from[0], from[1]];
    const out = this.smooth(pts, offRoad);
    out.reached = found;
    return out;
  }

  // Can the body go straight from a to b? Samples the free map every half
  // cell, and (for a careful driver) refuses shortcuts across the paving.
  clear(a, b, offRoad) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n = Math.max(1, Math.ceil(L / (this.cell * 0.25)));
    // Check a little either side of the line too: a body has width.
    const px = (-(b[1] - a[1]) / L) * this.cell * 0.6;
    const pz = ((b[0] - a[0]) / L) * this.cell * 0.6;
    let rough = 0;
    for (let s = 0; s <= n; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / n;
      const z = a[1] + ((b[1] - a[1]) * s) / n;
      for (const o of [0, 1, -1]) {
        const [i, j] = this.cellOf(x + px * o, z + pz * o);
        if (!this.inside(i, j) || !this.free[j * this.w + i]) return false;
      }
      const [i, j] = this.cellOf(x, z);
      if (!this.road[j * this.w + i]) rough++;
    }
    return offRoad < 2 || rough <= 1;
  }

  // Learn from bumping into something: block the cells around (x, z).
  block(x, z, radius) {
    const [ci, cj] = this.cellOf(x, z);
    const r = Math.ceil(radius / this.cell);
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (!this.inside(i, j)) continue;
        const [px, pz] = this.centre(i, j);
        if (Math.hypot(px - x, pz - z) <= radius) this.free[j * this.w + i] = 0;
      }
    }
  }

  smooth(pts, offRoad) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.clear(pts[i], pts[j], offRoad)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}

export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}
