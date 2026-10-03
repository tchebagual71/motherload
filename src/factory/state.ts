// All mutable factory state plus the primitives every phase and command shares: id allocation, awake sets,
// grid writes, the Stockpile and the conservation counters (02 §10.1, §10.7–10.8; 04 §4.3–4.6). PURE MODULE.
import { MINE_H } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import { scopeAtLeast } from '../shared/scope';
import { F, type Scope } from '../shared/types';
import type { TerrainGrid } from '../terrain/grid';
import { RUNGS, kitUnits, type FactoryOptions, type FactoryPorts, type FactoryWallet, type Rung } from './api';
import { Q16, invOf, type Ent } from './ent';
import { MINE, W, YARD_H, type PlaneNum } from './geom';
import type { Ghost } from './ghost';
import { ITEMS, item, kitItemId } from './items';
import type { Line } from './line';
import { RECIPES } from './recipes';

/** u16 ids 1..32,767 (04 §4.3). */
export const MAX_ID = 32_767;
const BITSET_WORDS = (MAX_ID + 1) >>> 5;
/** Item registry nums are < 256 (04 §4.3). */
export const ITEM_SLOTS = 256;

/** Conservation counters (02 §10.7). Items enter by import or production and leave by sale, use, take or scrap. */
export interface Counters {
  imported: number;
  produced: number;
  sold: number;
  consumed: number;
  taken: number;
  scrapped: number;
}

export class FactoryState {
  readonly grid: TerrainGrid;
  readonly wallet: FactoryWallet;
  readonly emit: (e: GameEvent) => void;
  readonly scope: Scope;
  readonly v1: boolean;
  readonly surveyColumn: number;
  readonly scriptedLodeId: number;
  readonly noSleep: boolean;
  readonly checkInvariants: boolean;

  tickNo = 0;
  /** Power satisfaction, Q16. MVP: always 65,536 (02 §6.1); the hook stays for v1 and tests. */
  sQ = Q16;
  yardRows: number;
  away = false;
  /** Unlocked rungs (RungDef.bit). */
  rungs = 0;
  /** Recipes unlocked by rung or possession (F1). */
  readonly recipeOpen = new Uint8Array(RECIPES.length);
  /** Item types that have existed in the factory or Stockpile (F1). */
  readonly seen = new Uint8Array(ITEM_SLOTS);
  firstLift = false;
  firstIngot = false;
  /** Lode purity shown (02 §3.6 discovery). */
  readonly purityKnown = new Uint8Array(256);
  /** Drill entity per lode id (one per lode, E_LODE). */
  readonly lodeDrill = new Uint16Array(256);
  /** Loose units of opened metered Kits in the Stockpile (02 §2.7 "metered Kits merge"). */
  readonly kitMeter: Record<string, number> = {};

  // ---- entities ----
  readonly ents: (Ent | null)[] = [null];
  readonly entFree: number[] = [];
  readonly entAwake = new Uint32Array(BITSET_WORDS);
  // ---- lines ----
  readonly lines: (Line | null)[] = [null];
  readonly lineFree: number[] = [];
  readonly lineAwake = new Uint32Array(BITSET_WORDS);
  // ---- ghosts ----
  readonly ghosts: (Ghost | null)[] = [null];
  readonly ghostFree: number[] = [];
  ghostSeq = 0;

  // ---- per-plane cell layers (index y × 48 + x) ----
  /** Belt words (04 §4.1 layout). The mine layer is mirrored into grid.mount. */
  readonly belt: [Uint16Array, Uint16Array] = [new Uint16Array(W * YARD_H), new Uint16Array(W * MINE_H)];
  /** Yard: building id per cell. Mine: mount owner id (Router, lift). */
  readonly build: [Uint16Array, Uint16Array] = [new Uint16Array(W * YARD_H), new Uint16Array(W * MINE_H)];
  /** Mine occupant owner id (Auto-Drill). */
  readonly occ = new Uint16Array(W * MINE_H);
  /** Ghost job id per cell. */
  readonly ghostAt: [Uint16Array, Uint16Array] = [new Uint16Array(W * YARD_H), new Uint16Array(W * MINE_H)];
  /** Line id and tile index owning each belt slot: layer A and (Junction) layer B. */
  readonly cellLineA: [Uint16Array, Uint16Array] = [new Uint16Array(W * YARD_H), new Uint16Array(W * MINE_H)];
  readonly cellLineB: [Uint16Array, Uint16Array] = [new Uint16Array(W * YARD_H), new Uint16Array(W * MINE_H)];
  readonly cellIdxA: [Uint8Array, Uint8Array] = [new Uint8Array(W * YARD_H), new Uint8Array(W * MINE_H)];
  readonly cellIdxB: [Uint8Array, Uint8Array] = [new Uint8Array(W * YARD_H), new Uint8Array(W * MINE_H)];

  readonly stockTotals = new Uint32Array(ITEM_SLOTS);
  readonly count: Counters = { imported: 0, produced: 0, sold: 0, consumed: 0, taken: 0, scrapped: 0 };
  /** Export sales this tick, reported once in P6. */
  saleAmount = 0;
  saleCount = 0;
  topologyVersion = 0;
  /** Next Ent.serial (session only). */
  serialSeq = 1;

  constructor(ports: FactoryPorts, opts: FactoryOptions) {
    this.grid = ports.grid;
    this.wallet = ports.wallet;
    this.emit = (e) => ports.emit(e);
    this.scope = opts.scope;
    this.v1 = scopeAtLeast(opts.scope, 'v1');
    this.surveyColumn = opts.surveyColumn;
    this.scriptedLodeId = opts.scriptedLodeId;
    this.noSleep = opts.noSleep ?? false;
    this.checkInvariants = opts.checkInvariants ?? false;
    this.yardRows = opts.yardRows ?? 8;
  }

  // ---------------------------------------------------------------- ids

  allocEnt(): number {
    if (this.entFree.length > 0) return this.entFree.pop() as number;
    const id = this.ents.length;
    if (id > MAX_ID) return 0;
    this.ents.push(null);
    return id;
  }
  freeEnt(id: number): void {
    this.ents[id] = null;
    this.entFree.push(id);
    clearBit(this.entAwake, id);
  }
  allocLine(): number {
    if (this.lineFree.length > 0) return this.lineFree.pop() as number;
    const id = this.lines.length;
    this.lines.push(null);
    return id;
  }
  freeLine(id: number): void {
    this.lines[id] = null;
    this.lineFree.push(id);
    clearBit(this.lineAwake, id);
  }
  ent(id: number): Ent | null {
    return id > 0 && id < this.ents.length ? this.ents[id] : null;
  }
  line(id: number): Line | null {
    return id > 0 && id < this.lines.length ? this.lines[id] : null;
  }

  // ---------------------------------------------------------------- awake sets (02 §10.8)

  wakeEnt(id: number): void {
    const e = this.ents[id];
    if (!e) return;
    e.active = true;
    this.entAwake[id >>> 5] |= 1 << (id & 31);
  }
  wakeLine(id: number): void {
    const l = this.lines[id];
    if (!l) return;
    l.active = true;
    this.lineAwake[id >>> 5] |= 1 << (id & 31);
  }
  wakeFeeders(e: Ent): void {
    for (let i = 0; i < e.feeders.length; i++) this.wakeEnt(e.feeders[i]);
  }
  /** After a line's tail gained room: wake whatever feeds it. */
  wakeLineFeeder(l: Line): void {
    if (l.feederNode) this.wakeEnt(l.feederNode);
    else if (l.feederLine) this.wakeLine(l.feederLine);
  }
  wakeAll(): void {
    for (let id = 1; id < this.ents.length; id++) if (this.ents[id]) this.wakeEnt(id);
    for (let id = 1; id < this.lines.length; id++) if (this.lines[id]) this.wakeLine(id);
  }
  sleepEnt(id: number): void {
    clearBit(this.entAwake, id);
  }
  sleepLine(id: number): void {
    clearBit(this.lineAwake, id);
  }

  // ---------------------------------------------------------------- grid writes (04 §4.1)

  setMount(cell: number, v: number): void {
    const g = this.grid;
    if (g.mount[cell] === v) return;
    g.mount[cell] = v;
    g.touch(cell % W, Math.floor(cell / W));
  }
  setOccupant(cell: number, id: number): void {
    const g = this.grid;
    this.occ[cell] = id;
    if (g.occupant[cell] === id) return;
    g.occupant[cell] = id;
    g.touch(cell % W, Math.floor(cell / W));
  }
  /**
   * ANCHORED (02 §2.3): set on the cell directly beneath every underground Belt, Router and occupant cell, cleared
   * when that piece goes. Lift cells never anchor.
   */
  refreshAnchor(x: number, r: number): void {
    if (r < 1 || r >= MINE_H) return;
    const above = (r - 1) * W + x;
    const here = r * W + x;
    const mount = this.belt[MINE][above] !== 0 || this.isRouterAt(above);
    const occ = this.occ[above] !== 0 && this.occ[above] !== this.occ[here];
    this.grid.setFlag(x, r, F.ANCHORED, mount || occ);
  }
  private isRouterAt(cell: number): boolean {
    const e = this.ents[this.build[MINE][cell]];
    return e !== null && e !== undefined && e.kind === 'router';
  }

  /** Entity at a plane cell: Yard building, or mine mount owner, else mine occupant. */
  entAt(p: PlaneNum, cell: number): Ent | null {
    if (cell < 0) return null;
    const id = this.build[p][cell] || (p === MINE ? this.occ[cell] : 0);
    return id ? this.ents[id] : null;
  }

  // ---------------------------------------------------------------- rungs, possession, events

  hasRung(r: Rung): boolean {
    return (this.rungs & (1 << rungBit(r))) !== 0;
  }
  /** Unlock a rung (idempotent); emits 'unlock' and re-checks possession recipes. */
  unlock(r: Rung): void {
    if (this.hasRung(r)) return;
    const d = RUNGS.find((x) => x.id === r);
    if (!d || (d.scope === 'v1' && !this.v1)) return;
    this.rungs |= 1 << d.bit;
    if (r !== 'U0') this.emit({ t: 'unlock', rung: r, label: d.unlocks });
    this.refreshRecipes();
  }
  /** An item type now exists in the factory or Stockpile (F1). */
  see(itemNum: number): void {
    if (this.seen[itemNum]) return;
    this.seen[itemNum] = 1;
    this.refreshRecipes();
  }
  /** Open recipes whose rung is unlocked or, for possession recipes, whose inputs have all existed (02 §0.2 F1). */
  refreshRecipes(): void {
    for (const r of RECIPES) {
      if (this.recipeOpen[r.num] || (r.scope === 'v1' && !this.v1)) continue;
      if (!this.recipeAllowed(r.num)) continue;
      this.recipeOpen[r.num] = 1;
      if (r.unlock === 'possession') this.emit({ t: 'unlock', rung: r.id, label: item(r.outputs[0].item).name });
    }
  }
  private recipeAllowed(num: number): boolean {
    const r = RECIPES[num];
    if (r.unlock === 'auto') return this.hasRung('U2');
    if (r.unlock !== 'possession') return this.hasRung(r.unlock);
    if (!this.hasRung('U3')) return false;
    for (const s of r.inputs) if (!this.seen[s.num]) return false;
    return true;
  }

  // ---------------------------------------------------------------- Stockpile (all Bins; canon §2.8)

  /** Bins in ascending id. */
  bins(out: Ent[]): Ent[] {
    out.length = 0;
    for (let id = 1; id < this.ents.length; id++) {
      const e = this.ents[id];
      if (e && e.inv) out.push(e);
    }
    return out;
  }
  private readonly binScratch: Ent[] = [];
  stockFree(): number {
    let free = 0;
    for (const b of this.bins(this.binScratch)) free += invOf(b).cap - invOf(b).total;
    return free;
  }
  /** Room for `n` of one item across Bins (capacity and run limits). */
  stockFits(itemNum: number, n: number): boolean {
    let room = 0;
    for (const b of this.bins(this.binScratch)) {
      const inv = invOf(b);
      if (inv.fits(itemNum, 1)) room += inv.cap - inv.total;
      if (room >= n) return true;
    }
    return room >= n;
  }
  /** Put into Bins, lowest id first. Caller checked room (stockFits). Not a conservation event. */
  stockAdd(itemNum: number, n: number, skip = 0): number {
    let left = n;
    for (const b of this.bins(this.binScratch)) {
      if (b.id === skip) continue;
      const inv = invOf(b);
      if (!inv.fits(itemNum, 1)) continue;
      const k = Math.min(left, inv.cap - inv.total);
      if (k <= 0) continue;
      inv.add(itemNum, k);
      this.stockTotals[itemNum] += k;
      this.wakeEnt(b.id);
      left -= k;
      if (left === 0) break;
    }
    if (n - left > 0) this.see(itemNum);
    return n - left;
  }
  /** Take from Bins, lowest id first (`skip`: not from that Bin). Caller checked the count. */
  stockRemove(itemNum: number, n: number, skip = 0): void {
    let left = n;
    for (const b of this.bins(this.binScratch)) {
      if (b.id === skip) continue;
      const k = invOf(b).remove(itemNum, left);
      if (k > 0) {
        this.stockTotals[itemNum] -= k;
        this.wakeEnt(b.id);
        left -= k;
      }
      if (left === 0) break;
    }
  }
  /** Displaced item (removed belt tile, rebuild spacing, lift queue): Stockpile if room, else destroyed (02 §2.7). */
  displace(itemNum: number): void {
    if (this.stockFits(itemNum, 1)) this.stockAdd(itemNum, 1);
    else this.count.scrapped++;
  }

  /** Refund Kit units to the Stockpile; metered units merge into whole Kits as they fill (02 §2.7). */
  stockKitUnits(kitId: string, units: number): void {
    const per = kitUnits(kitId);
    const num = item(kitItemId(kitId)).num;
    let meter = (this.kitMeter[kitId] ?? 0) + units;
    const whole = Math.floor(meter / per);
    const fit = whole > 0 && this.stockFits(num, whole) ? whole : 0;
    if (fit > 0) {
      this.stockAdd(num, fit);
      this.count.imported += fit;
      meter -= fit * per;
    }
    this.kitMeter[kitId] = meter;
  }
  /** Whole Kits a refund of `units` would add to the Bins (for the room check). */
  kitsFromUnits(kitId: string, units: number): number {
    return Math.floor(((this.kitMeter[kitId] ?? 0) + units) / kitUnits(kitId));
  }

  // ---------------------------------------------------------------- conservation (02 §10.7)

  /** Items held anywhere in the factory. A running craft holds none: inputs are consumed at its start. */
  itemsHeld(): number {
    let n = 0;
    for (const l of this.lines) if (l) n += l.n;
    for (const e of this.ents) {
      if (!e) continue;
      for (let i = 0; i < e.inCount.length; i++) n += e.inCount[i];
      if (e.out) n += e.out.n;
      if (e.inv) n += e.inv.total;
      if (e.queue) n += e.queue.n + (e.lip ? 1 : 0);
    }
    return n;
  }
  conservationOk(): boolean {
    const c = this.count;
    return c.imported + c.produced - c.sold - c.consumed - c.taken - c.scrapped === this.itemsHeld();
  }
}

function clearBit(set: Uint32Array, id: number): void {
  set[id >>> 5] &= ~(1 << (id & 31));
}

export function rungBit(r: Rung): number {
  return Number(r.slice(1));
}

/** Registry nums are append-only and < 256 (04 §4.3). */
if (ITEMS.length >= ITEM_SLOTS) throw new Error('factory: item registry exceeds 255 entries');
