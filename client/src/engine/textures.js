// Procedural textures. Everything here is drawn into a canvas at startup, so
// the engine core ships with no image files at all.

import * as THREE from 'three';

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { srgb = true, repeat = false } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// A facade of windows. Emissive map: black walls, some lit windows.
// Most light is warm tungsten; a few windows carry the cold flicker of a TV.
export function windowTexture(cols, rows, seed) {
  const cell = 32;
  const [c, g] = canvas(Math.max(1, cols) * cell, Math.max(1, rows) * cell);
  const r = rng(seed);
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const litChance = 0.22 + r() * 0.25;
  for (let y = 0; y < rows; y++) {
    // Whole floors are sometimes dark: offices after hours.
    const floorDark = r() < 0.18;
    for (let x = 0; x < cols; x++) {
      const px = x * cell + 9;
      const py = y * cell + 9;
      const w = cell - 18;
      const h = cell - 15;
      const lit = !floorDark && r() < litChance;
      if (lit) {
        const tv = r() < 0.12;
        const k = 0.55 + r() * 0.45;
        const col = tv
          ? `rgb(${80 * k | 0},${150 * k | 0},${255 * k | 0})`
          : `rgb(${255 * k | 0},${(165 + r() * 40) * k | 0},${(90 + r() * 40) * k | 0})`;
        const grad = g.createLinearGradient(px, py, px, py + h);
        grad.addColorStop(0, col);
        grad.addColorStop(1, tv ? col : `rgb(${200 * k | 0},${110 * k | 0},${55 * k | 0})`);
        g.fillStyle = grad;
        g.fillRect(px, py, w, h);
        // Half-drawn blinds.
        if (r() < 0.35) {
          g.fillStyle = 'rgba(0,0,0,0.75)';
          g.fillRect(px, py, w, h * (0.2 + r() * 0.5));
        }
      } else {
        g.fillStyle = 'rgb(6,8,10)';
        g.fillRect(px, py, w, h);
      }
    }
  }
  return toTexture(c);
}

// Neon tube lettering. Drawn bright on black; the emissive intensity does the rest.
export function neonTexture(text, color, vertical) {
  const letters = vertical ? text.split('') : [text];
  const w = vertical ? 128 : Math.max(256, text.length * 96);
  const h = vertical ? letters.length * 128 : 128;
  const [c, g] = canvas(w, h);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.font = `bold ${vertical ? 104 : 92}px "Arial Narrow", Arial, sans-serif`;
  const draw = (s, x, y) => {
    g.strokeStyle = color;
    g.lineWidth = 9;
    g.globalAlpha = 0.35;
    g.strokeText(s, x, y);
    g.globalAlpha = 1;
    g.lineWidth = 5;
    g.strokeText(s, x, y);
    g.strokeStyle = '#fff';
    g.lineWidth = 1.6;
    g.strokeText(s, x, y);
  };
  if (vertical) letters.forEach((ch, i) => draw(ch, w / 2, i * 128 + 68));
  else draw(text, w / 2, h / 2 + 4);
  // Frame of the sign box.
  g.strokeStyle = color;
  g.globalAlpha = 0.5;
  g.lineWidth = 3;
  g.strokeRect(4, 4, w - 8, h - 8);
  return toTexture(c);
}

// Road markings: worn lane lines, stop lines and zebra crossings for a grid
// of roads. Mask in the red channel, mapped over the whole street square.
export function markingsTexture(size, roadWidth, roads, seed) {
  const px = 2048;
  const [c, g] = canvas(px, px);
  const r = rng(seed);
  const m = px / size; // pixels per metre
  const o = px / 2; // world origin in pixels
  const half = roadWidth / 2;
  const X = (v) => o + v * m;
  g.fillStyle = '#000';
  g.fillRect(0, 0, px, px);
  g.fillStyle = '#fff';
  const clear = half + 3.5; // keep paint out of each crossing
  const nearCrossing = (v) => roads.some((q) => Math.abs(v - q) < clear);
  // Dashed centre lines along every road, in both directions.
  for (const q of roads) {
    for (let d = -size / 2; d < size / 2; d += 6) {
      if (nearCrossing(d) || nearCrossing(d + 3)) continue;
      g.fillRect(X(d), X(q) - 0.08 * m, 3 * m, 0.16 * m);
      g.fillRect(X(q) - 0.08 * m, X(d), 0.16 * m, 3 * m);
    }
  }
  // Zebras and stop lines on all four arms of every crossing.
  for (const qx of roads) {
    for (const qz of roads) {
      for (let i = -half + 0.4; i < half - 0.4; i += 1.0) {
        for (const s of [-1, 1]) {
          const lo = Math.min(s * (half + 0.6), s * (half + 3.0));
          g.fillRect(X(qx + lo), X(qz + i), 2.4 * m, 0.5 * m);
          g.fillRect(X(qx + i), X(qz + lo), 0.5 * m, 2.4 * m);
        }
      }
      for (const s of [-1, 1]) {
        g.fillRect(X(qx + s * (half + 3.4)) - 0.15 * m, X(qz + (s > 0 ? 0 : -half)), 0.3 * m, half * m);
        g.fillRect(X(qx + (s > 0 ? -half : 0)), X(qz + s * (half + 3.4)) - 0.15 * m, half * m, 0.3 * m);
      }
    }
  }
  // Wear: rub paint away in blotches.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 3200; i++) {
    g.globalAlpha = 0.25 + r() * 0.6;
    g.beginPath();
    g.arc(r() * px, r() * px, 2 + r() * 12, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return toTexture(c, { srgb: false });
}

// Road markings for real, irregular streets: a dashed centre line on
// two-way roads and a faint edge line either side. Covers a square of
// `size` metres centred on the origin, like the street surface.
// A road stencil: text painted on the tarmac, stretched long the way real
// road lettering is so it reads at a low angle, aligned with the lane.
function stencil(g, P, m, x, z, ang, text) {
  const lines = text.split('\n');
  g.save();
  const c = P([x, z]);
  g.translate(c[0], c[1]);
  // Keep text within a readable half-turn so the drone never sees it upside
  // down, whichever way the lane runs.
  let a = ang + Math.PI / 2;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  if (a > Math.PI / 2) a -= Math.PI;
  if (a < -Math.PI / 2) a += Math.PI;
  g.rotate(a);
  g.scale(1, 2.1); // stretched down the road
  g.fillStyle = '#fff';
  g.globalAlpha = 0.5;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const px = Math.max(9, 1.9 * m);
  g.font = `bold ${px}px "Arial Narrow", Arial, sans-serif`;
  lines.forEach((ln, i) => g.fillText(ln, 0, (i - (lines.length - 1) / 2) * px * 1.05));
  g.globalAlpha = 1;
  g.restore();
}

export function roadMarkingsTexture(size, roads, seed, junctions = []) {
  const px = 2048;
  const [c, g] = canvas(px, px);
  const r = rng(seed);
  const m = px / size;
  const P = ([x, z]) => [px / 2 + x * m, px / 2 + z * m];
  g.fillStyle = '#000';
  g.fillRect(0, 0, px, px);
  g.strokeStyle = '#fff';
  g.lineCap = 'butt';
  for (const road of roads) {
    const pts = road.points.map(P);
    if (road.width >= 9) {
      g.lineWidth = Math.max(1.2, 0.16 * m);
      g.setLineDash([3 * m, 3 * m]);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    // Edge lines: offset the polyline either side.
    g.setLineDash([]);
    g.lineWidth = Math.max(1, 0.12 * m);
    for (const side of [-1, 1]) {
      g.beginPath();
      road.points.forEach(([x, z], i) => {
        const a = road.points[Math.max(0, i - 1)];
        const b = road.points[Math.min(road.points.length - 1, i + 1)];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const off = (road.width / 2 - 0.5) * side;
        const [qx, qy] = P([x - ((b[1] - a[1]) / L) * off, z + ((b[0] - a[0]) / L) * off]);
        if (i) g.lineTo(qx, qy);
        else g.moveTo(qx, qy);
      });
      g.globalAlpha = 0.5;
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  // Only real crossings — where three or more streets (or an alley and a
  // street) meet — get pedestrian markings. A bend in a road doesn't.
  const crossings = junctions.filter((j) => j.degree >= 3);
  const clearRadius = (j) => Math.max(...j.arms.map((a) => a.width)) / 2 + 3;

  // Wipe the centre and edge lines out of the intersection itself, so they
  // don't run through the crossing. (Black is "no paint" in this map.)
  g.fillStyle = '#000';
  for (const j of crossings) {
    const R = clearRadius(j) + 2;
    g.beginPath();
    const c = P([j.x, j.z]);
    g.arc(c[0], c[1], R * m, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#fff';

  // A helper to know how far a point is from any crossing, so bays and
  // stencils keep clear of them.
  const nearCrossing = (x, z, pad) => crossings.some((j) => Math.hypot(j.x - x, j.z - z) < clearRadius(j) + pad);

  // Parking bays: proper car-length slots (~5.5 m) ticked square to the kerb,
  // along the wider streets, clear of the crossings.
  g.setLineDash([]);
  g.globalAlpha = 0.4;
  for (const road of roads) {
    if (road.width < 12) continue; // only streets with room for a parking lane
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 30) continue;
      const dx = (b[0] - a[0]) / L;
      const dz = (b[1] - a[1]) / L;
      const nx = -dz;
      const nz = dx;
      for (const side of [-1, 1]) {
        if (r() < 0.35) continue;
        const off = road.width / 2 - 0.6;
        const bay = 5.5; // a car plus a little
        const depth = 2.6;
        g.lineWidth = Math.max(1, 0.12 * m);
        for (let d = 12 + r() * 6; d < L - 12; d += bay) {
          const cx0 = a[0] + dx * d + nx * off * side;
          const cz0 = a[1] + dz * d + nz * off * side;
          if (nearCrossing(cx0, cz0, 4)) continue;
          const p0 = P([cx0, cz0]);
          const p1 = P([cx0 - nx * depth * side, cz0 - nz * depth * side]);
          g.beginPath();
          g.moveTo(p0[0], p0[1]);
          g.lineTo(p1[0], p1[1]);
          g.stroke();
        }
      }
    }
  }
  g.globalAlpha = 1;

  // Painted stencils down the lanes: SLOW, BUS, a lane arrow, and WRONG WAY on
  // the contra-flow side. Kept off the crossings.
  const STENCILS = ['SLOW', 'BUS', 'AHEAD', 'SLOW', '20'];
  for (const road of roads) {
    if (road.width < 12) continue;
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 34) continue;
      const dx = (b[0] - a[0]) / L;
      const dz = (b[1] - a[1]) / L;
      const ang = Math.atan2(dz, dx);
      for (let d = 18 + r() * 10; d < L - 14; d += 26 + r() * 20) {
        const lane = road.width / 4;
        const side = r() < 0.5 ? 1 : -1;
        const cx = a[0] + dx * d + -dz * lane * side;
        const cz = a[1] + dz * d + dx * lane * side;
        if (nearCrossing(cx, cz, 6)) continue;
        // Now and then, WRONG WAY facing back up the lane.
        if (r() < 0.18) stencil(g, P, m, cx, cz, ang + Math.PI, 'WRONG\nWAY');
        else stencil(g, P, m, cx, cz, ang, STENCILS[Math.floor(r() * STENCILS.length)]);
      }
    }
  }

  // Junctions: a zebra crossing across each arm, and a stop line behind it.
  for (const j of crossings) {
    const R = clearRadius(j);
    for (const arm of j.arms) {
      const back = R + 1.2;
      const cx = j.x + arm.dx * back;
      const cz = j.z + arm.dz * back;
      const nx = -arm.dz;
      const nz = arm.dx;
      const half = arm.width / 2 - 0.6;
      const bars = Math.max(3, Math.floor(arm.width / 0.9));
      g.globalAlpha = 0.85;
      for (let s = 0; s < bars; s++) {
        const t = (s + 0.5) / bars;
        const px0 = cx + nx * (t * 2 - 1) * half;
        const pz0 = cz + nz * (t * 2 - 1) * half;
        const q0 = P([px0 - arm.dx * 1.4, pz0 - arm.dz * 1.4]);
        const q1 = P([px0 + arm.dx * 1.4, pz0 + arm.dz * 1.4]);
        g.lineWidth = Math.max(1.5, 0.34 * m);
        g.beginPath();
        g.moveTo(q0[0], q0[1]);
        g.lineTo(q1[0], q1[1]);
        g.stroke();
      }
      const sx = j.x + arm.dx * (back + 1.8);
      const sz = j.z + arm.dz * (back + 1.8);
      g.lineWidth = Math.max(2, 0.4 * m);
      g.beginPath();
      const e0 = P([sx - nx * half, sz - nz * half]);
      const e1 = P([sx + nx * half, sz + nz * half]);
      g.moveTo(e0[0], e0[1]);
      g.lineTo(e1[0], e1[1]);
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 3200; i++) {
    g.globalAlpha = 0.25 + r() * 0.6;
    g.beginPath();
    g.arc(r() * px, r() * px, 2 + r() * 12, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  const tex = toTexture(c, { srgb: false });
  tex.flipY = false;
  return tex;
}

// Dirt on the camera glass. Only visible where bright light hits it, so this
// is a multiplier for the bloom, not an overlay.
export function lensDirtTexture(seed, crack) {
  const w = 1024;
  const h = 576;
  const [c, g] = canvas(w, h);
  const r = rng(seed);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  // Soft blobs of grime, denser towards the edges.
  for (let i = 0; i < 260; i++) {
    const edge = r() < 0.6;
    let x = r() * w;
    let y = r() * h;
    if (edge) {
      if (r() < 0.5) x = r() < 0.5 ? r() * w * 0.2 : w - r() * w * 0.2;
      else y = r() < 0.5 ? r() * h * 0.2 : h - r() * h * 0.2;
    }
    const rad = 6 + r() ** 2 * 90;
    const a = 0.04 + r() * 0.16;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(255,240,215,${a})`);
    grad.addColorStop(0.6, `rgba(255,235,210,${a * 0.5})`);
    grad.addColorStop(1, 'rgba(255,235,210,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // A wiped smear across the middle, where somebody once cleaned it badly.
  g.save();
  g.translate(w * 0.55, h * 0.45);
  g.rotate(-0.35);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(255,245,230,${0.02 + r() * 0.03})`;
    g.lineWidth = 2 + r() * 10;
    g.beginPath();
    const y0 = (r() - 0.5) * 140;
    g.moveTo(-w * 0.35, y0);
    g.bezierCurveTo(-w * 0.1, y0 + (r() - 0.5) * 60, w * 0.1, y0 + (r() - 0.5) * 60, w * 0.35, y0 + (r() - 0.5) * 30);
    g.stroke();
  }
  g.restore();
  // Fine scratches.
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.06 + r() * 0.12})`;
    g.lineWidth = 0.6 + r();
    g.beginPath();
    const x = r() * w;
    const y = r() * h;
    const a = r() * Math.PI;
    const l = 20 + r() * 120;
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // A crack in the housing glass, top right. Cheap camera.
  if (crack) {
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1.4;
    const branch = (x, y, a, len, depth) => {
      if (depth <= 0 || len < 8) return;
      let px0 = x;
      let py0 = y;
      g.beginPath();
      g.moveTo(px0, py0);
      const steps = 6;
      for (let s = 0; s < steps; s++) {
        a += (r() - 0.5) * 0.5;
        px0 += Math.cos(a) * len / steps;
        py0 += Math.sin(a) * len / steps;
        g.lineTo(px0, py0);
      }
      g.stroke();
      branch(px0, py0, a + (r() - 0.5) * 1.2, len * 0.65, depth - 1);
      if (r() < 0.6) branch(px0, py0, a + (r() < 0.5 ? 0.8 : -0.8), len * 0.5, depth - 1);
    };
    const ox = w * 0.9;
    const oy = h * 0.08;
    for (let k = 0; k < 5; k++) branch(ox, oy, Math.PI * 0.5 + k * 0.45 + r() * 0.3, 150 + r() * 120, 4);
  }
  g.globalCompositeOperation = 'source-over';
  const tex = toTexture(c, { srgb: false });
  return tex;
}

// Rain drops sitting on the camera housing. Red = height of the water.
export function lensDropsTexture(seed) {
  const w = 1024;
  const h = 1024;
  const [c, g] = canvas(w, h);
  const r = rng(seed);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  const drop = (x, y, rad, stretch) => {
    const grad = g.createRadialGradient(x, y - rad * 0.2, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,0,0,0.9)');
    grad.addColorStop(0.7, 'rgba(160,0,0,0.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.save();
    g.translate(x, y);
    g.scale(1, stretch);
    g.beginPath();
    g.arc(0, 0, rad, 0, Math.PI * 2);
    g.restore();
    g.fill();
  };
  for (let i = 0; i < 70; i++) {
    drop(r() * w, r() * h, 2 + r() ** 3 * 16, 1 + r() * 0.4);
  }
  // A few drops that ran, leaving a trail.
  // Trails are drawn faintly: overlapping full-strength drops would stack
  // into a flat plateau with hard edges, which refracts as a black smear.
  for (let i = 0; i < 6; i++) {
    const x = r() * w;
    const y = r() * h * 0.7;
    const len = 40 + r() * 200;
    g.globalAlpha = 0.12;
    for (let s = 0; s < len; s += 3) {
      drop(x + Math.sin(s * 0.05) * 3, y + s, 2.2 - s / len * 1.2, 1);
    }
    g.globalAlpha = 1;
    drop(x, y + len, 7 + r() * 6, 1.3);
  }
  g.globalCompositeOperation = 'source-over';
  return toTexture(c, { srgb: false, repeat: true });
}
