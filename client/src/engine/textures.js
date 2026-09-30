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

// Road markings: worn lane lines, stop lines and zebra crossings.
// Alpha-only mask in the red channel, mapped over the whole street square.
export function markingsTexture(size, roadWidth, sidewalk, seed) {
  const px = 2048;
  const [c, g] = canvas(px, px);
  const r = rng(seed);
  const m = px / size; // pixels per metre
  const cx = px / 2;
  const half = roadWidth / 2;
  g.fillStyle = '#000';
  g.fillRect(0, 0, px, px);
  g.fillStyle = '#fff';
  const inter = half + 3.5; // clear zone around the crossing
  // Dashed centre lines.
  for (let d = inter; d < size / 2; d += 6) {
    for (const s of [-1, 1]) {
      g.fillRect(cx + s * d * m - (s < 0 ? 3 * m : 0), cx - 0.08 * m, 3 * m, 0.16 * m);
      g.fillRect(cx - 0.08 * m, cx + s * d * m - (s < 0 ? 3 * m : 0), 0.16 * m, 3 * m);
    }
  }
  // Zebra crossings on all four arms.
  for (let i = -half + 0.4; i < half - 0.4; i += 1.0) {
    for (const s of [-1, 1]) {
      const a = s * (half + 0.6);
      const b = s * (half + 3.0);
      const lo = Math.min(a, b);
      g.fillRect(cx + lo * m, cx + i * m, 2.4 * m, 0.5 * m);
      g.fillRect(cx + i * m, cx + lo * m, 0.5 * m, 2.4 * m);
    }
  }
  // Stop lines.
  for (const s of [-1, 1]) {
    g.fillRect(cx + s * (half + 3.4) * m - 0.15 * m, cx + (s > 0 ? 0 : -half) * m, 0.3 * m, half * m);
    g.fillRect(cx + (s > 0 ? -half : 0) * m, cx + s * (half + 3.4) * m - 0.15 * m, half * m, 0.3 * m);
  }
  // Wear: rub paint away in blotches.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i++) {
    const x = r() * px;
    const y = r() * px;
    const rad = 2 + r() * 14;
    g.globalAlpha = 0.25 + r() * 0.6;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  const tex = toTexture(c, { srgb: false });
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
  for (let i = 0; i < 6; i++) {
    const x = r() * w;
    let y = r() * h * 0.7;
    const len = 40 + r() * 200;
    for (let s = 0; s < len; s += 3) {
      drop(x + Math.sin(s * 0.05) * 3, y + s, 2.2 - s / len * 1.2, 1);
    }
    drop(x, y + len, 7 + r() * 6, 1.3);
  }
  g.globalCompositeOperation = 'source-over';
  return toTexture(c, { srgb: false, repeat: true });
}
