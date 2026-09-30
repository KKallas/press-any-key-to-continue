// Art Deco building generator.
//
// Input per plot: a footprint polygon (from the map or the plot cutter), a
// height, a seed, and optionally a style. Output: geometry, merged for a
// whole block so the city costs a handful of draw calls per block.
//
// The recipe, taken from 1920s-30s towers: a podium that fills the plot,
// then setback tiers that step inwards as they rise, vertical piers running
// up every face, and a crown on top (stepped ziggurat, spire, fins, or a
// neon band). Everything is chosen from the seed, so the same plot always
// grows the same building until its prompt or style changes.

import * as THREE from 'three';
import { windowTexture, rng } from '../engine/textures.js';

const FLOOR = 3.3; // metres per storey
const BAY = 2.4; // metres per window bay
const CELLS = 16; // window texture is 16 x 16 bays
const GROUND = 0.15; // sidewalk height

// ---- Materials, shared by every building in the city ----------------------

let MATS = null;
export function decoMaterials() {
  if (MATS) return MATS;
  const windows = windowTexture(CELLS, CELLS, 4242);
  windows.wrapS = windows.wrapT = THREE.RepeatWrapping;
  MATS = {
    walls: new THREE.MeshStandardMaterial({
      vertexColors: true,
      emissiveMap: windows,
      emissive: 0xffffff,
      emissiveIntensity: 1.3,
      roughness: 0.6,
      metalness: 0.05,
    }),
    roof: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.45 }),
    // Unlit and brighter than white, so neon and beacons bloom.
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(5, 5, 5) }),
  };
  return MATS;
}

// ---- A small geometry builder ---------------------------------------------

export class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  vert(p, n, uv, c) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }

  // Adds a triangle facing along n, whatever order the points came in.
  tri(i0, i1, i2, n) {
    const p = this.pos;
    const ax = p[i1 * 3] - p[i0 * 3], ay = p[i1 * 3 + 1] - p[i0 * 3 + 1], az = p[i1 * 3 + 2] - p[i0 * 3 + 2];
    const bx = p[i2 * 3] - p[i0 * 3], by = p[i2 * 3 + 1] - p[i0 * 3 + 1], bz = p[i2 * 3 + 2] - p[i0 * 3 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(i0, i1, i2);
    else this.idx.push(i0, i2, i1);
  }

  quad(a, b, c, d, n, uvs, col) {
    const i = [a, b, c, d].map((p, k) => this.vert(p, n, uvs[k], col));
    this.tri(i[0], i[1], i[2], n);
    this.tri(i[0], i[2], i[3], n);
  }

  // One wall from footprint point a to b, between heights y0 and y1.
  // Window UVs follow real metres, so floors line up across tiers.
  wall(a, b, y0, y1, out, col, uvo) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = [out[0], 0, out[1]];
    const u0 = uvo[0];
    const u1 = uvo[0] + len / BAY / CELLS;
    const v0 = y0 / FLOOR / CELLS + uvo[1];
    const v1 = y1 / FLOOR / CELLS + uvo[1];
    this.quad(
      [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]],
      n, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], col,
    );
  }

  // A flat polygon cap at height y.
  cap(pts, y, col, up = true) {
    const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const n = [0, up ? 1 : -1, 0];
    const base = pts.map((p) => this.vert([p[0], y, p[1]], n, [0, 0], col));
    for (const t of tris) this.tri(base[t[0]], base[t[1]], base[t[2]], n);
  }

  // An axis-aligned box rotated about Y by angle.
  box(cx, cy, cz, sx, sy, sz, angle, col) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const N = (x, z) => [x * c + z * s, 0, -x * s + z * c];
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.quad(P(hx, -hy, -hz), P(hx, -hy, hz), P(hx, hy, hz), P(hx, hy, -hz), N(1, 0), uv, col);
    this.quad(P(-hx, -hy, hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(-hx, hy, hz), N(-1, 0), uv, col);
    this.quad(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), N(0, 1), uv, col);
    this.quad(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), N(0, -1), uv, col);
    this.quad(P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz), [0, 1, 0], uv, col);
  }

  mesh(material) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return new THREE.Mesh(g, material);
  }
}

// ---- Polygon helpers --------------------------------------------------------

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

function centroid(pts) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    const f = x0 * z1 - x1 * z0;
    a += f;
    cx += (x0 + x1) * f;
    cz += (z0 + z1) * f;
  }
  return Math.abs(a) < 1e-6 ? pts[0] : [cx / (3 * a), cz / (3 * a)];
}

export function inside(pt, pts) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > pt[1] !== zj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// The smallest rectangle around the footprint: the frame the tower tiers use.
function orientedBox(pts) {
  const h = hull(pts);
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / L;
    const uz = (b[1] - a[1]) / L;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of h) {
      const u = p[0] * ux + p[1] * uz;
      const v = -p[0] * uz + p[1] * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = { area, ux, uz, hu: (maxU - minU) / 2, hv: (maxV - minV) / 2, cx: cu * ux - cv * uz, cz: cu * uz + cv * ux };
    }
  }
  return best;
}

function rectPoints(o, su, sv, cx = o.cx, cz = o.cz) {
  const { ux, uz } = o;
  const hu = o.hu * su;
  const hv = o.hv * sv;
  const vx = -uz;
  const vz = ux;
  return [
    [cx - ux * hu - vx * hv, cz - uz * hu - vz * hv],
    [cx + ux * hu - vx * hv, cz + uz * hu - vz * hv],
    [cx + ux * hu + vx * hv, cz + uz * hu + vz * hv],
    [cx - ux * hu + vx * hv, cz - uz * hu + vz * hv],
  ];
}

// ---- Style -----------------------------------------------------------------

// Linear colours; the night light is dim, so these read as dark stone.
const STONE = [
  [0.26, 0.24, 0.22], // soot-stained limestone
  [0.32, 0.27, 0.21], // sandstone
  [0.2, 0.22, 0.26], // blue-grey granite
  [0.28, 0.27, 0.26], // warm grey
  [0.15, 0.15, 0.16], // near black
];
const NEON = ['#35e6ff', '#ff2fb4', '#ffae2f', '#59ff7a', '#b06bff'];

// A style is plain data, so a prompt (through an LLM) can set any of it.
export function defaultStyle(plot, area) {
  const r = rng(plot.seed);
  const H = plot.height;
  let tiers = H < 12 ? 1 : H < 26 ? 2 : H < 50 ? 3 : 4;
  if (area < 70) tiers = Math.min(tiers, 2);
  const crowns = H > 40 ? ['ziggurat', 'spire', 'fins', 'ziggurat'] : H > 20 ? ['ziggurat', 'flat', 'fins'] : ['flat'];
  return {
    tiers,
    podium: 0.3 + r() * 0.25, // share of the height the podium takes
    setback: 0.72 + r() * 0.1, // how much each tier shrinks
    pierSpacing: 2.4 * (1 + Math.floor(r() * 2)), // every bay or every other bay
    pierDepth: 0.3 + r() * 0.25,
    crown: crowns[Math.floor(r() * crowns.length)],
    neon: H > 30 && r() < 0.28 ? NEON[Math.floor(r() * NEON.length)] : null,
    stone: STONE[Math.floor(r() * STONE.length)],
    trim: r() < 0.35 ? [0.3, 0.22, 0.12] : null, // bronze trim, or stone
  };
}

// ---- The generator -----------------------------------------------------------

// Adds one building to the block's builders and returns its overlay outline.
function building(plot, B) {
  const H = plot.height;
  let fp = plot.footprint;
  if (!H || fp.length < 3) return [];
  if (signedArea(fp) < 0) fp = [...fp].reverse();
  const area = Math.abs(signedArea(fp));
  const st = { ...defaultStyle(plot, area), ...(plot.style ?? {}) };
  const r = rng(plot.seed ^ 0x5eed);
  const stone = new THREE.Color(...st.stone.map((v) => v * (0.85 + r() * 0.3)));
  const trim = st.trim ? new THREE.Color(...st.trim).multiplyScalar(2.2) : stone.clone().multiplyScalar(1.7);
  // Tar, gravel and lead roofs: what the drone mostly sees.
  const rv = 0.14 + r() * 0.1;
  const roofCol = new THREE.Color(rv, rv * (1 + (r() - 0.5) * 0.1), rv * (1.02 + r() * 0.08));
  const uvo = [Math.floor(r() * CELLS) / CELLS, Math.floor(r() * CELLS) / CELLS];
  const outline = [];

  // Outward normal of each edge of a counter-clockwise polygon (x, z).
  const outward = (a, b) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
  };

  // outline: 'full' (roof ring and fading corner edges), 'ring', or 'none'.
  const prism = (pts, y0, y1, withPiers, cornerFins, outlineMode = 'none') => {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const n = outward(a, b);
      B.walls.wall(a, b, y0, y1, n, stone, uvo);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      if (withPiers && L > 3) {
        // Vertical piers up the face, running a little past the parapet.
        const count = Math.max(1, Math.floor(L / st.pierSpacing));
        for (let k = 1; k < count; k++) {
          const t = k / count;
          const px = a[0] + (b[0] - a[0]) * t + n[0] * st.pierDepth / 2;
          const pz = a[1] + (b[1] - a[1]) * t + n[1] * st.pierDepth / 2;
          const top = y1 + 0.5;
          B.trim.box(px, (y0 + top) / 2, pz, 0.32, top - y0, st.pierDepth, ang, trim);
        }
      }
      if (cornerFins) {
        const top = y1 + 1.2 + r() * 1.5;
        B.trim.box(a[0] + n[0] * 0.3, (y0 + top) / 2, a[1] + n[1] * 0.3, 0.55, top - y0, 0.55, ang, trim);
      }
    }
    B.roof.cap(pts, y1, roofCol);
    if (outlineMode === 'none') return;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      outline.push({ a: [a[0], y1, a[1]], b: [b[0], y1, b[1]], alphaA: 0.95, alphaB: 0.95 });
      if (outlineMode === 'full') {
        outline.push({ a: [a[0], y1, a[1]], b: [a[0], Math.max(y0, y1 - Math.min(14, (y1 - y0) * 0.6)), a[1]], alphaA: 0.8, alphaB: 0 });
      }
    }
  };

  // Podium.
  const tiers = st.tiers;
  const podiumTop = tiers === 1 ? H : Math.max(FLOOR * 2, H * st.podium);
  prism(fp, GROUND, podiumTop, true, false, tiers === 1 ? 'full' : 'ring');

  // Setback tiers, stepping in towards the middle. On an ordinary plot the
  // tier keeps the plot's own shape, shrunk about its centre; on an awkward
  // one it falls back to a rectangle that fits inside.
  const ob = orientedBox(fp);
  const cen = centroid(fp);
  const convexish = inside(cen, fp) && Math.abs(signedArea(hull(fp))) < area * 1.15;
  let top = podiumTop;
  let topRect = fp;
  let firstTier = null;
  if (tiers > 1 && ob) {
    const weights = [0.55, 0.3, 0.15].slice(0, tiers - 1);
    const wsum = weights.reduce((s, w) => s + w, 0);
    let scale = 1;
    let y = podiumTop;
    for (let t = 0; t < tiers - 1; t++) {
      scale *= st.setback;
      let shape = null;
      if (convexish) {
        const cand = fp.map((p) => [cen[0] + (p[0] - cen[0]) * scale, cen[1] + (p[1] - cen[1]) * scale]);
        if (cand.every((p) => inside(p, fp)) && scale * Math.min(ob.hu, ob.hv) > 1.6) shape = cand;
      }
      for (let tries = 0, s = scale * 0.92; !shape && tries < 7; tries++, s *= 0.86) {
        const cand = rectPoints(ob, s, s * (0.9 + r() * 0.2));
        if (cand.every((p) => inside(p, fp)) && s * Math.min(ob.hu, ob.hv) > 1.6) {
          shape = cand;
          scale = s;
        }
      }
      if (!shape) break;
      const last = t === tiers - 2;
      const h = ((H - podiumTop) * weights[t]) / wsum;
      prism(shape, y, y + h, true, last && st.crown === 'fins', last ? 'full' : 'none');
      y += h;
      top = y;
      topRect = shape;
      if (!firstTier) firstTier = shape;
    }
  }

  const tierTop = top;
  // Crown.
  const ctr = topRect.reduce((s, p) => [s[0] + p[0] / topRect.length, s[1] + p[1] / topRect.length], [0, 0]);
  const shrink = (pts, s) => pts.map((p) => [ctr[0] + (p[0] - ctr[0]) * s, ctr[1] + (p[1] - ctr[1]) * s]);
  if (st.crown === 'ziggurat') {
    let y = top;
    for (let k = 0; k < 3; k++) {
      const pts = shrink(topRect, 0.78 - k * 0.2);
      const h = 1.6 - k * 0.3;
      const n = pts.length;
      for (let i = 0; i < n; i++) B.trim.wall(pts[i], pts[(i + 1) % n], y, y + h, outward(pts[i], pts[(i + 1) % n]), trim, uvo);
      B.roof.cap(pts, y + h, roofCol);
      y += h;
    }
    top = y;
  } else if (st.crown === 'spire') {
    const s = Math.max(0.6, Math.min(ob.hu, ob.hv) * 0.35);
    const len = Math.min(24, H * 0.22);
    let y = top;
    for (let k = 0; k < 5; k++) {
      const w = s * (1 - k * 0.18);
      const h = len / 5;
      B.trim.box(ctr[0], y + h / 2, ctr[1], w, h, w, Math.atan2(-ob.uz, ob.ux), trim);
      y += h;
    }
    top = y;
  }
  // A neon band round the top tier.
  if (st.neon) {
    const neon = new THREE.Color(st.neon);
    for (let i = 0; i < topRect.length; i++) {
      const a = topRect[i];
      const b = topRect[(i + 1) % topRect.length];
      const n = outward(a, b);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      B.glow.box((a[0] + b[0]) / 2 + n[0] * 0.08, top - 0.9, (a[1] + b[1]) / 2 + n[1] * 0.08, L, 0.22, 0.1,
        Math.atan2(-(b[1] - a[1]), b[0] - a[0]), neon);
    }
  }
  // Ways in: a lit doorway under a small canopy. Street doors burn warmer
  // and brighter than the ones down the alleys.
  for (const d of plot.doors ?? []) {
    const ang = Math.atan2(d.nx, d.nz); // box width along the wall, depth along the normal
    const warm = d.kind === 'street' ? new THREE.Color(0.32, 0.22, 0.12) : new THREE.Color(0.16, 0.12, 0.08);
    B.glow.box(d.x + d.nx * 0.04, GROUND + 1.15, d.z + d.nz * 0.04, 1.3, 2.3, 0.06, ang, warm);
    B.trim.box(d.x + d.nx * 0.45, GROUND + 2.55, d.z + d.nz * 0.45, 1.9, 0.12, 0.9, ang, trim);
  }

  rooftop(B, r, fp, cen, podiumTop, firstTier, topRect, tierTop, st.crown, roofCol);

  // Aviation light on the tall ones.
  if (H > 45) {
    B.glow.box(ctr[0], top + 0.4, ctr[1], 0.35, 0.35, 0.35, 0, new THREE.Color(1, 0.05, 0.05));
  }
  // Rooftop plant on a wide podium roof.
  if (tiers > 1 && area > 250) {
    for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
      const p = [fp[0][0] + (ctr[0] - fp[0][0]) * (0.25 + r() * 0.4), fp[0][1] + (ctr[1] - fp[0][1]) * (0.25 + r() * 0.4)];
      if (!inside(p, fp)) continue;
      B.roof.box(p[0], podiumTop + 0.5, p[1], 1 + r() * 1.6, 1, 1 + r() * 1.4, r() * 3, roofCol.clone().multiplyScalar(1.6));
    }
  }
  return outline;
}

// The clutter every real roof has: air-conditioning units, chimneys, vents,
// antennas and the odd satellite dish. On a stepped tower it sits on the
// podium roof, round the foot of the first setback; on a plain block, round
// the edge of the roof.
function rooftop(B, r, fp, cen, podiumTop, firstTier, topRect, tierTop, crown, roofCol) {
  const metal = new THREE.Color(0.2, 0.21, 0.22);
  const dark = new THREE.Color(0.08, 0.08, 0.085);
  const brick = new THREE.Color(0.22, 0.1, 0.07);
  const area = Math.abs(signedArea(fp));
  const place = (pts, y, avoid, count, kinds) => {
    const c = centroid(pts);
    for (let k = 0, tries = 0; k < count && tries < count * 8; tries++) {
      const v = pts[Math.floor(r() * pts.length)];
      const w = pts[Math.floor(r() * pts.length)];
      const u = 0.55 + r() * 0.33;
      const m = 0.5 + r() * 0.5;
      const p = [c[0] + ((v[0] + (w[0] - v[0]) * m * 0.3) - c[0]) * u, c[1] + ((v[1] + (w[1] - v[1]) * m * 0.3) - c[1]) * u];
      if (!inside(p, pts) || (avoid && inside(p, avoid))) continue;
      k++;
      const ang = r() * Math.PI;
      const kind = kinds[Math.floor(r() * kinds.length)];
      if (kind === 'ac') {
        B.trim.box(p[0], y + 0.45, p[1], 1.3, 0.9, 0.9, ang, metal);
        B.roof.box(p[0], y + 0.92, p[1], 0.7, 0.05, 0.7, ang, dark); // the fan grille
      } else if (kind === 'chimney') {
        const h = 1.4 + r() * 1.6;
        B.roof.box(p[0], y + h / 2, p[1], 0.7, h, 0.7, ang, brick);
        B.roof.box(p[0], y + h + 0.05, p[1], 0.8, 0.1, 0.8, ang, dark);
      } else if (kind === 'vent') {
        B.trim.box(p[0], y + 0.5, p[1], 0.35, 1, 0.35, 0, metal);
        B.trim.box(p[0], y + 1.05, p[1], 0.55, 0.1, 0.55, 0, metal);
      } else if (kind === 'antenna') {
        const h = 4 + r() * 6;
        B.trim.box(p[0], y + h / 2, p[1], 0.07, h, 0.07, 0, metal);
        for (let b = 0; b < 3; b++) B.trim.box(p[0], y + h * (0.55 + b * 0.15), p[1], 1.6 - b * 0.4, 0.04, 0.04, ang, metal);
        if (r() < 0.35) B.glow.box(p[0], y + h + 0.1, p[1], 0.14, 0.14, 0.14, 0, new THREE.Color(1, 0.04, 0.03));
      } else if (kind === 'dish') {
        B.trim.box(p[0], y + 0.5, p[1], 0.1, 1, 0.1, 0, metal);
        B.trim.box(p[0], y + 1.1, p[1], 1.1, 0.8, 0.08, ang, new THREE.Color(0.32, 0.32, 0.3));
      } else if (kind === 'tank') {
        for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) B.trim.box(p[0] + dx, y + 1, p[1] + dz, 0.12, 2, 0.12, 0, dark);
        B.roof.box(p[0], y + 3, p[1], 2.2, 2, 2.2, ang, new THREE.Color(0.18, 0.13, 0.09));
        B.roof.box(p[0], y + 4.1, p[1], 2.4, 0.2, 2.4, ang, dark);
      }
    }
  };
  const n = Math.min(10, 2 + Math.floor(area / 90));
  if (firstTier) {
    place(fp, podiumTop, firstTier, n, ['ac', 'ac', 'vent', 'chimney', 'tank', 'dish']);
    if (crown !== 'spire') place(topRect, tierTop, crown === 'ziggurat' ? topRect.map((q) => [cen[0] + (q[0] - cen[0]) * 0.8, cen[1] + (q[1] - cen[1]) * 0.8]) : null, 2, ['antenna', 'ac', 'vent']);
  } else {
    const avoid = crown === 'ziggurat' ? fp.map((q) => [cen[0] + (q[0] - cen[0]) * 0.8, cen[1] + (q[1] - cen[1]) * 0.8]) : null;
    place(fp, podiumTop, avoid, n, ['ac', 'ac', 'vent', 'chimney', 'antenna', 'dish', 'tank']);
  }
}

// All the buildings of one block, merged: four meshes for the whole block.
export function buildDecoBlock(plots) {
  const M = decoMaterials();
  const B = { walls: new Builder(), roof: new Builder(), trim: new Builder(), glow: new Builder() };
  const outline = [];
  // Each outline segment knows its building, so the HUD can show just one.
  for (const plot of plots) {
    for (const seg of building(plot, B)) {
      seg.owner = plot.id;
      outline.push(seg);
    }
  }
  const group = new THREE.Group();
  for (const [k, b] of Object.entries(B)) {
    const m = b.mesh(M[k]);
    if (m) {
      m.name = k;
      group.add(m);
    }
  }
  return { object: group, outline };
}
