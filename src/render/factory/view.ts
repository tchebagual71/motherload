// Factory rendering from the read-only views (04 §3.3, §5.1, §5.3; 03 §8.6–8.7, §8.11; canon §3.1):
// instanced buildings, belts (decks, corners, Junctions, scrolling chevrons), Auto-Drills, Bucket Lifts, items on
// belts and in buckets, status bubbles, smoke, and the build overlays (ghost jobs, the armed tool's preview, belt
// paint path, bulldoze tint, selection outline, cursor marker, underground ghost highlight; 03 §4.3, §4.9–4.10).
//
// Structure (instance matrices, piece lists) is rebuilt only when factory.topologyVersion moves; per-tick state
// (working, status, tints) rewrites the small hfInst buffers; moving things (items, buckets, sheaves, bits,
// smoke, bubbles) are placed per frame for the camera rect only. No per-frame allocation.
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, PlaneGeometry, type Material } from 'three';
import { FACTORY_HZ, MINE_H, MINE_W } from '../../shared/canon';
import {
  BUILDINGS,
  YARD_MAX_ROWS,
  type BeltItemsView,
  type BuildingKind,
  type Cell,
  type Dir,
  type EntityView,
  type FactoryApi,
  type GhostView,
  type LiftBucketsView,
  type Plane,
  type ViewRect,
} from '../../factory/api';
import { F, T, type Look } from '../../shared/types';
import type { TerrainGrid } from '../../terrain/grid';
import type { BuildFrame } from '../api';
import type { CameraPose, Vec3 } from '../camera';
import { LAYER_LATE, type MaterialKit } from '../materials';
import { INST_TINT } from '../materials/glsl';
import { ROLE } from '../palette';
import { SHAPE_CORNER, SHAPE_JUNCTION, beltTiles, pathTiles, type BeltTile } from './belts';
import { buildItemTable, type ItemTable } from './itemLooks';
import {
  BELT_DECK_TOP,
  CHEVRON_Y,
  HEADFRAME_SHEAVE_Z,
  LIFT_Z,
  MINE_BELT_SCALE_Y,
  SHEAVE_R,
  SHEAVE_Y,
  SMELTER_CHIMNEY,
  TINTED_SHAPES,
  assemblerGeometry,
  autoDrillGeometry,
  beltCornerGeometry,
  beltJunctionGeometry,
  beltStraightGeometry,
  binGeometry,
  bucketGeometry,
  chevronGeometry,
  drillBitGeometry,
  exportGeometry,
  headframeGeometry,
  itemGeometry,
  liftFootGeometry,
  liftHeadGeometry,
  liftRailGeometry,
  liftStrandGeometry,
  liftTieGeometry,
  routerGeometry,
  sheaveGeometry,
  smelterGeometry,
  smokeGeometry,
} from './models';
import { BUBBLE_GLYPH, GHOST_ALPHA, GHOST_STYLE, INVALID_HEX, OVERLAY_HEX, createBubbleMaterial, createGhostMaterial, createGlyphAtlas, overlayMaterial } from './overlayMaterials';
import { PieceMesh } from './pieceMesh';
import { rayBox } from './projection';

/** Pieces built from the structure (topology). */
const STATIC_PIECES = [
  'belt',
  'beltCorner',
  'junction',
  'chevron',
  'router',
  'bin',
  'smelter',
  'assembler',
  'export',
  'headframe',
  'autoDrill',
  'liftRail',
  'liftTie',
  'liftStrand',
  'liftFoot',
  'liftHead',
] as const;
type StaticPiece = (typeof STATIC_PIECES)[number];
/** Pieces a ghost or preview can show. */
const GHOST_PIECES = ['belt', 'beltCorner', 'junction', 'router', 'bin', 'smelter', 'assembler', 'export', 'headframe', 'autoDrill', 'liftRail', 'liftFoot', 'liftHead'] as const;
type GhostPiece = (typeof GHOST_PIECES)[number];
/** Pieces whose instances are entities (per-tick state). */
const ENTITY_PIECES: readonly StaticPiece[] = ['router', 'bin', 'smelter', 'assembler', 'export', 'headframe', 'autoDrill', 'liftRail', 'liftTie', 'liftStrand', 'liftFoot', 'liftHead'];
const BELT_PIECES: readonly StaticPiece[] = ['belt', 'beltCorner', 'junction', 'chevron'];

const GEOMETRY: Readonly<Record<StaticPiece, () => BufferGeometry>> = {
  belt: beltStraightGeometry,
  beltCorner: beltCornerGeometry,
  junction: beltJunctionGeometry,
  chevron: chevronGeometry,
  router: routerGeometry,
  bin: binGeometry,
  smelter: smelterGeometry,
  assembler: assemblerGeometry,
  export: exportGeometry,
  headframe: headframeGeometry,
  autoDrill: autoDrillGeometry,
  liftRail: liftRailGeometry,
  liftTie: liftTieGeometry,
  liftStrand: liftStrandGeometry,
  liftFoot: liftFootGeometry,
  liftHead: liftHeadGeometry,
};

/** Yard rows in the belt word layer (row 0 is the Rim strip). */
const YARD_ROWS = YARD_MAX_ROWS + 1;
/** Status order of EntStatus (factory/api). */
const STATUS_INDEX: Readonly<Record<string, number>> = { working: 0, idle: 1, blocked: 2, noRecipe: 3, noOutput: 4 };
/** Bucket speed by Mk (02 §3.4: 40/3, 8, 5 ticks per row → 1.5 / 2.5 / 4 rows/s); sheaves and empties follow it. */
const LIFT_TICKS_PER_ROW = [40 / 3, 8, 5] as const;
function liftRowsPerS(mk: number): number {
  return FACTORY_HZ / LIFT_TICKS_PER_ROW[Math.max(0, Math.min(2, mk - 1))];
}
const DRILL_SPIN = 9;
const ITEM_BOB = 0.01;
/** Empty buckets on the down strand, every this many rows. */
const EMPTY_BUCKET_ROWS = 2;
const BUCKET_SCALE = 1.3;
/** Item caps per tier (canon §3.14). */
export const ITEM_CAP = { low: 1500, mid: 4000, high: 6000 } as const;
/** Machines whose bubbles say "no input" when idle (03 §4.10). */
const STARVES: ReadonlySet<BuildingKind> = new Set<BuildingKind>(['smelter', 'assembler']);
const BUBBLE_KINDS: ReadonlySet<BuildingKind> = new Set<BuildingKind>(['smelter', 'assembler', 'export', 'headframe', 'autoDrill', 'lift', 'router']);
/** Yard heights for picking and bubbles (canon §3.1: ≤ 1.6, Headframes ≤ 3). */
const YARD_TOP: Partial<Record<BuildingKind, number>> = { router: 0.48, bin: 1.55, smelter: 1.62, assembler: 1.6, export: 1.32, headframe: 2.72 };
const BUBBLE_SIZE = 0.62;
/** Jam-head markers drawn at most (Logistics overlay), and how long a head must stay stopped to count. */
const MAX_JAMS = 64;
const JAM_HOLD_MS = 600;
/** Working-machine light (03 §8.8) and how far from the pod it is still worth a lamp slot. */
const MACHINE_LAMP_R = 1.5;
const LAMP_REACH = 14;

const ROLE_HEX: Partial<Record<BuildingKind, number>> = {
  belt: ROLE.logistics,
  router: ROLE.logistics,
  lift: ROLE.logistics,
  headframe: ROLE.logistics,
  autoDrill: ROLE.extraction,
  smelter: ROLE.processing,
  assembler: ROLE.assembly,
  bin: ROLE.storage,
  export: ROLE.storage,
};

/** Yaw that turns a piece's local +x to plane direction d (Yard: S = −z; mine belts run E/W). */
export function dirAngle(d: number): number {
  return (d & 3) * (Math.PI / 2);
}

export interface FactoryFrame {
  factory: FactoryApi;
  grid: TerrainGrid;
  timeMs: number;
  /** Seconds since the last frame. */
  dt: number;
  /** Interpolation between the last factory tick and the next (04 §3.3 α_f). */
  alphaF: number;
  /** The camera on screen (billboards, Pixel Lab snapping). */
  pose: CameraPose;
  /** Visible cells per plane (+ margin), or null when that plane is off screen. */
  yardRect: ViewRect | null;
  mineRect: ViewRect | null;
  build: BuildFrame | null;
  /** Underground job the pod is completing now. */
  ghostProgress: { id: number; progress: number } | null;
  /** Pixel Lab: world units per RT texel (moving pieces snap to it); 0 = no snapping. */
  texel: number;
  /** False with reduced motion or battery mode: machines hold still (03 §7, 04 §5.8). */
  animate: boolean;
  /** Item cap (canon §3.14) and working Smelters that may smoke (03 §8.10). */
  itemCap: number;
  smokeCap: number;
}

/** Cell bounds of a mesh's instances on one plane (culling: canon §3.14 draw budget). */
interface CellBounds {
  on: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface PlaneBounds {
  yard: CellBounds;
  mine: CellBounds;
}
function newBounds(): PlaneBounds {
  return { yard: { on: false, x0: 0, y0: 0, x1: 0, y1: 0 }, mine: { on: false, x0: 0, y0: 0, x1: 0, y1: 0 } };
}
function overlaps(b: CellBounds, r: ViewRect | null): boolean {
  return !!r && b.on && b.x1 >= r.x0 && b.x0 <= r.x1 && b.y1 >= r.y0 && b.y0 <= r.y1;
}

interface HeadframeRef {
  e: EntityView;
  lift: EntityView | null;
  /** World x of the shaft column centre the sheave sits over. */
  sheaveX: number;
  angle: number;
}
interface SpinRef {
  e: EntityView;
  angle: number;
}

function newBeltView(): BeltItemsView {
  const n = 64;
  return { count: 0, plane: new Uint8Array(n), item: new Uint16Array(n), x: new Float32Array(n), y: new Float32Array(n), dx: new Float32Array(n), dy: new Float32Array(n) };
}
function newBucketView(): LiftBucketsView {
  const n = 64;
  return { count: 0, lift: new Uint16Array(n), item: new Uint16Array(n), x: new Float32Array(n), row: new Float32Array(n), dRow: new Float32Array(n) };
}

/** Frame of a unit cell (4 bars) in the xy plane, centred. */
function cellFrameGeometry(inner: number, bar: number): BufferGeometry {
  const h = inner / 2 + bar;
  const i = inner / 2;
  const quads: [number, number, number, number][] = [
    [-h, i, h, h],
    [-h, -h, h, -i],
    [-h, -i, -i, i],
    [i, -i, h, i],
  ];
  const pos: number[] = [];
  for (const [x0, y0, x1, y1] of quads) pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
}

const BRACKET_BARS = 8;

/** Underground ghost highlight cell: a mustard frame with a faint fill (vertex alpha), in the xy plane. */
function highlightGeometry(): BufferGeometry {
  const frame = cellFrameGeometry(0.78, 0.06);
  const fp = frame.getAttribute('position').array as Float32Array;
  const fill = [-0.39, -0.39, 0, 0.39, -0.39, 0, 0.39, 0.39, 0, -0.39, -0.39, 0, 0.39, 0.39, 0, -0.39, 0.39, 0];
  const pos = new Float32Array(fp.length + fill.length);
  pos.set(fp);
  pos.set(fill, fp.length);
  const n = pos.length / 3;
  const col = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 1;
    col[i * 4 + 3] = i < fp.length / 3 ? 0.6 : 0.12;
  }
  frame.dispose();
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 4));
  return g;
}

export class FactoryView {
  readonly root = new Group();
  private readonly solid: Record<StaticPiece, PieceMesh>;
  private readonly ghost: Record<GhostPiece, PieceMesh>;
  private readonly items: PieceMesh[] = [];
  private readonly sheave: PieceMesh;
  private readonly bit: PieceMesh;
  private readonly bucket: PieceMesh;
  private readonly smoke: PieceMesh;
  private readonly bubbles: PieceMesh;
  private readonly highlight: PieceMesh;
  private readonly cursor: Mesh;
  private readonly cursorMat: Material & { color: Color; opacity: number };
  private readonly brackets: Mesh;
  private readonly bracketPos = new Float32Array(BRACKET_BARS * 6 * 3);
  private readonly bracketMat: Material & { opacity: number };
  private readonly ghostMat = createGhostMaterial();
  private readonly bubbleMat;
  private readonly table: ItemTable = buildItemTable();

  private factory: FactoryApi | null = null;
  private topo = -1;
  private ents: readonly EntityView[] = [];
  private ghostJobs: readonly GhostView[] = [];
  private headframes: HeadframeRef[] = [];
  private drills: SpinRef[] = [];
  private lifts: SpinRef[] = [];
  private smelters: EntityView[] = [];
  private bubbleEnts: EntityView[] = [];
  /** Lifts whose row-0 top has a Headframe over it. */
  private readonly framedLifts = new Set<number>();

  private readonly yardItems = newBeltView();
  private readonly mineItems = newBeltView();
  private readonly bucketView = newBucketView();

  private stateHover = -2;
  private stateKeyCell = -2;
  private stateSelected = -2;
  private lastTick = -1;
  private hullsAll = false;
  private hullsSelected = false;
  private look: Look = 'toon';
  private readonly selKey = { id: -1, x: 0, y: 0, w: 0, h: 0 };
  private readonly hiKey = { on: false, kind: '' as string, x0: 0, y0: 0, x1: 0, y1: 0, grid: -1, topo: -1 };
  private readonly hover = { id: -1, key: -1 };
  private readonly itemViews: BeltItemsView[];
  /** Ghost job instances per mesh (kept across frames; the preview is appended after them). */
  private readonly jobCounts = new Map<GhostPiece, number>();
  private jobTopo = -1;
  private jobActive = -2;
  private readonly jobTint: GhostTint = { hex: 0, alpha: 0, style: 0 };
  private readonly previewTint: GhostTint = { hex: 0, alpha: 0, style: 0 };
  private readonly entScratch = { kind: 'belt' as BuildingKind, plane: 'mine' as Plane, x: 0, y: 0, w: 1, h: 1, dir: 0 as Dir };
  private lastPath: readonly Cell[] | null = null;
  private lastPathDir = -1;
  private pathCache: BeltTile[] = [];
  private readonly solo: BeltTile = { x: 0, y: 0, dir: 0, entry: 0, shape: 0, turn: 0, tier: 1, tail: true, head: true, dirB: 0, tailB: false, headB: false };
  private readonly tmp: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly rgb = new Color();
  private readonly bounds = new Map<PieceMesh, PlaneBounds>();
  /** Belt tiles that end a line (plane << 16 | cell): a stopped item there is a jam head (Logistics overlay). */
  private readonly headTiles = new Set<number>();
  /** Jam candidates this frame (stopped items on head tiles) and how long each head has been stopped. */
  private readonly jamKeys = new Int32Array(MAX_JAMS);
  private readonly jamPos = new Float32Array(MAX_JAMS * 3);
  private jams = 0;
  private readonly stuckKeys = new Int32Array(MAX_JAMS).fill(-1);
  private readonly stuckSince = new Float64Array(MAX_JAMS);
  private readonly drillLamp = new Color(ROLE.extraction).multiplyScalar(0.55);

  constructor(private readonly kit: MaterialKit, look: Look) {
    this.itemViews = [this.yardItems, this.mineItems];
    this.root.name = 'factory';
    this.look = look;
    const mat = kit.factory(look);
    const hull = kit.factoryHull();
    this.solid = {} as Record<StaticPiece, PieceMesh>;
    const bases = new Map<StaticPiece, BufferGeometry>();
    for (const p of STATIC_PIECES) {
      const base = GEOMETRY[p]();
      bases.set(p, base);
      const noHull = p === 'chevron' || p === 'liftStrand';
      const m = new PieceMesh(`factory-${p}`, base, mat, noHull ? null : hull, { capacity: p === 'belt' || p === 'chevron' ? 256 : 32 });
      this.solid[p] = m;
      this.root.add(m.mesh);
    }
    this.ghost = {} as Record<GhostPiece, PieceMesh>;
    for (const p of GHOST_PIECES) {
      const m = new PieceMesh(`factory-ghost-${p}`, bases.get(p) as BufferGeometry, this.ghostMat, null, { capacity: 16, colors: true, extra: { hfGhost: 2 } });
      m.mesh.layers.set(LAYER_LATE);
      m.mesh.renderOrder = 8;
      this.ghost[p] = m;
      this.root.add(m.mesh);
    }
    for (const shape of this.table.shapes) {
      const m = new PieceMesh(`factory-item-${shape}`, itemGeometry(shape), mat, hull, { capacity: shape === 'chunk' || shape === 'ingot' ? 512 : 64, colors: TINTED_SHAPES.has(shape) });
      this.items.push(m);
      this.root.add(m.mesh);
    }
    this.sheave = new PieceMesh('factory-sheave', sheaveGeometry(), mat, hull, { capacity: 4 });
    this.bit = new PieceMesh('factory-drill-bit', drillBitGeometry(), mat, hull, { capacity: 4 });
    this.bucket = new PieceMesh('factory-bucket', bucketGeometry(), mat, hull, { capacity: 64 });
    this.smoke = new PieceMesh('factory-smoke', smokeGeometry(), mat, null, { capacity: 16 });
    const atlas = createGlyphAtlas();
    this.bubbleMat = createBubbleMaterial(atlas);
    const quad = new PlaneGeometry(1, 1);
    this.bubbles = new PieceMesh('factory-bubbles', quad, this.bubbleMat, null, { capacity: 16, extra: { hfGlyph: 2 } });
    this.bubbles.mesh.layers.set(LAYER_LATE);
    this.bubbles.mesh.renderOrder = 12;
    const hiMat = overlayMaterial(OVERLAY_HEX.highlight, 1);
    hiMat.vertexColors = true;
    this.highlight = new PieceMesh('factory-cell-highlight', highlightGeometry(), hiMat, null, { capacity: 128 });
    this.highlight.mesh.layers.set(LAYER_LATE);
    this.highlight.mesh.renderOrder = 6;
    for (const m of [this.sheave, this.bit, this.bucket, this.smoke, this.bubbles, this.highlight]) this.root.add(m.mesh);

    const cursorMat = overlayMaterial(OVERLAY_HEX.cursor, 0.9);
    this.cursorMat = cursorMat;
    this.cursor = new Mesh(cellFrameGeometry(0.9, 0.07), cursorMat);
    this.cursor.name = 'factory-cursor';
    this.bracketMat = overlayMaterial(OVERLAY_HEX.select, 0.95);
    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(this.bracketPos, 3));
    this.brackets = new Mesh(bg, this.bracketMat);
    this.brackets.name = 'factory-selection';
    for (const m of [this.cursor, this.brackets]) {
      m.layers.set(LAYER_LATE);
      m.renderOrder = 14;
      m.visible = false;
      m.frustumCulled = false;
      this.root.add(m);
    }
  }

  setLook(look: Look): void {
    this.look = look;
    const mat = this.kit.factory(look);
    for (const p of STATIC_PIECES) this.solid[p].material = mat;
    for (const m of [...this.items, this.sheave, this.bit, this.bucket, this.smoke]) m.material = mat;
    this.applyHulls();
  }

  /** Outline scope (04 §5.5): all factory pieces, or only the selected one (low tier). Toon only. */
  setHulls(all: boolean, selected: boolean): void {
    this.hullsAll = all;
    this.hullsSelected = selected;
    this.kit.uniforms.uHfFactoryHullSel.value = all ? 0 : 1;
    this.applyHulls();
  }

  /** Selected entity whose outline shows under the low-tier scope. */
  private currentSelected: number | null = null;

  private applyHulls(selectedId: number | null = this.currentSelected): void {
    const toon = this.look === 'toon';
    for (const p of STATIC_PIECES) {
      const m = this.solid[p];
      if (!m.hull) continue;
      m.hull.visible = toon && (this.hullsAll || (this.hullsSelected && selectedId !== null && m.refs.some((r) => (r as EntityView | null)?.id === selectedId)));
    }
    for (const m of [...this.items, this.sheave, this.bit, this.bucket]) if (m.hull) m.hull.visible = toon && this.hullsAll;
  }

  /** Bind a factory (null hides everything: M0 builds keep their demo yard). */
  bind(factory: FactoryApi | null): void {
    if (factory === this.factory) return;
    this.factory = factory;
    this.topo = -1;
    this.root.visible = factory !== null;
    if (!factory) this.clear();
  }

  private clear(): void {
    for (const p of STATIC_PIECES) {
      this.solid[p].reset();
      this.solid[p].commit();
    }
    this.ents = [];
    this.ghostJobs = [];
    this.headframes = [];
    this.drills = [];
    this.lifts = [];
    this.smelters = [];
    this.bubbleEnts = [];
  }

  update(fr: FactoryFrame): void {
    const f = fr.factory;
    if (f !== this.factory) this.bind(f);
    if (f.topologyVersion !== this.topo) this.rebuild(f);
    this.cullStatic(fr);
    this.syncState(fr);
    this.placeItems(fr);
    this.placeBuckets(fr);
    this.placeSpinners(fr);
    this.placeSmoke(fr);
    this.placeBubbles(fr);
    this.placeGhosts(fr);
    this.placeOverlays(fr);
    this.ghostMat.uniforms.uTime.value = (fr.timeMs / 1000) % 3600;
    this.kit.uniforms.uHfFactoryBreath.value = fr.animate && this.smelters.length + this.drills.length <= 40 ? 0.03 : 0;
  }

  // ---- structure ---------------------------------------------------------------------------------

  private rebuild(f: FactoryApi): void {
    this.topo = f.topologyVersion;
    for (const p of STATIC_PIECES) {
      this.solid[p].reset();
      const b = this.bounds.get(this.solid[p]) ?? newBounds();
      b.yard.on = false;
      b.mine.on = false;
      this.bounds.set(this.solid[p], b);
    }
    this.ents = f.entities();
    this.ghostJobs = f.ghosts();
    this.headframes = [];
    this.drills = [];
    this.lifts = [];
    this.smelters = [];
    this.bubbleEnts = [];
    this.framedLifts.clear();
    this.headTiles.clear();
    const lifts = this.ents.filter((e) => e.kind === 'lift');
    for (const e of this.ents) {
      if (e.kind !== 'headframe') continue;
      const lift = lifts.find((l) => l.y === 0 && l.x >= e.x && l.x < e.x + e.w) ?? null;
      if (lift) this.framedLifts.add(lift.id);
      this.headframes.push({ e, lift, sheaveX: (lift ? lift.x : e.x) + 0.5, angle: 0 });
    }
    for (const e of this.ents) {
      this.emitEntity(e, this.solid, null);
      if (e.kind === 'autoDrill') this.drills.push({ e, angle: 0 });
      else if (e.kind === 'lift') this.lifts.push({ e, angle: 0 });
      else if (e.kind === 'smelter') this.smelters.push(e);
      if (BUBBLE_KINDS.has(e.kind)) this.bubbleEnts.push(e);
    }
    for (const [plane, rows] of [
      ['yard', YARD_ROWS],
      ['mine', MINE_H],
    ] as const) {
      const tiles = beltTiles(f.beltWords(plane), rows);
      for (const t of tiles) {
        this.emitBelt(t, plane, this.solid, true);
        if (t.head || t.headB) this.headTiles.add((plane === 'mine' ? 1 << 16 : 0) | (t.y * MINE_W + t.x));
      }
    }
    for (const p of STATIC_PIECES) this.solid[p].commit();
    this.stateHover = -2;
    this.jobTopo = -1;
    this.applyHulls();
  }

  /** Emission context of the piece being pushed (kept in fields so the emitters need no closures). */
  private readonly emit = {
    sink: null as Record<string, PieceMesh | undefined> | null,
    ghost: null as GhostTint | null,
    ref: null as unknown,
    plane: 'yard' as Plane,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
  };

  /** Push one piece instance for the current emission context. */
  private put(p: StaticPiece, x: number, y: number, z: number, ry: number, sx = 1, sy = 1, sz = 1): number {
    const c = this.emit;
    const m = c.sink?.[p];
    if (!m) return -1;
    const i = m.push(x, y, z, ry, sx, sy, sz, c.ref);
    if (c.ghost) this.tintGhost(m, i, c.ghost);
    else this.extend(m, c.plane, c.x0, c.y0, c.x1, c.y1);
    return i;
  }

  /** Push the pieces of an entity-shaped footprint into `sink` (solid meshes, or ghosts when `ghost` is set). */
  private emitEntity(
    e: Pick<EntityView, 'kind' | 'plane' | 'x' | 'y' | 'w' | 'h' | 'dir'> & { id?: number },
    sink: Record<StaticPiece, PieceMesh> | Record<GhostPiece, PieceMesh>,
    ghost: GhostTint | null,
    liftPart: 'foot' | 'rail' | null = null,
  ): void {
    const c = this.emit;
    c.sink = sink as Record<string, PieceMesh | undefined>;
    c.ghost = ghost;
    c.ref = ghost ? null : e;
    c.plane = e.plane;
    // Lifts reach row 0 (and the Headframe's sheave above it); Headframes overhang the Rim strip.
    c.x0 = e.x;
    c.y0 = e.kind === 'headframe' ? 0 : e.y;
    c.x1 = e.x + e.w - 1;
    c.y1 = e.y + e.h - 1;
    const def = BUILDINGS[e.kind];
    if (e.plane === 'yard') {
      if (e.kind === 'router') {
        this.put('router', e.x + 0.5, 0, -(e.y + 0.5), 0);
        return;
      }
      if (!(e.kind in GEOMETRY) || e.kind === 'autoDrill' || e.kind === 'belt') return;
      const ry = def.rotates ? dirAngle(e.dir) : 0;
      this.put(e.kind as StaticPiece, e.x + e.w / 2, 0, -(e.y + e.h / 2), ry);
      return;
    }
    switch (e.kind) {
      case 'router':
        this.put('router', e.x + 0.5, -(e.y + 1), 0, 0);
        return;
      case 'autoDrill':
        this.put('autoDrill', e.x + 1, -(e.y + 1), 0, 0);
        return;
      case 'lift': {
        const x = e.x + 0.5;
        const foot = e.y + e.h - 1;
        this.put('liftRail', x, -(foot + 1), 0, 0, 1, e.h, 1);
        if (!ghost) {
          for (let r = e.y + 1; r <= foot; r += 3) this.put('liftTie', x, -(r + 0.5), 0, 0);
          const s0 = -(foot + 1) + 0.56;
          const s1 = e.y === 0 ? (e.id !== undefined && this.framedLifts.has(e.id) ? SHEAVE_Y : 0.35) : -(e.y + 1) + 0.66;
          this.put('liftStrand', x, s0, 0, 0, 1, Math.max(0.01, s1 - s0), 1);
        }
        if (liftPart !== 'rail') this.put('liftFoot', x, -(foot + 1), 0, 0);
        if (e.y > 0 && liftPart === null) this.put('liftHead', x, -(e.y + 1), 0, 0);
        return;
      }
      default:
        return;
    }
  }

  private emitBelt(t: BeltTile, plane: Plane, sink: Record<StaticPiece, PieceMesh> | Record<GhostPiece, PieceMesh>, chevrons: boolean, ghost: GhostTint | null = null): void {
    const mine = plane === 'mine';
    const cx = t.x + 0.5;
    const y0 = mine ? -(t.y + 1) : 0;
    const cz = mine ? 0 : -(t.y + 0.5);
    const sy = mine ? MINE_BELT_SCALE_Y : 1;
    const c = this.emit;
    c.sink = sink as Record<string, PieceMesh | undefined>;
    c.ghost = ghost;
    c.ref = (mine ? 1 << 16 : 0) | (t.y * MINE_W + t.x);
    c.plane = plane;
    c.x0 = c.x1 = t.x;
    c.y0 = c.y1 = t.y;
    if (t.shape === SHAPE_JUNCTION) this.put('junction', cx, y0, cz, 0, 1, sy, 1);
    else if (t.shape === SHAPE_CORNER) this.put('beltCorner', cx, y0, cz, t.turn > 0 ? dirAngle(t.entry) : dirAngle(t.entry + 1), 1, sy, 1);
    else this.put('belt', cx, y0, cz, dirAngle(t.dir), 1, sy, 1);
    if (!chevrons) return;
    const cy = y0 + CHEVRON_Y * sy;
    if (t.shape === SHAPE_JUNCTION) {
      this.chevron(cx, cy, cz, sy, t.dir, t.tail, t.head, 0);
      this.chevron(cx, cy, cz, sy, t.dirB, t.tailB, t.headB, 0);
    } else if (t.shape === SHAPE_CORNER) {
      this.chevron(cx, cy, cz, sy, t.entry, t.tail, t.head, t.turn);
    } else {
      this.chevron(cx, cy, cz, sy, t.dir, t.tail, t.head, 0);
    }
  }

  /** A chevron pair for one belt slot (hfInst: tail fade, head fade, tint, turn). */
  private chevron(cx: number, cy: number, cz: number, sy: number, dir: number, tail: boolean, head: boolean, turn: number): void {
    const c = this.emit;
    const ch = this.solid.chevron;
    const i = ch.push(cx, cy, cz, dirAngle(dir), 1, sy, 1, c.ref);
    ch.setInst(i, tail ? 1 : 0, head ? 1 : 0, 0, turn);
    this.extend(ch, c.plane, c.x0, c.y0, c.x1, c.y1);
  }

  private extend(m: PieceMesh, plane: Plane, x0: number, y0: number, x1: number, y1: number): void {
    const pb = this.bounds.get(m);
    if (!pb) return;
    const b = plane === 'yard' ? pb.yard : pb.mine;
    if (!b.on) {
      b.on = true;
      b.x0 = x0;
      b.y0 = y0;
      b.x1 = x1;
      b.y1 = y1;
      return;
    }
    if (x0 < b.x0) b.x0 = x0;
    if (y0 < b.y0) b.y0 = y0;
    if (x1 > b.x1) b.x1 = x1;
    if (y1 > b.y1) b.y1 = y1;
  }

  /** Draw a structure mesh only while its instances' cells meet the camera rect (instancing skips frustum culling). */
  private cullStatic(fr: FactoryFrame): void {
    for (const p of STATIC_PIECES) {
      const m = this.solid[p];
      const b = this.bounds.get(m);
      m.mesh.visible = m.count > 0 && !!b && (overlaps(b.yard, fr.yardRect) || overlaps(b.mine, fr.mineRect));
    }
  }

  // ---- per-tick state ----------------------------------------------------------------------------

  private syncState(fr: FactoryFrame): void {
    const f = fr.factory;
    const b = fr.build;
    const hv = this.hover;
    hv.id = -1;
    hv.key = -1;
    if (b && b.bulldoze && b.cursor) this.hoverAt(f, b.plane, b.cursor);
    const selected = b && b.selectedId !== null ? b.selectedId : -1;
    const tintChanged = hv.id !== this.stateHover || hv.key !== this.stateKeyCell || selected !== this.stateSelected;
    if (!tintChanged && f.tickNo === this.lastTick) return;
    this.stateHover = hv.id;
    this.stateKeyCell = hv.key;
    this.stateSelected = selected;
    this.lastTick = f.tickNo;
    for (const p of ENTITY_PIECES) {
      const m = this.solid[p];
      for (let i = 0; i < m.count; i++) {
        const e = m.refs[i] as EntityView;
        const st = STATUS_INDEX[e.status] ?? 1;
        const tint = e.id === hv.id ? INST_TINT.BULLDOZE : e.id === selected ? INST_TINT.SELECTED : INST_TINT.NONE;
        m.setInst(i, st === 0 ? 1 : 0, e.rusted ? 1 : 0, tint, st);
      }
      m.commitInst();
    }
    if (tintChanged) {
      for (const p of BELT_PIECES) {
        const m = this.solid[p];
        for (let i = 0; i < m.count; i++) m.setTint(i, m.refs[i] === hv.key ? INST_TINT.BULLDOZE : INST_TINT.NONE);
        m.commitInst();
      }
      const sel = selected >= 0 ? selected : null;
      if (sel !== this.currentSelected) {
        this.currentSelected = sel;
        this.applyHulls(sel);
      }
    }
  }

  /** What a bulldoze tap at a cell would remove, into this.hover: an entity id, or a belt cell key. */
  private hoverAt(f: FactoryApi, plane: Plane, c: Cell): void {
    const hv = this.hover;
    if (c.x < 0 || c.x >= MINE_W || c.y < 0) return;
    const cell = c.y * MINE_W + c.x;
    if (plane === 'yard') {
      if (c.y >= YARD_ROWS) return;
      const id = f.yardBuildings()[cell];
      if (id > 0) hv.id = id;
      else if (f.beltWords('yard')[cell] & 0x8000) hv.key = cell;
      return;
    }
    if (c.y >= MINE_H) return;
    for (const e of this.ents) {
      if (e.plane === 'mine' && c.x >= e.x && c.x < e.x + e.w && c.y >= e.y && c.y < e.y + e.h) {
        hv.id = e.id;
        return;
      }
    }
    if (f.beltWords('mine')[cell] & 0x8000) hv.key = (1 << 16) | cell;
  }

  // ---- moving pieces -----------------------------------------------------------------------------

  /** Pixel Lab: move a world point onto the RT texel grid along the camera's right and up (no sub-texel crawl). */
  private snap(p: Vec3, fr: FactoryFrame): void {
    const t = fr.texel;
    if (t <= 0) return;
    const { right: r, up: u } = fr.pose;
    const a = p.x * r.x + p.y * r.y + p.z * r.z;
    const b = p.x * u.x + p.y * u.y + p.z * u.z;
    const da = Math.round(a / t) * t - a;
    const db = Math.round(b / t) * t - b;
    p.x += r.x * da + u.x * db;
    p.y += r.y * da + u.y * db;
    p.z += r.z * da + u.z * db;
  }

  private placeItems(fr: FactoryFrame): void {
    for (const m of this.items) m.reset();
    const f = fr.factory;
    if (fr.yardRect) f.fillBeltItems(this.yardItems, fr.yardRect);
    else this.yardItems.count = 0;
    if (fr.mineRect) f.fillBeltItems(this.mineItems, fr.mineRect);
    else this.mineItems.count = 0;
    const bob = fr.animate ? ITEM_BOB * Math.sin((fr.timeMs / 1000) * Math.PI * 2 * 4) : 0;
    const logistics = fr.build?.overlay === 'logistics';
    this.jams = 0;
    let total = 0;
    for (const view of this.itemViews) {
      for (let k = 0; k < view.count && total < fr.itemCap; k++) {
        const num = view.item[k];
        const fam = this.table.family[num];
        if (fam === undefined || fam === 255) continue;
        if (logistics && view.dx[k] === 0 && view.dy[k] === 0) this.markJam(view.plane[k], view.x[k], view.y[k]);
        const x = view.x[k] + view.dx[k] * fr.alphaF;
        const y = view.y[k] + view.dy[k] * fr.alphaF;
        const p = this.tmp;
        if (view.plane[k] === 0) {
          p.x = x;
          p.y = BELT_DECK_TOP + bob;
          p.z = -y;
        } else {
          p.x = x;
          p.y = -(Math.floor(y) + 1) + BELT_DECK_TOP * MINE_BELT_SCALE_Y + bob;
          p.z = 0;
        }
        this.snap(p, fr);
        const m = this.items[fam];
        const i = m.push(p.x, p.y, p.z, num * 1.3);
        this.tintItem(m, i, num);
        total++;
      }
    }
    this.settleJams(fr.timeMs);
    // Buckets add their loads to the same families (placeBuckets), so commit happens there.
  }

  /**
   * Keep only heads stopped for JAM_HOLD_MS: an item waiting a moment at a machine's input is not a jam. Heads not
   * stopped this frame are forgotten; the survivors are compacted to the front of jamKeys / jamPos for drawing.
   */
  private settleJams(timeMs: number): void {
    const keys = this.stuckKeys, since = this.stuckSince;
    for (let s = 0; s < MAX_JAMS; s++) {
      const k = keys[s];
      if (k < 0) continue;
      let seen = false;
      for (let j = 0; j < this.jams && !seen; j++) seen = this.jamKeys[j] === k;
      if (!seen) keys[s] = -1;
    }
    let shown = 0;
    for (let j = 0; j < this.jams; j++) {
      const k = this.jamKeys[j];
      let slot = -1, free = -1;
      for (let s = 0; s < MAX_JAMS && slot < 0; s++) {
        if (keys[s] === k) slot = s;
        else if (keys[s] < 0 && free < 0) free = s;
      }
      if (slot < 0 && free >= 0) {
        keys[free] = k;
        since[free] = timeMs;
        slot = free;
      }
      if (slot < 0 || timeMs - since[slot] < JAM_HOLD_MS) continue;
      this.jamKeys[shown] = k;
      this.jamPos[shown * 3] = this.jamPos[j * 3];
      this.jamPos[shown * 3 + 1] = this.jamPos[j * 3 + 1];
      this.jamPos[shown * 3 + 2] = this.jamPos[j * 3 + 2];
      shown++;
    }
    this.jams = shown;
  }

  /** A stopped item on a line's last tile is a jam head (03 §4.10 "⊘ at each jam head"). */
  private markJam(plane: number, x: number, y: number): void {
    const cx = Math.floor(x), cy = Math.floor(y);
    const key = (plane === 1 ? 1 << 16 : 0) | (cy * MINE_W + cx);
    if (!this.headTiles.has(key) || this.jams >= MAX_JAMS) return;
    for (let i = 0; i < this.jams; i++) if (this.jamKeys[i] === key) return;
    const j = this.jams++;
    this.jamKeys[j] = key;
    const p = this.jamPos;
    if (plane === 0) {
      p[j * 3] = cx + 0.5;
      p[j * 3 + 1] = 0.8;
      p[j * 3 + 2] = -(cy + 0.5);
    } else {
      p[j * 3] = cx + 0.5;
      p[j * 3 + 1] = -(cy + 1) + 0.75;
      p[j * 3 + 2] = 0.3;
    }
  }

  private tintItem(m: PieceMesh, i: number, num: number): void {
    const rgb = this.table.rgb;
    m.setColor(i, rgb[num * 3], rgb[num * 3 + 1], rgb[num * 3 + 2]);
  }

  private placeBuckets(fr: FactoryFrame): void {
    const f = fr.factory;
    const v = this.bucketView;
    const bk = this.bucket;
    bk.reset();
    if (fr.mineRect && this.lifts.length > 0) f.fillLiftBuckets(v, fr.mineRect);
    else v.count = 0;
    const p = this.tmp;
    for (let k = 0; k < v.count; k++) {
      const row = v.row[k] + v.dRow[k] * fr.alphaF;
      // Loaded buckets climb the −x strand: the cameras look from +x, so the shaft's left half stays in view.
      p.x = v.x[k] - SHEAVE_R - 0.08;
      p.y = -row;
      p.z = LIFT_Z;
      this.snap(p, fr);
      bk.push(p.x, p.y, p.z, 0, BUCKET_SCALE, BUCKET_SCALE, BUCKET_SCALE);
      const num = v.item[k];
      const fam = this.table.family[num];
      if (fam !== undefined && fam !== 255) {
        const m = this.items[fam];
        const i = m.push(p.x, p.y - 0.02, p.z + 0.02, num * 1.3, 0.85, 0.85, 0.85);
        this.tintItem(m, i, num);
      }
    }
    // Empty buckets ride down the other strand, moving while the lift runs.
    const rect = fr.mineRect;
    if (rect) {
      for (const l of this.lifts) {
        const e = l.e;
        if (e.x < rect.x0 || e.x > rect.x1) continue;
        if (e.status === 'working' && fr.animate) l.angle = (l.angle + fr.dt * liftRowsPerS(e.mk)) % EMPTY_BUCKET_ROWS;
        const r0 = Math.max(e.y, rect.y0);
        const r1 = Math.min(e.y + e.h - 1, rect.y1);
        for (let r = r0 - (r0 % EMPTY_BUCKET_ROWS); r <= r1; r += EMPTY_BUCKET_ROWS) {
          const row = r + 0.5 + l.angle;
          if (row < e.y + 0.4 || row > e.y + e.h - 0.4) continue;
          p.x = e.x + 0.5 + SHEAVE_R + 0.08;
          p.y = -row;
          p.z = LIFT_Z;
          this.snap(p, fr);
          const i = bk.push(p.x, p.y, p.z, 0);
          bk.setTRZ(i, p.x, p.y, p.z, Math.PI, BUCKET_SCALE);
        }
      }
    }
    bk.commit();
    for (const m of this.items) m.commit();
  }

  private placeSpinners(fr: FactoryFrame): void {
    const sh = this.sheave;
    sh.reset();
    const p = this.tmp;
    const yr = fr.yardRect;
    for (const h of this.headframes) {
      // Up the −x strand, over the top, down the +x strand: clockwise seen from the front.
      if (fr.animate && h.lift && h.lift.status === 'working') h.angle = (h.angle - (fr.dt * liftRowsPerS(h.lift.mk)) / SHEAVE_R) % (Math.PI * 2);
      if (!yr || h.e.x + 1 < yr.x0 || h.e.x > yr.x1 || yr.y0 > h.e.y + 1) continue;
      const i = sh.push(0, 0, 0, 0, 1, 1, 1, h.e);
      p.x = h.sheaveX;
      p.y = SHEAVE_Y;
      p.z = -(h.e.y + h.e.h / 2) + HEADFRAME_SHEAVE_Z;
      sh.setTRZ(i, p.x, p.y, p.z, h.angle, 1);
    }
    sh.commit();
    const bt = this.bit;
    bt.reset();
    const rect = fr.mineRect;
    for (const d of this.drills) {
      const e = d.e;
      if (!rect || e.x + 2 < rect.x0 || e.x > rect.x1 || e.y + 2 < rect.y0 || e.y > rect.y1) continue;
      if (fr.animate && e.status === 'working') d.angle = (d.angle + fr.dt * DRILL_SPIN) % (Math.PI * 2);
      bt.push(e.x + 1, -(e.y + 1) - 0.15, 0, d.angle, 1, 1, 1, e);
    }
    bt.commit();
  }

  private placeSmoke(fr: FactoryFrame): void {
    const sm = this.smoke;
    sm.reset();
    const rect = fr.yardRect;
    const t = fr.timeMs / 1000;
    const puffs = fr.animate ? 3 : 0;
    let smelters = 0;
    for (const e of this.smelters) {
      if (puffs === 0 || !rect || smelters >= fr.smokeCap) break;
      if (e.status !== 'working' || e.x + 2 < rect.x0 || e.x > rect.x1 || e.y + 2 < rect.y0 || e.y > rect.y1) continue;
      smelters++;
      const ry = dirAngle(e.dir);
      const c = Math.cos(ry), s = Math.sin(ry);
      const lx = SMELTER_CHIMNEY[0], ly = SMELTER_CHIMNEY[1], lz = SMELTER_CHIMNEY[2];
      const ox = e.x + 1 + lx * c + lz * s;
      const oz = -(e.y + 1) - lx * s + lz * c;
      const seed = e.id * 0.37;
      for (let k = 0; k < puffs; k++) {
        const ph = (t / 3.2 + k / puffs + seed) % 1;
        const grow = 0.08 + 0.2 * ph;
        const fade = ph > 0.7 ? (1 - ph) / 0.3 : Math.min(1, ph / 0.08);
        const sc = grow * fade;
        sm.push(ox + 0.3 * ph + 0.04 * Math.sin(t * 2 + k + seed), ly + 1.05 * ph, oz - 0.1 * ph, 0, sc, sc, sc);
      }
    }
    sm.commit();
  }

  private placeBubbles(fr: FactoryFrame): void {
    const bb = this.bubbles;
    bb.reset();
    const { right, up, dir } = fr.pose;
    for (const e of this.bubbleEnts) {
      const st = e.status;
      let glyph = -1;
      if (st === 'blocked') glyph = BUBBLE_GLYPH.FULL;
      else if (st === 'noOutput') glyph = BUBBLE_GLYPH.DISCONNECTED;
      else if (st === 'noRecipe') glyph = BUBBLE_GLYPH.NO_RECIPE;
      else if (st === 'idle' && STARVES.has(e.kind)) glyph = BUBBLE_GLYPH.NO_INPUT;
      if (glyph < 0) continue;
      let x: number, y: number, z: number;
      if (e.plane === 'yard') {
        const rect = fr.yardRect;
        if (!rect || e.x + e.w < rect.x0 || e.x > rect.x1 || e.y + e.h < rect.y0 || e.y > rect.y1) continue;
        x = e.x + e.w / 2;
        y = (YARD_TOP[e.kind] ?? 1.2) + 0.42;
        z = -(e.y + e.h / 2);
      } else {
        const rect = fr.mineRect;
        // A lift is blocked at its top (02 §10.6); the bubble floats over its top cell.
        const top = e.y;
        if (!rect || e.x + e.w < rect.x0 || e.x > rect.x1 || top + 2 < rect.y0 || top > rect.y1) continue;
        if (e.kind === 'lift') {
          x = e.x + 0.5;
          y = e.y === 0 ? 0.7 : -(e.y + 1) + 1.3;
          z = 0.1;
        } else if (e.kind === 'autoDrill') {
          x = e.x + 1;
          y = -(e.y + 1) + 1.42;
          z = 0.3;
        } else {
          x = e.x + 0.5;
          y = -(e.y + 1) + 0.95;
          z = 0.3;
        }
      }
      const i = bb.push(0, 0, 0, 0, 1, 1, 1, e);
      bb.setBasis(i, x, y, z, right, up, dir, BUBBLE_SIZE);
      bb.setExtra('hfGlyph', i, glyph, st === 'blocked' || st === 'noOutput' ? 1 : 0);
    }
    for (let j = 0; j < this.jams; j++) {
      const p = this.jamPos;
      const i = bb.push(0, 0, 0, 0);
      bb.setBasis(i, p[j * 3], p[j * 3 + 1], p[j * 3 + 2], right, up, dir, BUBBLE_SIZE * 0.85);
      bb.setExtra('hfGlyph', i, BUBBLE_GLYPH.JAM, 1);
    }
    bb.commit();
  }

  // ---- ghosts and the armed tool -------------------------------------------------------------------

  private tintGhost(m: PieceMesh, i: number, g: GhostTint): void {
    this.rgb.setHex(g.hex);
    m.setColor(i, this.rgb.r, this.rgb.g, this.rgb.b);
    m.setExtra('hfGhost', i, g.alpha, g.style);
  }

  private placeGhosts(fr: FactoryFrame): void {
    const active = fr.ghostProgress ? fr.ghostProgress.id : -1;
    if (this.jobTopo !== this.topo || this.jobActive !== active) {
      // Queued jobs change only with the structure (or the job being built): emit them once and keep them.
      this.jobTopo = this.topo;
      this.jobActive = active;
      for (const p of GHOST_PIECES) this.ghost[p].reset();
      const tint = this.jobTint;
      for (const g of this.ghostJobs) {
        tint.hex = ROLE_HEX[g.kind] ?? ROLE.logistics;
        tint.alpha = GHOST_ALPHA.job;
        tint.style = g.id === active ? GHOST_STYLE.ACTIVE : GHOST_STYLE.JOB;
        if (g.kind === 'belt') {
          for (let k = 0; k < g.w; k++) this.emitBelt(this.soloTile(g.x + k, g.y, g.dir), 'mine', this.ghost, false, tint);
        } else {
          const e = this.entScratch;
          e.kind = g.kind;
          e.plane = 'mine';
          e.x = g.x;
          e.y = g.y;
          e.w = g.w;
          e.h = g.h;
          e.dir = g.dir;
          this.emitEntity(e, this.ghost, tint, g.part);
        }
      }
      for (const p of GHOST_PIECES) this.jobCounts.set(p, this.ghost[p].count);
    } else {
      for (const p of GHOST_PIECES) this.ghost[p].count = this.jobCounts.get(p) ?? 0;
    }
    const pv = fr.build?.preview;
    if (pv && fr.build) {
      const plane = fr.build.plane;
      const tint = this.previewTint;
      tint.hex = pv.valid ? (ROLE_HEX[pv.kind] ?? ROLE.logistics) : INVALID_HEX;
      tint.alpha = pv.valid ? GHOST_ALPHA.valid : GHOST_ALPHA.invalid;
      tint.style = pv.valid ? GHOST_STYLE.VALID : GHOST_STYLE.INVALID;
      if (pv.kind === 'belt') {
        if (pv.path && pv.path.length > 0) {
          if (pv.path !== this.lastPath || pv.dir !== this.lastPathDir) {
            this.lastPath = pv.path;
            this.lastPathDir = pv.dir;
            this.pathCache = pathTiles(pv.path, pv.dir);
          }
          for (const t of this.pathCache) this.emitBelt(t, plane, this.ghost, false, tint);
        } else {
          const n = Math.max(1, pv.w);
          for (let k = 0; k < n; k++) this.emitBelt(this.soloTile(pv.x + k, pv.y, pv.dir), plane, this.ghost, false, tint);
        }
      } else {
        const e = this.entScratch;
        e.kind = pv.kind;
        e.plane = plane;
        e.x = pv.x;
        e.y = pv.y;
        e.w = pv.w;
        e.h = pv.h;
        e.dir = pv.dir;
        this.emitEntity(e, this.ghost, tint, null);
      }
    }
    for (const p of GHOST_PIECES) this.ghost[p].commit();
  }

  /** A lone straight belt tile (ghost belt runs, previews without a path), reusing one scratch tile. */
  private soloTile(x: number, y: number, dir: Dir): BeltTile {
    const t = this.solo;
    t.x = x;
    t.y = y;
    t.dir = dir;
    t.entry = dir;
    t.dirB = dir;
    return t;
  }

  // ---- cursor, selection, highlight ----------------------------------------------------------------

  private placeOverlays(fr: FactoryFrame): void {
    const b = fr.build;
    const c = b?.cursor ?? null;
    this.cursor.visible = !!(b && c);
    if (b && c) {
      this.cursorMat.color.setHex(b.bulldoze ? OVERLAY_HEX.bulldoze : OVERLAY_HEX.cursor);
      if (b.plane === 'yard') {
        this.cursor.position.set(c.x + 0.5, 0.025, -(c.y + 0.5));
        this.cursor.rotation.set(-Math.PI / 2, 0, 0);
      } else {
        this.cursor.position.set(c.x + 0.5, -(c.y + 0.5), 0.53);
        this.cursor.rotation.set(0, 0, 0);
      }
    }
    this.placeSelection(fr);
    this.placeHighlight(fr);
  }

  private placeSelection(fr: FactoryFrame): void {
    const id = fr.build?.selectedId ?? null;
    const e = id !== null ? fr.factory.entity(id) : null;
    this.brackets.visible = !!e;
    const k = this.selKey;
    if (!e) {
      k.id = -1;
      return;
    }
    this.bracketMat.opacity = 0.8 + 0.2 * Math.sin((fr.timeMs / 1000) * 5);
    if (k.id === e.id && k.x === e.x && k.y === e.y && k.w === e.w && k.h === e.h) return;
    k.id = e.id;
    k.x = e.x;
    k.y = e.y;
    k.w = e.w;
    k.h = e.h;
    // Corner brackets around the footprint: on the plateau (Yard) or the slab front (mine).
    const yard = e.plane === 'yard';
    const pad = 0.1, len = 0.42, bar = 0.11;
    // Yard: v is world z; mine: v is world y. Both run −(y + h) … −y.
    const x0 = e.x - pad, x1 = e.x + e.w + pad;
    const v0 = -(e.y + e.h) - pad;
    const v1 = -e.y + pad;
    const p = this.bracketPos;
    let o = 0;
    const quad = (ax: number, av: number, bx: number, bv: number): void => {
      const pts = [ax, av, bx, av, bx, bv, ax, av, bx, bv, ax, bv];
      for (let k = 0; k < 12; k += 2) {
        if (yard) {
          p[o++] = pts[k];
          p[o++] = 0.03;
          p[o++] = pts[k + 1];
        } else {
          p[o++] = pts[k];
          p[o++] = pts[k + 1];
          p[o++] = 0.54;
        }
      }
    };
    for (const [cx, cv, sx, sv] of [
      [x0, v0, 1, 1],
      [x1, v0, -1, 1],
      [x0, v1, 1, -1],
      [x1, v1, -1, -1],
    ] as const) {
      quad(cx, cv, cx + sx * len, cv + sv * bar);
      quad(cx, cv, cx + sx * bar, cv + sv * len);
    }
    const attr = this.brackets.geometry.getAttribute('position') as BufferAttribute;
    attr.needsUpdate = true;
  }

  /** Underground "ghost highlight": seen, excavated cells where the armed tool may go (03 §4.12). */
  private placeHighlight(fr: FactoryFrame): void {
    const b = fr.build;
    const rect = fr.mineRect;
    const hi = this.highlight;
    // Only an armed tool has somewhere to go (its preview names it).
    if (!b || b.plane !== 'mine' || b.bulldoze || !b.preview || !rect) {
      if (this.hiKey.on) {
        hi.reset();
        hi.commit();
        this.hiKey.on = false;
      }
      return;
    }
    const kind = b.preview?.kind ?? null;
    const k = this.hiKey;
    const kindKey = kind ?? '';
    if (k.on && k.kind === kindKey && k.x0 === rect.x0 && k.y0 === rect.y0 && k.x1 === rect.x1 && k.y1 === rect.y1 && k.grid === fr.grid.version && k.topo === this.topo) return;
    k.on = true;
    k.kind = kindKey;
    k.x0 = rect.x0;
    k.y0 = rect.y0;
    k.x1 = rect.x1;
    k.y1 = rect.y1;
    k.grid = fr.grid.version;
    k.topo = this.topo;
    hi.reset();
    const g = fr.grid;
    const f = fr.factory;
    const cap = 400;
    if (kind === 'autoDrill') {
      for (const lode of g.lodes) {
        if (!lode.discovered || lode.x0 + 3 < rect.x0 || lode.x0 > rect.x1 || lode.top < rect.y0 || lode.top - 2 > rect.y1) continue;
        for (const dx of [0, 1]) {
          const x = lode.x0 + dx;
          if (f.canPlaceGhost({ kind: 'autoDrill', x, y: lode.top - 2 }) !== null) continue;
          for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) hi.push(x + cx + 0.5, -(lode.top - 2 + cy + 0.5), -0.96, 0);
        }
      }
    } else {
      for (let r = Math.max(1, rect.y0); r <= rect.y1 && hi.count < cap; r++) {
        for (let x = rect.x0; x <= rect.x1 && hi.count < cap; x++) {
          if (!this.toolMayGo(g, kind, x, r)) continue;
          hi.push(x + 0.5, -(r + 0.5), -0.96, 0);
        }
      }
    }
    hi.commit();
  }

  private toolMayGo(g: TerrainGrid, kind: BuildingKind | null, x: number, r: number): boolean {
    const i = g.idx(x, r);
    if (g.terrain[i] !== T.AIR || (g.flags[i] & F.SEEN) === 0 || g.occupant[i] !== 0) return false;
    if (kind === 'belt' || kind === 'router') return g.mount[i] === 0 && g.get(x, r + 1) !== T.AIR;
    if (kind === 'lift') return g.mount[i] === 0;
    return g.mount[i] === 0;
  }

  // ---- light -------------------------------------------------------------------------------------

  /**
   * Working underground machines light their surroundings (03 §8.8: r 1.5 in role colour): append the nearest
   * working Auto-Drills to the lamp list after the terrain's own lights. Returns the new lamp count.
   */
  collectLamps(px: number, py: number, count: number, max: number, lamps: { set(x: number, y: number, z: number, w: number): unknown }[], colors: Color[]): number {
    let n = count;
    for (const d of this.drills) {
      if (n >= max) break;
      const e = d.e;
      if (e.status !== 'working') continue;
      const x = e.x + 1, y = -(e.y + 1) + 0.2;
      if (Math.abs(x - px) > LAMP_REACH || Math.abs(y - py) > LAMP_REACH) continue;
      lamps[n].set(x, y, 0, MACHINE_LAMP_R);
      colors[n].copy(this.drillLamp);
      n++;
    }
    return n;
  }

  // ---- picking -----------------------------------------------------------------------------------

  /** Nearest entity whose box the ray enters (plane-restricted when given), or null. */
  pick(o: Vec3, d: Vec3, plane: Plane | null): number | null {
    let best = Infinity;
    let id: number | null = null;
    for (const e of this.ents) {
      if (plane && e.plane !== plane) continue;
      let t: number;
      if (e.plane === 'yard') {
        const top = YARD_TOP[e.kind] ?? 1;
        const reach = e.kind === 'headframe' ? 0.45 : 0;
        t = rayBox(o, d, e.x, 0, -(e.y + e.h), e.x + e.w, top, -e.y + reach);
      } else if (e.kind === 'lift') {
        t = rayBox(o, d, e.x, -(e.y + e.h), -1, e.x + 1, -e.y, 0.5);
      } else if (e.kind === 'router') {
        t = rayBox(o, d, e.x, -(e.y + 1), -0.5, e.x + 1, -(e.y + 1) + 0.6, 0.5);
      } else {
        t = rayBox(o, d, e.x, -(e.y + e.h), -0.5, e.x + e.w, -e.y, 0.5);
      }
      if (t < best) {
        best = t;
        id = e.id;
      }
    }
    return id;
  }

  /** Make every mesh visible for a compile pass (programs for every piece, look and hull). */
  setCompileVisible(on: boolean): void {
    this.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const data = o.userData as { hfWasVisible?: boolean };
      if (on) {
        data.hfWasVisible = o.visible;
        o.visible = true;
      } else if (data.hfWasVisible !== undefined) {
        o.visible = data.hfWasVisible;
        delete data.hfWasVisible;
      }
    });
    if (on) this.root.visible = true;
    else this.root.visible = this.factory !== null;
  }

  /** Draw calls this view adds right now (for budget reports and tests). */
  get drawCalls(): number {
    let n = 0;
    this.root.traverse((o) => {
      if (o instanceof Mesh && o.visible && (o.parent?.visible ?? true)) n++;
    });
    return n;
  }

  dispose(): void {
    for (const p of STATIC_PIECES) this.solid[p].dispose();
    for (const p of GHOST_PIECES) this.ghost[p].dispose();
    for (const m of [...this.items, this.sheave, this.bit, this.bucket, this.smoke, this.bubbles, this.highlight]) m.dispose();
    this.ghostMat.dispose();
    this.bubbleMat.dispose();
    this.cursor.geometry.dispose();
    this.brackets.geometry.dispose();
  }
}

interface GhostTint {
  hex: number;
  alpha: number;
  style: number;
}

