// The side monitors of the rack. The top one is a vector map of the city in
// green phosphor, the way a dispatch terminal of the period would draw it:
// blocks, parks, streets, the skin's car, and the next link blinking with
// its deadline. The other two have no input, so they show a dim snow.

const GREEN = [141, 255, 168];
const rgba = (a) => `rgba(${GREEN[0]},${GREEN[1]},${GREEN[2]},${a})`;

export class MapScreen {
  // city: { bounds, blocks (polygons), roads (centre lines), greens (patches) }
  constructor(canvas, city) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.city = city;
    this.base = null;
    this.resize();
  }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Drawn at a low resolution on purpose: it's a small tube.
    const w = Math.max(160, Math.round(c.clientWidth * dpr * 0.75));
    const h = Math.max(120, Math.round(c.clientHeight * dpr * 0.75));
    if (c.width === w && c.height === h && this.base) return;
    c.width = w;
    c.height = h;
    this.fit();
    this.base = this.drawBase();
  }

  // World to screen: the whole city, a margin for the text lines.
  fit() {
    const b = this.city.bounds;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const top = H * 0.16;
    const bottom = H * 0.1;
    const s = Math.min((W * 0.92) / (b.maxX - b.minX), (H - top - bottom) / (b.maxZ - b.minZ));
    const ox = W / 2 - ((b.minX + b.maxX) / 2) * s;
    const oy = top + (H - top - bottom) / 2 - ((b.minZ + b.maxZ) / 2) * s;
    this.P = (x, z) => [ox + x * s, oy + z * s];
    this.s = s;
    this.ox = ox;
    this.oy = oy;
  }

  // A click on the map (fx, fy as 0..1 of the canvas) back to world x, z.
  worldAt(fx, fy) {
    const px = fx * this.canvas.width;
    const py = fy * this.canvas.height;
    return [(px - this.ox) / this.s, (py - this.oy) / this.s];
  }

  drawBase() {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d');
    const { P, city } = this;
    g.fillStyle = '#020403';
    g.fillRect(0, 0, c.width, c.height);
    // Parks: stippled.
    g.fillStyle = rgba(0.22);
    for (const patch of city.greens?.patches ?? []) {
      for (let i = 0; i < patch.length; i += 9) {
        const [x, y] = P(patch[i][0], patch[i][1]);
        g.fillRect(x, y, 1, 1);
      }
    }
    // Blocks: outlines.
    g.strokeStyle = rgba(0.35);
    g.lineWidth = 1;
    for (const poly of city.blocks) {
      g.beginPath();
      poly.forEach(([x, z], i) => {
        const [px, py] = P(x, z);
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      });
      g.closePath();
      g.stroke();
    }
    // Streets: centre lines, brighter.
    g.strokeStyle = rgba(0.75);
    g.lineWidth = Math.max(1, this.s * 1.2);
    for (const r of city.roads) {
      g.beginPath();
      r.points.forEach(([x, z], i) => {
        const [px, py] = P(x, z);
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      });
      g.stroke();
    }
    return c;
  }

  // state: { car: [x, z, heading], skin: [x, z] | null, mission, now, heat }
  draw(state) {
    this.resize();
    const g = this.g;
    const { P } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.drawImage(this.base, 0, 0);
    const blink = Math.floor(state.now * 2.5) % 2 === 0;
    const fs = Math.max(10, Math.round(H * 0.085));
    g.font = `${fs}px "VT323", "Courier New", monospace`;
    g.textBaseline = 'top';
    g.fillStyle = rgba(0.95);

    const m = state.mission;
    if (m?.target) {
      const d = m.target;
      const [tx, ty] = P(d.hx, d.hz);
      const left = m.left(state.now);
      g.strokeStyle = rgba(m.state === 'open' ? (blink ? 1 : 0.4) : 0.9);
      g.lineWidth = 1.5;
      const rr = Math.max(5, H * 0.04);
      g.beginPath();
      g.arc(tx, ty, rr, 0, Math.PI * 2);
      g.moveTo(tx - rr * 1.8, ty); g.lineTo(tx - rr * 0.6, ty);
      g.moveTo(tx + rr * 0.6, ty); g.lineTo(tx + rr * 1.8, ty);
      g.moveTo(tx, ty - rr * 1.8); g.lineTo(tx, ty - rr * 0.6);
      g.moveTo(tx, ty + rr * 0.6); g.lineTo(tx, ty + rr * 1.8);
      g.stroke();
      // A line from the car to it, dashed.
      const [cx, cy] = P(state.car[0], state.car[1]);
      g.setLineDash([3, 4]);
      g.strokeStyle = rgba(0.45);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(tx, ty);
      g.stroke();
      g.setLineDash([]);
      const head = m.state === 'made' ? 'LINK ESTABLISHED' : m.state === 'lost' ? 'LINK LOST' : `LINK  ${d.plot.toUpperCase()}`;
      g.textAlign = 'left';
      g.fillText(head, W * 0.04, H * 0.03);
      g.textAlign = 'right';
      if (m.state === 'open') g.fillText(`BY ${m.clock}  T-${String(Math.ceil(left)).padStart(2, '0')}`, W * 0.96, H * 0.03);
      else g.fillText(m.state === 'made' ? `${m.count.made} MADE` : 'NEXT WINDOW...', W * 0.96, H * 0.03);
    }

    // Where you told the car (or skin) to go: a bright cross, and a line from
    // you to it. Longer dashes when the trip is flat out, like the feed.
    if (state.dest) {
      const [dx, dy] = P(state.dest.x, state.dest.z);
      const [cx0, cy0] = P(state.car[0], state.car[1]);
      g.strokeStyle = rgba(0.7);
      g.setLineDash(state.dest.fast ? [6, 4] : [2, 4]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx0, cy0);
      g.lineTo(dx, dy);
      g.stroke();
      g.setLineDash([]);
      const r = Math.max(4, H * 0.03);
      g.strokeStyle = rgba(blink ? 1 : 0.5);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(dx - r, dy); g.lineTo(dx + r, dy);
      g.moveTo(dx, dy - r); g.lineTo(dx, dy + r);
      g.stroke();
    }

    // The admin booth: a blinking box with its code, so you can find the line
    // that rebuilds the world.
    if (state.adminBooth) {
      const [ax, ay] = P(state.adminBooth.x, state.adminBooth.z);
      const r = Math.max(3.5, H * 0.026);
      g.strokeStyle = blink ? 'rgba(120,255,170,1)' : 'rgba(120,255,170,0.45)';
      g.lineWidth = 1.5;
      g.strokeRect(ax - r, ay - r, r * 2, r * 2);
      g.fillStyle = g.strokeStyle;
      g.textAlign = 'center';
      g.fillText('#99', ax, ay + r + 1);
      g.textAlign = 'left';
    }

    // The car: a heading tick; the skin on foot: a dot.
    const [cx, cy] = P(state.car[0], state.car[1]);
    g.fillStyle = rgba(1);
    g.fillRect(cx - 2, cy - 2, 4, 4);
    g.strokeStyle = rgba(1);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(state.car[2]) * 8, cy - Math.sin(state.car[2]) * 8);
    g.stroke();
    if (state.skin) {
      const [sx, sy] = P(state.skin[0], state.skin[1]);
      g.beginPath();
      g.arc(sx, sy, 2.5, 0, Math.PI * 2);
      g.fill();
    }
    // Other operators in the city: soft green dots with a tick of heading.
    for (const p of state.players ?? []) {
      const [px, py] = P(p.x, p.z);
      g.fillStyle = rgba(0.6);
      if (p.kind === 'car') g.fillRect(px - 2, py - 2, 4, 4);
      else {
        g.beginPath();
        g.arc(px, py, 2, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Pursuers, when there are any.
    for (const p of state.pursuers ?? []) {
      const [px, py] = P(p.x, p.z);
      g.fillStyle = p.kind === 'agent' ? (blink ? '#ffffff' : rgba(0.6)) : blink ? 'rgba(255,70,70,0.95)' : 'rgba(90,140,255,0.95)';
      g.fillRect(px - 2.5, py - 2.5, 5, 5);
    }
    // Bottom line: heat.
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.fillStyle = rgba(0.85);
    const heat = state.heat ?? 0;
    const bars = '■'.repeat(Math.round(heat * 5)).padEnd(5, '□');
    g.fillText(`HEAT ${bars}${state.heatLabel ? '  ' + state.heatLabel : ''}`, W * 0.04, H * 0.98);
  }
}

// A small CRT that draws itself at a low resolution, with the tube's own
// rounding and a scanline wash. ActionScreen and InventoryScreen share it.
class SmallCRT {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.rows = []; // clickable [y0, y1, index] bands, for pointer picking
    this.fit();
  }
  fit() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(160, Math.round(c.clientWidth * dpr * 0.8));
    const h = Math.max(120, Math.round(c.clientHeight * dpr * 0.8));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }
  begin(now) {
    this.fit();
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#020403';
    g.fillRect(0, 0, W, H);
    this.W = W;
    this.H = H;
    this.k = W / 240; // scale so text sizes read on any tube
    return g;
  }
  end(now) {
    const g = this.g;
    // Scanline wash + a slow roll bar, so it looks alive.
    g.globalAlpha = 0.06;
    g.fillStyle = '#8dffa8';
    for (let y = 0; y < this.H; y += 3) g.fillRect(0, y, this.W, 1);
    g.globalAlpha = 0.05;
    const ry = ((now * 40) % (this.H + 40)) - 20;
    g.fillRect(0, ry, this.W, 16);
    g.globalAlpha = 1;
  }
  // Turn a pointer position (canvas-relative 0..1) into a row index, or -1.
  pick(fx, fy) {
    const y = fy * this.H;
    for (const [y0, y1, i] of this.rows) if (y >= y0 && y <= y1) return i;
    return -1;
  }
}

const GRN = (a) => `rgba(141,255,168,${a})`;

// AUX 1: the action selector. It shows what you can do where you're standing,
// as a numbered menu — the middle monitor the player lives in. What's on it is
// just a list handed in each frame, so the same screen serves a bank break-in,
// a phone booth, or a respray, and a fuller list can be generated later from a
// prompt without touching this.
export class ActionScreen extends SmallCRT {
  // s: { now, title, actions:[{label, need, disabled, note}], selected, busy }
  draw(s) {
    const g = this.begin(s.now);
    const W = this.W;
    const H = this.H;
    const k = this.k;
    this.rows = [];
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillStyle = GRN(0.9);
    g.font = `${Math.round(15 * k)}px "VT323", monospace`;
    g.fillText((s.title || 'NO ACTION').slice(0, 22), 10 * k, 8 * k);
    g.strokeStyle = GRN(0.3);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(8 * k, 28 * k);
    g.lineTo(W - 8 * k, 28 * k);
    g.stroke();

    const acts = s.actions ?? [];
    if (s.busy) {
      g.fillStyle = GRN(0.8);
      g.font = `${Math.round(14 * k)}px "VT323", monospace`;
      g.fillText('… working', 12 * k, 40 * k);
      this.end(s.now);
      return;
    }
    if (!acts.length) {
      g.fillStyle = GRN(0.4);
      g.font = `${Math.round(13 * k)}px "VT323", monospace`;
      g.fillText('nothing to do here.', 12 * k, 42 * k);
      g.fillText('find a door, a booth,', 12 * k, 58 * k);
      g.fillText('a way in.', 12 * k, 74 * k);
      this.end(s.now);
      return;
    }
    let y = 36 * k;
    const rowH = 22 * k;
    acts.forEach((a, i) => {
      const on = i === s.selected;
      const usable = !a.disabled;
      g.fillStyle = usable ? GRN(on ? 1 : 0.8) : GRN(0.3);
      if (on && usable) {
        g.fillStyle = GRN(0.14);
        g.fillRect(6 * k, y - 2 * k, W - 12 * k, rowH - 2 * k);
        g.fillStyle = GRN(1);
      }
      g.font = `${Math.round(15 * k)}px "VT323", monospace`;
      const label = `${i + 1}. ${a.label}`;
      g.fillText(label.slice(0, 24), 10 * k, y);
      if (a.disabled && a.note) {
        g.fillStyle = GRN(0.35);
        g.font = `${Math.round(11 * k)}px "VT323", monospace`;
        g.fillText(a.note.slice(0, 30), 14 * k, y + 12 * k);
      }
      this.rows.push([y - 2 * k, y + rowH - 4 * k, i]);
      y += rowH + (a.disabled && a.note ? 8 * k : 0);
    });
    g.fillStyle = GRN(0.4);
    g.font = `${Math.round(11 * k)}px "VT323", monospace`;
    g.fillText('KEYS 1-9 · CLICK', 10 * k, H - 14 * k);
    this.end(s.now);
  }
}

// AUX 2: the inventory. What you're carrying, each with a glyph, and a line
// on the selected one.
export class InventoryScreen extends SmallCRT {
  // s: { now, items:[{id,name,note,glyph}], hint }
  draw(s) {
    const g = this.begin(s.now);
    const W = this.W;
    const H = this.H;
    const k = this.k;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillStyle = GRN(0.9);
    g.font = `${Math.round(15 * k)}px "VT323", monospace`;
    g.fillText('KIT', 10 * k, 8 * k);
    g.strokeStyle = GRN(0.3);
    g.beginPath();
    g.moveTo(8 * k, 28 * k);
    g.lineTo(W - 8 * k, 28 * k);
    g.stroke();
    const items = s.items ?? [];
    if (!items.length) {
      g.fillStyle = GRN(0.4);
      g.font = `${Math.round(13 * k)}px "VT323", monospace`;
      g.fillText('empty pockets.', 12 * k, 42 * k);
      this.end(s.now);
      return;
    }
    let y = 38 * k;
    for (const it of items) {
      this.glyph(g, 16 * k, y + 7 * k, 9 * k, it.glyph);
      g.fillStyle = GRN(0.85);
      g.font = `${Math.round(14 * k)}px "VT323", monospace`;
      g.fillText(it.name.slice(0, 20), 32 * k, y);
      g.fillStyle = GRN(0.35);
      g.font = `${Math.round(10 * k)}px "VT323", monospace`;
      g.fillText((it.note || '').slice(0, 30), 32 * k, y + 13 * k);
      y += 30 * k;
    }
    if (s.hint) {
      g.fillStyle = GRN(0.4);
      g.font = `${Math.round(11 * k)}px "VT323", monospace`;
      g.fillText(s.hint.slice(0, 30), 10 * k, H - 14 * k);
    }
    this.end(s.now);
  }
  glyph(g, cx, cy, r, kind) {
    g.strokeStyle = GRN(0.8);
    g.lineWidth = Math.max(1, r * 0.16);
    g.beginPath();
    if (kind === 'laptop') {
      g.rect(cx - r, cy - r * 0.6, r * 2, r * 1.1);
      g.moveTo(cx - r * 1.2, cy + r * 0.6);
      g.lineTo(cx + r * 1.2, cy + r * 0.6);
    } else if (kind === 'modem') {
      g.rect(cx - r, cy - r * 0.5, r * 2, r);
      g.moveTo(cx - r * 0.6, cy);
      g.lineTo(cx + r * 0.6, cy);
    } else if (kind === 'pick') {
      g.moveTo(cx - r, cy + r);
      g.lineTo(cx + r, cy - r);
      g.moveTo(cx + r * 0.4, cy - r);
      g.lineTo(cx + r, cy - r);
    } else if (kind === 'ruler') {
      // a long slim bar with a little hook at the foot
      g.moveTo(cx - r * 0.5, cy - r);
      g.lineTo(cx - r * 0.5, cy + r);
      g.lineTo(cx + r * 0.3, cy + r);
    } else {
      g.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
    }
    g.stroke();
  }
}

// Snow for a monitor with nothing plugged in: a few frames made once and
// cycled, dim, with a slow roll bar.
export class Snow {
  constructor(canvases) {
    this.canvases = canvases;
    this.frames = [];
    const w = 120;
    const h = 90;
    for (let f = 0; f < 6; f++) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      const img = g.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const v = Math.random() ** 2 * 70;
        img.data[i * 4] = v;
        img.data[i * 4 + 1] = v * 1.05;
        img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      this.frames.push(c);
    }
    for (const c of canvases) {
      c.width = w;
      c.height = h;
    }
  }

  draw(now) {
    this.canvases.forEach((c, i) => {
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(this.frames[(Math.floor(now * 14) + i * 3) % this.frames.length], 0, 0);
      const y = ((now * 9 + i * 40) % (c.height + 30)) - 15;
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(0, y, c.width, 12);
      g.fillStyle = 'rgba(200,210,200,0.5)';
      g.font = '14px "VT323", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (Math.floor(now * 0.7 + i) % 3 !== 0) g.fillText('NO INPUT', c.width / 2, c.height / 2);
    });
  }
}
