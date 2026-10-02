// Transport lines with gap encoding (02 §10.3; 04 §4.4). PURE MODULE.
// A line is a chain of same-tier belt tiles, head (downstream end) first. Items sit in a ring, head first;
// gap[0] = head edge → item 0, gap[i] = item i−1 → item i, in belt units (240 u per tile). Every gap is ≥ S
// except gap[0] ≥ 0, so a compressed line delivers one item per S / v ticks.
import { pow2 } from './geom';

/** Belt units per tile and per tick (canon §3.11: 1 tile/s on every tier). */
export const TILE_U = 240;
export const BELT_V = 12;
/** Item spacing by Mk (index = Mk): 1.0 / 0.5 / 0.25 tile. */
export const SPACING_U: readonly number[] = [0, 240, 120, 60];
/** Lines break every 128 tiles (02 §10.1), so L ≤ 30,720 u. */
export const MAX_LINE_TILES = 128;
/** 60 one-second flow buckets (02 §10.2 P6). */
const FLOW_BUCKETS = 60;
const TICKS_PER_BUCKET = 20;

/** Packed belt slot: (cell << 2) | dir. A Junction cell holds two slots (04 §4.1). */
export function slotKey(cell: number, dir: number): number {
  return (cell << 2) | dir;
}
export function slotCell(slot: number): number {
  return slot >> 2;
}
export function slotDir(slot: number): number {
  return slot & 3;
}

export class Line {
  readonly S: number;
  readonly L: number;
  private readonly items: Uint16Array;
  private readonly gaps: Int32Array;
  private readonly mask: number;
  private head = 0;
  n = 0;
  /** Σ gaps: distance from the head edge to the last item. */
  tailPos = 0;
  /** Gaps before this index have no slack (items pressed against the head); a pure optimisation. */
  firstSlack = 0;

  // Endpoints, resolved by the topology pass. 0 = none.
  targetNode = 0;
  targetSide = 0;
  targetLine = 0;
  feederNode = 0;
  feederLine = 0;

  /** Something moved in the last P3 (render extrapolation). */
  moved = false;
  /** Did anything this tick (P6 sleep test). */
  active = true;

  private readonly flow = new Uint16Array(FLOW_BUCKETS);
  private flowBucket = 0;

  /** Cell-space bounding box for view culling. */
  bx0 = 0;
  by0 = 0;
  bx1 = 0;
  by1 = 0;

  constructor(
    readonly id: number,
    readonly plane: number,
    readonly tier: number,
    /** Tiles head → tail as slot keys. */
    readonly slots: Int32Array,
    /** Travel direction entering each tile (differs from the tile's own dir on a corner). */
    readonly entry: Uint8Array,
  ) {
    this.S = SPACING_U[tier];
    this.L = slots.length * TILE_U;
    const cap = pow2(Math.floor(this.L / this.S) + 2);
    this.items = new Uint16Array(cap);
    this.gaps = new Int32Array(cap);
    this.mask = cap - 1;
  }

  /** P3 (02 §10.3): advance by v; items behind the first slack gap move rigidly. Returns whether anything moved. */
  move(): boolean {
    const n = this.n;
    if (n === 0) return (this.moved = false);
    const S = this.S;
    const gaps = this.gaps;
    const mask = this.mask;
    const h = this.head;
    let r = BELT_V;
    for (let j = this.firstSlack; j < n; j++) {
      const p = (h + j) & mask;
      const g = gaps[p];
      const slack = j === 0 ? g : g - S;
      if (slack <= 0) continue;
      const d = slack < r ? slack : r;
      gaps[p] = g - d;
      this.tailPos -= d;
      r -= d;
      if (r === 0) break;
    }
    this.advanceSlack();
    return (this.moved = r !== BELT_V);
  }

  private advanceSlack(): void {
    let f = this.firstSlack;
    const n = this.n;
    const h = this.head;
    while (f < n) {
      const g = this.gaps[(h + f) & this.mask];
      if ((f === 0 ? g : g - this.S) > 0) break;
      f++;
    }
    this.firstSlack = f;
  }

  /** The head item sits at the head edge and may exit (P4). */
  headReady(): boolean {
    return this.n > 0 && this.gaps[this.head] === 0;
  }
  headItem(): number {
    return this.items[this.head];
  }
  /** Remove the head item (only when headReady()). */
  popHead(): number {
    const h = this.head;
    const item = this.items[h];
    const n = this.n - 1;
    if (n > 0) this.gaps[(h + 1) & this.mask] += this.gaps[h];
    this.head = (h + 1) & this.mask;
    this.n = n;
    if (n === 0) this.tailPos = 0;
    this.firstSlack = 0;
    this.active = true;
    return item;
  }

  /** Free length at the tail (L when empty). */
  tailRoom(): number {
    return this.n === 0 ? this.L : this.L - this.tailPos;
  }
  canInsert(): boolean {
    return this.n === 0 || this.L - this.tailPos >= this.S;
  }
  /** P4/P5 (02 §10.3): append at the tail edge when the spacing allows. */
  insertTail(item: number): boolean {
    if (!this.canInsert()) return false;
    const g = this.tailRoom();
    const p = (this.head + this.n) & this.mask;
    this.items[p] = item;
    this.gaps[p] = g;
    this.n++;
    this.tailPos = this.L;
    if (this.firstSlack === this.n - 1) this.advanceSlack();
    this.active = true;
    return true;
  }

  /** Rebuild / load: append an item at absolute position `pos` (ascending, spacing already checked). */
  appendAt(pos: number, item: number): void {
    const p = (this.head + this.n) & this.mask;
    this.items[p] = item;
    this.gaps[p] = pos - (this.n === 0 ? 0 : this.tailPos);
    this.n++;
    this.tailPos = pos;
    this.firstSlack = 0;
    this.advanceSlack();
  }

  /** Item i (0 = head) and its gap. */
  itemAt(i: number): number {
    return this.items[(this.head + i) & this.mask];
  }
  gapAt(i: number): number {
    return this.gaps[(this.head + i) & this.mask];
  }

  clear(): void {
    this.head = 0;
    this.n = 0;
    this.tailPos = 0;
    this.firstSlack = 0;
  }

  // ---- flow counters (logistics overlay; not saved, not hashed) ----

  noteExit(tick: number): void {
    const b = Math.floor(tick / TICKS_PER_BUCKET);
    this.rollFlow(b);
    this.flow[b % FLOW_BUCKETS]++;
  }
  /** Items that left the head in the last 60 s. */
  flowPerMinute(tick: number): number {
    this.rollFlow(Math.floor(tick / TICKS_PER_BUCKET));
    let s = 0;
    for (let i = 0; i < FLOW_BUCKETS; i++) s += this.flow[i];
    return s;
  }
  private rollFlow(b: number): void {
    if (b <= this.flowBucket) return;
    const k = Math.min(FLOW_BUCKETS, b - this.flowBucket);
    for (let i = 1; i <= k; i++) this.flow[(this.flowBucket + i) % FLOW_BUCKETS] = 0;
    this.flowBucket = b;
  }
}
