// ADR-0002 browser bench, the parts without a DOM (04 §3.4; 04 §10.1; canon §3.14): the MVP-17 fixture built
// through factory commands inside a live World, a per-tick timer on the World's factory, the statistics, and the
// copyable `HFB1:` result code (base64url of deflate-raw JSON, like the Perf Report's HFP1).
import { CHUNKS_X, CHUNKS_Y } from '../terrain/grid';
import { World } from '../world/world';
import type { FactoryApi } from '../factory/api';
import { deflateRaw, inflateRaw } from '../save/compress';
import { fromBase64Url, toBase64Url } from './base64url';
import { benchGrid, buildBenchCommands, countFixture, placeStockBin, unlockBench, type BenchCounts } from './benchFixture';

export const BENCH_PREFIX = 'HFB1:';
/** Canon §3.14 / ADR-0002 gate: factory tick p95 on the low device. */
export const TICK_GATE_MS = 1.5;

export interface BenchWorld {
  world: World;
  counts: BenchCounts;
  buildMs: number;
}

/**
 * A fresh v1-scope World (Mk III belts and Expansion II, as the fixture needs) whose mine is replaced by the
 * fixture's and whose factory gets the fixture through commands. The survey set gives way; the pod parks on the Rim
 * clear of the lift shafts.
 */
export function benchWorld(seed: number, now: () => number, dense = false): BenchWorld {
  const world = new World({ seed, scope: 'v1' });
  const t0 = now();
  const plan = benchGrid(seed);
  const g = world.terrain;
  g.terrain.set(plan.grid.terrain);
  g.flags.set(plan.grid.flags);
  g.lodeIndex.set(plan.grid.lodeIndex);
  g.lodes = plan.grid.lodes;
  for (let i = 0; i < CHUNKS_X * CHUNKS_Y; i++) g.chunkVersion[i]++;
  g.version++;
  const f = world.factory as FactoryApi;
  world.debugGiveCash(1e9);
  for (const e of [...f.entities()]) if (e.rusted) f.deconstruct(e.id);
  unlockBench(f, plan);
  placeStockBin(f);
  buildBenchCommands(f, plan, dense);
  const pod = world.pod;
  pod.x = pod.prevX = 1.5;
  return { world, counts: countFixture(f), buildMs: now() - t0 };
}

/**
 * Wraps the World's factory `tick` (the World calls it on stepNo % 3 === 2) to time each one. `recording` turns the
 * capture on; samples land in a preallocated buffer (no allocation per tick).
 */
export class TickTimer {
  readonly samples: Float64Array;
  n = 0;
  ticks = 0;
  recording = false;
  /** The factory's own tick, unwrapped (for batch timing). */
  readonly rawTick: () => void;

  constructor(
    f: FactoryApi,
    capacity: number,
    private readonly now: () => number,
  ) {
    this.samples = new Float64Array(capacity);
    const tick = f.tick.bind(f);
    this.rawTick = tick;
    (f as { tick: () => void }).tick = () => {
      if (!this.recording || this.n >= this.samples.length) {
        tick();
        this.ticks++;
        return;
      }
      const a = this.now();
      tick();
      this.samples[this.n++] = this.now() - a;
      this.ticks++;
    };
  }

  get full(): boolean {
    return this.n >= this.samples.length;
  }

  /**
   * Time `ticks` back-to-back factory ticks with one clock read pair: the mean ms per tick. Precise even where the
   * clock is coarse (iOS Safari 1 ms, Chrome 0.1 ms without cross-origin isolation).
   */
  batch(ticks: number): number {
    const a = this.now();
    for (let i = 0; i < ticks; i++) this.rawTick();
    this.ticks += ticks;
    return (this.now() - a) / ticks;
  }
}

/** Smallest step of the clock (ms): the browser's timer resolution. */
export function timerResolution(now: () => number, samples = 40): number {
  let best = Infinity;
  for (let k = 0; k < samples; k++) {
    const a = now();
    let b = now();
    for (let i = 0; i < 1e6 && b === a; i++) b = now();
    if (b > a) best = Math.min(best, b - a);
  }
  return best === Infinity ? 0 : best;
}

export interface Dist {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
  n: number;
}

/** Distribution of the first `n` samples. */
export function dist(samples: Float64Array, n = samples.length): Dist {
  if (n === 0) return { p50: 0, p95: 0, p99: 0, mean: 0, max: 0, n: 0 };
  const s = samples.slice(0, n).sort();
  const q = (p: number): number => s[Math.min(n - 1, Math.floor(p * n))];
  let sum = 0;
  for (let i = 0; i < n; i++) sum += s[i];
  return { p50: q(0.5), p95: q(0.95), p99: q(0.99), mean: sum / n, max: s[n - 1], n };
}

export interface BenchReport {
  v: 1;
  build: string;
  scope: string;
  /** 'live' = the 04 §3.2 loop at display rate (≤ 5 steps a frame); 'fast' = as many steps as fit a frame budget. */
  mode: 'live' | 'fast';
  /** Camera: the Yard or mine build camera over the fixture, or the play camera on the pod. */
  view: 'yard' | 'mine' | 'pod';
  dense: boolean;
  ua: string;
  gpu: string;
  dpr: number;
  look: string;
  quality: string;
  entities: number;
  beltTiles: number;
  /** Entities + belt tiles: the "buildings" the player placed. */
  buildings: number;
  items: number;
  kinds: Record<string, number>;
  buildMs: number;
  prefillTicks: number;
  warmupTicks: number;
  /** Factory tick ms over the timed window (each tick timed; quantized by `timerResMs`). */
  tick: Dist;
  /** Mean ms per tick of back-to-back batches after the live window (precise whatever the clock). */
  tickBatch: Dist;
  /** The clock's resolution here (ms). */
  timerResMs: number;
  /** rAF intervals (ms) over the timed window. */
  frame: Dist;
  /** Main-thread work per frame: World steps + render submit (ms). */
  work: Dist;
  /** Share of rAF intervals > 1.25 × the display interval (04 §10.1). */
  dropped: number;
  displayHz: number;
  drawCalls: number;
  triangles: number;
  /** Tick p95 ≤ 1.5 ms (on a low device this decides ADR-0002): the per-tick p95, or the batch p95 if larger. */
  gatePass: boolean;
}

/** Dropped-frame rate (04 §10.1): intervals longer than 1.25 × the display interval. */
export function droppedRate(intervals: Float64Array, n: number, displayHz: number): number {
  if (n === 0) return 0;
  const limit = (1000 / displayHz) * 1.25;
  let k = 0;
  for (let i = 0; i < n; i++) if (intervals[i] > limit) k++;
  return k / n;
}

/** Display rate from the median rAF interval, snapped to 30 / 60 / 90 / 120 Hz. */
export function displayHz(medianMs: number): number {
  const hz = 1000 / Math.max(1, medianMs);
  return [30, 60, 90, 120].reduce((best, h) => (Math.abs(h - hz) < Math.abs(best - hz) ? h : best), 60);
}

export async function encodeBench(r: BenchReport): Promise<string> {
  return BENCH_PREFIX + toBase64Url(await deflateRaw(new TextEncoder().encode(JSON.stringify(r))));
}

export async function decodeBench(code: string): Promise<BenchReport> {
  const s = code.trim();
  if (!s.startsWith(BENCH_PREFIX)) throw new Error('Not a bench code');
  const r = JSON.parse(new TextDecoder().decode(await inflateRaw(fromBase64Url(s.slice(BENCH_PREFIX.length))))) as BenchReport;
  if (r.v !== 1) throw new Error(`Unsupported bench code version ${String(r.v)}`);
  return r;
}
