// ADR-0002 bench fixture (04 §3.4; MVP-17; 02 §10.11 #12): the terrain plan and the command sequence that build
// "2,000 buildings, 10k items, 128-tile lines, 24 lifts, every MVP node" through factory commands, as a player
// would. Shared by the Node bench (tools/bench/factoryBench.ts) and the browser bench (bench.html), which builds it
// inside a live World. No DOM.
//
// The closest the 48-wide mine allows: only MVP building kinds; the scope is v1 solely so storage rows can use Mk III
// belts (4 items per tile) and the Yard can take Expansion II for the serpentine. Belt tiles count as buildings.
// - 24 Mk I Bucket Lifts in 12 Headframe pairs, feet 54–500 rows deep, each fed by a Rich Mk I Auto-Drill;
// - 12 Yard lanes: Headframe → Smelter → Assembler (A2) → Bin (unload Wire) → Export;
// - a 360-tile Yard loop (three 128-tile lines and a remainder) with a Router merging Wire in from a Bin;
// - storage rows of Mk III belts fed by drills and dead-ended, in the free columns and below the lifts.
// `dense` swaps every other storage tile for a Router: ~1,000 more entities and 1-tile lines (a harsher stress).
import { F, T, type Lode } from '../shared/types';
import { TerrainGrid } from '../terrain/grid';
import type { BuildingKind, Cell, Dir, FactoryApi, KitSource, Res } from '../factory/api';

/** Headframe pairs: 2-wide valid columns (02 §2.2) side by side. */
export const PAIRS = [5, 7, 14, 16, 18, 20, 22, 24, 26, 28, 34, 36];
/** The Node fixture's survey column (its Factory places the survey set there). */
export const SURVEY_COLUMN = 44;
const AWAY = { minX: 0.1, maxX: 0.9, minY: -0.9, maxY: -0.1 };
const KITS: KitSource = { count: () => 1_000_000, take: () => {} };
/** Storage rows: right columns every 4 rows above row 500, full width every 4 rows from 508. */
const RIGHT_ROWS = { first: 8, last: 496, x0: 38 };
const BOTTOM_ROWS = { first: 508, last: 576 };

export interface BenchPlan {
  grid: TerrainGrid;
  drills: Cell[];
  rows: { y: number; x0: number; x1: number }[];
}

export interface BenchCounts {
  entities: number;
  beltTiles: number;
  kinds: Record<string, number>;
}

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
export const pairFoot = (i: number): number => 60 + i * 40;

/** The fixture's mine: solid dirt, the lift shafts, drill sites on Rich Copper lodes and the storage rows. */
export function benchGrid(seed = 1): BenchPlan {
  const g = new TerrainGrid(seed);
  g.terrain.fill(T.DIRT);
  const drills: Cell[] = [];
  const rows: BenchPlan['rows'] = [];
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

/**
 * Build the fixture through commands (02 §10.10) on a factory whose grid holds `plan.grid`'s terrain and lodes,
 * with a 200-Wire Bin already standing (the Node fixture's survey Bin; the World bench places one).
 */
export function buildBenchCommands(f: FactoryApi, plan: BenchPlan, dense = false): void {
  unlockBench(f, plan);
  if (f.yardRows < 16) must(f.expandYard(), 'Expansion I');
  if (f.yardRows < 24) must(f.expandYard(), 'Expansion II');
  const build = (spec: Parameters<FactoryApi['placeGhost']>[0], what: string): void => {
    for (const id of must(f.placeGhost(spec), `${what} ghost`).ids) must(f.completeGhost(id, AWAY, KITS), what);
  };
  for (const d of plan.drills) build({ kind: 'autoDrill', x: d.x, y: d.y }, 'drill');
  PAIRS.forEach((c, i) => {
    build({ kind: 'lift', x: c, foot: pairFoot(i) - 6, top: 0 }, 'lift');
    build({ kind: 'lift', x: c + 1, foot: pairFoot(i), top: 0 }, 'lift');
  });
  for (const r of plan.rows) {
    if (dense) for (let x = r.x0; x <= r.x1; x++) build(x % 2 === 0 ? { kind: 'belt', mk: 3, x, y: r.y, dir: 0, length: 1 } : { kind: 'router', x, y: r.y }, 'dense row');
    else for (let x = r.x0; x <= r.x1; x += 8) build({ kind: 'belt', mk: 3, x, y: r.y, dir: 0, length: Math.min(8, r.x1 - x + 1) }, 'belt');
  }
  buildLoop(f);
  buildLanes(f);
}

/** Every lode discovered (U2) and the rungs the fixture's pieces need (U3; v1 U8, U10 for Mk III). Idempotent. */
export function unlockBench(f: FactoryApi, plan: BenchPlan): void {
  for (let id = 0; id < plan.grid.lodes.length; id++) f.discoverLode(id, true);
  for (const r of ['U3', 'U8', 'U10'] as const) f.unlockRung(r);
}

function place(f: FactoryApi, kind: BuildingKind, x: number, y: number, dir: Dir): number {
  return must(f.place(kind, 1, x, y, dir), `${kind} at ${x},${y}`).id;
}

/** A 360-tile ring on Yard rows 15–22 (serpentine x 3–45, return up column 2), Wire merged in by a T-Router. */
function buildLoop(f: FactoryApi): void {
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
function buildLanes(f: FactoryApi): void {
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

/** Entities by kind and belt tiles (a Junction counts twice). */
export function countFixture(f: FactoryApi): BenchCounts {
  const kinds: Record<string, number> = {};
  for (const e of f.entities()) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  let beltTiles = 0;
  for (const plane of ['yard', 'mine'] as const) for (const w of f.beltWords(plane)) if (w) beltTiles += w & 0x4000 ? 2 : 1;
  return { entities: f.entities().length, beltTiles, kinds };
}

/** The 200-Wire Bin every fixture starts with (where the Node fixture's survey Bin stands). */
export function placeStockBin(f: FactoryApi): void {
  const r = f.place('bin', 1, SURVEY_COLUMN, 7, 1);
  if (!r.ok) throw new Error(`bench fixture: stock Bin: ${JSON.stringify(r)}`);
  must(f.stockpilePut([{ item: 'wire', n: 200 }]), 'stock wire');
}
