// The street network as a graph, for driving like everyone else: along the
// roads, in the right-hand lane, turning at junctions, and pulling up at the
// kerb. Built from the city's road centre lines, split wherever two roads
// meet so that every junction is a node.

const MERGE = 1.0; // metres: points closer than this are the same junction
const TOUCH = 2.5; // metres: a road ending this close to another joins it
const UTURN = 35; // metres of cost for turning round at the start
const WRONG_SIDE = 160; // metres of cost for parking across the street from the goal

const right = (dx, dz) => [-dz, dx]; // right-hand side of travel, seen from above

export class RoadGraph {
  // inset: keep routes this far inside `bounds` (the world ends there).
  constructor(roads, bounds, inset = 4) {
    this.bounds = bounds;
    this.inset = inset;
    this.nodes = []; // [x, z]
    this.edges = []; // { a, b, width, len }
    this.adj = []; // node -> [{ to, edge }]
    const segs = [];
    for (const r of roads) {
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i];
        const b = r.points[i + 1];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.2) segs.push({ a, b, width: r.width, cuts: [0, 1] });
      }
    }
    // Where segments cross, or one ends on another, both get cut.
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s = segs[i];
        const t = segs[j];
        const hit = cross(s.a, s.b, t.a, t.b);
        if (hit) {
          s.cuts.push(hit[0]);
          t.cuts.push(hit[1]);
          continue;
        }
        for (const [p, q, other] of [[s.a, s, t], [s.b, s, t], [t.a, t, s], [t.b, t, s]]) {
          const u = project(p, other.a, other.b);
          if (u.t > 0.001 && u.t < 0.999 && u.d < TOUCH) other.cuts.push(u.t);
        }
      }
    }
    const nodeAt = (p) => {
      for (let k = 0; k < this.nodes.length; k++) {
        if (Math.hypot(this.nodes[k][0] - p[0], this.nodes[k][1] - p[1]) < MERGE) return k;
      }
      this.nodes.push([p[0], p[1]]);
      this.adj.push([]);
      return this.nodes.length - 1;
    };
    for (const s of segs) {
      const cuts = [...new Set(s.cuts.map((c) => Math.round(c * 1e4) / 1e4))].sort((x, y) => x - y);
      for (let k = 0; k < cuts.length - 1; k++) {
        const p = lerp(s.a, s.b, cuts[k]);
        const q = lerp(s.a, s.b, cuts[k + 1]);
        const a = nodeAt(p);
        const b = nodeAt(q);
        if (a === b) continue;
        const len = Math.hypot(this.nodes[b][0] - this.nodes[a][0], this.nodes[b][1] - this.nodes[a][1]);
        const e = this.edges.length;
        this.edges.push({ a, b, width: s.width, len });
        this.adj[a].push({ to: b, edge: e });
        this.adj[b].push({ to: a, edge: e });
      }
    }
  }

  // The nearest point on the network: { edge, t, p, d }.
  nearest(x, z) {
    let best = null;
    for (let e = 0; e < this.edges.length; e++) {
      const E = this.edges[e];
      const u = project([x, z], this.nodes[E.a], this.nodes[E.b]);
      if (!best || u.d < best.d) best = { edge: e, t: u.t, p: u.p, d: u.d };
    }
    return best;
  }

  // A drive from `from` (facing `heading`) to the kerb nearest `to`, on the
  // right-hand side of the road. Returns { pts, park, heading } or null.
  route(from, heading, to) {
    const S = this.nearest(from[0], from[1]);
    const G = this.nearest(to[0], to[1]);
    if (!S || !G) return null;
    const hx = Math.cos(heading);
    const hz = -Math.sin(heading);
    const SE = this.edges[S.edge];
    const GE = this.edges[G.edge];
    const dirOf = (E) => {
      const a = this.nodes[E.a];
      const b = this.nodes[E.b];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    };
    // Which way the car can leave: ahead costs nothing extra, turning round does.
    const sd = dirOf(SE);
    const fwdToB = sd[0] * hx + sd[1] * hz >= 0;
    const starts = [
      { node: SE.b, cost: SE.len * (1 - S.t) + (fwdToB ? 0 : UTURN), dir: sd, uturn: !fwdToB },
      { node: SE.a, cost: SE.len * S.t + (fwdToB ? UTURN : 0), dir: [-sd[0], -sd[1]], uturn: fwdToB },
    ];
    // Which way the car must arrive so the kerb it parks at faces the goal.
    const gd = dirOf(GE);
    const [rx, rz] = right(gd[0], gd[1]);
    const side = (to[0] - G.p[0]) * rx + (to[1] - G.p[1]) * rz;
    // Arriving the other way means parking across the street from the goal:
    // allowed, but a little dearer. Arriving through a dead end (the edge of
    // the map) means turning round in it: much dearer.
    const deadEnd = (k) => (this.adj[k].length < 2 ? 60 : 0);
    const ends = [
      { node: GE.a, cost: GE.len * G.t + (side >= 0 ? 0 : WRONG_SIDE) + deadEnd(GE.a), dir: gd },
      { node: GE.b, cost: GE.len * (1 - G.t) + (side < 0 ? 0 : WRONG_SIDE) + deadEnd(GE.b), dir: [-gd[0], -gd[1]] },
    ];

    // Same stretch of road, already heading the right way, goal ahead.
    let best = null;
    if (S.edge === G.edge) {
      for (const st of starts) {
        for (const en of ends) {
          if (st.dir[0] * en.dir[0] + st.dir[1] * en.dir[1] < 0) continue;
          const ahead = (G.p[0] - S.p[0]) * st.dir[0] + (G.p[1] - S.p[1]) * st.dir[1];
          if (ahead < 6) continue;
          const c = ahead + (st.uturn ? UTURN : 0);
          if (!best || c < best.cost) best = { cost: c, nodes: [], dir: en.dir };
        }
      }
    }
    // Otherwise the cheapest way through the junctions (Dijkstra; the
    // network is small).
    const n = this.nodes.length;
    for (const st of starts) {
      const dist = new Float64Array(n).fill(Infinity);
      const prev = new Int32Array(n).fill(-1);
      const done = new Uint8Array(n);
      dist[st.node] = st.cost;
      for (;;) {
        let k = -1;
        for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (k < 0 || dist[i] < dist[k])) k = i;
        if (k < 0) break;
        done[k] = 1;
        for (const { to: m, edge } of this.adj[k]) {
          const c = dist[k] + this.edges[edge].len;
          if (c < dist[m]) {
            dist[m] = c;
            prev[m] = k;
          }
        }
      }
      for (const en of ends) {
        const c = dist[en.node] + en.cost;
        if (c === Infinity || (best && c >= best.cost)) continue;
        const nodes = [];
        for (let k = en.node; k !== -1; k = prev[k]) nodes.push(k);
        nodes.reverse();
        best = { cost: c, nodes, dir: en.dir };
      }
    }
    if (!best) return null;

    // Centre line of the drive, with the width of road under each leg.
    const centre = [S.p, ...best.nodes.map((k) => this.nodes[k]), G.p];
    const widths = [];
    const legW = (p, q) => {
      const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      return this.edges[this.nearest(m[0], m[1]).edge].width;
    };
    const pts = [centre[0]];
    for (let i = 1; i < centre.length; i++) {
      const q = centre[i];
      const p = pts[pts.length - 1];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.5) pts.push(q);
    }
    if (pts.length < 2) return null;
    for (let i = 0; i < pts.length - 1; i++) widths.push(legW(pts[i], pts[i + 1]));
    const lane = offsetPolyline(pts, widths.map(laneOffset));

    // Pull in to the kerb: a point a car length before the stop, still in
    // lane, then the stop itself against the kerb.
    const d = best.dir;
    const [kx, kz] = right(d[0], d[1]);
    const kerb = GE.width / 2 - 1.4;
    const park = [G.p[0] + kx * kerb, G.p[1] + kz * kerb];
    const last = lane[lane.length - 1];
    const lead = Math.min(9, Math.hypot(last[0] - lane[lane.length - 2][0], last[1] - lane[lane.length - 2][1]) * 0.6);
    lane[lane.length - 1] = [last[0] - d[0] * lead, last[1] - d[1] * lead];
    lane.push(park);
    // Start from where the car actually is; stay inside the world.
    lane[0] = [from[0], from[1]];
    const b = this.bounds;
    if (b) {
      const k = this.inset;
      for (const p of lane) {
        p[0] = Math.min(b.maxX - k, Math.max(b.minX + k, p[0]));
        p[1] = Math.min(b.maxZ - k, Math.max(b.minZ + k, p[1]));
      }
    }
    return { pts: lane, park, heading: Math.atan2(-d[1], d[0]) };
  }
}

// How far right of the centre line to drive: the middle of the right lane on
// a two-way road, a little right of centre on a narrow one.
function laneOffset(width) {
  return width >= 8 ? width / 4 : 0.6;
}

// Offset a polyline to the right by a per-leg distance, meeting at mitred corners.
function offsetPolyline(pts, offs) {
  const out = [];
  const legs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const L = Math.hypot(x1 - x0, z1 - z0) || 1;
    const d = [(x1 - x0) / L, (z1 - z0) / L];
    const [rx, rz] = right(d[0], d[1]);
    legs.push({ a: [x0 + rx * offs[i], z0 + rz * offs[i]], b: [x1 + rx * offs[i], z1 + rz * offs[i]], d });
  }
  out.push(legs[0].a);
  for (let i = 0; i < legs.length - 1; i++) {
    const l = legs[i];
    const m = legs[i + 1];
    const denom = l.d[0] * m.d[1] - l.d[1] * m.d[0];
    if (Math.abs(denom) < 0.05) {
      out.push(l.b);
      continue;
    }
    const t = ((m.a[0] - l.a[0]) * m.d[1] - (m.a[1] - l.a[1]) * m.d[0]) / denom;
    const p = [l.a[0] + l.d[0] * t, l.a[1] + l.d[1] * t];
    // A U-turn or hairpin makes a long spike: fall back to the leg ends.
    if (Math.hypot(p[0] - pts[i + 1][0], p[1] - pts[i + 1][1]) > 12) out.push(l.b, m.a);
    else out.push(p);
  }
  out.push(legs[legs.length - 1].b);
  return out;
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function project(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
  const q = [a[0] + dx * t, a[1] + dz * t];
  return { t, p: q, d: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

// Where segments ab and cd cross: [t on ab, u on cd] or null.
function cross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) return null;
  return [t, u];
}
