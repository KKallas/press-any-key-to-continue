// The drone's symbology, drawn into a canvas each frame and handed to the
// camera pass as a texture. The camera pass mixes it into the picture before
// compression, interlacing and noise, so the green lines and text degrade
// with the video, the way burned-in symbology does on old aviation footage.

import * as THREE from 'three';

const GREEN = '#8dffa8';

export class Hud {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.v = new THREE.Vector3();
    this.w = new THREE.Vector3();
    this.resize(16 / 9);
  }

  // The HUD is drawn at modest resolution on purpose: it only has to survive
  // a 480-line signal.
  resize(aspect) {
    const w = 1280;
    this.canvas.width = w;
    this.canvas.height = Math.round(w / aspect);
    this.scale = w / 1280;
    this.texture.dispose();
    this.texture.image = this.canvas;
    this.texture.needsUpdate = true;
  }

  // Project a world point into canvas pixels; null if behind the camera.
  toPx(p, camera, out) {
    this.v.set(p[0], p[1], p[2]).project(camera);
    if (this.v.z > 1) return null;
    out.x = (this.v.x * 0.5 + 0.5) * this.canvas.width;
    out.y = (-this.v.y * 0.5 + 0.5) * this.canvas.height;
    return out;
  }

  draw(s) {
    const { ctx: g, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const k = this.scale;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = GREEN;
    g.fillStyle = GREEN;
    g.lineCap = 'square';
    const font = (px) => `${Math.round(px * k)}px "VT323", "Courier New", monospace`;

    // Wireframes of what the system knows. Kept faint: they are there to make
    // the city readable, not to replace it.
    const WIRE = 0.55;
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    g.lineWidth = 2 * k;
    for (const seg of s.segments) {
      if (!this.toPx(seg.a, s.camera, a) || !this.toPx(seg.b, s.camera, b)) continue;
      if ((a.x < -W * 0.3 && b.x < -W * 0.3) || (a.x > W * 1.3 && b.x > W * 1.3)) continue;
      if ((a.y < -H * 0.3 && b.y < -H * 0.3) || (a.y > H * 1.3 && b.y > H * 1.3)) continue;
      g.setLineDash(seg.dashed ? [7 * k, 6 * k] : []);
      if (seg.alphaA === seg.alphaB) {
        g.globalAlpha = seg.alphaA * WIRE;
        g.strokeStyle = GREEN;
      } else {
        const grad = g.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, `rgba(141,255,168,${seg.alphaA * WIRE})`);
        grad.addColorStop(1, `rgba(141,255,168,${seg.alphaB * WIRE})`);
        g.globalAlpha = 1;
        g.strokeStyle = grad;
      }
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    g.strokeStyle = GREEN;

    // Block names on the ground.
    g.font = font(24);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.globalAlpha = 0.45;
    for (const blk of s.blocks) {
      if (this.toPx([blk.x, 0.2, blk.z], s.camera, a)) g.fillText(blk.name.split('').join(' '), a.x, a.y);
    }
    // Known cameras: a small diamond and a name.
    g.globalAlpha = 0.7;
    g.font = font(18);
    for (const cam of s.cams) {
      if (!this.toPx(cam.pos, s.camera, a)) continue;
      g.lineWidth = 1.5 * k;
      g.beginPath();
      g.moveTo(a.x, a.y - 6 * k);
      g.lineTo(a.x + 6 * k, a.y);
      g.lineTo(a.x, a.y + 6 * k);
      g.lineTo(a.x - 6 * k, a.y);
      g.closePath();
      g.stroke();
      g.fillText(cam.name, a.x, a.y + 17 * k);
    }
    g.globalAlpha = 1;

    // Hotzones: doors within walking range, as small ground marks. The one
    // in reach gets a full bracket.
    g.lineWidth = 1.5 * k;
    for (const d of s.doors ?? []) {
      if (!this.toPx([d.hx, 0.2, d.hz], s.camera, a)) continue;
      const on = d === s.activeDoor;
      const r = (on ? 9 : 4) * k;
      g.globalAlpha = on ? 1 : d.kind === 'street' ? 0.75 : 0.5;
      g.strokeRect(a.x - r, a.y - r, r * 2, r * 2);
      if (on) {
        g.beginPath();
        g.moveTo(a.x - r - 5 * k, a.y); g.lineTo(a.x - r, a.y);
        g.moveTo(a.x + r, a.y); g.lineTo(a.x + r + 5 * k, a.y);
        g.stroke();
      }
    }
    g.globalAlpha = 1;

    // Tracking box on the car or skin, sized to it as seen from up here.
    if (s.track && this.toPx(s.track.pos, s.camera, a)) {
      this.w.set(s.track.size ?? 3, 0, 0).applyQuaternion(s.camera.quaternion);
      const p2 = [s.track.pos[0] + this.w.x, s.track.pos[1] + this.w.y, s.track.pos[2] + this.w.z];
      this.toPx(p2, s.camera, b);
      const r = Math.max(16 * k, Math.abs(b.x - a.x));
      const c = 9 * k;
      g.lineWidth = 2.5 * k;
      g.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = a.x + sx * r;
        const y = a.y + sy * r;
        g.moveTo(x - sx * c, y);
        g.lineTo(x, y);
        g.lineTo(x, y - sy * c);
      }
      g.stroke();
      g.font = font(20);
      g.textAlign = 'left';
      g.fillText(s.track.label, a.x + r + 8 * k, a.y - r + 4 * k);
      if (s.prompt) g.fillText(s.prompt, a.x + r + 8 * k, a.y - r + 26 * k);
    }

    // Fixed symbology: crosshair, frame brackets, heading tape, text.
    g.lineWidth = 2 * k;
    const cx = W / 2;
    const cy = H / 2;
    const arm = 44 * k;
    const gap = 12 * k;
    g.beginPath();
    g.moveTo(cx - arm, cy); g.lineTo(cx - gap, cy);
    g.moveTo(cx + gap, cy); g.lineTo(cx + arm, cy);
    g.moveTo(cx, cy - arm); g.lineTo(cx, cy - gap);
    g.moveTo(cx, cy + gap); g.lineTo(cx, cy + arm);
    g.stroke();

    const bx = W * 0.12;
    const by = H * 0.14;
    const bl = 30 * k;
    g.globalAlpha = 0.8;
    g.beginPath();
    for (const [x, y, sx, sy] of [[bx, by, 1, 1], [W - bx, by, -1, 1], [W - bx, H - by, -1, -1], [bx, H - by, 1, -1]]) {
      g.moveTo(x + sx * bl, y); g.lineTo(x, y); g.lineTo(x, y + sy * bl);
    }
    g.stroke();
    g.globalAlpha = 1;

    this.headingTape(s.telemetry.hdg, cx, 34 * k, k, font);

    g.font = font(28);
    g.textAlign = 'left';
    g.textBaseline = 'top';
    const t = s.telemetry;
    const left = [
      `${s.name}  ${s.description}`,
      `ALT ${String(t.alt).padStart(4, ' ')} FT   GS ${String(s.track?.kmh ?? 0).padStart(3, ' ')} KM/H`,
      `ZOOM ${t.zoom}X   TGT ${t.grid}`,
      `MODE ${t.mode}`,
    ];
    left.forEach((line, i) => g.fillText(line, 24 * k, (70 + i * 30) * k));
    g.textAlign = 'right';
    const blink = Math.floor(s.time * 1.25) % 2 === 0;
    [`${blink ? 'REC ●' : 'REC  '}`, '31.12.1999', s.clock].forEach((line, i) => g.fillText(line, W - 24 * k, (70 + i * 30) * k));

    this.texture.needsUpdate = true;
  }

  // A compass ribbon across the top, ticks every 10 degrees.
  headingTape(hdg, cx, y, k, font) {
    const g = this.ctx;
    const span = 90; // degrees shown across the tape
    const width = 520 * k;
    g.lineWidth = 2 * k;
    g.font = font(20);
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.beginPath();
    for (let d = Math.ceil((hdg - span / 2) / 10) * 10; d <= hdg + span / 2; d += 10) {
      const x = cx + ((d - hdg) / span) * width;
      const major = ((d % 30) + 30) % 30 === 0;
      g.moveTo(x, y);
      g.lineTo(x, y + (major ? 12 : 6) * k);
      if (major) {
        const n = ((d % 360) + 360) % 360;
        const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n] ?? String(n / 10).padStart(2, '0');
        g.fillText(label, x, y - 2 * k);
      }
    }
    g.moveTo(cx - width / 2, y + 16 * k);
    g.lineTo(cx + width / 2, y + 16 * k);
    // The pointer under the tape.
    g.moveTo(cx, y + 16 * k);
    g.lineTo(cx - 7 * k, y + 26 * k);
    g.lineTo(cx + 7 * k, y + 26 * k);
    g.lineTo(cx, y + 16 * k);
    g.stroke();
    g.textBaseline = 'top';
    g.fillText(String(Math.round(((hdg % 360) + 360) % 360)).padStart(3, '0'), cx, y + 30 * k);
  }
}
