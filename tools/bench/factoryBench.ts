// ADR-0002 factory tick bench (04 §3.4; 02 §10.11 #12): builds a large factory through commands and reports the
// per-tick time distribution in Node. Run: HF_BENCH=1 npx vitest run tests/unit/factory-bench.test.ts
//
// Fixture (MVP-17, src/debug/benchFixture.ts): the closest the 48-wide mine allows to "2,000 buildings, 10k items,
// 128-tile lines, 24 lifts, every MVP node". The browser bench (bench.html) builds the same fixture in a live World.
import { Factory } from '../../src/factory/factory';
import { SURVEY_COLUMN, benchGrid, buildBenchCommands, countFixture } from '../../src/debug/benchFixture';

export interface BenchFixture {
  f: Factory;
  entities: number;
  beltTiles: number;
  kinds: Record<string, number>;
}

export interface BenchResult {
  ticks: number;
  /** Milliseconds per tick. */
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
  items: number;
  entities: number;
  beltTiles: number;
  kinds: Record<string, number>;
  buildMs: number;
  /** Work done in the timed window, per simulated minute: ore produced, items sold, items moved off line heads. */
  perMinute: { produced: number; sold: number; consumed: number };
}

/** Build the fixture through commands (02 §10.10), as a player would (src/debug/benchFixture.ts). */
export function buildBenchFixture(noSleep = false, dense = false): BenchFixture {
  const plan = benchGrid();
  let cash = 1e12;
  const wallet = {
    cash: () => cash,
    debit: (n: number) => (n <= cash ? ((cash -= n), true) : false),
    credit: (n: number) => {
      cash += n;
    },
  };
  const f = Factory.create({ grid: plan.grid, wallet, emit: () => {} }, { scope: 'v1', surveyColumn: SURVEY_COLUMN, scriptedLodeId: 0, noSleep });
  // The survey Bin holds 200 Wire before the loop's Bin goes down (the Stockpile fills Bins lowest id first).
  const r = f.stockpilePut([{ item: 'wire', n: 200 }]);
  if (!r.ok) throw new Error(`bench fixture: fill the survey Bin: ${JSON.stringify(r)}`);
  buildBenchCommands(f, plan, dense);
  return { f, ...countFixture(f) };
}

function quantile(sorted: Float64Array, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Warm up, then time `ticks` ticks one by one (04 §3.4 times 6,000 after 1,200; deep lifts need longer to fill). */
export function runFactoryBench(opts: { now: () => number; warmup?: number; ticks?: number; noSleep?: boolean; dense?: boolean }): BenchResult {
  const t0 = opts.now();
  const fx = buildBenchFixture(opts.noSleep, opts.dense);
  const buildMs = opts.now() - t0;
  const { f } = fx;
  const n = opts.ticks ?? 6_000;
  for (let i = 0, warm = opts.warmup ?? 8_000; i < warm; i++) f.tick();
  const times = new Float64Array(n);
  const c = f.debug.counts;
  const before = { produced: c.produced, sold: c.sold, consumed: c.consumed };
  for (let i = 0; i < n; i++) {
    const a = opts.now();
    f.tick();
    times[i] = opts.now() - a;
  }
  const sorted = times.slice().sort();
  let sum = 0;
  for (const t of times) sum += t;
  return {
    ticks: n,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    mean: sum / n,
    max: sorted[n - 1],
    items: f.debug.itemsHeld(),
    entities: fx.entities,
    beltTiles: fx.beltTiles,
    kinds: fx.kinds,
    buildMs,
    perMinute: { produced: ((c.produced - before.produced) * 1_200) / n, sold: ((c.sold - before.sold) * 1_200) / n, consumed: ((c.consumed - before.consumed) * 1_200) / n },
  };
}
