// Sound, synthesised: nothing to download. For now just the siren, a
// two-tone American wail, louder the closer the patrol car is to where the
// drone is looking. Browsers only allow sound after the first click, so it
// wakes up then.

export class Sound {
  constructor() {
    this.ctx = null;
    this.sirens = new Map();
    const wake = () => {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    };
    window.addEventListener('pointerdown', wake, { once: false, capture: true });
    window.addEventListener('keydown', wake, { once: false, capture: true });
  }

  siren(id) {
    if (!this.ctx) return null;
    let s = this.sirens.get(id);
    if (s) return s;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const shape = ctx.createBiquadFilter();
    shape.type = 'lowpass';
    shape.frequency.value = 2200;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(shape).connect(gain).connect(this.master);
    osc.start();
    s = { osc, gain };
    this.sirens.set(id, s);
    return s;
  }

  // sources: [{ id, x, z, on }]; listener: [x, z] on the ground.
  update(now, sources, listener) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const src of sources) {
      const s = this.siren(src.id);
      if (!s) continue;
      const d = Math.hypot(src.x - listener[0], src.z - listener[1]);
      const vol = src.on ? Math.max(0, 1 - d / 220) ** 2 * 0.18 : 0;
      s.gain.gain.setTargetAtTime(vol, t, 0.1);
      // Wail: up and down over four seconds, offset per car.
      const phase = ((now + src.id.length * 0.7) % 4) / 4;
      const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      s.osc.frequency.setTargetAtTime(620 + tri * 780, t, 0.05);
    }
  }
}
