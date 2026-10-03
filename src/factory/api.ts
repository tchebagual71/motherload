// Public contract of the factory simulation (02 §10; canon §4.10, 04 §3.1–3.3). Other modules (World, render,
// UI, save) depend on THIS file only, never on factory internals. Frozen: extend by appending.
// PURE MODULE (types and static tables).
//
// Hosting (04 §3.1): the World owns one Factory, implements FactoryPorts, calls `tick()` on
// stepNo % FACTORY_EVERY === FACTORY_PHASE, forwards 'lode-discovered' to `discoverLode`, calls `tileChanged`
// after digs and blasts, calls `completeGhost` from the pod step, and embeds `serialize()` as its FACT section.
import type { PartId, PartsLedger } from '../economy/parts';
import type { GameEvent } from '../shared/events';
import type { Scope } from '../shared/types';
import type { TerrainGrid } from '../terrain/grid';

// ---------------------------------------------------------------- planes, cells, directions

/** Build planes (02 §2.1): the surface Yard and the underground slab. */
export type Plane = 'yard' | 'mine';

/**
 * Cell coordinates per plane. Yard: x 0–47, y = Yard row (row k spans world z ∈ [−1−k, −k]; row 0 is the Rim
 * strip, never buildable). Mine: x 0–47, y = mine row r (0 = turf row, down is +y).
 */
export interface Cell {
  x: number;
  y: number;
}

/**
 * Directions: 0 E (+x), 1 S (+y: Yard away from the Rim / mine downward), 2 W (−x), 3 N (−y). Clockwise is
 * increasing index. A building's `dir` is its output (facing) edge (02 §2.2).
 */
export type Dir = 0 | 1 | 2 | 3;
export const DIR = { E: 0, S: 1, W: 2, N: 3 } as const;

/** Yard rows hold z ∈ [−33, −1] (canon §3.1): rows 1–32; row 0 is the Rim strip. */
export const YARD_MAX_ROWS = 32;
/** Rim buildings (canon §2.4) stand on Yard rows 1–3 over their pad columns. */
export const RIM_BUILDING_ROWS = 3;
/** Underground pieces may not go at or below the Seal (02 §2.5 E_ARENA). */
export const ARENA_ROW = 584;

// ---------------------------------------------------------------- unlock ladder (02 §9)

/** Co-op Plans rungs. Ids are stable save flags (04 §4.8); U4–U5 are unused. */
export type Rung = 'U0' | 'U1' | 'U2' | 'U3' | 'U6' | 'U7' | 'U8' | 'U9' | 'U10' | 'U11';

export interface RungDef {
  id: Rung;
  /** Stable bit in the factory's rung mask. */
  bit: number;
  trigger: string;
  unlocks: string;
  scope: Scope;
}

export const RUNGS: readonly RungDef[] = [
  { id: 'U0', bit: 0, trigger: 'New game', unlocks: 'Yard 48 × 8 with the survey set', scope: 'mvp' },
  { id: 'U1', bit: 1, trigger: 'Pass 400 ft', unlocks: "Dot's survey ping", scope: 'mvp' },
  { id: 'U2', bit: 2, trigger: 'Discover a lode', unlocks: 'Auto-Drill, Bucket Lift, Lift Rail, Headframe, Belt, Bin, Smelter, Expansion I', scope: 'mvp' },
  { id: 'U3', bit: 3, trigger: 'Produce an ingot', unlocks: 'Assembler, Router, Export Terminal', scope: 'mvp' },
  { id: 'U6', bit: 6, trigger: 'Reach 1,000 ft', unlocks: 'Depot, Chute, Shoring Brace, Lamp', scope: 'v1' },
  { id: 'U7', bit: 7, trigger: 'Discover a Kerogen lode', unlocks: 'Refinery, Power Plant', scope: 'v1' },
  { id: 'U8', bit: 8, trigger: 'Reach 1,612 ft', unlocks: 'Mk II belts, drills and lifts; Silo; Pod Works; Expansion II', scope: 'v1' },
  { id: 'U9', bit: 9, trigger: 'Sell or Stockpile a gem', unlocks: 'Gem Cutter', scope: 'v1' },
  { id: 'U10', bit: 10, trigger: 'Reach 3,275 ft', unlocks: 'Mk III belts, drills and lifts; Magma Tap; Expansion III', scope: 'v1' },
  { id: 'U11', bit: 11, trigger: 'Reveal a Methane cell', unlocks: 'Gas Tap', scope: 'v1' },
];

// ---------------------------------------------------------------- buildings (02 §3.1)

export const MVP_KINDS = ['belt', 'router', 'bin', 'smelter', 'assembler', 'export', 'headframe', 'autoDrill', 'lift'] as const;
export const V1_KINDS = [
  'silo',
  'depot',
  'chute',
  'shoring',
  'lamp',
  'refinery',
  'podWorks',
  'gemCutter',
  'coopGenerator',
  'solarArray',
  'powerPlant',
  'magmaTap',
  'gasTap',
] as const;
export type BuildingKind = (typeof MVP_KINDS)[number] | (typeof V1_KINDS)[number];

/** Where a piece sits (02 §2.3): Yard building, underground floor mount, wall mount, or pod-blocking occupant. */
export type Layer = 'yard' | 'floor' | 'wall' | 'occupant';

export interface ItemStack {
  /** Item registry id (src/factory/items.ts), e.g. 'copperOre', 'gear', 'kit:belt'. */
  item: string;
  n: number;
}

export interface MkSpec {
  mk: 1 | 2 | 3;
  /** Yard crane price in dollars (belts: per tile). 0 for Kit-only pieces. */
  cash: number;
  /** Stockpile parts taken with the cash (surface). */
  parts: readonly ItemStack[];
  /** Cargo Kit id that builds it underground (registry item `kit:<id>`), or null when it is surface-only. */
  kit: string | null;
  /** Nameplate draw in kW (v1 power; MVP keeps it hidden, 02 §6.1). Lifts: per started 16 rows. */
  kw: number;
  rung: Rung;
  scope: Scope;
}

export interface BuildingDef {
  kind: BuildingKind;
  /** Stable u8 save code. Never renumber. */
  num: number;
  name: string;
  /** Layer on the Yard, or null if it cannot go there. */
  yard: Layer | null;
  /** Layer underground, or null if it cannot go there. */
  mine: Layer | null;
  /** Footprint (lift and chute: 1 × column height, set at placement). */
  w: number;
  h: number;
  /** Rotatable on the Yard: its facing edge is an output port (02 §2.2). Underground ports are fixed by rule (§2.3). */
  rotates: boolean;
  mks: readonly MkSpec[];
  scope: Scope;
}

const NO_PARTS: readonly ItemStack[] = [];
const mkI = (cash: number, kit: string | null, kw: number, rung: Rung, scope: Scope = 'mvp'): MkSpec => ({ mk: 1, cash, parts: NO_PARTS, kit, kw, rung, scope });
const mkN = (mk: 2 | 3, cash: number, parts: readonly ItemStack[], kit: string | null, kw: number, rung: Rung): MkSpec => ({ mk, cash, parts, kit, kw, rung, scope: 'v1' });
const p = (item: string, n: number): ItemStack => ({ item, n });

/** Yard buildings whose facing edge is an output (belts face their travel direction). */
const ROTATES: readonly BuildingKind[] = ['belt', 'bin', 'smelter', 'assembler', 'silo', 'refinery', 'gemCutter'];

function def(kind: BuildingKind, num: number, name: string, yard: Layer | null, mine: Layer | null, w: number, h: number, mks: readonly MkSpec[]): BuildingDef {
  return { kind, num, name, yard, mine, w, h, rotates: ROTATES.includes(kind), mks, scope: mks[0].scope };
}

/** 02 §3.1 master table. Costs: Yard crane cash + parts; underground pieces come from Kits (Shed prices in the item registry). */
export const BUILDINGS: Readonly<Record<BuildingKind, BuildingDef>> = {
  belt: def('belt', 1, 'Belt', 'yard', 'floor', 1, 1, [
    mkI(5, 'belt', 0, 'U2'),
    mkN(2, 40, [p('gear', 1)], 'belt2', 0, 'U8'),
    mkN(3, 150, [p('gear', 1), p('wire', 1)], 'belt3', 0, 'U10'),
  ]),
  router: def('router', 2, 'Router', 'yard', 'floor', 1, 1, [mkI(40, 'router', 0, 'U3')]),
  bin: def('bin', 3, 'Storage Bin', 'yard', null, 2, 2, [mkI(250, null, 0, 'U2')]),
  smelter: def('smelter', 4, 'Smelter', 'yard', null, 2, 2, [mkI(300, null, 3, 'U2')]),
  assembler: def('assembler', 5, 'Assembler', 'yard', null, 2, 2, [mkI(500, null, 3, 'U3')]),
  export: def('export', 6, 'Export Terminal', 'yard', null, 2, 2, [mkI(400, null, 1, 'U3')]),
  headframe: def('headframe', 7, 'Headframe', 'yard', null, 2, 2, [mkI(200, null, 0, 'U2')]),
  autoDrill: def('autoDrill', 8, 'Auto-Drill', null, 'occupant', 2, 2, [
    mkI(0, 'autoDrill', 3, 'U2'),
    mkN(2, 0, NO_PARTS, 'autoDrill2', 6, 'U8'),
    mkN(3, 0, NO_PARTS, 'autoDrill3', 10, 'U10'),
  ]),
  lift: def('lift', 9, 'Bucket Lift', null, 'wall', 1, 1, [
    mkI(0, 'liftFoot', 1, 'U2'),
    mkN(2, 0, NO_PARTS, 'liftFoot2', 1, 'U8'),
    mkN(3, 0, NO_PARTS, 'liftFoot3', 1, 'U10'),
  ]),
  // ---- v1 (declared so saves, UI and render can name them; placement answers E_LOCKED in the MVP) ----
  silo: def('silo', 10, 'Silo', 'yard', null, 3, 3, [{ ...mkI(6_000, null, 0, 'U8', 'v1'), parts: [p('hullPlate', 10)] }]),
  depot: def('depot', 11, 'Depot', null, 'occupant', 3, 2, [mkI(0, 'depot', 2, 'U6', 'v1')]),
  chute: def('chute', 12, 'Chute', null, 'wall', 1, 1, [mkI(0, 'chute', 0, 'U6', 'v1')]),
  shoring: def('shoring', 13, 'Shoring Brace', null, 'wall', 1, 1, [mkI(0, 'shoring', 0, 'U6', 'v1')]),
  lamp: def('lamp', 14, 'Lamp', null, 'wall', 1, 1, [mkI(0, 'lamp', 0, 'U6', 'v1')]),
  refinery: def('refinery', 15, 'Refinery', 'yard', null, 2, 2, [{ ...mkI(2_500, null, 3, 'U7', 'v1'), parts: [p('hullPlate', 4)] }]),
  podWorks: def('podWorks', 16, 'Pod Works', 'yard', null, 3, 3, [{ ...mkI(12_000, null, 6, 'U8', 'v1'), parts: [p('motor', 6), p('circuit', 4)] }]),
  gemCutter: def('gemCutter', 17, 'Gem Cutter', 'yard', null, 2, 2, [{ ...mkI(20_000, null, 5, 'U9', 'v1'), parts: [p('drillBit', 6), p('circuit', 2)] }]),
  coopGenerator: def('coopGenerator', 18, 'Co-op Generator', 'yard', null, 2, 2, [mkI(0, null, -10, 'U0', 'v1')]),
  solarArray: def('solarArray', 19, 'Solar Array', 'yard', null, 2, 2, [mkI(1_500, null, -4, 'U2', 'v1')]),
  powerPlant: def('powerPlant', 20, 'Power Plant', 'yard', null, 2, 2, [{ ...mkI(6_000, null, -20, 'U7', 'v1'), parts: [p('motor', 4), p('coolantCoil', 2)] }]),
  magmaTap: def('magmaTap', 21, 'Magma Tap', null, 'occupant', 2, 2, [mkI(0, 'magmaTap', -60, 'U10', 'v1')]),
  gasTap: def('gasTap', 22, 'Gas Tap', null, 'occupant', 2, 2, [mkI(0, 'gasTap', 4, 'U11', 'v1')]),
};

/** Lift Rail Kit: one per further ≤ 32 rows above the foot section (02 §2.6, §3.4). */
export const LIFT_RAIL_KIT = 'liftRail';
/** Metered Kits (02 §2.6): units per Kit. A belt run uses one unit per tile. Others are whole Kits (1). */
export const KIT_METER: Readonly<Record<string, number>> = { belt: 8, belt2: 8, belt3: 8, lamp: 4, chute: 16 };
/** Units in one Kit of `kitId` (1 for unmetered Kits). */
export function kitUnits(kitId: string): number {
  return KIT_METER[kitId] ?? 1;
}

/** Yard Expansion prices by step (canon §3.1): I (MVP, U2), II (v1, U8), III (v1, U10). */
export const YARD_EXPANSIONS: readonly { rows: number; cash: number; rung: Rung; scope: Scope }[] = [
  { rows: 16, cash: 2_500, rung: 'U2', scope: 'mvp' },
  { rows: 24, cash: 25_000, rung: 'U8', scope: 'v1' },
  { rows: 32, cash: 250_000, rung: 'U10', scope: 'v1' },
];

// ---------------------------------------------------------------- results and errors (02 §2.5, §10.10)

export type ErrCode =
  | 'E_LOCKED'
  | 'E_YARD'
  | 'E_OCCUPIED'
  | 'E_SOLID'
  | 'E_UNSEEN'
  | 'E_FLOOR'
  | 'E_LODE'
  | 'E_HEAT' // v1
  | 'E_DEPOT' // v1
  | 'E_POD'
  | 'E_COLUMN'
  | 'E_ARENA'
  | 'E_FUNDS'
  | 'E_PARTS'
  | 'E_KIT'
  | 'E_STOCKPILE_FULL'
  | 'E_SERVED' // v1
  | 'E_PACKS' // v1
  | 'E_BLOCKED' // v1
  /** Unknown id, wrong building kind, or malformed arguments. */
  | 'E_INVALID'
  /** A cap: 256 ghost jobs, 32,767 entities, the last Yard expansion. */
  | 'E_LIMIT'
  /** Undo / redo with nothing to apply. */
  | 'E_EMPTY';

/** Failure: nothing changed. Detail fields feed the 03 §6.2 toasts ("Need $n more", "Shaft blocked at row r"). */
export interface Err {
  ok: false;
  code: ErrCode;
  /** E_COLUMN / E_SOLID / E_UNSEEN …: first failing cell. */
  x?: number;
  y?: number;
  /** E_FUNDS: dollars short; E_PARTS / E_KIT: units short of `item`. */
  need?: number;
  /** E_PARTS: part item id; E_KIT: cargo Kit id. */
  item?: string;
  /** E_LOCKED: the rung that unlocks it. */
  rung?: Rung;
}
export type Ok<T = object> = { ok: true } & T;
export type Res<T = object> = Ok<T> | Err;

// ---------------------------------------------------------------- ports (04 §3.1)

export type DebitReason = 'build' | 'yard';
export type CreditReason = 'export' | 'refund';

/** The World's wallet. `debit` returns false (and changes nothing) when cash is short. */
export interface FactoryWallet {
  cash(): number;
  debit(n: number, reason: DebitReason): boolean;
  credit(n: number, reason: CreditReason): void;
}

export interface FactoryPorts {
  /**
   * The mine grid. The factory reads terrain, flags (SEEN) and lodes, and writes `mount`, `occupant` and the
   * F.ANCHORED flag, touching chunks so remeshing follows (04 §4.1).
   */
  grid: TerrainGrid;
  wallet: FactoryWallet;
  emit(e: GameEvent): void;
}

/** Pod cargo as a Kit source for `completeGhost`. Units: whole Kits, or meter units for metered Kits (KIT_METER). */
export interface KitSource {
  count(kitId: string): number;
  take(kitId: string, n: number): void;
}

/**
 * Pod cargo as a Kit refund target (deconstruct; 02 §2.7: pod within 2 tiles with a free slot; metered Kits merge).
 * `canPut` must not change anything; `put` is called only after `canPut` said yes.
 */
export interface KitSink {
  canPut(kitId: string, n: number): boolean;
  put(kitId: string, n: number): void;
}

/** The pod's collision box in world units (x right, y up; y = 0 at the Rim). */
export interface PodBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface FactoryOptions {
  scope: Scope;
  /** Dot's survey shaft column (canon §3.2 pass 5); the U0 survey set stands over it. */
  surveyColumn: number;
  /** Id of the scripted Copper lode in grid.lodes. */
  scriptedLodeId: number;
  /** Purchased Yard rows at a new game (default 8). */
  yardRows?: number;
  /** SIM_NO_SLEEP (02 §10.8): keep every entity awake. Must give identical state hashes. */
  noSleep?: boolean;
  /** Check the conservation invariant every tick (02 §10.7) and throw on a violation. */
  checkInvariants?: boolean;
}

// ---------------------------------------------------------------- commands

/** Underground ghost jobs (02 §2.6). A lift ghost becomes one foot job plus one job per Lift Rail. */
export type GhostSpec =
  | { kind: 'belt'; mk?: 1 | 2 | 3; x: number; y: number; dir: Dir; length: number }
  | { kind: 'router'; x: number; y: number }
  | { kind: 'autoDrill'; mk?: 1 | 2 | 3; x: number; y: number }
  | { kind: 'lift'; mk?: 1 | 2 | 3; x: number; foot: number; top: number };

export type RouterMode = 'even' | 'overflow' | 'filter';

export interface DeconstructOptions {
  /** Underground: offer the Kit to the pod first (pod within 2 tiles, free slot); else it goes to the Stockpile. */
  toCargo?: KitSink;
}

// ---------------------------------------------------------------- views (read-only; 04 §3.3)

export type EntStatus = 'working' | 'idle' | 'blocked' | 'noRecipe' | 'noOutput';

export interface EntityView {
  readonly id: number;
  readonly kind: BuildingKind;
  readonly mk: number;
  readonly plane: Plane;
  /** Footprint min corner (lift: x, top row; h = rows). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly dir: Dir;
  readonly status: EntStatus;
  /** Recipe id ('S2', 'A1', …) of the running craft, else of the buffer; null when none. */
  readonly recipe: string | null;
  /** Craft / drill progress 0..1. */
  readonly progress: number;
  /** Survey-set skin (02 §2.2). Works normally. */
  readonly rusted: boolean;
}

export interface GhostView {
  readonly id: number;
  readonly kind: BuildingKind;
  readonly mk: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly dir: Dir;
  /** Lift jobs: the foot section or a rail section. */
  readonly part: 'foot' | 'rail' | null;
  /** Kit the job consumes and how many units (02 §2.6). */
  readonly kit: string;
  readonly kitUnits: number;
  /** Creation order: jobs complete oldest first. */
  readonly order: number;
}

/**
 * Belt items, filled into reusable arrays (no per-frame allocation). Position (x, y) is in cell units of its plane
 * (cell centre = c + 0.5) at the last tick; (dx, dy) is the displacement over the next tick, already clamped so an
 * item never passes the one ahead or the line head. Render at (x + dx·α_f, y + dy·α_f) (04 §3.3).
 */
export interface BeltItemsView {
  count: number;
  plane: Uint8Array; // 0 yard, 1 mine
  item: Uint16Array; // item registry num
  x: Float32Array;
  y: Float32Array;
  dx: Float32Array;
  dy: Float32Array;
}

/** Lift buckets: items in flight and on the lip. `row` is continuous (foot = foot row), `dRow` per tick (≤ 0). */
export interface LiftBucketsView {
  count: number;
  lift: Uint16Array;
  item: Uint16Array;
  x: Float32Array;
  row: Float32Array;
  dRow: Float32Array;
}

/** Optional cull rectangle for view fills (camera rect + 1 chunk, 04 §3.3). */
export interface ViewRect {
  plane: Plane;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface InspectView {
  id: number;
  kind: BuildingKind;
  status: EntStatus;
  recipe: string | null;
  /** Input buffer / storage contents. */
  contents: ItemStack[];
  /** Output buffer (machines, drills, Headframe, Export queue). */
  output: ItemStack[];
  /** Lift: items in flight; others 0. */
  inFlight: number;
  /** Router mode and filter; Bin unload filter. */
  routerMode: RouterMode | null;
  filter: string | null;
}

export interface RecipeView {
  id: string;
  machine: 'smelter' | 'assembler' | 'refinery' | 'gemCutter';
  inputs: readonly ItemStack[];
  outputs: readonly ItemStack[];
  ticks: number;
  unlocked: boolean;
}

// ---------------------------------------------------------------- the factory

export interface FactoryApi {
  readonly scope: Scope;
  /** Ticks simulated (20 Hz). */
  readonly tickNo: number;
  /** Bumped by every structure change (entities, belts, ghosts); render rebuilds instances when it moves. */
  readonly topologyVersion: number;
  readonly yardRows: number;
  readonly away: boolean;

  // ---- simulation ----
  tick(): void;
  /** FNV-1a 32 over FENT, FLIN, FINV, FQUE (02 §10.9). */
  stateHash(): number;
  serialize(): Uint8Array;

  // ---- structure commands (all-or-nothing; one undo step each) ----
  /** Yard crane (02 §2.6): validate, debit cash, take parts, create. `belt` paints one tile (id 0); prefer paintBelts. */
  place(kind: BuildingKind, mk: number, x: number, y: number, dir: Dir): Res<{ id: number }>;
  /** Yard belts along a 4-connected path; straight crossings become Junctions, T's become Routers (02 §2.1). */
  paintBelts(path: readonly Cell[], mk: number, endDir?: Dir): Res<{ cost: number; tiles: number }>;
  /** Remove belt tiles (Bulldoze; 02 §2.7 refunds). */
  removeBelts(plane: Plane, cells: readonly Cell[], opts?: DeconstructOptions): Res<{ refund: number }>;
  placeGhost(spec: GhostSpec): Res<{ ids: number[] }>;
  removeGhost(id: number): Res;
  /** From the pod step: validate (E_POD included), take the Kit, build and write the grid in one call. */
  completeGhost(id: number, pod: PodBox, cargo: KitSource): Res<{ id: number }>;
  deconstruct(id: number, opts?: DeconstructOptions): Res<{ refund: number }>;
  setRecipe(id: number, recipe: string | null): Res;
  setRouterMode(id: number, mode: RouterMode, opts?: { primary?: Dir; filter?: string }): Res;
  setUnloadFilter(id: number, item: string | null): Res;
  expandYard(): Res<{ rows: number }>;
  undo(): Res;
  redo(): Res;
  readonly canUndo: boolean;
  readonly canRedo: boolean;

  // ---- validators (red-ghost preview; same rules as the commands) ----
  canPlace(kind: BuildingKind, mk: number, x: number, y: number, dir: Dir): Err | null;
  canPlaceGhost(spec: GhostSpec): Err | null;

  // ---- world hooks ----
  discoverLode(id: number, purityKnown: boolean): void;
  /**
   * Is lode `id`'s purity known (02 §3.6)? Set at discovery for fixed-purity lodes or with a Dowser-or-better
   * scan (World), and by the lode's first drilled ore. Until then the map and inspect show "?".
   */
  purityKnown(id: number): boolean;
  tileChanged(cells: readonly Cell[]): void;
  /** World-driven rungs (U1 at r32; v1 depth rungs). Idempotent. */
  unlockRung(rung: Rung): void;
  isUnlocked(rung: Rung): boolean;
  /** MVP: the factory sleeps while away (02 §8). */
  setAway(on: boolean): void;

  // ---- Stockpile (all Bins; canon §2.8) ----
  stockpileCount(item: string): number;
  stockpileItems(): ItemStack[];
  stockpileFree(): number;
  stockpileTake(bill: readonly ItemStack[]): Res;
  stockpilePut(items: readonly ItemStack[]): Res;
  /** Garage adapter (economy PartsLedger). */
  partsLedger(): PartsLedger;

  // ---- views ----
  entity(id: number): EntityView | null;
  entities(): readonly EntityView[];
  ghosts(): readonly GhostView[];
  inspect(id: number): InspectView | null;
  recipes(machine: RecipeView['machine']): RecipeView[];
  /** Belt word layer of a plane (04 §4.1 layout: bit 15 present, 14 junction, tierA 12–13, dirA 10–11, tierB 8–9, dirB 6–7). */
  beltWords(plane: Plane): Readonly<Uint16Array>;
  /** Yard building ids per cell (y × 48 + x). */
  yardBuildings(): Readonly<Uint16Array>;
  fillBeltItems(out: BeltItemsView, rect?: ViewRect): void;
  fillLiftBuckets(out: LiftBucketsView, rect?: ViewRect): void;
  /** Items per minute leaving a belt line's head over the last 60 s (logistics overlay). */
  beltFlowAt(plane: Plane, x: number, y: number): number;
  /** Suggested onboarding jobs on the scripted lode (Place drill / Route to surface; 01 §2.5). */
  surveyPlan(): { drill: Cell; lift: { x: number; foot: number; top: number } };

  // ---- appended (MVP review round 2) ----
  /**
   * Would `completeGhost(id, pod, cargo)` succeed now? The same checks, nothing changes (the pod's build ring
   * re-checks a held refusal with it, e.g. E_POD until Pip steps out of the footprint).
   */
  canCompleteGhost(id: number, pod: PodBox, cargo: KitSource): Err | null;
  /**
   * Bumped whenever a command records an undo step (02 §2.7; not by undo / redo themselves). A command that
   * returns ok without moving it changed nothing: a no-op stroke, the same recipe again. Session only, from 0.
   */
  readonly historyVersion: number;
}

export type { PartId, PartsLedger };
