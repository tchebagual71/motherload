// The one authoritative simulation (canon §4.10; 04 §3.1): terrain, pod, wallet, story and (MVP) the
// factory, stepped at a fixed 60 Hz. UI, render and app reach it only through WorldApi. PURE MODULE.
import { FACTORY_EVERY, FACTORY_PHASE, MINE_H, MINE_W, POD_H, RIM_BUILDINGS, START_CASH, START_X, SURVEY_PING_ROW, TILE_FT, type Line } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import { Rng, STREAM } from '../shared/rng';
import { T, type CargoItem, type ConsumableId, type Lode, type RimBuildingId, type Scope } from '../shared/types';
import { generateWorld, type GenMeta } from '../terrain/generate';
import type { TerrainGrid } from '../terrain/grid';
import { applyScopeOverlay, scopeFloorRow } from '../terrain/scope';
import { PUMP_PAD_X, createPod, destructionCause, inScannerRange, podStats, returnTickLiters, stepPod, type PodStepCtx } from '../pod';
import type { PodIntent, PodState } from '../pod/types';
import * as econ from '../economy';
import type { EconomyCtx, PartsLedger } from '../economy';
import { SaveError, deserialize as decodeSave, serialize as encodeSave, type SaveState } from '../save/codec';
import type { CargoGroup, KitShopItem, PodStats, Quote, Result, ShopItem, StoryState, UpgradeCard, Wallet, WorldApi } from './api';
import { DiscardLog, takeCargo } from './discard';
import { loadScope } from './loadScope';
import { PUMP_PAD, PadArming, isNeutral, isOnRim, padIndexAt, padIndexOf } from './pads';
import { newStory, resetTrip, updateDepth, updateTrip } from './rules';
import { RECORDER_RELIC, StoryDirector, obFlag, rungFlag, type StoryContext, type StorySnapshot } from '../story';
import { scopeAtLeast } from '../shared/scope';
import { Factory, FactoryLoadError, RUNGS, YARD_EXPANSIONS, type Cell, type ErrCode, type FactoryPorts, type Res } from '../factory';
import { LODE_TABLE } from '../terrain/lodes';
import { CargoKitSink, CargoKitSource } from './kits';
import { GHOST_REACH, GhostBuilder, jobDistance } from './ghostJob';
import { errText } from './factoryText';
import * as kits from './kitShop';

export interface WorldOptions {
  seed: number;
  scope: Scope;
  /** Deep Heat A/B flag (canon §4.4), off by default. */
  deepHeat?: boolean;
}

const NO_EVENTS: GameEvent[] = Object.freeze([]) as unknown as GameEvent[];
/** Pod centre height when standing on a surface (the Rim at y = 0, or a cell's floor). */
const STAND_Y = POD_H / 2;
/** Scanner tier from which discovery shows a lode's purity (Dowser, canon §2.6; 02 §3.6). */
const DOWSER_TIER = 3;

/** A brand-new claim: full v1 generation plus the scope's debug overlay (canon §3.2, §5.1). */
function newGame(opts: WorldOptions): SaveState {
  const seed = opts.seed >>> 0;
  const { grid, meta } = generateWorld(seed);
  applyScopeOverlay(grid, opts.scope);
  return {
    seed,
    scope: opts.scope,
    deepHeat: opts.deepHeat ?? false,
    stepNo: 0,
    meta,
    grid,
    pod: createPod(),
    wallet: { cash: START_CASH, debt: 0, lifetimeEarned: 0 },
    story: newStory(),
    rng: new Rng(seed, STREAM.HOP_BEACON).s,
    pads: new PadArming().snapshot(),
  };
}

/** Stop the pod dead at (x, y): no velocity, dig, engage, cooldown or pending hit; no interpolation streak. */
function placePod(pod: PodState, x: number, y: number, grounded: boolean): void {
  pod.x = pod.prevX = x;
  pod.y = pod.prevY = y;
  pod.vx = 0;
  pod.vy = 0;
  pod.grounded = grounded;
  pod.dig = null;
  pod.engageSteps = 0;
  pod.engageDir = null;
  pod.sector = 'none';
  pod.cooldown = 0;
  pod.magmaPending = 0;
  pod.thrust = 0;
  pod.digging = false;
  pod.airSteps = 0;
  const row = Math.floor(-y);
  pod.row = row < 0 ? 0 : row;
}

/** Cells a debug teleport may carve: never lode rock, the Seal, Heartstone, paved pads or occupants. */
function isCarvable(grid: TerrainGrid, x: number, r: number): boolean {
  const c = grid.get(x, r);
  return c !== T.LODE_ROCK && c !== T.SEAL && c !== T.HEARTSTONE && c !== T.PAVED && grid.occupant[grid.idx(x, r)] === 0;
}

/** Nearest carvable column to `preferred` on row r, skipping column `avoid` (the survey shaft). */
function debugColumn(grid: TerrainGrid, preferred: number, r: number, avoid: number): number {
  for (let d = 0; d < MINE_W; d++) {
    for (const x of d === 0 ? [preferred] : [preferred - d, preferred + d]) {
      if (x >= 0 && x < MINE_W && x !== avoid && isCarvable(grid, x, r)) return x;
    }
  }
  return preferred;
}

export class World implements WorldApi {
  readonly seed: number;
  readonly scope: Scope;
  readonly deepHeat: boolean;
  readonly terrain: TerrainGrid;
  /** Survey shaft column and scripted lode id (canon §3.2 pass 5). */
  readonly meta: GenMeta;
  readonly pod: PodState;
  readonly wallet: Wallet;
  readonly story: StoryState;
  /** The hosted factory (MVP+; canon §4.10). Null in M0 builds. */
  readonly factory: Factory | null;

  private steps: number;
  private readonly rng: Rng;
  private readonly pads: PadArming;
  private readonly discards = new DiscardLog();
  private events: GameEvent[] = [];
  /**
   * The pod was already destroyed when this World was restored (a save written during the death card,
   * before respawn): its 'destroyed' event went to a previous session, so the app's death → salvage →
   * respawn flow would never start. The first running step reports it again (see step()).
   */
  private deathUnreported: boolean;
  /** Reused every step (no per-step allocation). */
  private readonly podCtx: PodStepCtx;
  private readonly shop: EconomyCtx;
  private readonly emit = (e: GameEvent): void => {
    this.events.push(e);
  };
  /** Radio beats, milestones, Co-op Plans rungs and map pings (01 §7–8); state lives in story.flags. */
  private readonly director: StoryDirector;
  /** Index of the first event the director has not seen yet. */
  private storyMark = 0;
  /** Reused every step (no per-step allocation). */
  private readonly storySnap: StorySnapshot;
  /** Pod-side ghost completion (02 §2.6); its timer is saved with the pod. */
  private readonly ghosts: GhostBuilder;
  /** The bay as the factory's Kit source (reused). */
  private readonly kitSource: CargoKitSource;
  /** One-cell tileChanged argument for digs (reused). */
  private readonly dugCell: Cell[] = [{ x: 0, y: 0 }];
  /** U1 already unlocked (skips the rung check every step). */
  private u1Done = false;

  /** `restored` is for World.deserialize only; it replaces generation with saved state. */
  constructor(opts: WorldOptions, restored?: SaveState) {
    const s = restored ?? newGame(opts);
    this.seed = s.seed;
    this.scope = s.scope;
    this.deepHeat = s.deepHeat;
    this.terrain = s.grid;
    this.meta = s.meta;
    this.pod = s.pod;
    this.wallet = s.wallet;
    this.story = s.story;
    this.steps = s.stepNo;
    this.rng = Rng.fromState(s.rng);
    this.pads = new PadArming(s.pads);
    this.deathUnreported = s.pod.destroyed;
    this.podCtx = { floorRow: scopeFloorRow(this.scope), deepHeat: this.deepHeat, rng: this.rng, stepNo: this.steps, scope: this.scope };
    this.shop = { pod: this.pod, wallet: this.wallet, scope: this.scope, parts: econ.EMPTY_PARTS, emit: this.emit };
    this.ghosts = new GhostBuilder(s.ghost);
    this.kitSource = new CargoKitSource(this.pod);
    this.factory = scopeAtLeast(this.scope, 'mvp') ? this.hostFactory(s.factory) : null;
    if (this.factory) {
      this.shop.parts = this.factory.partsLedger();
      // A fresh session is never away, whatever the last save caught (MVP: the factory sleeps while hidden).
      this.factory.setAway(false);
      if (restored && !s.factory) this.migrateToFactory();
      // Earlier MVP saves marked the Starter Kit collected when the lode was found: while it still waits at the
      // Shed, the goal chip asks for it again.
      if (restored && kits.starterKitReady(this.story.flags)) delete this.story.flags[obFlag('kit')];
      this.u1Done = this.factory.isUnlocked('U1');
    }
    this.director = new StoryDirector(this.storyContext());
    this.storySnap = { stepNo: 0, row: 0, depthFt: 0, grounded: true, onRim: true, alive: true, magmaPending: 0, trips: 0, cash: 0, tiers: this.pod.tiers };
    // The game-start card fires for a new claim only, never for a restored one (canon §2.12 #1 exception).
    if (!restored) this.director.start(this.story.flags, this.emit);
    this.storyMark = this.events.length;
  }

  /** `buildScope`: the scope this build plays (INT-6); an older save migrates to it, a newer one throws. */
  static deserialize(bytes: Uint8Array, buildScope?: Scope): World {
    const s = decodeSave(bytes);
    if (buildScope) s.scope = loadScope(s.scope, buildScope);
    try {
      return new World({ seed: s.seed, scope: s.scope, deepHeat: s.deepHeat }, s);
    } catch (e) {
      // A FACT section behind a valid CRC that the factory refuses is a corrupt save like any other (04 §4.13).
      if (e instanceof FactoryLoadError) throw new SaveError('section', e.message);
      throw e;
    }
  }

  serialize(): Uint8Array {
    return encodeSave(this.saveState());
  }

  /** Everything an HFSV file holds (read synchronously by the codec; not a copy). */
  saveState(): SaveState {
    return {
      seed: this.seed,
      scope: this.scope,
      deepHeat: this.deepHeat,
      stepNo: this.steps,
      meta: this.meta,
      grid: this.terrain,
      pod: this.pod,
      wallet: this.wallet,
      story: this.story,
      rng: this.rng.s,
      pads: this.pads.snapshot(),
      factory: this.factory?.serialize(),
      ghost: this.ghosts.timer(),
    };
  }

  /**
   * A save without a FACT section (an M0-scope build's version 1 save, INT-6; M0's own version 0 saves never load,
   * canon §3.15) under an MVP build: the fresh factory (survey set placed) learns what the claim already knows:
   * discovered lodes (U2, the Starter Kit), the r32 pass (U1). Pod, wallet and story stay as saved; the rungs
   * land in the story flags quietly, since the claim crossed those triggers long ago.
   */
  private migrateToFactory(): void {
    const f = this.factory;
    if (!f) return;
    const mark = this.events.length;
    for (const lode of this.terrain.lodes) {
      if (!lode.discovered) continue;
      f.discoverLode(lode.id, this.purityShown(lode));
      if (lode.id === this.meta.scriptedLodeId) kits.offerStarterKit(this.story.flags);
    }
    if (this.story.deepestRow >= SURVEY_PING_ROW) f.unlockRung('U1');
    for (const r of RUNGS) if (f.isUnlocked(r.id) && r.scope === 'mvp') this.story.flags[rungFlag(r.id)] = true;
    this.events.length = mark;
  }

  /** Purity shows at discovery for fixed-purity lodes or with a Dowser or better (02 §3.6). */
  private purityShown(lode: Lode): boolean {
    return (LODE_TABLE[lode.id]?.purity ?? null) !== null || this.pod.tiers.scanner >= DOWSER_TIER;
  }

  /**
   * 02 §3.6: a lode found with Tin Ear shows "?" until a Dowser-or-better scan: once the Scanner reaches Dowser,
   * each discovered lode whose purity is unknown is assayed when it comes within the Scanner radius.
   */
  private scanPurity(f: Factory): void {
    if (this.pod.tiers.scanner < DOWSER_TIER) return;
    const lodes = this.terrain.lodes;
    for (let i = 0; i < lodes.length; i++) {
      const lode = lodes[i];
      if (lode.discovered && !f.purityKnown(lode.id) && inScannerRange(this.pod, lode)) f.discoverLode(lode.id, true);
    }
  }

  /** Factory ports over the World's grid, wallet and event queue (04 §3.1). */
  private hostFactory(bytes: Uint8Array | undefined): Factory {
    const wallet = this.wallet;
    const ports: FactoryPorts = {
      grid: this.terrain,
      wallet: {
        cash: () => wallet.cash,
        debit: (n) => {
          if (n > wallet.cash) return false;
          wallet.cash -= n;
          return true;
        },
        credit: (n) => {
          wallet.cash += n;
          wallet.lifetimeEarned += n;
        },
      },
      emit: this.emit,
    };
    const opts = { scope: this.scope, surveyColumn: this.meta.surveyColumn, scriptedLodeId: this.meta.scriptedLodeId };
    return bytes ? Factory.deserialize(bytes, ports, opts) : Factory.create(ports, opts);
  }

  get stepNo(): number {
    return this.steps;
  }

  // ------------------------------------------------------------------ stepping

  step(intent: PodIntent, podRunning: boolean): void {
    const pod = this.pod;
    if (podRunning && !pod.destroyed) {
      const mark = this.events.length;
      this.podCtx.stepNo = this.steps;
      stepPod(pod, this.terrain, intent, this.podCtx, this.events);
      if (this.factory) {
        this.factoryHooks(this.factory, mark);
        this.scanPurity(this.factory);
      }
      if (pod.destroyed) this.story.destructions++;
      else {
        this.applyRules(intent, mark);
        if (this.factory) this.buildNearbyGhost(this.factory);
      }
    } else {
      // Paused (velocity kept, canon §4.5) or wrecked: no interpolation drift while frames keep rendering.
      pod.prevX = pod.x;
      pod.prevY = pod.y;
      // A restored wreck is reported once the pod would run, i.e. after the title and resume gate, so the
      // death card and salvage happen in view. Its destruction was counted when it happened.
      if (podRunning && this.deathUnreported) this.reportRestoredDeath();
    }
    if (this.steps % FACTORY_EVERY === FACTORY_PHASE) this.tickFactory();
    this.runStory();
    this.steps++;
  }

  private reportRestoredDeath(): void {
    this.deathUnreported = false;
    this.emit({ t: 'destroyed', cause: destructionCause(this.pod) });
  }

  drainEvents(): GameEvent[] {
    // Events from services called between steps (a sale, a purchase) reach the director before they leave.
    if (this.storyMark < this.events.length) this.runStory();
    this.storyMark = 0;
    if (this.events.length === 0) return NO_EVENTS;
    const out = this.events;
    this.events = [];
    return out;
  }

  stats(): PodStats {
    return podStats(this.pod);
  }

  /** World rules after a live pod step: Homing latch, depth and incentives, trip cycle, pads. */
  private applyRules(intent: PodIntent, mark: number): void {
    const pod = this.pod;
    this.latchAfterHoming(mark);
    const row = Math.floor(-pod.y);
    updateDepth(this.story, this.wallet, row, this.emit);
    // U1: the pod passes r32 (02 §9). The director fires Dot's survey ping (S1, 'lode-pinged') once on the same row.
    if (!this.u1Done && row >= SURVEY_PING_ROW && this.factory) {
      this.factory.unlockRung('U1');
      this.u1Done = true;
    }
    if (updateTrip(this.story, row, isOnRim(pod), this.emit)) this.onTripEnd();
    const pad = this.pads.step(pod, isNeutral(intent));
    if (pad >= 0) this.arriveAtPad(pad);
  }

  /** The Homing Beacon lands on the Pump House pad disarmed (01 §3.9). */
  private latchAfterHoming(mark: number): void {
    const ev = this.events;
    for (let i = mark; i < ev.length; i++) {
      const e = ev[i];
      if (e.t === 'teleport' && e.id === 'homingBeacon') this.pads.latch(PUMP_PAD);
    }
  }

  private arriveAtPad(pad: number): void {
    const id = RIM_BUILDINGS[pad].id;
    this.emit({ t: 'pad-arrive', id });
    // Co-op Credit is MVP (canon §5.5; INT-10).
    if (id === 'pump' && scopeAtLeast(this.scope, 'mvp')) econ.grantCoopCredit(this.shop, this.story, this.steps);
  }

  // ---- Factory hooks (MVP, 02 §10; canon §4.10). The M0 build has no factory. ----

  /** 20 Hz factory tick on stepNo % FACTORY_EVERY === FACTORY_PHASE (canon §3.5). MVP: `factory.tick()`. */
  private tickFactory(): void {
    this.factory?.tick();
  }

  /**
   * The pod step's world events the factory hosts (04 §3.1): lode discovery (U2; the scripted lode also offers
   * the Starter Kit) and terrain changes from digs and blasts (tileChanged re-checks ghosts).
   */
  private factoryHooks(f: Factory, mark: number): void {
    const ev = this.events;
    const n = ev.length; // hooks may emit (unlock, starter-kit); those are not re-read
    for (let i = mark; i < n; i++) {
      const e = ev[i];
      switch (e.t) {
        case 'lode-discovered': {
          const lode = this.terrain.lodes[e.lodeId];
          if (!lode) break;
          f.discoverLode(e.lodeId, this.purityShown(lode));
          if (e.lodeId === this.meta.scriptedLodeId && kits.offerStarterKit(this.story.flags)) this.emit({ t: 'starter-kit' });
          break;
        }
        case 'dug': {
          const c = this.dugCell[0];
          c.x = e.x;
          c.y = e.r;
          f.tileChanged(this.dugCell);
          break;
        }
        case 'explosion':
          f.tileChanged(blastCells(e.x, e.r, e.radius));
          break;
        default:
          break;
      }
    }
  }

  /** 02 §2.6: complete the oldest ghost within 2 tiles whose Kit the bay holds, after 1.0 s of staying near. */
  private buildNearbyGhost(f: Factory): void {
    const r = this.ghosts.step(f, this.pod, this.kitSource, this.emit);
    if (!r.done || r.job.kind !== 'lift') return;
    const lift = f.entity(r.id);
    if (lift) this.noteLiftBuilt(lift.h - 1);
  }

  /** Rim arrival after a trip (01 §2.2): MVP re-arms Depot sessions; v1 rolls Shears (canon §4.7). */
  private onTripEnd(): void {}

  /** The Garage draws t3+ parts from the factory's Stockpile (MVP). */
  setPartsLedger(parts: PartsLedger): void {
    this.shop.parts = parts;
  }

  // ------------------------------------------------------------------ Rim pads

  padUnderPod(): RimBuildingId | null {
    if (!isOnRim(this.pod)) return null;
    const i = padIndexAt(this.pod.x);
    return i < 0 ? null : RIM_BUILDINGS[i].id;
  }

  /** Armed = lights pulse (03 §6.4). */
  isPadArmed(id: RimBuildingId): boolean {
    return this.pads.isArmed(this.pod, padIndexOf(id));
  }

  sheetClosed(id: RimBuildingId): void {
    this.pads.latch(padIndexOf(id));
  }

  // ------------------------------------------------------------------ services
  // Trades need a live pod grounded on the Rim (canon §2.4; 01 §3.10: a pad, or a sign tap that drives it
  // there), never one in the sky, in a surface hole, underground or awaiting salvage. Quotes, lists and quick
  // slots stay available anywhere.

  /** Why a trade is refused right now, or null when the pod may trade. */
  private tradeRefusal(): Result | null {
    if (this.pod.destroyed) return econ.fail('Salvage first');
    return isOnRim(this.pod) ? null : econ.fail('Land on the Rim first');
  }

  fuelQuote(liters: number | 'fill'): Quote {
    return econ.fuelQuote(this.shop, liters);
  }
  buyFuel(liters: number | 'fill'): Result {
    return this.tradeRefusal() ?? econ.buyFuel(this.shop, liters);
  }
  cargoGroups(): CargoGroup[] {
    return econ.cargoGroups(this.pod.cargo);
  }
  cargoValue(): number {
    return econ.cargoValue(this.pod.cargo);
  }
  sellAll(keep?: readonly CargoItem[]): Result {
    return this.tradeRefusal() ?? this.withRecorderLogs(() => econ.sellAll(this.shop, keep));
  }
  repairQuote(): Quote {
    return econ.repairQuote(this.shop);
  }
  repairAll(): Result {
    return this.tradeRefusal() ?? econ.repairAll(this.shop);
  }
  garageCards(): UpgradeCard[] {
    return econ.garageCards(this.shop);
  }
  buyUpgrade(line: Line, tier: number): Result {
    return this.tradeRefusal() ?? econ.buyUpgrade(this.shop, line, tier);
  }
  shedItems(): ShopItem[] {
    return econ.shedItems(this.shop);
  }
  buyConsumable(id: ConsumableId, n: number): Result {
    return this.tradeRefusal() ?? econ.buyConsumable(this.shop, id, n);
  }
  setQuickSlot(slot: number, id: ConsumableId): void {
    econ.setQuickSlot(this.shop, slot, id);
  }

  // ------------------------------------------------------------------ cargo panel, Return Tick, Rim

  discardCargo(item: CargoItem, n: number | 'all'): Result {
    if (this.pod.destroyed) return econ.fail('Salvage first');
    const batch = takeCargo(this.pod.cargo, item, n);
    if (batch.length === 0) return econ.fail('Nothing like that aboard');
    this.discards.push(batch);
    return { ok: true, amount: batch.length };
  }

  undoDiscard(): Result {
    const batch = this.discards.pop();
    if (!batch) return econ.fail('Nothing to undo');
    // The pod is paused under the panel, so the room the discard made is still there.
    for (let i = batch.length - 1; i >= 0; i--) this.pod.cargo.push(batch[i]);
    return { ok: true, amount: batch.length };
  }

  get discardsPending(): number {
    return this.discards.pending;
  }

  commitDiscards(): void {
    this.discards.clear();
  }

  returnFuel(): number {
    return returnTickLiters(this.pod, this.deepHeat);
  }

  onRim(): boolean {
    return !this.pod.destroyed && isOnRim(this.pod);
  }

  // ------------------------------------------------------------------ failure

  respawn(): { fee: number; debt: number; lost: CargoItem[] } {
    const r = econ.salvage(this.shop);
    const pod = this.pod;
    placePod(pod, PUMP_PAD_X, STAND_Y, true);
    pod.destroyed = false;
    this.deathUnreported = false;
    pod.fuelWarn = -1;
    pod.hullWarned = false;
    this.pads.latch(PUMP_PAD);
    resetTrip(this.story);
    this.emit({ t: 'respawned', fee: r.fee, debt: r.debt, lost: r.lost });
    return r;
  }

  // ------------------------------------------------------------------ story

  /** Factory hook: a lift `rows` tall was completed (the first one over 100 rows wakes the count, 01 §7.4 S8). */
  noteLiftBuilt(rows: number): void {
    this.director.liftBuilt(rows, this.story.flags, this.emit);
  }

  private storyContext(): StoryContext {
    const iridium = this.terrain.lodes.find((l) => l.metal === 'iridium');
    return {
      scope: this.scope,
      scriptedLodeId: this.meta.scriptedLodeId,
      iridiumLodeId: iridium ? iridium.id : -1,
      loadFrac: () => {
        const s = podStats(this.pod);
        return s.hoverCap > 0 ? s.cargoMass / s.hoverCap : 0;
      },
      partCount: (part) => this.shop.parts.count(part as econ.PartId),
      billHasPart: (line, tier, part) => econ.partsFor(this.scope, line, tier).some((r) => r.part === part),
    };
  }

  /** Hand the director the events it has not seen, with the pod as it stands now. */
  private runStory(): void {
    const s = this.storySnap;
    const pod = this.pod;
    s.stepNo = this.steps;
    s.row = pod.row;
    s.depthFt = pod.y < 0 ? -pod.y * TILE_FT : 0;
    s.grounded = pod.grounded;
    s.onRim = isOnRim(pod);
    s.alive = !pod.destroyed && pod.hull > 0;
    s.magmaPending = pod.magmaPending;
    s.trips = this.story.trips;
    s.cash = this.wallet.cash;
    s.tiers = pod.tiers;
    this.director.onEvents(this.events, s, this.story.flags, this.emit, this.storyMark);
    this.storyMark = this.events.length;
  }

  /** Each Lost Pod Recorder a sale takes plays the next Deepreach log (01 §7.5, in order of sale). */
  private withRecorderLogs(sale: () => Result): Result {
    const before = this.recordersAboard();
    const r = sale();
    const sold = before - this.recordersAboard();
    if (r.ok && sold > 0) this.director.recordersSold(sold, this.story.flags, this.emit);
    return r;
  }

  private recordersAboard(): number {
    let n = 0;
    for (const c of this.pod.cargo) if (c.kind === 'relic' && c.id === RECORDER_RELIC) n++;
    return n;
  }

  // ------------------------------------------------------------------ debug

  // ---- Factory-facing services (MVP; canon §2.4, §4.8–§4.9; 02 §2.7, §3.7) ----

  private shopCtx(): kits.ShopCtx | null {
    const f = this.factory;
    return f ? { pod: this.pod, wallet: this.wallet, scope: this.scope, factory: f, flags: this.story.flags, emit: this.emit } : null;
  }

  kitShop(): KitShopItem[] {
    const ctx = this.shopCtx();
    return ctx ? kits.kitShop(ctx) : [];
  }
  buyKit(kitId: string, n: number, to: 'cargo' | 'stockpile'): Result {
    const ctx = this.shopCtx();
    if (!ctx) return econ.fail('No Kits in this build');
    return this.tradeRefusal() ?? kits.buyKit(ctx, kitId, n, to);
  }
  loadKit(kitId: string, n: number): Result {
    const ctx = this.shopCtx();
    if (!ctx) return econ.fail('No Stockpile in this build');
    return this.tradeRefusal() ?? kits.loadKit(ctx, kitId, n);
  }
  starterKitReady(): boolean {
    return this.factory !== null && kits.starterKitReady(this.story.flags);
  }
  claimStarterKit(): Result {
    const ctx = this.shopCtx();
    if (!ctx) return econ.fail('No Starter Kit in this build');
    return this.tradeRefusal() ?? kits.claimStarterKit(ctx);
  }
  stockpileCargo(item: CargoItem, n: number | 'all'): Result {
    const ctx = this.shopCtx();
    if (!ctx) return econ.fail('No Stockpile in this build');
    return this.tradeRefusal() ?? kits.stockpileCargo(ctx, item, n);
  }
  expandYard(): Result {
    const f = this.factory;
    if (!f) return econ.fail('No Yard in this build');
    const refusal = this.tradeRefusal();
    if (refusal) return refusal;
    const next = YARD_EXPANSIONS.find((x) => x.rows > f.yardRows);
    if (!next) return econ.fail('The Yard is as big as it gets');
    if (next.scope === 'v1' && !scopeAtLeast(this.scope, 'v1')) return econ.fail('More Yard comes in the next update');
    const cash = this.wallet.cash;
    const r = f.expandYard();
    if (!r.ok) return econ.fail(errText(r));
    this.emit({ t: 'purchase', kind: 'yard', amount: cash - this.wallet.cash });
    return { ok: true, message: `Yard expanded to 48 × ${r.rows}`, amount: r.rows };
  }
  ghostProgress(): { id: number; progress: number; blocked: ErrCode | null } | null {
    return this.factory ? this.ghosts.progress() : null;
  }

  /** The bay takes refunds only when the pod is alive and within 2 tiles of the piece (02 §2.7). */
  private sinkNear(x: number, y: number, w: number, h: number): CargoKitSink | undefined {
    const pod = this.pod;
    if (pod.destroyed) return undefined;
    const near = jobDistance({ x, y, w, h }, Math.floor(pod.x), Math.floor(-pod.y)) <= GHOST_REACH;
    return near ? new CargoKitSink(pod) : undefined;
  }

  deconstructUnderground(id: number): Res<{ refund: number }> {
    const f = this.factory;
    if (!f) return { ok: false, code: 'E_INVALID' };
    const e = f.entity(id);
    if (!e) return { ok: false, code: 'E_INVALID' };
    if (e.plane === 'yard') return f.deconstruct(id);
    const sink = this.sinkNear(e.x, e.y, e.w, e.h);
    return f.deconstruct(id, sink ? { toCargo: sink } : undefined);
  }

  removeUndergroundBelts(cells: readonly Cell[]): Res<{ refund: number }> {
    const f = this.factory;
    if (!f) return { ok: false, code: 'E_INVALID' };
    let sink: CargoKitSink | undefined;
    for (const c of cells) {
      sink = this.sinkNear(c.x, c.y, 1, 1);
      if (sink) break;
    }
    return f.removeBelts('mine', cells, sink ? { toCargo: sink } : undefined);
  }

  setAway(on: boolean): void {
    this.factory?.setAway(on);
  }

  /**
   * Put the pod, grounded and still, in a freshly carved 1×1 air cell on `row` near x 7 (never the open survey
   * shaft, INT-12), on a floor: the cell below becomes dirt if it is air.
   */
  debugTeleport(row: number): void {
    const grid = this.terrain;
    const floorRow = scopeFloorRow(this.scope);
    const r = Math.max(0, Math.min(floorRow - 1, Math.floor(row)));
    const x = debugColumn(grid, START_X, r, this.meta.surveyColumn);
    grid.set(x, r, T.AIR);
    grid.markDug(x, r);
    if (r + 1 < floorRow && grid.get(x, r + 1) === T.AIR) grid.set(x, r + 1, T.DIRT);
    placePod(this.pod, x + 0.5, -(r + 1) + STAND_Y, true);
  }

  debugGiveCash(amount: number): void {
    if (Number.isFinite(amount)) this.wallet.cash = Math.max(0, this.wallet.cash + amount);
  }

  debugSetTier(line: Line, tier: number): void {
    if (econ.tierExists(line, tier)) econ.installTier(this.shop, line, tier);
  }
}

/** Cells of a blast square (canon §3.3), clipped to the mine. Blasts are rare: a fresh list each. */
function blastCells(x: number, r: number, radius: number): Cell[] {
  const out: Cell[] = [];
  for (let y = Math.max(0, r - radius); y <= Math.min(MINE_H - 1, r + radius); y++) {
    for (let c = Math.max(0, x - radius); c <= Math.min(MINE_W - 1, x + radius); c++) out.push({ x: c, y });
  }
  return out;
}
