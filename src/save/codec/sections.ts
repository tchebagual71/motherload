// HFSV section bodies (04 §4.9): one writer and one validating reader per FourCC. PURE MODULE.
// Every reader checks each value against canon bounds (04 §4.13) and throws SaveError('bounds').
import {
  BAY,
  CONSUMABLE_CAP,
  CONSUMABLES,
  DEFAULT_QUICK_SLOTS,
  LINES,
  LODE_H,
  LODE_W,
  MINE_H,
  MINE_W,
  MINERALS,
  PAD_NEUTRAL_STEPS,
  RELICS,
  RIM_BUILDINGS,
  SKY_ROWS,
  lineTierName,
  type Line,
} from '../../shared/canon';
import { STREAM, type RngState } from '../../shared/rng';
import { T, type CargoItem, type ConsumableId, type Lode, type LodeMetal, type Purity, type Scope } from '../../shared/types';
import { TerrainGrid } from '../../terrain/grid';
import type { DigDir, DigState, PodState, Sector } from '../../pod/types';
import { kitUnits } from '../../factory/api';
import type { StoryState, Wallet } from '../../world/api';
import type { ByteReader, ByteWriter } from './bytes';
import { SaveError } from './errors';
import type { PadSnapshot, SaveState } from './types';

export const TAG = {
  META: 'META',
  TERR: 'TERR',
  LODE: 'LODE',
  PODS: 'PODS',
  WALT: 'WALT',
  STRY: 'STRY',
  RNGS: 'RNGS',
  PADS: 'PADS',
  /** Factory bytes (MVP+): `FactoryApi.serialize()` verbatim; the factory validates its own sub-sections. */
  FACT: 'FACT',
} as const;

// ---------- enumerations (append-only: the index is the stored byte) ----------
const SCOPES: readonly Scope[] = ['m0', 'mvp', 'v1'];
const METALS: readonly LodeMetal[] = ['hematite', 'copper', 'cobalt', 'gold', 'iridium', 'thorium', 'kerogen'];
const PURITIES: readonly Purity[] = ['poor', 'normal', 'rich'];
const DIG_DIRS: readonly DigDir[] = ['down', 'left', 'right'];
const SECTORS: readonly Sector[] = ['none', 'up', 'down', 'left', 'right'];
const CONSUMABLE_IDS: readonly ConsumableId[] = CONSUMABLES.map((c) => c.id);
const CARGO_MINERAL = 0;
const CARGO_RELIC = 1;
const CARGO_KIT = 2;
const LODE_SCRIPTED = 1;
const LODE_V1 = 2;
const LODE_DISCOVERED = 4;

// ---------- bounds (canon maxima; 04 §4.13) ----------
const CELLS = MINE_W * MINE_H;
const MAX_CARGO = Math.max(...BAY.map((b) => (b ? b.slots : 0)));
const MAX_KIT_ID = 32;
const MAX_FLAGS = 512;
const MAX_FLAG_KEY = 64;
const MAX_LODES = 254; // lodeIndex is u8 holding id + 1
const MAX_SPEED = 100;
const MAX_TANK_OR_HULL = 1_000;
const MAX_DIG_STEPS = 1_000;
const MAX_TIMER_STEPS = 1_000_000;
const MAX_STEP_NO = Number.MAX_SAFE_INTEGER;
const MAX_MONEY = 1e15;
const MAX_RNG_STREAMS = 16;
/** Ghost completion holds 60 steps (02 §2.6); a saved timer is always below that. */
const MAX_GHOST_STEPS = 60;
const Y_MIN = -MINE_H;
const Y_MAX = SKY_ROWS + 16;

const VALID_TERRAIN = buildValidTerrain();

function buildValidTerrain(): Uint8Array {
  const ok = new Uint8Array(256);
  for (let c = T.AIR; c <= T.HEARTSTONE; c++) ok[c] = 1;
  for (let tier = 1; tier <= MINERALS.length; tier++) ok[T.MINERAL_BASE + tier] = 1;
  for (let id = 0; id < RELICS.length; id++) ok[T.RELIC_BASE + id] = 1;
  return ok;
}

function bounds(what: string, v: unknown): never {
  throw new SaveError('bounds', `${what} out of range: ${String(v)}`);
}

// ---------- META ----------

export function writeMeta(w: ByteWriter, s: SaveState): void {
  w.u32(s.seed);
  w.u8(SCOPES.indexOf(s.scope));
  w.bool(s.deepHeat);
  w.f64(s.stepNo);
  w.u8(s.meta.surveyColumn);
  w.u8(s.meta.scriptedLodeId);
}

export interface MetaSection {
  seed: number;
  scope: Scope;
  deepHeat: boolean;
  stepNo: number;
  surveyColumn: number;
  scriptedLodeId: number;
}

export function readMeta(r: ByteReader): MetaSection {
  return {
    seed: r.u32('seed'),
    scope: r.oneOf(SCOPES, 'scope'),
    deepHeat: r.bool('deepHeat'),
    stepNo: r.whole(0, MAX_STEP_NO, 'stepNo'),
    surveyColumn: r.int(r.u8('surveyColumn'), 0, MINE_W - 1, 'surveyColumn'),
    scriptedLodeId: r.u8('scriptedLodeId'),
  };
}

// ---------- TERR ----------

export function writeTerrain(w: ByteWriter, grid: TerrainGrid): void {
  w.u32(CELLS);
  w.bytes(grid.terrain);
  w.bytes(grid.flags);
}

/** A fresh grid holding the saved terrain and flags (lodes are attached by `readLodes`). */
export function readTerrain(r: ByteReader, seed: number): TerrainGrid {
  r.int(r.u32('cell count'), CELLS, CELLS, 'cell count');
  const terrain = r.bytes(CELLS, 'terrain');
  for (let i = 0; i < CELLS; i++) if (!VALID_TERRAIN[terrain[i]]) bounds(`terrain code at cell ${i}`, terrain[i]);
  const grid = new TerrainGrid(seed);
  grid.terrain.set(terrain);
  grid.flags.set(r.bytes(CELLS, 'flags'));
  return grid;
}

// ---------- LODE ----------

export function writeLodes(w: ByteWriter, lodes: readonly Lode[]): void {
  w.u8(lodes.length);
  for (const l of lodes) {
    w.u8(l.id);
    w.u8(METALS.indexOf(l.metal));
    w.u8(PURITIES.indexOf(l.purity));
    w.u8(l.x0);
    w.u16(l.top);
    w.u8((l.scripted ? LODE_SCRIPTED : 0) | (l.scope === 'v1' ? LODE_V1 : 0) | (l.discovered ? LODE_DISCOVERED : 0));
  }
}

/** Read the lode table into `grid.lodes` and rebuild `grid.lodeIndex` from it. */
export function readLodes(r: ByteReader, grid: TerrainGrid): void {
  const n = r.int(r.u8('lode count'), 0, MAX_LODES, 'lode count');
  const lodes: Lode[] = [];
  for (let i = 0; i < n; i++) {
    const id = r.int(r.u8('lode id'), i, i, 'lode id');
    const metal = r.oneOf(METALS, 'lode metal');
    const purity = r.oneOf(PURITIES, 'lode purity');
    const x0 = r.int(r.u8('lode x0'), 0, MINE_W - LODE_W, 'lode x0');
    const top = r.int(r.u16('lode top'), 0, MINE_H - LODE_H, 'lode top');
    const bits = r.int(r.u8('lode bits'), 0, LODE_SCRIPTED | LODE_V1 | LODE_DISCOVERED, 'lode bits');
    lodes.push({
      id,
      metal,
      purity,
      x0,
      top,
      scripted: (bits & LODE_SCRIPTED) !== 0,
      scope: bits & LODE_V1 ? 'v1' : 'mvp',
      discovered: (bits & LODE_DISCOVERED) !== 0,
    });
  }
  grid.lodes = lodes;
  for (const l of lodes) {
    for (let row = l.top; row < l.top + LODE_H; row++) {
      for (let x = l.x0; x < l.x0 + LODE_W; x++) grid.lodeIndex[row * MINE_W + x] = l.id + 1;
    }
  }
}

// ---------- PODS ----------

/** Version ≥ 1: a Kit carries its remaining meter units (0 = full, the default). */
function writeCargo(w: ByteWriter, cargo: readonly CargoItem[]): void {
  w.u16(cargo.length);
  for (const item of cargo) {
    switch (item.kind) {
      case 'mineral':
        w.u8(CARGO_MINERAL);
        w.u8(item.tier);
        break;
      case 'relic':
        w.u8(CARGO_RELIC);
        w.u8(item.id);
        break;
      case 'kit':
        w.u8(CARGO_KIT);
        w.str(item.id);
        w.u8(item.units ?? 0);
        break;
    }
  }
}

function readKit(r: ByteReader): CargoItem {
  const id = r.str('kit id', MAX_KIT_ID);
  const units = r.int(r.u8('kit units'), 0, kitUnits(id), 'kit units');
  return units === 0 ? { kind: 'kit', id } : { kind: 'kit', id, units };
}

function readCargo(r: ByteReader): CargoItem[] {
  const n = r.int(r.u16('cargo count'), 0, MAX_CARGO, 'cargo count');
  const cargo: CargoItem[] = [];
  for (let i = 0; i < n; i++) {
    const kind = r.u8('cargo kind');
    if (kind === CARGO_MINERAL) cargo.push({ kind: 'mineral', tier: r.int(r.u8('mineral tier'), 1, MINERALS.length, 'mineral tier') });
    else if (kind === CARGO_RELIC) cargo.push({ kind: 'relic', id: r.int(r.u8('relic id'), 0, RELICS.length - 1, 'relic id') });
    else if (kind === CARGO_KIT) cargo.push(readKit(r));
    else bounds('cargo kind', kind);
  }
  return cargo;
}

function writeDig(w: ByteWriter, d: DigState | null): void {
  w.bool(d !== null);
  if (!d) return;
  w.u8(d.x);
  w.u16(d.r);
  w.u8(DIG_DIRS.indexOf(d.dir));
  w.f64(d.progress);
  w.f64(d.total);
  w.bool(d.cleared);
  w.f64(d.fromX);
  w.f64(d.fromY);
}

function readDig(r: ByteReader): DigState | null {
  if (!r.bool('dig present')) return null;
  const x = r.int(r.u8('dig x'), 0, MINE_W - 1, 'dig x');
  const row = r.int(r.u16('dig r'), 0, MINE_H - 1, 'dig r');
  const dir = r.oneOf(DIG_DIRS, 'dig dir');
  const progress = r.whole(0, MAX_DIG_STEPS, 'dig progress');
  const total = r.whole(1, MAX_DIG_STEPS, 'dig total');
  if (progress > total) bounds('dig progress', progress);
  return {
    x,
    r: row,
    dir,
    progress,
    total,
    cleared: r.bool('dig cleared'),
    fromX: r.finite(0, MINE_W, 'dig fromX'),
    fromY: r.finite(Y_MIN, Y_MAX, 'dig fromY'),
  };
}

export function writePod(w: ByteWriter, p: PodState): void {
  for (const v of [p.x, p.y, p.vx, p.vy, p.prevX, p.prevY]) w.f64(v);
  w.bool(p.grounded);
  w.u8(p.facing === 1 ? 1 : 0);
  w.f64(p.fuel);
  w.f64(p.hull);
  for (const line of LINES) w.u8(p.tiers[line]);
  writeCargo(w, p.cargo);
  for (const id of CONSUMABLE_IDS) w.u8(p.consumables[id]);
  w.u8(p.quickSlots.length);
  for (const id of p.quickSlots) w.u8(CONSUMABLE_IDS.indexOf(id));
  writeDig(w, p.dig);
  w.f64(p.engageSteps);
  w.u8(p.engageDir === null ? 0 : DIG_DIRS.indexOf(p.engageDir) + 1);
  w.u8(SECTORS.indexOf(p.sector));
  w.f64(p.cooldown);
  w.f64(p.magmaPending);
  w.f64(p.thrust);
  w.bool(p.digging);
  w.u8(p.fuelWarn + 1);
  w.bool(p.hullWarned);
  w.f64(p.airSteps);
  w.bool(p.destroyed);
  w.u16(p.row);
}

function readTiers(r: ByteReader): Record<Line, number> {
  const tiers = {} as Record<Line, number>;
  for (const line of LINES) {
    const t = r.u8(`${line} tier`);
    if (lineTierName(line, t) === null) bounds(`${line} tier`, t);
    tiers[line] = t;
  }
  return tiers;
}

function readConsumables(r: ByteReader): Record<ConsumableId, number> {
  const out = {} as Record<ConsumableId, number>;
  for (const id of CONSUMABLE_IDS) out[id] = r.int(r.u8(id), 0, CONSUMABLE_CAP, `${id} count`);
  return out;
}

function readQuickSlots(r: ByteReader): ConsumableId[] {
  const n = DEFAULT_QUICK_SLOTS.length;
  r.int(r.u8('quick slot count'), n, n, 'quick slot count');
  const slots: ConsumableId[] = [];
  for (let i = 0; i < n; i++) slots.push(r.oneOf(CONSUMABLE_IDS, 'quick slot'));
  return slots;
}

export function readPod(r: ByteReader): PodState {
  const x = r.finite(0, MINE_W, 'pod x');
  const y = r.finite(Y_MIN, Y_MAX, 'pod y');
  const vx = r.finite(-MAX_SPEED, MAX_SPEED, 'pod vx');
  const vy = r.finite(-MAX_SPEED, MAX_SPEED, 'pod vy');
  const prevX = r.finite(0, MINE_W, 'pod prevX');
  const prevY = r.finite(Y_MIN, Y_MAX, 'pod prevY');
  const grounded = r.bool('grounded');
  const facing: 1 | -1 = r.bool('facing') ? 1 : -1;
  const fuel = r.finite(0, MAX_TANK_OR_HULL, 'fuel');
  const hull = r.finite(0, MAX_TANK_OR_HULL, 'hull');
  const tiers = readTiers(r);
  const cargo = readCargo(r);
  const consumables = readConsumables(r);
  const quickSlots = readQuickSlots(r);
  const dig = readDig(r);
  const engageSteps = r.whole(0, MAX_TIMER_STEPS, 'engageSteps');
  const engage = r.int(r.u8('engageDir'), 0, DIG_DIRS.length, 'engageDir');
  return {
    x,
    y,
    vx,
    vy,
    prevX,
    prevY,
    grounded,
    facing,
    fuel,
    hull,
    tiers,
    cargo,
    consumables,
    quickSlots,
    dig,
    engageSteps,
    engageDir: engage === 0 ? null : DIG_DIRS[engage - 1],
    sector: r.oneOf(SECTORS, 'sector'),
    cooldown: r.whole(0, MAX_TIMER_STEPS, 'cooldown'),
    magmaPending: r.whole(0, MAX_TIMER_STEPS, 'magmaPending'),
    thrust: r.finite(0, 1, 'thrust'),
    digging: r.bool('digging'),
    fuelWarn: r.int(r.u8('fuelWarn'), 0, 3, 'fuelWarn') - 1,
    hullWarned: r.bool('hullWarned'),
    airSteps: r.whole(0, MAX_STEP_NO, 'airSteps'),
    destroyed: r.bool('destroyed'),
    row: r.int(r.u16('row'), 0, MINE_H - 1, 'row'),
  };
}

/** The ghost-completion timer, after the pod in PODS (version ≥ 1; 04 §4.9 "ghost timer"). */
export function writeGhostTimer(w: ByteWriter, g: { id: number; steps: number } | undefined): void {
  w.u16(g ? g.id : 0);
  w.u16(g ? g.steps : 0);
}

export function readGhostTimer(r: ByteReader): { id: number; steps: number } {
  const id = r.u16('ghost id');
  const steps = r.int(r.u16('ghost steps'), 0, MAX_GHOST_STEPS, 'ghost steps');
  return id === 0 ? { id: 0, steps: 0 } : { id, steps };
}

// ---------- WALT ----------

export function writeWallet(w: ByteWriter, wallet: Wallet): void {
  w.f64(wallet.cash);
  w.f64(wallet.debt);
  w.f64(wallet.lifetimeEarned);
}

export function readWallet(r: ByteReader): Wallet {
  return {
    cash: r.finite(0, MAX_MONEY, 'cash'),
    debt: r.finite(0, MAX_MONEY, 'debt'),
    lifetimeEarned: r.finite(0, MAX_MONEY, 'lifetimeEarned'),
  };
}

// ---------- STRY ----------

export function writeStory(w: ByteWriter, s: StoryState): void {
  w.u16(s.deepestRow);
  w.u32(s.trips);
  w.u16(s.tripDeepestRow);
  w.bool(s.underground);
  w.u8(s.incentivesPaid.length);
  for (const row of s.incentivesPaid) w.u16(row);
  const keys = Object.keys(s.flags);
  w.u16(keys.length);
  for (const k of keys) {
    w.str(k);
    w.bool(s.flags[k]);
  }
  w.f64(s.coopCreditReadyStep);
  w.u32(s.destructions);
}

export function readStory(r: ByteReader): StoryState {
  const deepestRow = r.int(r.u16('deepestRow'), 0, MINE_H - 1, 'deepestRow');
  const trips = r.u32('trips');
  const tripDeepestRow = r.int(r.u16('tripDeepestRow'), 0, MINE_H - 1, 'tripDeepestRow');
  const underground = r.bool('underground');
  const incentivesPaid: number[] = [];
  const nInc = r.u8('incentive count');
  for (let i = 0; i < nInc; i++) incentivesPaid.push(r.int(r.u16('incentive row'), 0, MINE_H - 1, 'incentive row'));
  const flags: Record<string, boolean> = {};
  const nFlags = r.int(r.u16('flag count'), 0, MAX_FLAGS, 'flag count');
  for (let i = 0; i < nFlags; i++) {
    const key = r.str('flag key', MAX_FLAG_KEY);
    flags[key] = r.bool('flag value');
  }
  return {
    deepestRow,
    trips,
    tripDeepestRow,
    underground,
    incentivesPaid,
    flags,
    coopCreditReadyStep: r.whole(0, MAX_STEP_NO, 'coopCreditReadyStep'),
    destructions: r.u32('destructions'),
  };
}

// ---------- RNGS ----------

/** Saved streams (04 §3.6). M0 has one; Shear, Hardcore and Boss streams append here. */
export function writeRng(w: ByteWriter, hop: RngState): void {
  w.u8(1);
  w.u16(STREAM.HOP_BEACON);
  w.u32(hop.a);
  w.u32(hop.b);
  w.u32(hop.c);
  w.u32(hop.d);
}

export function readRng(r: ByteReader): RngState {
  const n = r.int(r.u8('rng stream count'), 0, MAX_RNG_STREAMS, 'rng stream count');
  let hop: RngState | null = null;
  for (let i = 0; i < n; i++) {
    const id = r.u16('rng stream id');
    // sfc32 keeps its words as signed int32 (`| 0`); store unsigned, restore signed.
    const state = { a: r.u32('rng a') | 0, b: r.u32('rng b') | 0, c: r.u32('rng c') | 0, d: r.u32('rng d') | 0 };
    if (id === STREAM.HOP_BEACON) hop = state;
  }
  if (!hop) throw new SaveError('missing', 'Save has no Hop Beacon RNG stream');
  return hop;
}

// ---------- PADS ----------

export function writePads(w: ByteWriter, pads: PadSnapshot): void {
  w.u8(pads.latched.length);
  for (const l of pads.latched) w.bool(l);
  w.u16(pads.neutralSteps);
}

export function readPads(r: ByteReader): PadSnapshot {
  const n = RIM_BUILDINGS.length;
  r.int(r.u8('pad count'), n, n, 'pad count');
  const latched: boolean[] = [];
  for (let i = 0; i < n; i++) latched.push(r.bool('pad latched'));
  return { latched, neutralSteps: r.int(r.u16('pad neutral steps'), 0, PAD_NEUTRAL_STEPS, 'pad neutral steps') };
}
