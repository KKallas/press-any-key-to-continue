// What each building is, and where you can drive into it. The city file
// doesn't say — every plot is just a footprint — so we decide here, the same
// way every run, from the plot's own id. A few are banks (worth breaking
// into), one or two are internet cafés (safe to work, a trap to leave), a
// handful are respray garages (drive in dirty, out clean), the rest are
// ordinary. Most get a parking entrance: a spot on a road-facing wall the car
// can pull into.
//
// Kept pure so it can be tested and, later, driven by a prompt instead of a
// hash without anything downstream noticing.

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296; // 0..1
}

function area(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

function pointInPoly(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// assign: work out a kind for every plot and a parking entrance where one
// fits. plots: [{id, footprint}]. roadDist(x,z): metres to the nearest road,
// or Infinity. carFree(x,z): may the car stand here.
export function assignPlaces(plots, roadDist, carFree) {
  const kindOf = new Map();
  const parking = new Map(); // plot -> { x, z, hx, hz, nx, nz, respray }
  // Pick the cafés and respray garages up front, spread by hash.
  const scored = plots.map((p) => ({ p, h: hash(p.id + 'cafe') })).sort((a, b) => b.h - a.h);
  const cafes = new Set(scored.slice(0, 2).map((s) => s.p.id));

  for (const plot of plots) {
    const h = hash(plot.id + 'kind');
    let kind = 'plain';
    if (cafes.has(plot.id)) kind = 'cafe';
    else if (h < 0.1) kind = 'bank';
    else if (h < 0.16) kind = 'store';
    kindOf.set(plot.id, kind);

    // A parking entrance on the road-facing wall, for most buildings.
    const fp = plot.footprint;
    if (fp.length < 3) continue;
    const ccw = area(fp) > 0;
    let best = null;
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i];
      const b = fp[(i + 1) % fp.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 3.2) continue; // too narrow for a car
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      // Outward normal (flip by winding).
      let nx = (b[1] - a[1]) / L;
      let nz = -(b[0] - a[0]) / L;
      if (ccw) {
        nx = -nx;
        nz = -nz;
      }
      // Find the nearest clear spot off this wall for the car to sit.
      let hx = 0;
      let hz = 0;
      let clear = false;
      for (let d = 3; d <= 8; d += 0.5) {
        hx = mx + nx * d;
        hz = mz + nz * d;
        if (carFree(hx, hz)) {
          clear = true;
          break;
        }
      }
      if (!clear) continue;
      const rd = Math.min(roadDist(hx, hz), roadDist(mx, mz));
      if (rd > 34) continue;
      const score = rd - L * 0.2;
      if (!best || score < best.score) best = { x: mx, z: mz, hx, hz, nx, nz, score };
    }
    if (best) {
      const respray = kind === 'plain' && hash(plot.id + 'spray') < 0.3;
      if (respray) kindOf.set(plot.id, 'respray');
      parking.set(plot.id, { x: best.x, z: best.z, hx: best.hx, hz: best.hz, nx: best.nx, nz: best.nz, respray });
    }
  }
  return { kindOf, parking };
}

export { pointInPoly };
