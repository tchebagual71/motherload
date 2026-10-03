// Factory rendering from the read-only views (04 §3.3, §5.1, §5.3; 03 §8.6–8.7, §8.11; canon §3.1):
// instanced buildings, belts (decks, corners, Junctions, scrolling chevrons), Auto-Drills, Bucket Lifts, items on
// belts and in buckets, status bubbles, smoke, and the build overlays (ghost jobs, the armed tool's preview, belt
// paint path, bulldoze tint, selection outline, cursor marker, underground ghost highlight; 03 §4.3, §4.9–4.10).
//
// Structure (instance matrices, piece lists) is rebuilt only when factory.topologyVersion moves, filed under
// 4 × 4-cell regions per plane; each frame draws only the regions the camera rect meets (canon §3.14 triangle
// budgets: a Yard view never pays for mine belts, lift ties or drills, nor an underground view for the Yard).
// Per-tick state (working, status, tints) rewrites the small hfInst buffers; moving things (items, buckets,
// sheaves, bits, smoke, bubbles) are placed per frame for the camera rect only. No per-frame allocation.
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
  type ErrCode,
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
import { INST_HIDDEN, INST_TINT } from '../materials/glsl';
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
import {
  BUBBLE_GLYPH,
  GHOST_ALPHA,
  GHOST_EDGE_PX,
  GHOST_HATCH_PT,
  GHOST_STYLE,
  INVALID_HEX,
  OVERLAY_HEX,
  createBubbleMaterial,
  createGhostDepthMaterial,
  createGhostMaterial,
  createGhostOutlineMaterial,
  createGlyphAtlas,
  overlayMaterial,
} from './overlayMaterials';
import { PieceMesh } from './pieceMesh';
import { rayBox } from './projection';
import { BUBBLE_KINDS, glyphAlert, statusGlyph } from './status';

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
/** Yard buildings that fade to a see-through copy when they hide the cursor, the selection or a painted belt. */
const XRAY_PIECES = ['router', 'bin', 'smelter', 'assembler', 'export', 'headframe'] as const;
type XrayPiece = (typeof XRAY_PIECES)[number];
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
/**
 * Culling regions (canon §3.14): REGION × REGION cells. Keys run over the Yard's row bands, then the mine's, with
 * the column chunks inside each band, so the regions a camera rect meets form one key range per band.
 */
export const REGION = 4;
const REGION_COLS = Math.ceil(MINE_W / REGION);
const YARD_BANDS = Math.ceil(YARD_ROWS / REGION);
const MINE_BANDS = Math.ceil(MINE_H / REGION);
const REGION_KEYS = (YARD_BANDS + MINE_BANDS) * REGION_COLS;
/** Cells a piece reaches past the region of its anchor (min) cell: 2 × 2 footprints, a Headframe over the Rim strip. */
const REGION_SPAN = 2;
/** World extent of a region's pieces off its plane: Yard heights (≤ 3, canon §3.1), the slab's depth underground. */
const YARD_HEIGHT = [0, 3] as const;
const MINE_DEPTH = [-1, 0.5] as const;
/** Screen margin (world units) a region box may sit outside the viewport and still draw. */
const SCREEN_MARGIN = 0.5;
export function regionKey(plane: Plane, x: number, y: number): number {
  const bands = plane === 'yard' ? YARD_BANDS : MINE_BANDS;
  const band = Math.max(0, Math.min(bands - 1, Math.floor(y / REGION)));
  const col = Math.max(0, Math.min(REGION_COLS - 1, Math.floor(x / REGION)));
  return (plane === 'yard' ? 0 : YARD_BANDS * REGION_COLS) + band * REGION_COLS + col;
}
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
/**
 * Empties hang inside the +x strand and a little forward of it, smaller than loaded buckets: the cameras look from
 * +x (yaw 8–20°), so the rock right of a 1-wide shaft hides the back wall's +x edge (03 §8.6).
 */
const EMPTY_X = SHEAVE_R - 0.12;
const EMPTY_Z = LIFT_Z + 0.13;
const EMPTY_SCALE = 1;
/** Loaded buckets ride the −x strand, just outside it. */
const LOADED_X = -SHEAVE_R - 0.08;
/** Item caps per tier (canon §3.14). */
export const ITEM_CAP = { low: 1500, mid: 4000, high: 6000 } as const;
/** Yard heights for picking, bubbles and occlusion (canon §3.1: ≤ 1.6, Headframes ≤ 3). */
const YARD_TOP: Partial<Record<BuildingKind, number>> = { router: 0.48, bin: 1.55, smelter: 1.62, assembler: 1.6, export: 1.32, headframe: 2.72 };
/** Status bubbles are 28-pt discs on screen at every zoom (03 §4.10); jam heads a little smaller. */
export const BUBBLE_PT = 28;
const JAM_PT = 24;
/** Gap between a bubble's bottom and the top of what it floats over (world units). */
const BUBBLE_GAP = 0.11;
/** Occluders faded at most at once, and how far (cells) from a cell a ≤ 3-tall building can stand and still hide it. */
const MAX_XRAY = 16;
const XRAY_REACH = 3;
/** Painted path cells checked for occluders (longer strokes: the first ones). */
const XRAY_PATH_CELLS = 64;
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
  /**
   * Viewport in CSS px. With it, structure culling also drops the regions of the rects (bounding boxes of the view)
   * whose boxes miss the screen, e.g. the corners of a Yard view at yaw 45°.
   */
  viewport?: { width: number; height: number } | null;
  build: BuildFrame | null;
  /**
   * Underground job the pod is completing now (WorldApi.ghostProgress). `blocked`: the refusal the ring holds on
   * (PLAYER-6); that job is drawn stalled, striped in its role tint, instead of pulsing as being built.
   */
  ghostProgress: { id: number; progress: number; blocked?: ErrCode | null } | null;
  /** Pixel Lab: world units per RT texel (moving pieces snap to it); 0 = no snapping. */
  texel: number;
  /** False with reduced motion or battery mode: machines hold still (03 §7, 04 §5.8). */
  animate: boolean;
  /** Item cap (canon §3.14) and working Smelters that may smoke (03 §8.10). */
  itemCap: number;
  smokeCap: number;
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
interface LiftRef extends SpinRef {
  /** World y its buckets climb to: the Headframe's sheave, a Rim-top mouth, or an underground head pulley. */
  top: number;
}

/** World y of a lift's top (where loaded buckets tip and empties start down). */
function liftTopY(row: number, framed: boolean): number {
  if (row > 0) return -(row + 1) + 0.66;
  return framed ? SHEAVE_Y : 0.35;
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

/** Invalid-stripe period in target pixels for GHOST_HATCH_PT CSS px: ≥ 4 so both halves show, whole texels when snapped. */
export function ghostHatchPx(pxPerPt: number, wholeTexels: boolean): number {
  const p = GHOST_HATCH_PT * (pxPerPt > 0 && Number.isFinite(pxPerPt) ? pxPerPt : 1);
  return Math.max(4, wholeTexels ? Math.round(p) : p);
}

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
  /** See-through copies of the Yard buildings that hide the cursor, the selection or a painted belt (03 §4.9). */
  private readonly xray: Record<XrayPiece, PieceMesh>;
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
  private readonly ghostDepthMat = createGhostDepthMaterial();
  private readonly ghostEdgeMat = createGhostOutlineMaterial();
  private readonly bubbleMat;
  private readonly table: ItemTable = buildItemTable();

  private factory: FactoryApi | null = null;
  private topo = -1;
  private ents: readonly EntityView[] = [];
  private ghostJobs: readonly GhostView[] = [];
  private headframes: HeadframeRef[] = [];
  private drills: SpinRef[] = [];
  private lifts: LiftRef[] = [];
  private readonly liftById = new Map<number, LiftRef>();
  /** Yard buildings by id (occlusion tests). */
  private readonly yardById = new Map<number, EntityView>();
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
  private readonly hiKey = { on: false, kind: '' as BuildingKind | '', x0: 0, y0: 0, x1: 0, y1: 0, grid: -1, topo: -1 };
  private readonly hover = { id: -1, key: -1 };
  private readonly itemViews: BeltItemsView[];
  /** Ghost job instances per mesh (kept across frames; the preview is appended after them). */
  private readonly jobCounts = new Map<GhostPiece, number>();
  private jobTopo = -1;
  private jobActive = -2;
  private jobStalled = false;
  private readonly jobTint: GhostTint = { hex: 0, alpha: 0, style: 0 };
  private readonly previewTint: GhostTint = { hex: 0, alpha: 0, style: 0 };
  private readonly entScratch = { kind: 'belt' as BuildingKind, plane: 'mine' as Plane, x: 0, y: 0, w: 1, h: 1, dir: 0 as Dir };
  private lastPath: readonly Cell[] | null = null;
  private lastPathDir = -1;
  private pathCache: BeltTile[] = [];
  private readonly solo: BeltTile = { x: 0, y: 0, dir: 0, entry: 0, shape: 0, turn: 0, tier: 1, tail: true, head: true, dirB: 0, tailB: false, headB: false };
  private readonly tmp: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly rgb = new Color();
  /** Region-key ranges in view this frame (pairs; runs of regions per row band and plane). */
  private readonly cullRanges = new Int32Array(REGION_KEYS + 2);
  /** Mine rect the bucket view is filled for (the shafts in view, and the Headframe towers over row 0). */
  private readonly bucketRect: ViewRect = { plane: 'mine', x0: 0, y0: 0, x1: 0, y1: 0 };
  /** Yard buildings drawn see-through this frame, and a version that moves when the set does. */
  private readonly hidden = new Set<number>();
  private readonly hiddenNext: number[] = [];
  private hiddenVer = 0;
  private stateHidden = -1;
  private readonly xrayTint: GhostTint = { hex: 0xffffff, alpha: GHOST_ALPHA.xray, style: GHOST_STYLE.XRAY };
  private readonly rayO: Vec3 = { x: 0, y: 0, z: 0 };
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
      const m = new PieceMesh(`factory-${p}`, base, mat, noHull ? null : hull, { capacity: p === 'belt' || p === 'chevron' ? 256 : 32, regions: REGION_KEYS });
      this.solid[p] = m;
      this.root.add(m.mesh);
    }
    // Ghosts: a depth prepass (7), the silhouette outline it trims to the rim (7.5), then the translucent body (8).
    this.ghost = {} as Record<GhostPiece, PieceMesh>;
    for (const p of GHOST_PIECES) {
      const m = new PieceMesh(`factory-ghost-${p}`, bases.get(p) as BufferGeometry, this.ghostMat, null, { capacity: 16, colors: true, extra: { hfGhost: 2 } });
      m.addTwin(`factory-ghost-${p}-depth`, this.ghostDepthMat, false).renderOrder = 7;
      m.addTwin(`factory-ghost-${p}-edge`, this.ghostEdgeMat, true).renderOrder = 7.5;
      m.setLayer(LAYER_LATE);
      m.mesh.renderOrder = 8;
      this.ghost[p] = m;
      this.root.add(m.mesh);
    }
    // X-ray copies draw after the ghosts and never write depth: what they hide shows through at 60%.
    this.xray = {} as Record<XrayPiece, PieceMesh>;
    for (const p of XRAY_PIECES) {
      const m = new PieceMesh(`factory-xray-${p}`, bases.get(p) as BufferGeometry, this.ghostMat, null, { capacity: 8, colors: true, extra: { hfGhost: 2 } });
      m.setLayer(LAYER_LATE);
      m.mesh.renderOrder = 9;
      this.xray[p] = m;
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
    this.highlight.mesh.renderOrder = 5;
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
    // Cursor and selection draw before the ghosts' depth prepass, so a ghost over the cursor tints it instead of hiding it.
    for (const m of [this.cursor, this.brackets]) {
      m.layers.set(LAYER_LATE);
      m.renderOrder = 6;
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

  /**
   * Ghost outline width in target pixels and the target's size: Toon 1.5 CSS px × its render DPR on the canvas,
   * Pixel Lab one texel of the low-res target (crisp at any zoom; 03 §9.3). `pxPerPt` (target pixels per CSS px)
   * sizes the invalid stripes to GHOST_HATCH_PT on screen, in whole texels in Pixel Lab.
   */
  setGhostEdge(px: number, width: number, height: number, pxPerPt = px / GHOST_EDGE_PX): void {
    const u = this.ghostEdgeMat.uniforms;
    u.uPx.value = px;
    (u.uRes.value as { set(x: number, y: number): unknown }).set(Math.max(1, width), Math.max(1, height));
    this.ghostMat.uniforms.uHatch.value = ghostHatchPx(pxPerPt, this.look === 'pixel');
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
    this.liftById.clear();
    this.yardById.clear();
    this.smelters = [];
    this.bubbleEnts = [];
  }

  update(fr: FactoryFrame): void {
    const f = fr.factory;
    if (f !== this.factory) this.bind(f);
    if (f.topologyVersion !== this.topo) this.rebuild(f);
    this.cullStatic(fr);
    this.findOccluders(fr);
    this.syncState(fr);
    this.placeItems(fr);
    this.placeBuckets(fr);
    this.placeSpinners(fr);
    this.placeSmoke(fr);
    this.placeBubbles(fr);
    this.placeGhosts(fr);
    this.placeXray(fr);
    this.placeOverlays(fr);
    this.ghostMat.uniforms.uTime.value = (fr.timeMs / 1000) % 3600;
    this.kit.uniforms.uHfFactoryBreath.value = fr.animate && this.smelters.length + this.drills.length <= 40 ? 0.03 : 0;
  }

  // ---- structure ---------------------------------------------------------------------------------

  private rebuild(f: FactoryApi): void {
    this.topo = f.topologyVersion;
    for (const p of STATIC_PIECES) this.solid[p].reset();
    this.ents = f.entities();
    this.ghostJobs = f.ghosts();
    this.headframes = [];
    this.drills = [];
    this.lifts = [];
    this.liftById.clear();
    this.yardById.clear();
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
      else if (e.kind === 'lift') {
        const l: LiftRef = { e, angle: 0, top: liftTopY(e.y, this.framedLifts.has(e.id)) };
        this.lifts.push(l);
        this.liftById.set(e.id, l);
      } else if (e.kind === 'smelter') this.smelters.push(e);
      if (e.plane === 'yard') this.yardById.set(e.id, e);
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
    this.stateHidden = -1;
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
    m.region = regionKey(c.plane, c.x0, c.y0);
    const i = m.push(x, y, z, ry, sx, sy, sz, c.ref);
    if (c.ghost) this.tintGhost(m, i, c.ghost);
    return i;
  }

  /** Push the pieces of an entity-shaped footprint into `sink` (solid meshes, or ghosts when `ghost` is set). */
  private emitEntity(
    e: Pick<EntityView, 'kind' | 'plane' | 'x' | 'y' | 'w' | 'h' | 'dir'> & { id?: number },
    sink: Record<StaticPiece, PieceMesh> | Record<GhostPiece, PieceMesh> | Record<XrayPiece, PieceMesh>,
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
        if (ghost) this.put('liftRail', x, -(foot + 1), 0, 0, 1, e.h, 1);
        else this.emitLiftColumn(e.x, e.y, foot, e.id !== undefined && this.framedLifts.has(e.id));
        c.y0 = c.y1 = foot;
        if (liftPart !== 'rail') this.put('liftFoot', x, -(foot + 1), 0, 0);
        c.y0 = c.y1 = e.y;
        if (e.y > 0 && liftPart === null) this.put('liftHead', x, -(e.y + 1), 0, 0);
        return;
      }
      default:
        return;
    }
  }

  /**
   * A built lift's rails and chain strands, one piece per culling band so a deep lift costs only the rows in view,
   * ties every 3rd row, and (under a Headframe) the strands' climb from the shaft mouth to the sheave, filed with
   * the Yard's Rim strip where the tower stands.
   */
  private emitLiftColumn(col: number, top: number, foot: number, framed: boolean): void {
    const c = this.emit;
    const x = col + 0.5;
    const s0 = -(foot + 1) + 0.56;
    for (let a = top; a <= foot; ) {
      const next = (Math.floor(a / REGION) + 1) * REGION;
      const b = Math.min(foot, next - 1);
      c.y0 = a;
      c.y1 = b;
      this.put('liftRail', x, -(b + 1), 0, 0, 1, b - a + 1, 1);
      const lo = b === foot ? s0 : -(b + 1);
      // The top band runs to the lift's top; under a Headframe only to the mouth (the climb is filed with the Yard).
      const hi = a === top ? (framed && top === 0 ? 0 : liftTopY(top, false)) : -a;
      this.put('liftStrand', x, lo, 0, 0, 1, Math.max(0.01, hi - lo), 1);
      a = next;
    }
    for (let r = top + 1; r <= foot; r += 3) {
      c.y0 = c.y1 = r;
      this.put('liftTie', x, -(r + 0.5), 0, 0);
    }
    if (framed) {
      c.plane = 'yard';
      c.y0 = c.y1 = 0;
      this.put('liftStrand', x, 0, 0, 0, 1, SHEAVE_Y, 1);
      c.plane = 'mine';
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
    ch.region = regionKey(c.plane, c.x0, c.y0);
    const i = ch.push(cx, cy, cz, dirAngle(dir), 1, sy, 1, c.ref);
    ch.setInst(i, tail ? 1 : 0, head ? 1 : 0, 0, turn);
  }

  /**
   * Draw only the structure in the regions the camera rects meet (instancing skips frustum culling; canon §3.14).
   * Pieces are filed by their anchor (min) cell, so each rect grows by REGION_SPAN toward lower cells.
   */
  private cullStatic(fr: FactoryFrame): void {
    let n = this.addRanges(fr, fr.yardRect, 'yard', 0);
    n = this.addRanges(fr, fr.mineRect, 'mine', n);
    for (const p of STATIC_PIECES) this.solid[p].cull(this.cullRanges, n);
  }

  /** Append the runs of regions of one plane's rect whose boxes reach the screen. */
  private addRanges(fr: FactoryFrame, r: ViewRect | null, plane: Plane, n: number): number {
    if (!r) return n;
    const bands = plane === 'yard' ? YARD_BANDS : MINE_BANDS;
    const c0 = Math.max(0, Math.floor((r.x0 - REGION_SPAN) / REGION));
    const c1 = Math.min(REGION_COLS - 1, Math.floor(r.x1 / REGION));
    const b0 = Math.max(0, Math.floor((r.y0 - REGION_SPAN) / REGION));
    const b1 = Math.min(bands - 1, Math.floor(r.y1 / REGION));
    if (c0 > c1) return n;
    const base = regionKey(plane, 0, 0);
    const out = this.cullRanges;
    const vp = fr.viewport;
    for (let b = b0; b <= b1; b++) {
      let run = -1;
      for (let c = c0; c <= c1 + 1; c++) {
        const on = c <= c1 && (!vp || this.regionOnScreen(fr.pose, vp, plane, c, b));
        if (on && run < 0) run = c;
        else if (!on && run >= 0) {
          out[2 * n] = base + b * REGION_COLS + run;
          out[2 * n + 1] = base + b * REGION_COLS + c;
          n++;
          run = -1;
        }
      }
    }
    return n;
  }

  /**
   * Does region (col c, band b)'s box reach the screen? Its cells grow by REGION_SPAN (pieces reach past their
   * anchor region) and span the plane's piece heights; the eight corners' screen bounds are tested (conservative).
   */
  private regionOnScreen(pose: CameraPose, vp: { width: number; height: number }, plane: Plane, c: number, b: number): boolean {
    const x0 = c * REGION, x1 = (c + 1) * REGION + REGION_SPAN;
    const y0 = b * REGION, y1 = (b + 1) * REGION + REGION_SPAN;
    const l = pose.lookAt, r = pose.right, u = pose.up;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (let k = 0; k < 8; k++) {
      const cx = k & 1 ? x1 : x0;
      const cy = k & 2 ? y1 : y0;
      let px: number, py: number, pz: number;
      if (plane === 'yard') {
        px = cx;
        py = YARD_HEIGHT[k >> 2];
        pz = -cy;
      } else {
        px = cx;
        py = -cy;
        pz = MINE_DEPTH[k >> 2];
      }
      const dx = px - l.x, dy = py - l.y, dz = pz - l.z;
      const su = dx * r.x + dy * r.y + dz * r.z;
      const sv = dx * u.x + dy * u.y + dz * u.z;
      if (su < uMin) uMin = su;
      if (su > uMax) uMax = su;
      if (sv < vMin) vMin = sv;
      if (sv > vMax) vMax = sv;
    }
    const hw = vp.width / 2 / pose.ppu + SCREEN_MARGIN;
    const hh = vp.height / 2 / pose.ppu + SCREEN_MARGIN;
    return uMax >= -hw && uMin <= hw && vMax >= -hh && vMin <= hh;
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
    const hiddenChanged = this.hiddenVer !== this.stateHidden;
    if (!tintChanged && !hiddenChanged && f.tickNo === this.lastTick) return;
    this.stateHover = hv.id;
    this.stateKeyCell = hv.key;
    this.stateSelected = selected;
    this.stateHidden = this.hiddenVer;
    this.lastTick = f.tickNo;
    const hidden = this.hidden;
    for (const p of ENTITY_PIECES) {
      const m = this.solid[p];
      for (let i = 0; i < m.count; i++) {
        const e = m.refs[i] as EntityView;
        const st = STATUS_INDEX[e.status] ?? 1;
        let tint = e.id === hv.id ? INST_TINT.BULLDOZE : e.id === selected ? INST_TINT.SELECTED : INST_TINT.NONE;
        if (hidden.size > 0 && hidden.has(e.id)) tint += INST_HIDDEN;
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
      // Lines are culled whole by the views; long ones still cross the rect, so items are culled one by one too.
      const rect = view === this.yardItems ? fr.yardRect : fr.mineRect;
      if (!rect) continue;
      for (let k = 0; k < view.count && total < fr.itemCap; k++) {
        const num = view.item[k];
        const fam = this.table.family[num];
        if (fam === undefined || fam === 255) continue;
        if (view.x[k] < rect.x0 - 1 || view.x[k] > rect.x1 + 2 || view.y[k] < rect.y0 - 1 || view.y[k] > rect.y1 + 2) continue;
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

  /**
   * Lift buckets for the shafts in view (02 §3.4; 03 §8.6): loaded buckets climb the −x strand all the way to the
   * lift's top (into the Headframe, up to its sheave) and empties ride down the +x strand. The sim's bucket rows run
   * foot → top cell; they are stretched over the full climb. Only buckets inside the visible rows are placed.
   */
  private placeBuckets(fr: FactoryFrame): void {
    const f = fr.factory;
    const v = this.bucketView;
    const bk = this.bucket;
    bk.reset();
    const mr = fr.mineRect;
    const yr = fr.yardRect;
    // World-y window of the shafts on screen: the mine rows in view, plus the Headframe towers over the Rim strip.
    let yLo = Infinity, yHi = -Infinity, x0 = Infinity, x1 = -Infinity;
    if (mr) {
      yLo = -(mr.y1 + 1);
      yHi = -mr.y0;
      x0 = mr.x0;
      x1 = mr.x1;
    }
    if (yr && yr.y0 <= REGION_SPAN && this.framedLifts.size > 0) {
      yHi = Math.max(yHi, SHEAVE_Y + 0.5);
      yLo = Math.min(yLo, -1);
      x0 = Math.min(x0, yr.x0);
      x1 = Math.max(x1, yr.x1);
    }
    const q = this.bucketRect;
    const on = yHi > yLo && this.lifts.length > 0;
    if (on) {
      q.x0 = x0;
      q.x1 = x1;
      q.y0 = Math.max(0, Math.floor(-yHi));
      q.y1 = Math.max(q.y0, Math.ceil(-yLo));
      f.fillLiftBuckets(v, q);
    } else v.count = 0;
    const p = this.tmp;
    for (let k = 0; k < v.count; k++) {
      const l = this.liftById.get(v.lift[k]);
      if (!l) continue;
      const e = l.e;
      const foot = e.y + e.h - 1;
      const yFoot = -(foot + 0.5);
      const row = v.row[k] + v.dRow[k] * fr.alphaF;
      const t = foot > e.y ? Math.max(0, Math.min(1, (foot + 0.5 - row) / (foot - e.y))) : 1;
      const y = yFoot + t * (l.top - yFoot);
      if (y < yLo - 0.5 || y > yHi + 0.5) continue;
      p.x = v.x[k] + LOADED_X;
      p.y = y;
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
    // Empty buckets ride down the other strand from the top, moving while the lift runs.
    if (on) {
      for (const l of this.lifts) {
        const e = l.e;
        if (e.x < q.x0 || e.x > q.x1) continue;
        if (e.status === 'working' && fr.animate) l.angle = (l.angle + fr.dt * liftRowsPerS(e.mk)) % EMPTY_BUCKET_ROWS;
        const lo = Math.max(-(e.y + e.h - 1 + 0.5) + 0.4, yLo - 0.5);
        const hi = Math.min(l.top - 0.3, yHi + 0.5);
        if (hi <= lo) continue;
        const first = l.top - 0.3 - l.angle;
        for (let y = first - Math.max(0, Math.ceil((first - hi) / EMPTY_BUCKET_ROWS)) * EMPTY_BUCKET_ROWS; y >= lo; y -= EMPTY_BUCKET_ROWS) {
          p.x = e.x + 0.5 + EMPTY_X;
          p.y = y;
          p.z = EMPTY_Z;
          this.snap(p, fr);
          const i = bk.push(p.x, p.y, p.z, 0);
          bk.setTRZ(i, p.x, p.y, p.z, Math.PI, EMPTY_SCALE);
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

  /**
   * World size of a billboard that is `pt` CSS px across on screen (03 §4.10: 28-pt bubbles at every zoom). Pixel
   * Lab rounds it to whole texels of the low-res target so the glyph stays crisp.
   */
  bubbleSize(fr: Pick<FactoryFrame, 'pose' | 'texel'>, pt: number): number {
    const ppu = fr.pose.ppu > 0 && Number.isFinite(fr.pose.ppu) ? fr.pose.ppu : 39;
    const s = pt / ppu;
    return fr.texel > 0 ? Math.max(1, Math.round(s / fr.texel)) * fr.texel : s;
  }

  private placeBubbles(fr: FactoryFrame): void {
    const bb = this.bubbles;
    bb.reset();
    const { right, up, dir } = fr.pose;
    const size = this.bubbleSize(fr, BUBBLE_PT);
    const half = size / 2;
    for (const e of this.bubbleEnts) {
      const st = e.status;
      const glyph = statusGlyph(e.kind, st);
      if (glyph === -1) continue;
      // Each bubble sits BUBBLE_GAP over what it marks, its centre half a disc above that.
      let x: number, y: number, z: number;
      if (e.plane === 'yard') {
        const rect = fr.yardRect;
        if (!rect || e.x + e.w < rect.x0 || e.x > rect.x1 || e.y + e.h < rect.y0 || e.y > rect.y1) continue;
        x = e.x + e.w / 2;
        y = (YARD_TOP[e.kind] ?? 1.2) + BUBBLE_GAP + half;
        z = -(e.y + e.h / 2);
      } else {
        const rect = fr.mineRect;
        // A lift is blocked at its top (02 §10.6); the bubble floats over its top cell.
        const top = e.y;
        if (!rect || e.x + e.w < rect.x0 || e.x > rect.x1 || top + 2 < rect.y0 || top > rect.y1) continue;
        if (e.kind === 'lift') {
          x = e.x + 0.5;
          y = (e.y === 0 ? 0.28 : -(e.y + 1) + 0.88) + BUBBLE_GAP + half;
          z = 0.1;
        } else if (e.kind === 'autoDrill') {
          x = e.x + 1;
          y = -(e.y + 1) + 1 + BUBBLE_GAP + half;
          z = 0.3;
        } else {
          x = e.x + 0.5;
          y = -(e.y + 1) + 0.53 + BUBBLE_GAP + half;
          z = 0.3;
        }
      }
      const i = bb.push(0, 0, 0, 0, 1, 1, 1, e);
      bb.setBasis(i, x, y, z, right, up, dir, size);
      bb.setExtra('hfGlyph', i, glyph, glyphAlert(glyph) ? 1 : 0);
    }
    const jam = this.bubbleSize(fr, JAM_PT);
    for (let j = 0; j < this.jams; j++) {
      const p = this.jamPos;
      const i = bb.push(0, 0, 0, 0);
      bb.setBasis(i, p[j * 3], p[j * 3 + 1], p[j * 3 + 2], right, up, dir, jam);
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
    const gp = fr.ghostProgress;
    const active = gp ? gp.id : -1;
    const stalled = !!gp?.blocked;
    if (this.jobTopo !== this.topo || this.jobActive !== active || this.jobStalled !== stalled) {
      // Queued jobs change only with the structure (or the job being built): emit them once and keep them.
      this.jobTopo = this.topo;
      this.jobActive = active;
      this.jobStalled = stalled;
      for (const p of GHOST_PIECES) this.ghost[p].reset();
      const tint = this.jobTint;
      for (const g of this.ghostJobs) {
        tint.hex = ROLE_HEX[g.kind] ?? ROLE.logistics;
        tint.alpha = GHOST_ALPHA.job;
        tint.style = g.id !== active ? GHOST_STYLE.JOB : stalled ? GHOST_STYLE.INVALID : GHOST_STYLE.ACTIVE;
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

  // ---- occluders (03 §4.9: what the player is pointing at never hides behind a building) -------------

  /**
   * Yard buildings standing between the camera and a cell the player works on: the cursor, the armed tool's
   * footprint or painted path, and the selected building. Each is hidden (INST_HIDDEN) and drawn see-through in
   * the late pass instead. At yaw 45° a 1.6-tall Smelter otherwise covers the belt tile behind it.
   */
  private findOccluders(fr: FactoryFrame): void {
    const next = this.hiddenNext;
    next.length = 0;
    const b = fr.build;
    if (b && b.plane === 'yard' && this.yardById.size > 0) {
      const grid = fr.factory.yardBuildings();
      const dir = fr.pose.dir;
      if (b.cursor) this.occludersOf(b.cursor.x, b.cursor.y, grid, dir);
      const pv = b.preview;
      if (pv) {
        if (pv.path && pv.path.length > 0) {
          const n = Math.min(pv.path.length, XRAY_PATH_CELLS);
          for (let k = 0; k < n; k++) this.occludersOf(pv.path[k].x, pv.path[k].y, grid, dir);
        } else {
          const w = Math.max(1, pv.w), h = Math.max(1, pv.h);
          for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.occludersOf(pv.x + dx, pv.y + dy, grid, dir);
        }
      }
      const sel = b.selectedId !== null ? this.yardById.get(b.selectedId) : undefined;
      if (sel) for (let dy = 0; dy < sel.h; dy++) for (let dx = 0; dx < sel.w; dx++) this.occludersOf(sel.x + dx, sel.y + dy, grid, dir);
    }
    const hidden = this.hidden;
    let same = next.length === hidden.size;
    for (let k = 0; same && k < next.length; k++) same = hidden.has(next[k]);
    if (same) return;
    hidden.clear();
    for (const id of next) hidden.add(id);
    this.hiddenVer++;
  }

  /** Append (once) every Yard building whose box a ray from cell (cx, cy) toward the camera enters. */
  private occludersOf(cx: number, cy: number, grid: ArrayLike<number>, dir: Vec3): void {
    if (cx < 0 || cx >= MINE_W || cy < 0 || cy >= YARD_ROWS) return;
    const next = this.hiddenNext;
    const own = grid[cy * MINE_W + cx];
    const o = this.rayO;
    for (let dy = -XRAY_REACH; dy <= XRAY_REACH && next.length < MAX_XRAY; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= YARD_ROWS) continue;
      for (let dx = -XRAY_REACH; dx <= XRAY_REACH && next.length < MAX_XRAY; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= MINE_W) continue;
        const id = grid[y * MINE_W + x];
        if (id <= 0 || id === own || next.includes(id)) continue;
        const e = this.yardById.get(id);
        if (!e) continue;
        const top = YARD_TOP[e.kind] ?? 1;
        const reach = e.kind === 'headframe' ? 0.45 : 0;
        // The cell's centre and four inset corners, at belt-deck height.
        for (let k = 0; k < 5; k++) {
          o.x = cx + 0.5 + (k === 0 ? 0 : k & 1 ? -0.3 : 0.3);
          o.y = BELT_DECK_TOP;
          o.z = -(cy + 0.5) + (k === 0 ? 0 : k & 2 ? -0.3 : 0.3);
          if (rayBox(o, dir, e.x, 0, -(e.y + e.h), e.x + e.w, top, -e.y + reach) < Infinity) {
            next.push(id);
            break;
          }
        }
      }
    }
  }

  /** See-through copies of the hidden occluders (the solid instances drop out in the vertex shader). */
  private placeXray(fr: FactoryFrame): void {
    for (const p of XRAY_PIECES) this.xray[p].reset();
    if (fr.build) {
      // hiddenNext lists this frame's occluders (the same ids as `hidden`), without a Set iterator per frame.
      const ids = this.hiddenNext;
      for (let k = 0; k < ids.length; k++) {
        const e = this.yardById.get(ids[k]);
        if (e) this.emitEntity(e, this.xray, this.xrayTint);
      }
    }
    for (const p of XRAY_PIECES) this.xray[p].commit();
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
    // Only an armed tool has somewhere to go: the pending ghost names it, else the armed card (before the first
    // tap, so arming a tool shows where it can go; BUILD-9).
    const kind = b ? (b.preview?.kind ?? b.tool ?? null) : null;
    if (!b || b.plane !== 'mine' || b.bulldoze || kind === null || !rect) {
      if (this.hiKey.on) {
        hi.reset();
        hi.commit();
        this.hiKey.on = false;
      }
      return;
    }
    const k = this.hiKey;
    if (k.on && k.kind === kind && k.x0 === rect.x0 && k.y0 === rect.y0 && k.x1 === rect.x1 && k.y1 === rect.y1 && k.grid === fr.grid.version && k.topo === this.topo) return;
    k.on = true;
    k.kind = kind;
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

  private toolMayGo(g: TerrainGrid, kind: BuildingKind, x: number, r: number): boolean {
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
    for (const p of XRAY_PIECES) this.xray[p].dispose();
    for (const m of [...this.items, this.sheave, this.bit, this.bucket, this.smoke, this.bubbles, this.highlight]) m.dispose();
    this.ghostMat.dispose();
    this.ghostDepthMat.dispose();
    this.ghostEdgeMat.dispose();
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

