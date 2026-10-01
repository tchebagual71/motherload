// Deterministic PRNG (sfc32) and hashing. PURE MODULE.

/** 32-bit integer hash of any number of u32 inputs (murmur3-style finaliser chain). */
export function hash32(...xs: number[]): number {
  let h = 0x9e3779b9 | 0;
  for (const x0 of xs) {
    let x = x0 | 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x ^= x >>> 16;
    h = Math.imul(h ^ x, 0x27d4eb2d);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/** Hash a string to u32 (FNV-1a). Used for named RNG streams. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** sfc32 generator. `next()` returns a float in [0, 1). State is plain data so it can be saved. */
export class Rng {
  s: RngState;
  constructor(seed: number, stream = 0) {
    const s0 = hash32(seed, stream, 0xa5a5a5a5);
    this.s = { a: s0, b: hash32(s0, 1), c: hash32(s0, 2), d: 1 };
    for (let i = 0; i < 12; i++) this.nextU32();
  }
  static fromState(state: RngState): Rng {
    const r = Object.create(Rng.prototype) as Rng;
    r.s = { ...state };
    return r;
  }
  nextU32(): number {
    const s = this.s;
    let a = s.a | 0,
      b = s.b | 0,
      c = s.c | 0,
      d = s.d | 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    s.a = a;
    s.b = b;
    s.c = c;
    s.d = d;
    return t >>> 0;
  }
  next(): number {
    return this.nextU32() / 4294967296;
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)];
  }
}

/** Named stream ids (04 §3.6). */
export const STREAM = {
  GEN_BAND: 0x100, // + band index
  GEN_POST: 0x200,
  SHEAR: 0x300,
  HOP_BEACON: 0x400,
  HARDCORE: 0x500,
  BOSS: 0x600,
  FX: 0x700,
} as const;
