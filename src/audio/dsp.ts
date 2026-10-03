// Small offline DSP kit for the pre-rendered buffers (notes, blips, loops, ambience beds). Pure and deterministic:
// noise comes from a seeded xorshift, never Math.random, so a buffer renders the same on every boot.

export const TAU = Math.PI * 2;

/** Seeded white noise in [-1, 1) (xorshift32). */
export class WhiteNoise {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 2_147_483_648 - 1;
  }
}

/** Pink noise (Paul Kellet's economy filter over seeded white noise), roughly unit peak. */
export class PinkNoise {
  private readonly w: WhiteNoise;
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;

  constructor(seed: number) {
    this.w = new WhiteNoise(seed);
  }

  next(): number {
    const x = this.w.next();
    this.b0 = 0.99765 * this.b0 + x * 0.099046;
    this.b1 = 0.963 * this.b1 + x * 0.2965164;
    this.b2 = 0.57 * this.b2 + x * 1.0526913;
    return (this.b0 + this.b1 + this.b2 + x * 0.1848) * 0.2;
  }
}

/** Sine oscillator by phasor rotation: no Math.sin per sample (the renders run on the main thread). */
export class Osc {
  private x: number;
  private y: number;
  private readonly c: number;
  private readonly s: number;

  constructor(hz: number, sr: number, phase = 0) {
    this.c = Math.cos((TAU * hz) / sr);
    this.s = Math.sin((TAU * hz) / sr);
    this.x = Math.cos(phase);
    this.y = Math.sin(phase);
  }

  next(): number {
    const v = this.y;
    const nx = this.x * this.c - this.y * this.s;
    this.y = this.x * this.s + this.y * this.c;
    this.x = nx;
    return v;
  }
}

/** One-pole low-pass coefficient for a cutoff at `hz`. */
export function onePole(hz: number, sr: number): number {
  return 1 - Math.exp((-TAU * hz) / sr);
}

export interface PartialSpec {
  /** Frequency as a multiple of the note's fundamental. */
  ratio: number;
  amp: number;
  /** Time for this partial to fall to 1/e, seconds. */
  decayS: number;
}

/** Adds exponentially decaying sine partials (rotating-phasor recurrence: no Math.sin per sample). */
export function addPartials(out: Float32Array, sr: number, freq: number, partials: readonly PartialSpec[]): void {
  const nyquist = 0.45 * sr;
  for (const p of partials) {
    const f = freq * p.ratio;
    if (f >= nyquist) continue;
    const c = Math.cos((TAU * f) / sr);
    const s = Math.sin((TAU * f) / sr);
    const k = Math.exp(-1 / (p.decayS * sr));
    let x = 1;
    let y = 0;
    let a = p.amp;
    for (let i = 0; i < out.length; i++) {
      out[i] += a * y;
      const nx = x * c - y * s;
      y = x * s + y * c;
      x = nx;
      a *= k;
    }
  }
}

/** Linear attack ramp and a raised-cosine fade at the end, so a truncated decay never clicks. */
export function shapeEnds(out: Float32Array, sr: number, attackS: number, fadeS: number): void {
  const a = Math.max(1, Math.round(attackS * sr));
  for (let i = 0; i < a && i < out.length; i++) out[i] *= i / a;
  const f = Math.min(out.length, Math.round(fadeS * sr));
  for (let i = 0; i < f; i++) out[out.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / f);
}

export function peakOf(out: Float32Array): number {
  let p = 0;
  for (let i = 0; i < out.length; i++) {
    const v = Math.abs(out[i]);
    if (v > p) p = v;
  }
  return p;
}

/** Scales to the given peak (a silent buffer stays silent). */
export function normalize(out: Float32Array, peak: number): Float32Array {
  const p = peakOf(out);
  if (p > 0) for (let i = 0; i < out.length; i++) out[i] *= peak / p;
  return out;
}

/**
 * Seamless loop from `len + xfade` samples of uncorrelated material: the overhang is equal-power crossfaded into the
 * head, so sample len−1 flows into sample 0. Periodic (correlated) layers are added afterwards, not through this.
 */
export function crossfadeLoop(src: Float32Array, len: number): Float32Array {
  const x = src.length - len;
  const out = src.slice(0, len);
  for (let i = 0; i < x; i++) {
    const t = ((i + 0.5) / x) * (Math.PI / 2);
    out[i] = src[i] * Math.sin(t) + src[len + i] * Math.cos(t);
  }
  return out;
}

/** Rounds a frequency to a whole number of cycles over `loopS`, so a periodic layer loops without a seam. */
export function loopHz(hz: number, loopS: number): number {
  return Math.max(1, Math.round(hz * loopS)) / loopS;
}
