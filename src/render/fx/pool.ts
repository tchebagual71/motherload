// Fixed-capacity particle pool (structure of arrays, dense live range [0, n)). No allocation after
// construction: spawning writes into a free or evicted slot, death swaps the last live particle in.
// Over budget, the oldest particle of the lowest class goes (03 §8.10: tells > pod > factory > ambience).

/** Render families: lit chips, lit puffs, unlit glows. */
export const KIND = { CUBE: 0, BLOB: 1, GLOW: 2 } as const;
export type Kind = (typeof KIND)[keyof typeof KIND];
export const KIND_COUNT = 3;

/** Priority classes, lowest evicted first (03 §8.10). */
export const PRIO = { AMBIENCE: 0, FACTORY: 1, POD: 2, TELL: 3 } as const;
export type Prio = (typeof PRIO)[keyof typeof PRIO];

/** Orient along velocity and stretch by speed (sparks). */
export const FLAG_ALIGN = 1;

/** Spawn parameters. Reuse one instance (fill, then `spawn`) to stay allocation-free. */
export interface ParticleSpec {
  kind: Kind;
  prio: Prio;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds. */
  life: number;
  size0: number;
  size1: number;
  /** Linear RGB at birth and death. */
  r0: number;
  g0: number;
  b0: number;
  r1: number;
  g1: number;
  b1: number;
  /** Downward acceleration (tiles/s²); negative rises. */
  gravity: number;
  /** Linear drag rate (1/s). */
  drag: number;
  rot: number;
  spin: number;
  /** ALIGN: length gain per unit speed; otherwise extra vertical stretch. */
  stretch: number;
  flags: number;
}

export function newSpec(): ParticleSpec {
  return {
    kind: KIND.CUBE, prio: PRIO.POD, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size0: 0.1, size1: 0.1,
    r0: 1, g0: 1, b0: 1, r1: 1, g1: 1, b1: 1, gravity: 0, drag: 0, rot: 0, spin: 0, stretch: 0, flags: 0,
  };
}

export class ParticlePool {
  readonly capacity: number;
  /** Live particles occupy indices [0, n). */
  n = 0;
  private budgetCap: number;
  private serialNext = 1;

  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size0: Float32Array;
  readonly size1: Float32Array;
  /** 6 per particle: r0 g0 b0 r1 g1 b1. */
  readonly color: Float32Array;
  readonly gravity: Float32Array;
  readonly drag: Float32Array;
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  readonly stretch: Float32Array;
  readonly kind: Uint8Array;
  readonly prio: Uint8Array;
  readonly flags: Uint8Array;
  readonly serial: Uint32Array;

  constructor(capacity: number, budget = capacity) {
    this.capacity = capacity;
    this.budgetCap = Math.max(0, Math.min(capacity, budget));
    const f = (): Float32Array => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f();
    this.size0 = f(); this.size1 = f();
    this.color = new Float32Array(capacity * 6);
    this.gravity = f(); this.drag = f();
    this.rot = f(); this.spin = f(); this.stretch = f();
    this.kind = new Uint8Array(capacity);
    this.prio = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.serial = new Uint32Array(capacity);
  }

  get budget(): number {
    return this.budgetCap;
  }

  /** Change the live cap; trims immediately (oldest of the lowest class first). */
  setBudget(max: number): void {
    this.budgetCap = Math.max(0, Math.min(this.capacity, Math.floor(max)));
    while (this.n > this.budgetCap) this.kill(this.victim(255));
  }

  /** Returns the slot used, or −1 when the pool is full of higher-priority particles. */
  spawn(s: ParticleSpec): number {
    if (this.budgetCap === 0 || s.life <= 0) return -1;
    let i: number;
    if (this.n < this.budgetCap) i = this.n++;
    else {
      i = this.victim(s.prio);
      if (i < 0) return -1;
    }
    this.px[i] = s.x; this.py[i] = s.y; this.pz[i] = s.z;
    this.vx[i] = s.vx; this.vy[i] = s.vy; this.vz[i] = s.vz;
    this.age[i] = 0;
    this.life[i] = s.life;
    this.size0[i] = s.size0;
    this.size1[i] = s.size1;
    const c = i * 6;
    this.color[c] = s.r0; this.color[c + 1] = s.g0; this.color[c + 2] = s.b0;
    this.color[c + 3] = s.r1; this.color[c + 4] = s.g1; this.color[c + 5] = s.b1;
    this.gravity[i] = s.gravity;
    this.drag[i] = s.drag;
    this.rot[i] = s.rot;
    this.spin[i] = s.spin;
    this.stretch[i] = s.stretch;
    this.kind[i] = s.kind;
    this.prio[i] = s.prio;
    this.flags[i] = s.flags;
    this.serial[i] = this.serialNext;
    this.serialNext = (this.serialNext + 1) >>> 0 || 1;
    return i;
  }

  /** Advance every particle by dt seconds; expired ones are removed. */
  step(dt: number): void {
    for (let i = this.n - 1; i >= 0; i--) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) {
        this.kill(i);
        continue;
      }
      this.age[i] = age;
      this.vy[i] -= this.gravity[i] * dt;
      const damp = 1 / (1 + this.drag[i] * dt);
      this.vx[i] *= damp;
      this.vy[i] *= damp;
      this.vz[i] *= damp;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;
    }
  }

  clear(): void {
    this.n = 0;
  }

  /** Oldest particle among the lowest class ≤ maxPrio, or −1. */
  private victim(maxPrio: number): number {
    let best = -1;
    let bestPrio = 256;
    let bestAge = 0;
    for (let i = 0; i < this.n; i++) {
      const p = this.prio[i];
      if (p > maxPrio) continue;
      // Serial distance from "now" = age in spawn order (wrap-safe).
      const age = (this.serialNext - this.serial[i]) >>> 0;
      if (p < bestPrio || (p === bestPrio && age > bestAge)) {
        best = i;
        bestPrio = p;
        bestAge = age;
      }
    }
    return best;
  }

  private kill(i: number): void {
    const last = --this.n;
    if (i === last) return;
    this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.size0[i] = this.size0[last];
    this.size1[i] = this.size1[last];
    this.color.copyWithin(i * 6, last * 6, last * 6 + 6);
    this.gravity[i] = this.gravity[last];
    this.drag[i] = this.drag[last];
    this.rot[i] = this.rot[last];
    this.spin[i] = this.spin[last];
    this.stretch[i] = this.stretch[last];
    this.kind[i] = this.kind[last];
    this.prio[i] = this.prio[last];
    this.flags[i] = this.flags[last];
    this.serial[i] = this.serial[last];
  }
}
