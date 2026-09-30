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
