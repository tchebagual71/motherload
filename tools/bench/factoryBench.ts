// ADR-0002 factory tick bench (04 §3.4; 02 §10.11 #12): builds a large factory through commands and reports the
// per-tick time distribution in Node. Run: HF_BENCH=1 npx vitest run tests/unit/factory-bench.test.ts
//
// Fixture: the closest the 48-wide mine allows to "2,000 buildings, 10k items, 128-tile lines, 24 lifts, every
// MVP node". Only MVP building kinds; the scope is v1 solely so storage rows can use Mk III belts (4 items per tile)
// and the Yard can take Expansion II for the serpentine. Belt tiles count as buildings (the player places each).
// - 24 Mk I Bucket Lifts in 12 Headframe pairs, feet 54–500 rows deep, each fed by a Rich Mk I Auto-Drill;
// - 12 Yard lanes: Headframe → Smelter → Assembler (A2) → Bin (unload Wire) → Export;
// - a 360-tile Yard loop (three 128-tile lines and a remainder) with a Router merging Wire in from a Bin;
// - storage rows of Mk III belts fed by drills and dead-ended, in the free columns and below the lifts.
// `dense` swaps every other storage tile for a Router: ~1,000 more entities and 1-tile lines (a harsher stress).
import { F, T, type Lode } from '../../src/shared/types';
import { TerrainGrid } from '../../src/terrain/grid';
import type { BuildingKind, Cell, Dir, KitSource, Res } from '../../src/factory/api';
import { Factory } from '../../src/factory/factory';

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

/** Headframe pairs: 2-wide valid columns (02 §2.2) side by side. */
const PAIRS = [5, 7, 14, 16, 18, 20, 22, 24, 26, 28, 34, 36];
const SURVEY_COLUMN = 44;
const AWAY = { minX: 0.1, maxX: 0.9, minY: -0.9, maxY: -0.1 };
const KITS: KitSource = { count: () => 1_000_000, take: () => {} };
/** Storage rows: right columns every 4 rows above row 500, full width every 4 rows from 508. */
const RIGHT_ROWS = { first: 8, last: 496, x0: 38 };
const BOTTOM_ROWS = { first: 508, last: 576 };

function must<T extends object>(r: Res<T>, what: string): T {
  if (!r.ok) throw new Error(`bench fixture: ${what}: ${JSON.stringify(r)}`);
  return r;
}

function carve(g: TerrainGrid, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = g.idx(x, y);
      g.terrain[i] = T.AIR;
      g.flags[i] |= F.SEEN;
    }
  }
}

function addLode(g: TerrainGrid, x0: number, top: number): void {
  const l: Lode = { id: g.lodes.length, metal: 'copper', purity: 'rich', x0, top, scripted: g.lodes.length === 0, scope: 'mvp', discovered: false };
  g.lodes.push(l);
  for (let y = top; y < top + 2; y++) {
    for (let x = x0; x < x0 + 3; x++) {
      g.terrain[g.idx(x, y)] = T.LODE_ROCK;
      g.lodeIndex[g.idx(x, y)] = l.id + 1;
    }
  }
}

/** Foot of pair i's right (deep) lift; its left lift stops 6 rows higher. Pairs deepen left to right. */
const pairFoot = (i: number): number => 60 + i * 40;

interface Plan {
  grid: TerrainGrid;
  drills: Cell[];
  rows: { y: number; x0: number; x1: number }[];
}

function benchGrid(): Plan {
  const g = new TerrainGrid(1);
  g.terrain.fill(T.DIRT);
  const drills: Cell[] = [];
  const rows: Plan['rows'] = [];
  addLode(g, 30, 46); // the scripted-lode slot (id 0) stays undrilled
  PAIRS.forEach((c, i) => {
    const deep = pairFoot(i);
    const shallow = deep - 6;
    carve(g, c, 0, c, shallow);
    carve(g, c + 1, 0, c + 1, deep);
    // Right lift's drill on columns c−1..c, under the left lift's foot; left lift's on c−2..c−1.
    addLode(g, c - 1, deep + 1);
    carve(g, c - 1, deep - 1, c, deep);
    drills.push({ x: c - 1, y: deep - 1 });
    addLode(g, c - 2, shallow + 1);
    carve(g, c - 2, shallow - 1, c - 1, shallow);
    drills.push({ x: c - 2, y: shallow - 1 });
  });
  const storageRow = (y: number, x0: number): void => {
    addLode(g, x0, y + 1);
    carve(g, x0, y - 1, x0 + 1, y);
    carve(g, x0 + 2, y, 47, y);
    drills.push({ x: x0, y: y - 1 });
    rows.push({ y, x0: x0 + 2, x1: 47 });
  };
  for (let y = RIGHT_ROWS.first; y <= RIGHT_ROWS.last; y += 4) storageRow(y, RIGHT_ROWS.x0);
  for (let y = BOTTOM_ROWS.first; y <= BOTTOM_ROWS.last; y += 4) storageRow(y, 0);
  return { grid: g, drills, rows };
}

/** Build the fixture through commands (02 §10.10), as a player would. */
export function buildBenchFixture(noSleep = false, dense = false): BenchFixture {
  const { grid, drills, rows } = benchGrid();
  let cash = 1e12;
  const wallet = {
    cash: () => cash,
    debit: (n: number) => (n <= cash ? ((cash -= n), true) : false),
    credit: (n: number) => {
      cash += n;
    },
  };
  const f = Factory.create({ grid, wallet, emit: () => {} }, { scope: 'v1', surveyColumn: SURVEY_COLUMN, scriptedLodeId: 0, noSleep });
  for (const l of grid.lodes) f.discoverLode(l.id, true);
  for (const r of ['U3', 'U8', 'U10'] as const) f.unlockRung(r);
  must(f.expandYard(), 'Expansion I');
  must(f.expandYard(), 'Expansion II');
  const build = (spec: Parameters<Factory['placeGhost']>[0], what: string): void => {
    for (const id of must(f.placeGhost(spec), `${what} ghost`).ids) must(f.completeGhost(id, AWAY, KITS), what);
  };
  for (const d of drills) build({ kind: 'autoDrill', x: d.x, y: d.y }, 'drill');
  PAIRS.forEach((c, i) => {
    build({ kind: 'lift', x: c, foot: pairFoot(i) - 6, top: 0 }, 'lift');
    build({ kind: 'lift', x: c + 1, foot: pairFoot(i), top: 0 }, 'lift');
  });
  for (const r of rows) {
    if (dense) for (let x = r.x0; x <= r.x1; x++) build(x % 2 === 0 ? { kind: 'belt', mk: 3, x, y: r.y, dir: 0, length: 1 } : { kind: 'router', x, y: r.y }, 'dense row');
    else for (let x = r.x0; x <= r.x1; x += 8) build({ kind: 'belt', mk: 3, x, y: r.y, dir: 0, length: Math.min(8, r.x1 - x + 1) }, 'belt');
  }
  buildLoop(f);
  buildLanes(f);
  return summarize(f);
}

function place(f: Factory, kind: BuildingKind, x: number, y: number, dir: Dir): number {
  return must(f.place(kind, 1, x, y, dir), `${kind} at ${x},${y}`).id;
}

/** A 360-tile ring on Yard rows 15–22 (serpentine x 3–45, return up column 2), Wire merged in by a T-Router. */
function buildLoop(f: Factory): void {
  must(f.stockpilePut([{ item: 'wire', n: 200 }]), 'fill the survey Bin');
  const bin = place(f, 'bin', 0, 20, 3);
  must(f.stockpilePut([{ item: 'wire', n: 200 }]), 'loop wire');
  must(f.setUnloadFilter(bin, 'wire'), 'loop unload');
  const ring: Cell[] = [];
  for (let k = 0; k < 8; k++) {
    const y = 15 + k;
    for (let i = 0; i <= 42; i++) ring.push({ x: k % 2 === 0 ? 3 + i : 45 - i, y });
  }
  for (let y = 22; y >= 15; y--) ring.push({ x: 2, y });
  ring.push({ x: 3, y: 15 });
  must(f.paintBelts(ring, 1), 'loop');
  // A stroke from the Bin's port pointing into the ring's side becomes a merging Router (02 §2.1).
  must(f.paintBelts([{ x: 1, y: 19 }, { x: 1, y: 18 }], 1, 0), 'merge');
}

/** One lane under each Headframe: Smelter → Assembler (Wire) → Bin unloading Wire → Export. */
function buildLanes(f: Factory): void {
  for (const x of PAIRS) {
    place(f, 'headframe', x, 1, 1);
    must(f.paintBelts([{ x, y: 3 }], 1, 1), 'lane');
    place(f, 'smelter', x, 4, 1);
    must(f.paintBelts([{ x, y: 6 }], 1, 1), 'lane');
    must(f.setRecipe(place(f, 'assembler', x, 7, 1), 'A2'), 'recipe');
    must(f.paintBelts([{ x, y: 9 }], 1, 1), 'lane');
    must(f.setUnloadFilter(place(f, 'bin', x, 10, 1), 'wire'), 'unload');
    must(f.paintBelts([{ x, y: 12 }], 1, 1), 'lane');
    place(f, 'export', x, 13, 0);
  }
}

function summarize(f: Factory): BenchFixture {
  const kinds: Record<string, number> = {};
  for (const e of f.entities()) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  let beltTiles = 0;
  for (const plane of ['yard', 'mine'] as const) for (const w of f.beltWords(plane)) if (w) beltTiles += w & 0x4000 ? 2 : 1;
  return { f, entities: f.entities().length, beltTiles, kinds };
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
