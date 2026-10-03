// The factory: commands (02 §10.10), tick (§10.2), undo/redo (§2.7), Stockpile and views behind FactoryApi.
// Every command validates first and changes nothing on failure. PURE MODULE.
import type { PartId, PartsLedger } from '../economy/parts';
import { MINE_W } from '../shared/canon';
import { T } from '../shared/types';
import {
  BUILDINGS,
  DIR,
  YARD_EXPANSIONS,
  type BeltItemsView,
  type BuildingKind,
  type Cell,
  type DeconstructOptions,
  type Dir,
  type EntityView,
  type Err,
  type FactoryApi,
  type FactoryOptions,
  type FactoryPorts,
  type GhostSpec,
  type GhostView,
  type InspectView,
  type ItemStack,
  type KitSink,
  type KitSource,
  type LiftBucketsView,
  type MkSpec,
  type Plane,
  type PodBox,
  type RecipeView,
  type Res,
  type RouterMode,
  type Rung,
  type ViewRect,
} from './api';
import { addGhost, createEnt, destroyEnt, dropGhost, extendLift, ghostCount, setBelt, structureChanged } from './build';
import { Ent, ROUTER_MODES } from './ent';
import { MINE, W, YARD, headframeX0, isRimBuildingCell, opp, planeNum, step } from './geom';
import { MAX_GHOSTS, PART_RAIL, jobsOf, type Ghost, type JobShape } from './ghost';
import { hasItem, item, itemByNum } from './items';
import { slotCell } from './line';
import { checkJob, checkPlace, completionErr, fail, lockErr, yardCellsErr } from './placement';
import { RECIPES, recipeNum } from './recipes';
import { readState, serializeState, stateHash } from './serialize';
import { FactoryState, type Counters } from './state';
import { runTick } from './tick';
import { beltWord, isJunction, junctionWord, slotTier, upstream, wordDirA, wordTierA, wordTierB } from './topology';
import { BUILT_TILES, ROUTER_CELL, UNDO_DEPTH, findRefs, remapId, type Config, type JobRef, type UndoEntry } from './undo';
import { fillBeltItems, fillLiftBuckets } from './views';

const ok = <T extends object>(v: T): { ok: true } & T => ({ ok: true, ...v });
const OK = { ok: true } as const;

/** Debug and test hooks (not part of the frozen API). */
export interface FactoryDebug {
  conservationOk(): boolean;
  itemsHeld(): number;
  readonly counts: Readonly<Counters>;
  /** v1 power hook: set s_Q (Q16). MVP play never calls it. */
  setPowerQ16(sQ: number): void;
  /** Line id at a belt cell (layer A), or 0. */
  lineAt(plane: Plane, x: number, y: number): number;
  /** Items on a line, head first. */
  lineItems(id: number): number[];
}

export class Factory implements FactoryApi {
  private readonly s: FactoryState;
  private readonly undos: UndoEntry[] = [];
  private readonly redos: UndoEntry[] = [];
  private ledger: PartsLedger | null = null;
  private entList: Ent[] = [];
  private entListVersion = -1;

  private constructor(ports: FactoryPorts, opts: FactoryOptions) {
    this.s = new FactoryState(ports, opts);
  }

  /** New game (U0): the rusted survey set over Dot's shaft (02 §2.2). */
  static create(ports: FactoryPorts, opts: FactoryOptions): Factory {
    const f = new Factory(ports, opts);
    f.s.unlock('U0');
    f.placeSurveySet();
    structureChanged(f.s, false);
    return f;
  }

  /** Restore from `serialize()` bytes. Throws FactoryLoadError on malformed input. */
  static deserialize(bytes: Uint8Array, ports: FactoryPorts, opts: FactoryOptions): Factory {
    const f = new Factory(ports, opts);
    readState(f.s, bytes);
    return f;
  }

  /** Headframe on Yard rows 1–2 over the survey column, Smelter rows 4–5, Bin rows 7–8; $0, rusted (02 §2.2). */
  private placeSurveySet(): void {
    const x = headframeX0(this.s.surveyColumn);
    const set: [BuildingKind, number][] = [
      ['headframe', 1],
      ['smelter', 4],
      ['bin', 7],
    ];
    for (const [kind, y] of set) {
      if (yardCellsErr(this.s, kind, x, y)) continue; // generation guarantees a valid column (canon §3.2 pass 5)
      const e = createEnt(this.s, kind, 1, 'yard', x, y, DIR.S);
      if (e) e.rusted = true;
    }
  }

  get scope(): FactoryApi['scope'] {
    return this.s.scope;
  }
  get tickNo(): number {
    return this.s.tickNo;
  }
  get topologyVersion(): number {
    return this.s.topologyVersion;
  }
  get yardRows(): number {
    return this.s.yardRows;
  }
  get away(): boolean {
    return this.s.away;
  }
  get canUndo(): boolean {
    return this.undos.length > 0;
  }
  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  // ---------------------------------------------------------------- simulation

  tick(): void {
    if (this.s.away) return; // MVP: the factory sleeps while away (02 §8.1)
    runTick(this.s);
  }
  stateHash(): number {
    return stateHash(this.s);
  }
  serialize(): Uint8Array {
    return serializeState(this.s);
  }

  get debug(): FactoryDebug {
    const s = this.s;
    return {
      conservationOk: () => s.conservationOk(),
      itemsHeld: () => s.itemsHeld(),
      counts: s.count,
      setPowerQ16: (q) => {
        s.sQ = Math.max(0, Math.min(65_536, Math.floor(q)));
      },
      lineAt: (plane, x, y) => s.cellLineA[planeNum(plane)][y * W + x],
      lineItems: (id) => {
        const l = s.line(id);
        const out: number[] = [];
        if (l) for (let i = 0; i < l.n; i++) out.push(l.itemAt(i));
        return out;
      },
    };
  }

  // ---------------------------------------------------------------- undo bookkeeping

  private record(u: UndoEntry): void {
    this.undos.push(u);
    if (this.undos.length > UNDO_DEPTH) this.undos.shift();
    this.redos.length = 0;
  }

  undo(): Res {
    const u = this.undos.pop();
    if (!u) return fail('E_EMPTY');
    const r = this.apply(u, false);
    if (r.ok) this.redos.push(u);
    else this.undos.push(u);
    return r;
  }

  redo(): Res {
    const u = this.redos.pop();
    if (!u) return fail('E_EMPTY');
    const r = this.apply(u, true);
    if (r.ok) this.undos.push(u);
    else this.redos.push(u);
    return r;
  }

  /** Apply a record forward (redo) or backward (undo). */
  private apply(u: UndoEntry, forward: boolean): Res {
    switch (u.t) {
      case 'place':
      case 'unplace': {
        const create = (u.t === 'place') === forward;
        if (!create) {
          const e = this.live(u.id, u.serial);
          return e ? this.yardRemove(e, true) : fail('E_INVALID');
        }
        const r = this.yardPlace(u.kind, u.mk, u.x, u.y, u.dir);
        if (!r.ok) return r;
        const e = this.s.ent(r.id) as Ent;
        if (u.t === 'unplace') this.applyConfig(e, u.cfg, true);
        remapId(this.undos, u.serial, e.id, e.serial);
        remapId(this.redos, u.serial, e.id, e.serial);
        remapId([u], u.serial, e.id, e.serial);
        return OK;
      }
      case 'belts':
        return this.applyBelts(u.cells, forward ? u.after : u.before);
      case 'jobs':
        return u.adds === forward ? this.addJobs(u.refs) : this.removeJobs(u.refs);
      case 'config': {
        const e = this.live(u.id, u.serial);
        if (!e) return fail('E_INVALID');
        return this.applyConfig(e, forward ? u.after : u.before, false);
      }
    }
  }

  /** The entity `id` if it is still incarnation `serial`. */
  private live(id: number, serial: number): Ent | null {
    const e = this.s.ent(id);
    return e && e.serial === serial ? e : null;
  }

  // ---------------------------------------------------------------- Yard crane (02 §2.6)

  canPlace(kind: BuildingKind, mk: number, x: number, y: number, dir: Dir): Err | null {
    if (kind === 'belt') return this.paintPlan([{ x, y }], mk, dir).err;
    return checkPlace(this.s, kind, mk, x, y, dir);
  }

  place(kind: BuildingKind, mk: number, x: number, y: number, dir: Dir): Res<{ id: number }> {
    if (kind === 'belt') {
      const r = this.paintBelts([{ x, y }], mk, dir);
      return r.ok ? ok({ id: 0 }) : r;
    }
    const r = this.yardPlace(kind, mk, x, y, dir);
    if (r.ok) this.record({ t: 'place', kind, mk, x, y, dir, id: r.id, serial: (this.s.ent(r.id) as Ent).serial });
    return r;
  }

  private yardPlace(kind: BuildingKind, mk: number, x: number, y: number, dir: Dir): Res<{ id: number }> {
    const s = this.s;
    const err = checkPlace(s, kind, mk, x, y, dir);
    if (err) return err;
    const spec = BUILDINGS[kind].mks[mk - 1];
    const id = s.allocEnt();
    if (id === 0) return fail('E_LIMIT');
    if (spec.cash > 0 && !s.wallet.debit(spec.cash, 'build')) {
      s.entFree.push(id);
      return fail('E_FUNDS', { need: spec.cash - s.wallet.cash() });
    }
    for (const p of spec.parts) this.takeStock(item(p.item).num, p.n);
    const e = createEnt(s, kind, mk, 'yard', x, y, BUILDINGS[kind].rotates ? dir : DIR.S, BUILDINGS[kind].h, id) as Ent;
    e.paid = spec.cash;
    structureChanged(s, false);
    return ok({ id });
  }

  /** Surface deconstruct (02 §2.7): 100% cash back, parts and contents to the Stockpile; blocked without room. */
  private yardRemove(e: Ent, force: boolean): Res<{ refund: number }> {
    const s = this.s;
    const back = contentsOf(e);
    const parts = BUILDINGS[e.kind].mks[e.mk - 1].parts;
    let need = back.length;
    for (const p of parts) need += p.n;
    if (!force && need > this.freeExcept(e)) return fail('E_STOCKPILE_FULL', { need: need - this.freeExcept(e) });
    if (e.inv) for (let i = 0; i < e.inv.runs; i++) s.stockTotals[e.inv.items[i]] -= e.inv.counts[i];
    destroyEnt(s, e);
    if (e.paid > 0) s.wallet.credit(e.paid, 'refund');
    for (const it of back) s.displace(it);
    for (const p of parts) {
      const num = item(p.item).num;
      for (let k = 0; k < p.n; k++) s.displace(num);
      s.count.imported += p.n;
    }
    structureChanged(s, false);
    return ok({ refund: e.paid });
  }

  private freeExcept(e: Ent): number {
    return this.s.stockFree() - (e.inv ? e.inv.cap - e.inv.total : 0);
  }

  // ---------------------------------------------------------------- Yard belts (02 §2.1)

  paintBelts(path: readonly Cell[], mk: number, endDir?: Dir): Res<{ cost: number; tiles: number }> {
    const plan = this.paintPlan(path, mk, endDir);
    if (plan.err) return plan.err;
    if (plan.cells.length === 0) return ok({ cost: 0, tiles: 0 });
    const before = plan.cells.map((c) => this.cellState(c));
    const cash = this.s.wallet.cash();
    const r = this.applyBelts(plan.cells, plan.to);
    if (!r.ok) return r;
    this.record({ t: 'belts', cells: plan.cells, before, after: plan.to });
    return ok({ cost: cash - this.s.wallet.cash(), tiles: plan.cells.length });
  }

  /** Cell states a paint stroke would produce, or the reason it cannot (02 §2.1 auto Junctions and T-Routers). */
  private paintPlan(path: readonly Cell[], mk: number, endDir?: Dir): { err: Err | null; cells: number[]; to: number[] } {
    const s = this.s;
    const none = { cells: [], to: [] };
    const lock = lockErr(s, 'belt', mk);
    if (lock || path.length === 0) return { err: lock ?? fail('E_INVALID'), ...none };
    const dirs = pathDirs(path, endDir);
    if (!dirs) return { err: fail('E_INVALID'), ...none };
    const routerOk = lockErr(s, 'router', 1) === null;
    const cells: number[] = [];
    const to: number[] = [];
    const plannedStraight: boolean[] = [];
    for (let i = 0; i < path.length; i++) {
      const { x, y } = path[i];
      if (x < 0 || x >= W || y < 1 || y > s.yardRows || isRimBuildingCell(x, y)) return { err: fail('E_YARD', { x, y }), ...none };
      const c = y * W + x;
      const b = s.ents[s.build[YARD][c]];
      if (b) {
        if (b.kind === 'router') continue; // a stroke may pass through a Router
        return { err: fail('E_OCCUPIED', { x, y }), ...none };
      }
      const straight = i > 0 && i < path.length - 1 && dirs[i - 1] === dirs[i];
      const k = cells.indexOf(c);
      // A stroke crossing itself re-paints its own planned tile (straight crossings become Junctions).
      const old = k >= 0 ? to[k] : this.cellState(c);
      const oldStraight = k >= 0 ? plannedStraight[k] : old > 0 && this.isStraightTile(c);
      const next = paintCell(old, dirs[i], mk, straight, oldStraight, routerOk);
      if (k >= 0) to[k] = next;
      else if (next !== old) {
        cells.push(c);
        to.push(next);
        plannedStraight.push(straight);
      }
    }
    // The stroke's last tile pointing into the side of a belt makes a T: that tile becomes a Router (merger).
    const last = path[path.length - 1];
    const lastDir = dirs[path.length - 1];
    const n = step(YARD, last.y * W + last.x, lastDir);
    if (routerOk && n >= 0 && !cells.includes(n) && s.build[YARD][n] === 0) {
      const w = s.belt[YARD][n];
      if (w !== 0 && !isJunction(w) && (wordDirA(w) & 1) !== (lastDir & 1)) {
        cells.push(n);
        to.push(ROUTER_CELL);
      }
    }
    return { err: this.diffErr(this.diffCost(cells, to)), cells, to };
  }

  /** Can the wallet and Stockpile pay (or take back) a belt diff? */
  private diffErr(price: Price): Err | null {
    const s = this.s;
    if (price.cash > s.wallet.cash()) return fail('E_FUNDS', { need: price.cash - s.wallet.cash() });
    let back = 0;
    for (const p of price.parts) {
      const have = s.stockTotals[item(p.item).num];
      if (p.n > have) return fail('E_PARTS', { need: p.n - have, item: p.item });
      if (p.n < 0) back -= p.n;
    }
    if (back > s.stockFree()) return fail('E_STOCKPILE_FULL', { need: back - s.stockFree() });
    return null;
  }

  private isStraightTile(c: number): boolean {
    const belts = this.s.belt[YARD];
    const a = wordDirA(belts[c]);
    const up = upstream(belts, YARD, c, a);
    return up < 0 || slotCell(up) === step(YARD, c, opp(a));
  }

  /** Yard cell state for belt diffs: a belt word, ROUTER_CELL, or 0. */
  private cellState(c: number): number {
    const e = this.s.ents[this.s.build[YARD][c]];
    if (e) return e.kind === 'router' ? ROUTER_CELL : -2;
    return this.s.belt[YARD][c];
  }

  /** Net cash and parts a Yard belt diff costs (negative = refund). */
  private diffCost(cells: readonly number[], to: readonly number[]): Price {
    const price: Price = { cash: 0, parts: [] };
    for (let i = 0; i < cells.length; i++) {
      addPrice(price, to[i], 1);
      addPrice(price, this.cellState(cells[i]), -1);
    }
    return price;
  }

  /** Move Yard cells to new belt / Router states, paying or refunding the difference (02 §2.7). */
  private applyBelts(cells: readonly number[], to: readonly number[]): Res {
    const s = this.s;
    for (const c of cells) if (this.cellState(c) === -2) return fail('E_OCCUPIED', { x: c % W, y: Math.floor(c / W) });
    const price = this.diffCost(cells, to);
    const err = this.diffErr(price);
    if (err) return err;
    if (price.cash > 0 && !s.wallet.debit(price.cash, 'build')) return fail('E_FUNDS', { need: price.cash - s.wallet.cash() });
    if (price.cash < 0) s.wallet.credit(-price.cash, 'refund');
    for (const p of price.parts) {
      const num = item(p.item).num;
      if (p.n > 0) this.takeStock(num, p.n);
      for (let k = 0; k < -p.n; k++) s.displace(num);
      if (p.n < 0) s.count.imported -= p.n;
    }
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const router = s.ents[s.build[YARD][c]];
      if (router && to[i] !== ROUTER_CELL) {
        const held = contentsOf(router);
        destroyEnt(s, router);
        for (const it of held) s.displace(it);
      }
      if (to[i] === ROUTER_CELL) {
        setBelt(s, YARD, c, 0);
        if (!router) {
          const e = createEnt(s, 'router', 1, 'yard', c % W, Math.floor(c / W), DIR.E);
          if (e) e.paid = BUILDINGS.router.mks[0].cash;
        }
      } else setBelt(s, YARD, c, to[i]);
    }
    structureChanged(s, true);
    return OK;
  }

  removeBelts(plane: Plane, cells: readonly Cell[], opts?: DeconstructOptions): Res<{ refund: number }> {
    return plane === 'yard' ? this.removeYardBelts(cells) : this.removeMineBelts(cells, opts?.toCargo);
  }

  private removeYardBelts(cells: readonly Cell[]): Res<{ refund: number }> {
    const s = this.s;
    const list: number[] = [];
    for (const { x, y } of cells) {
      if (x < 0 || x >= W || y < 0 || y > s.yardRows) return fail('E_INVALID');
      const c = y * W + x;
      if (s.belt[YARD][c] !== 0 && !list.includes(c)) list.push(c);
    }
    if (list.length === 0) return ok({ refund: 0 });
    const before = list.map((c) => this.cellState(c));
    const to = list.map(() => 0);
    const refund = -this.diffCost(list, to).cash;
    const r = this.applyBelts(list, to);
    if (!r.ok) return r;
    this.record({ t: 'belts', cells: list, before, after: to });
    return ok({ refund });
  }

  /** Underground belt removal: Belt Kit units back (metered, 02 §2.7); undo re-places them as ghost runs. */
  private removeMineBelts(cells: readonly Cell[], sink?: KitSink): Res<{ refund: number }> {
    const s = this.s;
    const list: number[] = [];
    for (const { x, y } of cells) {
      if (x < 0 || x >= W || y < 1 || y >= s.belt[MINE].length / W) return fail('E_INVALID');
      const c = y * W + x;
      if (s.belt[MINE][c] !== 0 && !list.includes(c)) list.push(c);
    }
    if (list.length === 0) return ok({ refund: 0 });
    list.sort((a, b) => a - b);
    const kits: ItemStack[] = [];
    for (const c of list) addStack(kits, beltKitOf(wordTierA(s.belt[MINE][c])), 1);
    const plan = this.planKits(kits, [], sink);
    if (!plan.ok) return plan;
    const shapes = beltRuns(s, list);
    for (const c of list) setBelt(s, MINE, c, 0);
    this.commitKits(plan.toCargo, plan.toStock, sink);
    structureChanged(s, true);
    this.record({ t: 'jobs', adds: false, refs: shapes.map((shape) => ({ shape, ghost: 0, ent: 0, serial: 0 })) });
    return ok({ refund: 0 });
  }

  // ---------------------------------------------------------------- ghosts (02 §2.6)

  canPlaceGhost(spec: GhostSpec): Err | null {
    const jobs = specJobs(spec);
    if (!jobs) return fail('E_INVALID');
    if (ghostCount(this.s) + jobs.length > MAX_GHOSTS) return fail('E_LIMIT');
    for (const j of jobs) {
      const e = checkJob(this.s, j);
      if (e) return e;
    }
    return null;
  }

  placeGhost(spec: GhostSpec): Res<{ ids: number[] }> {
    const err = this.canPlaceGhost(spec);
    if (err) return err;
    const refs = (specJobs(spec) as JobShape[]).map((shape) => ({ shape, ghost: 0, ent: 0, serial: 0 }));
    const r = this.addJobs(refs);
    if (!r.ok) return r;
    this.record({ t: 'jobs', adds: true, refs });
    return ok({ ids: refs.map((x) => x.ghost) });
  }

  removeGhost(id: number): Res {
    const g = this.s.ghosts[id];
    if (!g) return fail('E_INVALID');
    const refs = this.sharedRefs((r) => r.ghost === id, [g.shape()]);
    dropGhost(this.s, g);
    for (const r of refs) r.ghost = 0;
    this.s.topologyVersion++;
    this.record({ t: 'jobs', adds: false, refs });
    return OK;
  }

  completeGhost(id: number, pod: PodBox, cargo: KitSource): Res<{ id: number }> {
    const s = this.s;
    const g = s.ghosts[id];
    if (!g) return fail('E_INVALID');
    const job = g.shape();
    const err = checkJob(s, job, g.id) ?? completionErr(s, job, pod) ?? kitErr(cargo, g.kit, g.kitUnits);
    if (err) return err;
    cargo.take(g.kit, g.kitUnits);
    dropGhost(s, g);
    const built = this.buildJob(job);
    structureChanged(s, job.kind === 'belt');
    const serial = built > 0 ? (s.ent(built) as Ent).serial : 0;
    for (const r of findRefs([this.undos, this.redos], (x) => x.ghost === id)) {
      r.ghost = 0;
      r.ent = built;
      r.serial = serial;
    }
    s.emit({ t: 'ghost-complete', kind: job.kind });
    return ok({ id: built === BUILT_TILES ? 0 : built });
  }

  /** Write a validated job into the world. Returns the entity id, or BUILT_TILES for a belt run. */
  private buildJob(j: JobShape): number {
    const s = this.s;
    if (j.kind === 'belt') {
      for (let x = j.x; x < j.x + j.w; x++) setBelt(s, MINE, j.y * W + x, beltWord(j.mk, j.dir));
      return BUILT_TILES;
    }
    if (j.kind === 'lift' && j.part === PART_RAIL) {
      const lift = s.entAt(MINE, (j.y + j.h) * W + j.x) as Ent;
      extendLift(s, lift, j.y);
      return lift.id;
    }
    const e = createEnt(s, j.kind, j.mk, 'mine', j.x, j.y, j.dir, j.h) as Ent;
    if (j.kind === 'autoDrill') {
      const lode = s.grid.lodes.find((l) => l.top === j.y + 2 && (j.x === l.x0 || j.x === l.x0 + 1));
      if (lode) {
        e.lodeId = lode.id;
        s.lodeDrill[lode.id] = e.id;
      }
    }
    return e.id;
  }

  /** Re-add ghosts for refs (undo of a removal / redo of a placement). All-or-nothing. */
  private addJobs(refs: JobRef[]): Res {
    const s = this.s;
    if (ghostCount(s) + refs.length > MAX_GHOSTS) return fail('E_LIMIT');
    for (const r of refs) {
      const e = checkJob(s, r.shape);
      if (e) return e;
    }
    for (const r of refs) {
      const g = addGhost(s, r.shape) as Ghost;
      r.ghost = g.id;
      r.ent = 0;
    }
    s.topologyVersion++;
    return OK;
  }

  /** Drop pending ghosts and deconstruct built pieces of refs (Kits to the Stockpile). All-or-nothing. */
  private removeJobs(refs: JobRef[]): Res {
    const s = this.s;
    const ents: Ent[] = [];
    const tiles: number[] = [];
    for (const r of refs) {
      if (r.ent > 0) {
        const e = this.live(r.ent, r.serial);
        if (e && !ents.includes(e)) ents.push(e);
      } else if (r.ent === BUILT_TILES) {
        const sh = r.shape;
        for (let x = sh.x; x < sh.x + sh.w; x++) {
          const c = sh.y * W + x;
          if (slotTier(s.belt[MINE][c], sh.dir) !== 0) tiles.push(c);
        }
      }
    }
    const kits: ItemStack[] = [];
    const held: number[] = [];
    for (const e of ents) mineKits(e, kits, held);
    for (const c of tiles) addStack(kits, beltKitOf(wordTierA(s.belt[MINE][c])), 1);
    const plan = this.planKits(kits, held, undefined);
    if (!plan.ok) return plan;
    for (const r of refs) {
      const g = r.ghost ? s.ghosts[r.ghost] : null;
      if (g) dropGhost(s, g);
      r.ghost = 0;
      r.ent = 0;
    }
    for (const e of ents) this.removeMineEnt(e);
    for (const c of tiles) setBelt(s, MINE, c, 0);
    this.commitKits(plan.toCargo, plan.toStock, undefined);
    for (const it of held) s.stockAdd(it, 1);
    structureChanged(s, tiles.length > 0);
    return OK;
  }

  /** Records that already track these jobs (shared), else fresh ones from shapes. */
  private sharedRefs(match: (r: JobRef) => boolean, shapes: JobShape[]): JobRef[] {
    const found = findRefs([this.undos, this.redos], match);
    return found.length > 0 ? found : shapes.map((shape) => ({ shape, ghost: 0, ent: 0, serial: 0 }));
  }

  // ---------------------------------------------------------------- deconstruct (02 §2.7)

  deconstruct(id: number, opts?: DeconstructOptions): Res<{ refund: number }> {
    const e = this.s.ent(id);
    if (!e) return fail('E_INVALID');
    if (e.plane === 'yard') {
      const cfg = readConfig(e);
      const r = this.yardRemove(e, false);
      if (r.ok) this.record({ t: 'unplace', kind: e.kind, mk: e.mk, x: e.x, y: e.y, dir: e.dir, id, serial: e.serial, cfg });
      return r;
    }
    const kits: ItemStack[] = [];
    const held: number[] = [];
    mineKits(e, kits, held);
    const plan = this.planKits(kits, held, opts?.toCargo);
    if (!plan.ok) return plan;
    const refs = this.sharedRefs((r) => r.ent === id && r.serial === e.serial, entShapes(e));
    this.removeMineEnt(e);
    this.commitKits(plan.toCargo, plan.toStock, opts?.toCargo);
    for (const it of held) this.s.stockAdd(it, 1);
    for (const r of refs) r.ent = 0;
    structureChanged(this.s, false);
    this.record({ t: 'jobs', adds: false, refs });
    return ok({ refund: 0 });
  }

  /** Remove an underground entity; lift items in flight go to the Stockpile, else are destroyed (02 §10.1). */
  private removeMineEnt(e: Ent): void {
    const s = this.s;
    const q = e.queue;
    const flying: number[] = [];
    if (q) for (let i = 0; i < q.n; i++) flying.push(q.itemAt(i));
    if (e.lip) flying.push(e.lip);
    destroyEnt(s, e);
    for (const it of flying) s.displace(it);
  }

  /** Decide where refunded Kits go: cargo when the sink takes them, else the Stockpile (room checked). */
  private planKits(kits: ItemStack[], held: number[], sink: KitSink | undefined): Res<{ toCargo: ItemStack[]; toStock: ItemStack[] }> {
    const s = this.s;
    const toCargo: ItemStack[] = [];
    const toStock: ItemStack[] = [];
    for (const k of kits) (sink && sink.canPut(k.item, k.n) ? toCargo : toStock).push(k);
    let need = held.length;
    for (const k of toStock) need += s.kitsFromUnits(k.item, k.n);
    const free = s.stockFree();
    if (need > free) return fail('E_STOCKPILE_FULL', { need: need - free });
    return ok({ toCargo, toStock });
  }

  private commitKits(toCargo: ItemStack[], toStock: ItemStack[], sink: KitSink | undefined): void {
    for (const k of toCargo) sink?.put(k.item, k.n);
    for (const k of toStock) this.s.stockKitUnits(k.item, k.n);
  }

  // ---------------------------------------------------------------- configuration

  setRecipe(id: number, recipe: string | null): Res {
    const e = this.s.ent(id);
    if (!e || e.kind !== 'assembler') return fail('E_INVALID');
    const num = recipe === null ? -1 : recipeNum(recipe);
    if (recipe !== null && (num < 0 || RECIPES[num].machine !== 'assembler')) return fail('E_INVALID');
    if (num >= 0 && !this.s.recipeOpen[num]) {
      const u = RECIPES[num].unlock;
      return fail('E_LOCKED', u === 'auto' || u === 'possession' ? {} : { rung: u });
    }
    if (num === e.recipeNum) return OK;
    const before = readConfig(e);
    const r = this.applyConfig(e, { ...before, recipe: num }, false);
    if (r.ok) this.record({ t: 'config', id, serial: e.serial, before, after: readConfig(e) });
    return r;
  }

  setRouterMode(id: number, mode: RouterMode, opts?: { primary?: Dir; filter?: string }): Res {
    const e = this.s.ent(id);
    const m = ROUTER_MODES.indexOf(mode);
    if (!e || e.kind !== 'router' || m < 0) return fail('E_INVALID');
    if (opts?.filter !== undefined && !hasItem(opts.filter)) return fail('E_INVALID');
    const before = readConfig(e);
    const after: Config = {
      ...before,
      mode: m,
      primary: opts?.primary ?? before.primary,
      filter: opts?.filter !== undefined ? item(opts.filter).num : before.filter,
    };
    this.applyConfig(e, after, false);
    this.record({ t: 'config', id, serial: e.serial, before, after });
    return OK;
  }

  setUnloadFilter(id: number, itemId: string | null): Res {
    const e = this.s.ent(id);
    if (!e || e.kind !== 'bin' || (itemId !== null && !hasItem(itemId))) return fail('E_INVALID');
    const before = readConfig(e);
    const after: Config = { ...before, unload: itemId === null ? 0 : item(itemId).num };
    this.applyConfig(e, after, false);
    this.record({ t: 'config', id, serial: e.serial, before, after });
    return OK;
  }

  /** Apply a configuration; a recipe change sends the Assembler's inputs to the Stockpile (`force`: else destroyed). */
  private applyConfig(e: Ent, c: Config, force: boolean): Res {
    const s = this.s;
    if (e.kind === 'assembler' && c.recipe !== e.recipeNum) {
      let n = 0;
      for (let i = 0; i < e.inCount.length; i++) n += e.inCount[i];
      if (!force && n > s.stockFree()) return fail('E_STOCKPILE_FULL', { need: n - s.stockFree() });
      if (e.recipeNum >= 0) {
        const r = RECIPES[e.recipeNum];
        for (let i = 0; i < r.inputs.length; i++) for (let k = 0; k < e.inCount[i]; k++) s.displace(r.inputs[i].num);
      }
      e.inCount.fill(0);
      e.recipeNum = c.recipe;
    }
    e.mode = c.mode;
    e.primary = c.primary;
    e.filter = c.filter;
    e.unload = c.unload;
    s.wakeAll();
    return OK;
  }

  expandYard(): Res<{ rows: number }> {
    const s = this.s;
    const next = YARD_EXPANSIONS.find((x) => x.rows > s.yardRows);
    if (!next) return fail('E_LIMIT');
    if ((next.scope === 'v1' && !s.v1) || !s.hasRung(next.rung)) return fail('E_LOCKED', { rung: next.rung });
    if (!s.wallet.debit(next.cash, 'yard')) return fail('E_FUNDS', { need: next.cash - s.wallet.cash() });
    s.yardRows = next.rows;
    s.topologyVersion++;
    return ok({ rows: next.rows });
  }

  // ---------------------------------------------------------------- world hooks

  discoverLode(id: number, purityKnown: boolean): void {
    const lode = this.s.grid.lodes[id];
    if (!lode || (lode.scope === 'v1' && !this.s.v1)) return;
    lode.discovered = true;
    if (purityKnown) this.s.purityKnown[id] = 1;
    this.s.unlock('U2');
    if (lode.metal === 'kerogen') this.s.unlock('U7');
  }

  /** After digs, blasts or Realign: drop ghosts that now sit on solid cells (02 §10.10). */
  tileChanged(cells: readonly Cell[]): void {
    const s = this.s;
    for (const { x, y } of cells) {
      if (x < 0 || x >= MINE_W || y < 0 || y * W + x >= s.ghostAt[MINE].length) continue;
      const g = s.ghosts[s.ghostAt[MINE][y * W + x]];
      if (!g || s.grid.terrain[y * W + x] === T.AIR) continue;
      for (const r of findRefs([this.undos, this.redos], (k) => k.ghost === g.id)) r.ghost = 0;
      dropGhost(s, g);
      s.topologyVersion++;
    }
  }

  unlockRung(rung: Rung): void {
    this.s.unlock(rung);
  }
  isUnlocked(rung: Rung): boolean {
    return this.s.hasRung(rung);
  }
  setAway(on: boolean): void {
    if (this.s.away === on) return;
    this.s.away = on;
    this.s.wakeAll();
  }

  // ---------------------------------------------------------------- Stockpile

  stockpileCount(id: string): number {
    return hasItem(id) ? this.s.stockTotals[item(id).num] : 0;
  }
  stockpileItems(): ItemStack[] {
    const out: ItemStack[] = [];
    const t = this.s.stockTotals;
    for (let i = 1; i < t.length; i++) if (t[i] > 0) out.push(stack(i, t[i]));
    return out;
  }
  stockpileFree(): number {
    return this.s.stockFree();
  }

  stockpileTake(bill: readonly ItemStack[]): Res {
    for (const b of bill) {
      if (!hasItem(b.item) || b.n < 0 || !Number.isInteger(b.n)) return fail('E_INVALID');
      const have = this.stockpileCount(b.item);
      if (have < b.n) return fail('E_PARTS', { need: b.n - have, item: b.item });
    }
    for (const b of bill) this.takeStock(item(b.item).num, b.n);
    return OK;
  }

  stockpilePut(items: readonly ItemStack[]): Res {
    let n = 0;
    for (const it of items) {
      if (!hasItem(it.item) || it.n < 0 || !Number.isInteger(it.n)) return fail('E_INVALID');
      n += it.n;
    }
    const free = this.s.stockFree();
    if (n > free) return fail('E_STOCKPILE_FULL', { need: n - free });
    for (const it of items) {
      const num = item(it.item).num;
      if (!this.s.stockFits(num, it.n)) return fail('E_STOCKPILE_FULL', { need: it.n });
    }
    for (const it of items) {
      const num = item(it.item).num;
      const put = this.s.stockAdd(num, it.n);
      this.s.count.imported += put;
    }
    return OK;
  }

  private takeStock(num: number, n: number): void {
    if (n <= 0) return;
    this.s.stockRemove(num, n);
    this.s.count.taken += n;
  }

  partsLedger(): PartsLedger {
    this.ledger ??= {
      count: (part: PartId) => this.stockpileCount(part),
      take: (part: PartId, n: number) => {
        const r = this.stockpileTake([{ item: part, n }]);
        if (!r.ok) throw new Error(`Stockpile short of ${part}`);
      },
    };
    return this.ledger;
  }

  // ---------------------------------------------------------------- views

  entity(id: number): EntityView | null {
    return this.s.ent(id);
  }
  entities(): readonly EntityView[] {
    if (this.entListVersion !== this.s.topologyVersion) {
      this.entList = this.s.ents.filter((e): e is Ent => e !== null);
      this.entListVersion = this.s.topologyVersion;
    }
    return this.entList;
  }
  ghosts(): readonly GhostView[] {
    return this.s.ghosts.filter((g): g is Ghost => g !== null).sort((a, b) => a.order - b.order);
  }
  inspect(id: number): InspectView | null {
    const e = this.s.ent(id);
    if (!e) return null;
    const contents: ItemStack[] = [];
    if (e.inv) for (let i = 0; i < e.inv.runs; i++) contents.push(stack(e.inv.items[i], e.inv.counts[i]));
    if (e.kind === 'smelter' && e.inCount[0] > 0) contents.push(stack(e.inItem[0], e.inCount[0]));
    if (e.kind === 'assembler' && e.recipeNum >= 0) {
      const ins = RECIPES[e.recipeNum].inputs;
      for (let i = 0; i < ins.length; i++) if (e.inCount[i] > 0) contents.push(stack(ins[i].num, e.inCount[i]));
    }
    if (e.lip) contents.push(stack(e.lip, 1));
    const output: ItemStack[] = [];
    if (e.out) for (let i = 0; i < e.out.n; i++) addStack(output, stack(e.out.at(i), 1).item, 1);
    return {
      id,
      kind: e.kind,
      status: e.status,
      recipe: e.recipe,
      contents,
      output,
      inFlight: e.queue ? e.queue.n : 0,
      routerMode: e.kind === 'router' ? ROUTER_MODES[e.mode] : null,
      filter: e.kind === 'router' && e.filter ? (itemByNum(e.filter)?.id ?? null) : e.kind === 'bin' && e.unload ? (itemByNum(e.unload)?.id ?? null) : null,
    };
  }
  recipes(machine: RecipeView['machine']): RecipeView[] {
    return RECIPES.filter((r) => r.machine === machine && (r.scope === 'mvp' || this.s.v1)).map((r) => ({
      id: r.id,
      machine: r.machine,
      inputs: r.inputs.map((x) => ({ item: x.item, n: x.n })),
      outputs: r.outputs.map((x) => ({ item: x.item, n: x.n })),
      ticks: r.ticks,
      unlocked: this.s.recipeOpen[r.num] === 1,
    }));
  }
  beltWords(plane: Plane): Readonly<Uint16Array> {
    return this.s.belt[planeNum(plane)];
  }
  yardBuildings(): Readonly<Uint16Array> {
    return this.s.build[YARD];
  }
  fillBeltItems(out: BeltItemsView, rect?: ViewRect): void {
    fillBeltItems(this.s, out, rect);
  }
  fillLiftBuckets(out: LiftBucketsView, rect?: ViewRect): void {
    fillLiftBuckets(this.s, out, rect);
  }
  beltFlowAt(plane: Plane, x: number, y: number): number {
    const p = planeNum(plane);
    if (x < 0 || x >= W || y < 0 || y * W + x >= this.s.belt[p].length) return 0;
    const l = this.s.line(this.s.cellLineA[p][y * W + x]);
    return l ? l.flowPerMinute(this.s.tickNo) : 0;
  }
  surveyPlan(): { drill: Cell; lift: { x: number; foot: number; top: number } } {
    const s = this.s;
    const lode = s.grid.lodes[s.scriptedLodeId];
    const c = s.surveyColumn;
    const x0 = lode ? lode.x0 : c + 1;
    const top = lode ? lode.top : 46;
    return { drill: { x: c < x0 ? x0 : x0 + 1, y: top - 2 }, lift: { x: c, foot: top - 1, top: 0 } };
  }
}

// ---------------------------------------------------------------- helpers

/** New state of a Yard cell under a stroke tile travelling d (02 §2.1). */
function paintCell(old: number, d: number, mk: number, straight: boolean, oldStraight: boolean, routerOk: boolean): number {
  if (old === ROUTER_CELL) return old;
  if (old <= 0) return beltWord(mk, d);
  if (slotTier(old, d) === mk) return old;
  if (isJunction(old)) return routerOk ? ROUTER_CELL : beltWord(mk, d);
  const a = wordDirA(old);
  if ((a & 1) === (d & 1)) return beltWord(mk, d); // same axis: upgrade or reverse in place
  if (straight && oldStraight) return junctionWord(wordTierA(old), a, mk, d);
  return routerOk ? ROUTER_CELL : beltWord(mk, d);
}

function pathDirs(path: readonly Cell[], endDir?: Dir): number[] | null {
  const dirs: number[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const dx = path[i + 1].x - path[i].x;
    const dy = path[i + 1].y - path[i].y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
    dirs.push(dx === 1 ? 0 : dy === 1 ? 1 : dx === -1 ? 2 : 3);
  }
  dirs.push(endDir ?? (dirs.length > 0 ? dirs[dirs.length - 1] : 0));
  return dirs;
}

interface Price {
  cash: number;
  /** Net parts; negative = handed back. */
  parts: ItemStack[];
}

/** Add (sign 1) or remove (−1) the Yard price of a cell state (02 §3.1 per-tile prices; a Router $40). */
function addPrice(p: Price, state: number, sign: 1 | -1): void {
  if (state === ROUTER_CELL) return addSpec(p, BUILDINGS.router.mks[0], sign);
  if (state <= 0) return;
  const tiers = BUILDINGS.belt.mks;
  addSpec(p, tiers[wordTierA(state) - 1], sign);
  if (isJunction(state)) addSpec(p, tiers[wordTierB(state) - 1], sign);
}

function addSpec(p: Price, spec: MkSpec, sign: 1 | -1): void {
  p.cash += sign * spec.cash;
  for (const part of spec.parts) addStack(p.parts, part.item, sign * part.n);
}

function contentsOf(e: Ent): number[] {
  const out: number[] = [];
  if (e.inv) for (let i = 0; i < e.inv.runs; i++) for (let k = 0; k < e.inv.counts[i]; k++) out.push(e.inv.items[i]);
  if (e.out) for (let i = 0; i < e.out.n; i++) out.push(e.out.at(i));
  if (e.kind === 'smelter' && e.inCount[0] > 0) for (let k = 0; k < e.inCount[0]; k++) out.push(e.inItem[0]);
  if (e.kind === 'assembler' && e.recipeNum >= 0) {
    const r = RECIPES[e.recipeNum];
    for (let i = 0; i < r.inputs.length; i++) for (let k = 0; k < e.inCount[i]; k++) out.push(r.inputs[i].num);
  }
  return out;
}

/** Kits an underground piece refunds and the buffered items that must reach the Stockpile. */
function mineKits(e: Ent, kits: ItemStack[], held: number[]): void {
  const spec = BUILDINGS[e.kind].mks[e.mk - 1];
  if (spec.kit) addStack(kits, spec.kit, 1);
  if (e.kind === 'lift' && e.rails > 0) addStack(kits, 'liftRail', e.rails);
  if (e.out) for (let i = 0; i < e.out.n; i++) held.push(e.out.at(i));
}

/** Jobs that rebuild an underground entity (undo of its deconstruct). */
function entShapes(e: Ent): JobShape[] {
  const spec: GhostSpec =
    e.kind === 'lift' ? { kind: 'lift', mk: e.mk as 1, x: e.x, foot: e.foot, top: e.y } : e.kind === 'autoDrill' ? { kind: 'autoDrill', mk: e.mk as 1, x: e.x, y: e.y } : { kind: 'router', x: e.x, y: e.y };
  return jobsOf(spec);
}

/** Contiguous same-direction runs (≤ 8) of removed underground tiles, as belt jobs. */
function beltRuns(s: FactoryState, cells: number[]): JobShape[] {
  const out: JobShape[] = [];
  for (const c of cells) {
    const w = s.belt[MINE][c];
    const x = c % W;
    const y = Math.floor(c / W);
    const prev = out[out.length - 1];
    if (prev && prev.y === y && prev.x + prev.w === x && prev.dir === wordDirA(w) && prev.mk === wordTierA(w) && prev.w < 8) {
      prev.w++;
      prev.units++;
      continue;
    }
    const kit = beltKitOf(wordTierA(w));
    out.push({ kind: 'belt', mk: wordTierA(w), x, y, w: 1, h: 1, dir: wordDirA(w) as Dir, part: 0, kit, units: 1 });
  }
  return out;
}

function beltKitOf(tier: number): string {
  return BUILDINGS.belt.mks[tier - 1].kit as string;
}

function specJobs(spec: GhostSpec): JobShape[] | null {
  const ints = [spec.x, spec.kind === 'lift' ? spec.foot : spec.y, spec.kind === 'lift' ? spec.top : 0, spec.kind === 'belt' ? spec.length : 1];
  if (!ints.every((v) => Number.isInteger(v))) return null;
  if (spec.kind === 'belt' && (spec.length < 1 || spec.length > MINE_W)) return null;
  if (spec.kind === 'lift' && spec.foot <= spec.top) return null;
  if (!BUILDINGS[spec.kind] || (spec.kind !== 'router' && spec.mk !== undefined && ![1, 2, 3].includes(spec.mk))) return null;
  return jobsOf(spec);
}

function kitErr(cargo: KitSource, kit: string, units: number): Err | null {
  const have = cargo.count(kit);
  return have >= units ? null : fail('E_KIT', { need: units - have, item: kit });
}

function readConfig(e: Ent): Config {
  return { recipe: e.recipeNum, mode: e.mode, primary: e.primary, filter: e.filter, unload: e.unload };
}

function addStack(list: ItemStack[], id: string, n: number): void {
  const at = list.find((x) => x.item === id);
  if (at) at.n += n;
  else list.push({ item: id, n });
}

function stack(num: number, n: number): ItemStack {
  return { item: itemByNum(num)?.id ?? '?', n };
}
