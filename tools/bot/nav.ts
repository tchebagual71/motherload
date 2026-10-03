// Economy bot (04 §11.2): what the bot knows about the mine and how it plans paths through it.
// Cells are (x, r) with r = −1 for the Rim level (the air just above the turf row). The bot only trusts cells it
// has SEEN (canon §3.1 light bubble); an unseen cell is planned as plain dirt and re-planned once it shows.
import { MINE_H, MINE_W, MINERALS, RELICS } from '../../src/shared/canon';
import { F, T, mineralTierOf, relicIdOf } from '../../src/shared/types';
import type { TerrainGrid } from '../../src/terrain/grid';
import { classifyDigTarget } from '../../src/pod';
import type { Scope } from '../../src/shared/types';

export const W = MINE_W;

export interface Cell {
  x: number;
  r: number;
}

/** Node index of (x, r), r ≥ −1. */
export const node = (x: number, r: number): number => (r + 1) * W + x;
export const nodeX = (n: number): number => n % W;
export const nodeR = (n: number): number => Math.floor(n / W) - 1;

/** Path costs, in 60 Hz steps (rough, for ranking only). */
export interface Costs {
  /** Steps to dig one cell (drill tier) plus the push engage. */
  dig: number;
  /** Per row of braked fall. */
  fall: number;
  /** Per row of climb at full thrust and the current load. */
  climb: number;
  /** Per tile of sideways travel standing on a floor (driving). */
  side: number;
  /** Per tile of sideways travel hovering in a shaft (stop in the row, slide over, go on). */
  sideAir: number;
}

/**
 * A read-only view of the mine for planning: open cells, support, digability and value, honouring the scope floor
 * (MVP r320 overlay) and the bot's knowledge (SEEN). One instance per World; cheap per-call queries.
 */
export class MineView {
  /** First unplayable row. */
  readonly floor: number;
  constructor(
    readonly grid: TerrainGrid,
    readonly scope: Scope,
    floorRow: number,
  ) {
    this.floor = floorRow;
  }

  inside(x: number, r: number): boolean {
    return x >= 0 && x < W && r >= -1 && r < this.floor;
  }

  /** The pod may occupy (x, r): the Rim level, or an air cell without an occupant above the floor. */
  open(x: number, r: number): boolean {
    if (x < 0 || x >= W || r >= this.floor) return false;
    if (r < 0) return true;
    const i = r * W + x;
    return this.grid.terrain[i] === T.AIR && this.grid.occupant[i] === 0;
  }

  /** Something the pod stands on below (x, r): solid terrain, an occupant or the floor. */
  supported(x: number, r: number): boolean {
    const b = r + 1;
    if (b >= this.floor) return true;
    if (b < 0) return false;
    const i = b * W + x;
    return this.grid.terrain[i] !== T.AIR || this.grid.occupant[i] !== 0;
  }

  seen(x: number, r: number): boolean {
    return r < 0 || (this.grid.flags[r * W + x] & F.SEEN) !== 0;
  }

  /**
   * Can the bot plan to drill (x, r)? Seen cells must classify as 'drill' and not be a Magma or Methane pocket
   * (the bot routes around glowing pockets); unseen cells are assumed to be dirt.
   */
  diggable(x: number, r: number): boolean {
    if (x < 0 || x >= W || r < 0 || r >= this.floor) return false;
    const i = r * W + x;
    if (this.grid.occupant[i] !== 0) return false;
    const code = this.grid.terrain[i];
    if (code === T.AIR) return false;
    if (!this.seen(x, r)) return code !== T.PAVED && code !== T.LODE_ROCK; // what a player would see at the edge
    if (code === T.MAGMA || code === T.METHANE) return false;
    return classifyDigTarget(this.grid, x, r, this.floor, this.scope) === 'drill';
  }

  /** Assay value of what digging (x, r) collects (seen cells only). */
  value(x: number, r: number): number {
    if (r < 0 || !this.seen(x, r)) return 0;
    const code = this.grid.terrain[r * W + x];
    const tier = mineralTierOf(code);
    if (tier > 0) return MINERALS[tier - 1].value;
    const relic = relicIdOf(code);
    return relic >= 0 ? RELICS[relic].value : 0;
  }

  /** Mineral tier at (x, r) (0 = none). */
  tier(x: number, r: number): number {
    return r < 0 ? 0 : mineralTierOf(this.grid.terrain[r * W + x]);
  }
}

// ---------------------------------------------------------------- Dijkstra

const N = W * (MINE_H + 1);

/** Binary min-heap of (cost, node) over typed arrays. */
class Heap {
  private cost = new Float64Array(1024);
  private id = new Int32Array(1024);
  n = 0;
  clear(): void {
    this.n = 0;
  }
  push(c: number, v: number): void {
    if (this.n === this.cost.length) {
      const c2 = new Float64Array(this.n * 2);
      c2.set(this.cost);
      this.cost = c2;
      const i2 = new Int32Array(this.n * 2);
      i2.set(this.id);
      this.id = i2;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p] <= c) break;
      this.cost[i] = this.cost[p];
      this.id[i] = this.id[p];
      i = p;
    }
    this.cost[i] = c;
    this.id[i] = v;
  }
  /** Pop the minimum; returns the node (its cost is in `top`). */
  top = 0;
  pop(): number {
    const v = this.id[0];
    this.top = this.cost[0];
    const c = this.cost[--this.n];
    const last = this.id[this.n];
    let i = 0;
    for (;;) {
      let k = 2 * i + 1;
      if (k >= this.n) break;
      if (k + 1 < this.n && this.cost[k + 1] < this.cost[k]) k++;
      if (this.cost[k] >= c) break;
      this.cost[i] = this.cost[k];
      this.id[i] = this.id[k];
      i = k;
    }
    this.cost[i] = c;
    this.id[i] = last;
    return v;
  }
}

export interface SearchOptions {
  /** Allow drilling (mining runs); false = open cells only (the way home). */
  dig: boolean;
  /** Stop expanding beyond this cost (steps). */
  maxCost: number;
  /** Cells the planner must not enter (failed moves, building sites). */
  avoid?: ReadonlySet<number>;
}

/**
 * Single-source shortest paths over pod moves: down (fall, or drill when grounded on the cell), sideways (drive,
 * hover, or drill when standing on support), up (climb through open cells only: the drill never digs up).
 */
export class Planner {
  readonly dist = new Float64Array(N);
  readonly prev = new Int32Array(N);
  private readonly heap = new Heap();
  /** Nodes touched by the last search (for a cheap reset). */
  private touched: number[] = [];

  constructor(readonly view: MineView) {
    this.dist.fill(Infinity);
    this.prev.fill(-1);
  }

  private reset(): void {
    for (const n of this.touched) {
      this.dist[n] = Infinity;
      this.prev[n] = -1;
    }
    this.touched.length = 0;
  }

  private relax(from: number, to: number, c: number): void {
    if (c < this.dist[to]) {
      if (this.dist[to] === Infinity) this.touched.push(to);
      this.dist[to] = c;
      this.prev[to] = from;
      this.heap.push(c, to);
    }
  }

  /** Run from `start`; `visit(node, cost)` sees each settled node; return true from it to stop early. */
  search(start: Cell, costs: Costs, opts: SearchOptions, visit?: (n: number, cost: number) => boolean): void {
    this.reset();
    const v = this.view;
    const s = node(start.x, start.r);
    this.heap.clear();
    this.touched.push(s);
    this.dist[s] = 0;
    this.prev[s] = -1;
    this.heap.push(0, s);
    while (this.heap.n > 0) {
      const u = this.heap.pop();
      const cu = this.heap.top;
      if (cu > this.dist[u]) continue;
      if (visit && visit(u, cu)) return;
      if (cu > opts.maxCost) return;
      const x = nodeX(u);
      const r = nodeR(u);
      // A cell entered by drilling is open from then on: chains of digs go on down or sideways from it (the cell
      // below is still solid, so it stands there); only originally open cells lead up.
      const avoid = opts.avoid;
      const stand = v.supported(x, r);
      // Down: fall into air, or drill the floor.
      if (r + 1 < v.floor) {
        const d = node(x, r + 1);
        if (!avoid?.has(d)) {
          if (v.open(x, r + 1)) this.relax(u, d, cu + costs.fall);
          else if (opts.dig && v.diggable(x, r + 1)) this.relax(u, d, cu + costs.dig);
        }
      }
      // Sideways.
      for (let dx = -1; dx <= 1; dx += 2) {
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        const d = node(nx, r);
        if (avoid?.has(d)) continue;
        if (v.open(nx, r)) this.relax(u, d, cu + (stand ? costs.side : costs.sideAir));
        else if (opts.dig && stand && r >= 0 && v.diggable(nx, r)) this.relax(u, d, cu + costs.dig);
      }
      // Up: open cells only.
      if (r >= 0 && v.open(x, r - 1)) {
        const d = node(x, r - 1);
        if (!avoid?.has(d)) this.relax(u, d, cu + costs.climb);
      }
    }
  }

  /** Path from the last search's start to `goal` (inclusive), or null if unreached. */
  path(goal: number): Cell[] | null {
    if (this.dist[goal] === Infinity) return null;
    const out: Cell[] = [];
    for (let n = goal; n >= 0; n = this.prev[n]) out.push({ x: nodeX(n), r: nodeR(n) });
    return out.reverse();
  }
}
