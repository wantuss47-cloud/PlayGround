// Procedural, deformable 2D terrain for UAZ TRIAL.
export const STEP = 4;
export const PX_PER_M = 60;
export const START_X = 1000;
export const BASE_Y = 548;

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class Terrain {
  constructor(seed = 1337) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.cap = 26000;
    this.heights = new Float32Array(this.cap);
    this.original = new Float32Array(this.cap);
    this.softness = new Float32Array(this.cap);
    this.disturb = new Float32Array(this.cap);
    this.count = 0;
    this.generatedTo = 0;
    this.nextFeatureX = 1520;
    this.decorTo = 620;
    this.trees = [];
    this.rocks = [];
    this.bushes = [];
    this.lastSmooth = 0;
    this.mudPits = [];
    this.featureLog = [];
    this.featureCount = 0;
    this.lastMudX = 0;
    this.fillTo(Math.ceil(2400 / STEP) + 4);
    this.generateUntil(5600);
  }

  ensure(index) {
    if (index < this.cap) return;
    let cap = this.cap;
    while (cap <= index) cap *= 2;
    const grow = (arr) => {
      const next = new Float32Array(cap);
      next.set(arr);
      return next;
    };
    this.heights = grow(this.heights);
    this.original = grow(this.original);
    this.softness = grow(this.softness);
    this.disturb = grow(this.disturb);
    this.cap = cap;
  }

  baseHeight(x) {
    let h =
      BASE_Y +
      Math.sin(x * 0.00165 + 0.7) * 18 +
      Math.sin(x * 0.0049 + 2.2) * 7 +
      Math.sin(x * 0.00062 + 1.1) * 26;
    // flat, safe launch pad
    h = lerp(BASE_Y, h, smoothstep(1200, 1750, x));
    return h;
  }

  fillTo(index) {
    this.ensure(index + 6);
    while (this.count <= index) {
      const x = this.count * STEP;
      const h = this.baseHeight(x);
      this.heights[this.count] = h;
      this.original[this.count] = h;
      this.softness[this.count] = 0;
      this.disturb[this.count] = 0;
      this.count++;
    }
    this.generatedTo = (this.count - 1) * STEP;
  }

  makeFeature(start) {
    const r = this.rng;
    const meters = start / PX_PER_M;
    this.featureCount++;
    const diff = clamp((meters - 40) / 1000, 0, 1);
    const roll = r();
    let type = "hill";
    if (meters < 90) {
      type = roll < 0.62 ? "hill" : roll < 0.86 ? "ruts" : "mud";
    } else if (meters < 260) {
      type = roll < 0.42 ? "hill" : roll < 0.64 ? "ruts" : roll < 0.84 ? "mud" : "rock";
    } else {
      if (roll < 0.28) type = "hill";
      else if (roll < 0.47) type = "steep";
      else if (roll < 0.68) type = "mud";
      else if (roll < 0.82) type = "ruts";
      else if (roll < 0.94) type = "rock";
      else type = "ramp";
    }

    const scale = 1 + diff * 0.55;
    // guarantee regular mud challenges, especially early on
    if (meters > 18 && start - this.lastMudX > 2400 && this.featureCount > 1) type = "mud";

    const f = { type, start, width: 320, amp: 60, soft: 0, shape: "smooth" };

    switch (type) {
      case "hill": {
        f.width = 300 + r() * 320;
        f.amp = (34 + r() * 88) * scale;
        f.amp *= r() < 0.42 ? -1 : 1;
        if (f.amp < 0) f.amp *= 0.8;
        break;
      }
      case "steep": {
        f.width = 270 + r() * 240;
        f.amp = (120 + r() * 110) * (1 + diff * 0.25);
        f.shape = "asym";
        break;
      }
      case "mud": {
        f.width = 210 + r() * 210 + diff * 60;
        f.amp = 24 + r() * 26 + diff * 18;
        f.soft = 0.72 + r() * 0.28;
        f.shape = "pit";
        break;
      }
      case "ruts": {
        f.width = 330 + r() * 360;
        f.amp = 6 + r() * 10 + diff * 6;
        f.soft = 0.32 + r() * 0.24;
        f.shape = "rut";
        break;
      }
      case "rock": {
        f.width = 70 + r() * 95;
        f.amp = (16 + r() * 30) * (1 + diff * 0.5);
        f.shape = "rock";
        break;
      }
      case "ramp": {
        f.width = 150 + r() * 150;
        f.amp = 52 + r() * 66;
        f.shape = "ramp";
        break;
      }
    }
    this.featureLog.push({ type: f.type, x: Math.round(f.start), w: Math.round(f.width) });
    if (f.type === "mud") this.lastMudX = f.start;
    return f;
  }

  applyFeature(f) {
    const startIdx = Math.round(f.start / STEP);
    const n = Math.max(4, Math.round(f.width / STEP));
    const endIdx = startIdx + n;
    this.ensure(endIdx + 8);
    this.fillTo(endIdx + 4);

    const mudPit = f.type === "mud";
    if (mudPit) {
      this.mudPits.push({ x: f.start + f.width * 0.5, w: f.width, depth: f.amp });
    }

    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const idx = startIdx + i;
      if (idx >= this.count) break;
      let w;
      if (f.shape === "pit") {
        w = Math.pow(Math.sin(Math.PI * t), 0.7);
      } else if (f.shape === "asym") {
        // gentle approach, long crest, steep back side
        w = Math.sin(Math.PI * Math.pow(t, 0.78));
        w = Math.pow(w, 1.15);
      } else if (f.shape === "ramp") {
        w = t < 0.72 ? smoothstep(0, 0.72, t) : 1 - smoothstep(0.72, 1, t) * 0.92;
        w = Math.pow(w, 1.2);
      } else if (f.shape === "rock") {
        w = Math.pow(Math.sin(Math.PI * t), 1.9);
      } else if (f.shape === "rut") {
        const ripple = 0.55 + 0.45 * Math.sin(t * Math.PI * 6 + f.start * 0.01);
        w = Math.pow(Math.sin(Math.PI * t), 1.2) * ripple;
      } else {
        w = Math.sin(Math.PI * t) ** 2;
      }

      const dir = f.amp < 0 ? -1 : 1;
      this.heights[idx] -= f.amp * w; // positive amp raises terrain

      if (f.soft > 0) {
        const s = f.soft * Math.pow(Math.sin(Math.PI * t), 0.42);
        this.softness[idx] = Math.max(this.softness[idx], s);
      }
      if (f.type === "rock") {
        this.softness[idx] = 0;
      }
      void dir;
    }

    // mud wallows get extra soft banks so they read clearly
    if (mudPit) {
      for (let i = -8; i <= n + 8; i++) {
        const idx = startIdx + i;
        if (idx < 1 || idx >= this.count) continue;
        const edge = 1 - Math.min(1, Math.abs(i - n / 2) / (n / 2 + 10));
        this.softness[idx] = Math.max(this.softness[idx], 0.22 * edge);
      }
      // a sturdy tree on the far rim gives the winch something to bite
      const ax = f.start + f.width * 1.08;
      const ay = this.heightAt(ax);
      this.trees.push({
        x: ax,
        y: ay,
        type: "pine",
        h: 132 + this.rng() * 50,
        lean: (this.rng() - 0.5) * 0.1,
        seed: this.rng() * 1000,
        anchor: true,
      });
    }
  }

  smoothNew() {
    const start = Math.max(2, this.lastSmooth);
    const end = this.count - 2;
    if (end - start < 8) return;

    // three-tap smoothing to remove harsh feature joins
    for (let i = start; i <= end; i++) {
      this.heights[i] = (this.heights[i - 1] + this.heights[i] * 2 + this.heights[i + 1]) * 0.25;
    }
    // forward slope limiter
    const maxD = 0.82 * STEP;
    for (let i = start; i <= end; i++) {
      const prev = this.heights[i - 1];
      this.heights[i] = clamp(this.heights[i], prev - maxD, prev + maxD);
    }
    // backward slope limiter
    for (let i = end; i >= start; i--) {
      const next = this.heights[i + 1];
      this.heights[i] = clamp(this.heights[i], next - maxD, next + maxD);
    }
    for (let i = start; i <= end; i++) this.original[i] = this.heights[i];
    this.lastSmooth = Math.max(start, end - 4);
  }

  generateUntil(xMax) {
    const target = xMax + 1400;
    while (this.nextFeatureX < target) {
      const f = this.makeFeature(this.nextFeatureX);
      this.applyFeature(f);
      const gap = 100 + this.rng() * 230 - clamp((this.nextFeatureX / PX_PER_M - 100) / 900, 0, 1) * 60;
      this.nextFeatureX = f.start + f.width + Math.max(65, gap);
      this.smoothNew();
    }
    // make sure ground exists a little beyond what was asked
    this.fillTo(Math.ceil(target / STEP));
    this.smoothNew();
    this.generateDecor(target);
  }

  generateDecor(untilX) {
    while (this.decorTo < untilX) {
      const gap = 110 + this.rng() * 300;
      this.decorTo += gap;
      const x = this.decorTo;
      if (x < 520) continue;
      const r = this.rng();
      const y = this.heightAt(x);
      if (r < 0.46) {
        const type = this.rng() < 0.55 ? "pine" : this.rng() < 0.7 ? "birch" : "dead";
        this.trees.push({
          x,
          y,
          type,
          h: 72 + this.rng() * 120,
          lean: (this.rng() - 0.5) * 0.16,
          seed: this.rng() * 1000,
        });
      } else if (r < 0.68) {
        this.bushes.push({ x, y, s: 0.7 + this.rng() * 0.9, seed: this.rng() * 1000 });
      } else if (r < 0.86) {
        this.rocks.push({
          x,
          y,
          s: 4 + this.rng() * 13,
          rot: this.rng() * Math.PI,
          seed: this.rng() * 1000,
        });
      }
    }
  }

  idx(x) {
    const i = Math.round(x / STEP);
    return i < 0 ? 0 : i >= this.count ? this.count - 1 : i;
  }

  heightAt(x) {
    const f = x / STEP;
    let i = Math.floor(f);
    if (i < 0) i = 0;
    if (i >= this.count - 1) return this.heights[this.count - 1];
    const t = f - i;
    return this.heights[i] + (this.heights[i + 1] - this.heights[i]) * t;
  }

  slopeAt(x) {
    return (this.heightAt(x + 6) - this.heightAt(x - 6)) / 12;
  }

  normalAt(x) {
    const s = this.slopeAt(x);
    const len = Math.hypot(s, 1);
    return { x: -s / len, y: -1 / len, slope: s };
  }

  softnessAt(x) {
    const f = x / STEP;
    let i = Math.floor(f);
    if (i < 0) i = 0;
    if (i >= this.count - 1) return this.softness[this.count - 1];
    const t = f - i;
    return this.softness[i] + (this.softness[i + 1] - this.softness[i]) * t;
  }

  disturbAt(x) {
    const f = x / STEP;
    let i = Math.floor(f);
    if (i < 0) i = 0;
    if (i >= this.count - 1) return this.disturb[this.count - 1];
    const t = f - i;
    return this.disturb[i] + (this.disturb[i + 1] - this.disturb[i]) * t;
  }

  // dig a rut under a spinning/sinking wheel
  deform(x, amount, radius = 14) {
    const s = this.softnessAt(x);
    if (s < 0.08 || amount <= 0) return;
    const center = this.idx(x);
    const span = Math.max(2, Math.round(radius / STEP));
    for (let i = center - span; i <= center + span; i++) {
      if (i < 3 || i >= this.count - 1) continue;
      const d = Math.abs(i - center) / span;
      const falloff = Math.cos(d * Math.PI * 0.5) ** 2;
      const limit = this.original[i] - 58 * this.softness[i] - 4;
      this.heights[i] = Math.max(limit, this.heights[i] - amount * falloff);
      this.disturb[i] = Math.min(1.5, this.disturb[i] + amount * 0.07 * falloff);
    }
  }

  treeNear(x, dir, range = 520) {
    let best = null;
    let bestD = Infinity;
    for (const t of this.trees) {
      const dx = (t.x - x) * dir;
      if (dx < 60 || dx > range) continue;
      if (dx < bestD) {
        bestD = dx;
        best = t;
      }
    }
    return best;
  }
}
