// Factory entity (04 §4.3): one monomorphic record per building; kind-specific fields stay at their defaults
// when unused, so the hot loops see one object shape. PURE MODULE.
import { BUILDINGS, type BuildingDef, type BuildingKind, type Dir, type EntStatus, type EntityView, type Plane, type RouterMode } from './api';
import { Inv, ItemRing, LiftQueue } from './buffers';
import { RECIPES } from './recipes';

/** Q16 fixed point (02 §0.1): s_Q = 65,536 at full power. */
export const Q16 = 65_536;
/** One ore per 1,200 × 100 × 65,536 of drill credit (02 §10.5). */
export const DRILL_UNIT = 1_200 * 100 * Q16;

export const STATUS: readonly EntStatus[] = ['working', 'idle', 'blocked', 'noRecipe', 'noOutput'];
export const ST_WORKING = 0;
export const ST_IDLE = 1;
export const ST_BLOCKED = 2;
export const ST_NO_RECIPE = 3;
export const ST_NO_OUTPUT = 4;

export const ROUTER_MODES: readonly RouterMode[] = ['even', 'overflow', 'filter'];

/** Buffer sizes (02 §3.2). */
export const DRILL_OUT = 4;
export const HEADFRAME_BUF = 4;
export const EXPORT_BUF = 50;
export const BIN_CAP = 200;
/** Ring big enough for every MVP recipe's output cap (Smelter 6, Assembler 2 crafts ≤ 4). */
const CRAFT_OUT_RING = 8;
const MAX_INPUTS = 4;

export class Ent implements EntityView {
  readonly def: BuildingDef;
  statusCode = ST_IDLE;
  rusted = false;
  /** Cash paid at placement (refund basis; the survey set paid $0). */
  paid = 0;

  // ---- crafting (Smelter, Assembler) ----
  /** Recipe of the input buffer (Assembler: player-set; Smelter: set by the first item, 02 §4.2). */
  recipeNum = -1;
  /** Recipe of the craft in progress, or −1. */
  craftNum = -1;
  /** Q16 progress or credit: craft, drill, Export sales. */
  acc = 0;
  readonly inItem: Uint16Array;
  readonly inCount: Uint16Array;
  /** Output buffer (machines, drill, Headframe; Export: its sale queue). */
  readonly out: ItemRing | null;
  /** Storage contents (Bin). */
  readonly inv: Inv | null;

  // ---- ports (rebuilt by the topology pass) ----
  inLines: number[] = [];
  inSides: number[] = [];
  outLines: number[] = [];
  /** Adjacent nodes this one pushes into directly (drill → lift lip, lift top → Headframe or relay foot). */
  pushTo: number[] = [];
  /** Nodes that push into this one directly (woken when it frees space). */
  feeders: number[] = [];
  rrIn = 0;
  rrOut = 0;

  // ---- Router ----
  mode = 0;
  /** Primary Out side for Overflow / Filter, or −1 = straight across from the first In (02 §10.4). */
  primary = -1;
  filter = 0;
  readonly sideIn = new Int32Array(4);
  readonly sideOut = new Int32Array(4);

  // ---- Bin unload port ----
  unload = 0;
  nextAllowedTick = 0;

  // ---- Auto-Drill ----
  lodeId = -1;

  // ---- Bucket Lift (02 §10.6): x, top = y, foot = y + h − 1 ----
  readonly queue: LiftQueue | null;
  lip = 0;
  clock = 0;
  credit = 0;
  transit = 0;
  stalled = false;
  rails = 0;

  /** Did anything this tick (P6 sleep test). */
  active = true;
  /** Session-unique incarnation (ids are reused): undo records name an entity by id and serial. Not saved. */
  serial = 0;

  constructor(
    readonly id: number,
    readonly kind: BuildingKind,
    public mk: number,
    readonly plane: Plane,
    readonly x: number,
    public y: number,
    readonly w: number,
    public h: number,
    readonly dir: Dir,
  ) {
    this.def = BUILDINGS[kind];
    const crafts = kind === 'smelter' || kind === 'assembler';
    this.inItem = new Uint16Array(crafts ? MAX_INPUTS : 0);
    this.inCount = new Uint16Array(crafts ? MAX_INPUTS : 0);
    this.out = makeOut(kind);
    this.inv = kind === 'bin' ? new Inv(BIN_CAP) : null;
    this.queue = kind === 'lift' ? new LiftQueue(8) : null;
  }

  get status(): EntStatus {
    return STATUS[this.statusCode];
  }
  get recipe(): string | null {
    const n = this.craftNum >= 0 ? this.craftNum : this.recipeNum;
    return n >= 0 ? RECIPES[n].id : null;
  }
  get progress(): number {
    if (this.craftNum >= 0) return Math.min(1, this.acc / (RECIPES[this.craftNum].ticks * Q16));
    return this.kind === 'autoDrill' ? Math.min(1, this.acc / DRILL_UNIT) : 0;
  }
  /** Lift foot row. */
  get foot(): number {
    return this.y + this.h - 1;
  }
  covers(x: number, y: number): boolean {
    return x >= this.x && x < this.x + this.w && y >= this.y && y < this.y + this.h;
  }
}

/** Buffers of a node known (by kind) to have them. */
export const outOf = (e: Ent): ItemRing => e.out as ItemRing;
export const invOf = (e: Ent): Inv => e.inv as Inv;
export const queueOf = (e: Ent): LiftQueue => e.queue as LiftQueue;

function makeOut(kind: BuildingKind): ItemRing | null {
  switch (kind) {
    case 'smelter':
    case 'assembler':
      return new ItemRing(CRAFT_OUT_RING);
    case 'autoDrill':
      return new ItemRing(DRILL_OUT);
    case 'headframe':
      return new ItemRing(HEADFRAME_BUF);
    case 'export':
      return new ItemRing(EXPORT_BUF);
    case 'router':
      return new ItemRing(1);
    default:
      return null;
  }
}
