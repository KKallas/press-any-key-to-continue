// Quality tiers. The grade runs on every tier: the look must not depend on
// the hardware. Only the richness of light does.

export const TIERS = {
  low: {
    name: 'low',
    scale: 0.6,
    msaa: 0,
    reflection: 0,
    rain: 4000,
    bloom: 0.8,
    drops: false,
    aberration: false,
  },
  mid: {
    name: 'mid',
    scale: 0.85,
    msaa: 0,
    reflection: 0.25,
    rain: 9000,
    bloom: 0.9,
    drops: false,
    aberration: true,
  },
  high: {
    name: 'high',
    scale: 1.0,
    msaa: 4,
    reflection: 0.5,
    rain: 14000,
    bloom: 0.95,
    drops: true,
    aberration: true,
  },
};

export const ORDER = ['low', 'mid', 'high'];

// Steps down a tier when frames stay slow. Never steps back up by itself,
// so the picture doesn't pump between tiers.
export class AutoQuality {
  constructor(onChange) {
    this.onChange = onChange;
    this.enabled = true;
    this.reset();
  }

  reset() {
    this.samples = [];
    this.warmup = 45;
  }

  frame(ms, current) {
    if (!this.enabled) return;
    if (this.warmup > 0) {
      this.warmup--;
      return;
    }
    this.samples.push(ms);
    if (this.samples.length < 90) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.samples = [];
    const i = ORDER.indexOf(current);
    if (median > 24 && i > 0) {
      this.onChange(ORDER[i - 1]);
      this.reset();
    }
  }
}
