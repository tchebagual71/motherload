// The one authoritative simulation (canon §4.10; 04 §3.1): terrain, pod, wallet, story and (MVP) the
// factory, stepped at a fixed 60 Hz. UI, render and app reach it only through WorldApi. PURE MODULE.
import { FACTORY_EVERY, FACTORY_PHASE, MINE_W, POD_H, RIM_BUILDINGS, START_CASH, START_X, type Line } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import { Rng, STREAM } from '../shared/rng';
import { T, type CargoItem, type ConsumableId, type RimBuildingId, type Scope } from '../shared/types';
import { generateWorld, type GenMeta } from '../terrain/generate';
import type { TerrainGrid } from '../terrain/grid';
import { applyScopeOverlay, scopeFloorRow } from '../terrain/scope';
import { PUMP_PAD_X, createPod, destructionCause, podStats, stepPod, type PodStepCtx } from '../pod';
import type { PodIntent, PodState } from '../pod/types';
import * as econ from '../economy';
import type { EconomyCtx, PartsLedger } from '../economy';
import { deserialize as decodeSave, serialize as encodeSave, type SaveState } from '../save/codec';
import type { CargoGroup, PodStats, Quote, Result, ShopItem, StoryState, UpgradeCard, Wallet, WorldApi } from './api';
import { PUMP_PAD, PadArming, isNeutral, isOnRim, padIndexAt, padIndexOf } from './pads';
import { newStory, resetTrip, updateDepth, updateTrip } from './rules';

export interface WorldOptions {
  seed: number;
  scope: Scope;
  /** Deep Heat A/B flag (canon §4.4), off by default. */
  deepHeat?: boolean;
}

const NO_EVENTS: GameEvent[] = Object.freeze([]) as unknown as GameEvent[];
/** Pod centre height when standing on a surface (the Rim at y = 0, or a cell's floor). */
const STAND_Y = POD_H / 2;

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

/** Nearest carvable column to `preferred` on row r. */
function debugColumn(grid: TerrainGrid, preferred: number, r: number): number {
  for (let d = 0; d < MINE_W; d++) {
    for (const x of d === 0 ? [preferred] : [preferred - d, preferred + d]) {
      if (x >= 0 && x < MINE_W && isCarvable(grid, x, r)) return x;
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

  private steps: number;
  private readonly rng: Rng;
  private readonly pads: PadArming;
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
  }

  static deserialize(bytes: Uint8Array): World {
    const s = decodeSave(bytes);
    return new World({ seed: s.seed, scope: s.scope, deepHeat: s.deepHeat }, s);
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
    };
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
      if (pod.destroyed) this.story.destructions++;
      else this.applyRules(intent, mark);
    } else {
      // Paused (velocity kept, canon §4.5) or wrecked: no interpolation drift while frames keep rendering.
      pod.prevX = pod.x;
      pod.prevY = pod.y;
      // A restored wreck is reported once the pod would run, i.e. after the title and resume gate, so the
      // death card and salvage happen in view. Its destruction was counted when it happened.
      if (podRunning && this.deathUnreported) this.reportRestoredDeath();
    }
    if (this.steps % FACTORY_EVERY === FACTORY_PHASE) this.tickFactory();
    this.steps++;
  }

  private reportRestoredDeath(): void {
    this.deathUnreported = false;
    this.emit({ t: 'destroyed', cause: destructionCause(this.pod) });
  }

  drainEvents(): GameEvent[] {
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
    if (id === 'pump') econ.grantCoopCredit(this.shop, this.story, this.steps);
  }

  // ---- Factory hooks (MVP, 02 §10; canon §4.10). The M0 build has no factory. ----

  /** 20 Hz factory tick on stepNo % FACTORY_EVERY === FACTORY_PHASE (canon §3.5). MVP: `factory.tick()`. */
  private tickFactory(): void {}

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

  /** Armed = lights pulse (03 §6.4). Not part of WorldApi yet. */
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
  sellAll(): Result {
    return this.tradeRefusal() ?? econ.sellAll(this.shop);
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

  // ------------------------------------------------------------------ debug

  /** Put the pod in a freshly carved 1×1 air cell on `row`: the survey column while inside the shaft, else x 7. */
  debugTeleport(row: number): void {
    const grid = this.terrain;
    const r = Math.max(0, Math.min(scopeFloorRow(this.scope) - 1, Math.floor(row)));
    const shaftBottom = grid.lodes[this.meta.scriptedLodeId]?.top ?? 0;
    const x = debugColumn(grid, r < shaftBottom ? this.meta.surveyColumn : START_X, r);
    grid.set(x, r, T.AIR);
    grid.markDug(x, r);
    placePod(this.pod, x + 0.5, -(r + 1) + STAND_Y, false);
  }

  debugGiveCash(amount: number): void {
    if (Number.isFinite(amount)) this.wallet.cash = Math.max(0, this.wallet.cash + amount);
  }

  debugSetTier(line: Line, tier: number): void {
    if (econ.tierExists(line, tier)) econ.installTier(this.shop, line, tier);
  }
}
