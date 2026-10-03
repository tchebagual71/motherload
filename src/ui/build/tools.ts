// Build-mode tool reducers (03 §4.3–4.6; 02 §2): belt paths, underground runs, lift endpoints, drill snapping,
// footprints, Kit bookkeeping and the build cards. Pure: plain data in, plain data out (no factory, no DOM).
import {
  BUILDINGS,
  DIR,
  KIT_METER,
  LIFT_RAIL_KIT,
  kitUnits,
  type BuildingKind,
  type Cell,
  type Dir,
  type GhostView,
  type Plane,
  type Rung,
} from '../../factory/api';
import { isJunction, slotTier, wordDirA, wordTierA, wordTierB } from '../../factory/topology';
import type { CargoItem, Lode } from '../../shared/types';
import { formatCash } from '../format';
import { shortName, unlockText } from './text';

export const DX: readonly number[] = [1, 0, -1, 0];
export const DY: readonly number[] = [0, 1, 0, -1];
export const W = 48;

export function sameCell(a: Cell | null | undefined, b: Cell | null | undefined): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

export function opposite(d: Dir): Dir {
  return ((d + 2) & 3) as Dir;
}

/** Direction of a unit step a → b, or null when they are not 4-neighbours. */
export function dirBetween(a: Cell, b: Cell): Dir | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  return (dx === 1 ? DIR.E : dy === 1 ? DIR.S : dx === -1 ? DIR.W : DIR.N) as Dir;
}

/**
 * Extend a painted path to cell `c` (03 §4.4): a 4-connected walk from its end (the longer axis first), where
 * stepping back onto the previous cell erases the last one ("backing up erases"). Crossing an older part of the
 * stroke is allowed (straight crossings become Junctions, 02 §2.1). Returns the same array when `c` is the end.
 */
export function extendPath(path: readonly Cell[], c: Cell): Cell[] {
  if (path.length === 0) return [{ x: c.x, y: c.y }];
  let cur = path[path.length - 1];
  if (cur.x === c.x && cur.y === c.y) return path as Cell[];
  const out = path.slice();
  let guard = 2 * W + 64;
  while ((cur.x !== c.x || cur.y !== c.y) && guard-- > 0) {
    const dx = c.x - cur.x;
    const dy = c.y - cur.y;
    const next = Math.abs(dx) >= Math.abs(dy) ? { x: cur.x + Math.sign(dx), y: cur.y } : { x: cur.x, y: cur.y + Math.sign(dy) };
    const prev = out.length >= 2 ? out[out.length - 2] : null;
    if (prev && prev.x === next.x && prev.y === next.y) out.pop();
    else out.push(next);
    cur = next;
  }
  return out;
}

/** L mode (03 §4.4): an L from `a` to `b`, horizontal leg first (vertical first when flipped). */
export function lPath(a: Cell, b: Cell, flip: boolean): Cell[] {
  const out: Cell[] = [{ x: a.x, y: a.y }];
  let x = a.x;
  let y = a.y;
  const legX = (): void => {
    while (x !== b.x) out.push({ x: (x += Math.sign(b.x - x)), y });
  };
  const legY = (): void => {
    while (y !== b.y) out.push({ x, y: (y += Math.sign(b.y - y)) });
  };
  if (flip) {
    legY();
    legX();
  } else {
    legX();
    legY();
  }
  return out;
}

/** Facing of every tile of a path: toward the next tile; the last one keeps the stroke's direction or `endDir`. */
export function pathDirs(path: readonly Cell[], endDir?: Dir): Dir[] {
  const dirs: Dir[] = [];
  for (let i = 0; i + 1 < path.length; i++) dirs.push(dirBetween(path[i], path[i + 1]) ?? DIR.E);
  dirs.push(endDir ?? (dirs.length > 0 ? dirs[dirs.length - 1] : DIR.E));
  return dirs;
}

/**
 * Port snap (03 §4.4, §4.9 "Ports 1 cell"): when the cell ahead of a stroke's last tile takes no input but a
 * side neighbour does, the last tile turns into it. `accepts(x, y, d)`: a belt travelling `d` into (x, y) feeds a
 * building there. Returns the end direction to use, or undefined to keep the drag's.
 */
export function snapEndDir(path: readonly Cell[], accepts: (x: number, y: number, d: Dir) => boolean): Dir | undefined {
  if (path.length < 2) return undefined;
  const last = path[path.length - 1];
  const d = dirBetween(path[path.length - 2], last);
  if (d === null) return undefined;
  if (accepts(last.x + DX[d], last.y + DY[d], d)) return undefined;
  for (const s of [((d + 1) & 3) as Dir, ((d + 3) & 3) as Dir]) {
    if (accepts(last.x + DX[s], last.y + DY[s], s)) return s;
  }
  return undefined;
}

/** Does a Yard building of `kind`, facing `facing`, take a belt arriving while travelling `d` (02 §2.2 ports)? */
export function takesInput(kind: BuildingKind, facing: Dir, d: Dir): boolean {
  switch (kind) {
    case 'bin':
    case 'export':
    case 'silo':
    case 'podWorks':
      return true; // inputs on all edges
    case 'smelter':
    case 'assembler':
    case 'refinery':
    case 'gemCutter':
      return opposite(d) !== facing; // every edge but the output edge
    default:
      return false; // Headframe (lift mode), Routers and the rest take no snapped belt
  }
}

/** Approximate Yard price of painting `path` (02 §3.1: $5 a tile; a crossing adds a tile): the pending chip. */
export function yardBeltCost(path: readonly Cell[], dirs: readonly Dir[], words: Readonly<Uint16Array>, tileCash: number): number {
  let cost = 0;
  const seen = new Set<number>();
  for (let i = 0; i < path.length; i++) {
    const c = path[i].y * W + path[i].x;
    if (seen.has(c)) continue;
    seen.add(c);
    const w = words[c] ?? 0;
    if (w === 0) cost += tileCash;
    else if (((w >> 10) & 1) !== (dirs[i] & 1) && (w & 0x4000) === 0) cost += tileCash; // perpendicular → Junction
  }
  return cost;
}

/**
 * Would painting `path` (facing `dirs`, tier `mk`) leave the Yard as it is? The factory's paint rule (02 §2.1)
 * keeps a cell whose belt already runs that way at that tier and a Router a stroke passes through; a stroke ending
 * into the side of a belt still adds its T-Router (when Routers are unlocked). Such a stroke records no undo
 * step, so ✓ stays off. `buildingAt(x, y)`: a Yard building id there (0 = none); `isRouter(id)`.
 */
export function beltPathUnchanged(
  path: readonly Cell[],
  dirs: readonly Dir[],
  words: Readonly<Uint16Array>,
  mk: number,
  buildingAt: (x: number, y: number) => number,
  isRouter: (id: number) => boolean,
  routerOk: boolean,
): boolean {
  if (path.length === 0) return false;
  for (let i = 0; i < path.length; i++) {
    const { x, y } = path[i];
    const b = buildingAt(x, y);
    if (b !== 0) {
      if (isRouter(b)) continue;
      return false;
    }
    if (slotTier(words[y * W + x] ?? 0, dirs[i]) !== mk) return false;
  }
  const last = path[path.length - 1];
  const d = dirs[path.length - 1];
  const nx = last.x + DX[d];
  const ny = last.y + DY[d];
  if (routerOk && nx >= 0 && nx < W && ny >= 0 && buildingAt(nx, ny) === 0) {
    const w = words[ny * W + nx] ?? 0;
    if (w !== 0 && !isJunction(w) && (wordDirA(w) & 1) !== (d & 1)) return false;
  }
  return true;
}

/**
 * Yard Bulldoze refund for belt cells (02 §2.7: the price paid back, as the factory's removal diff): each belt
 * tile's tier price, plus the second tile of a Junction, whose crossing line goes too. Router cells hold no belt.
 */
export function yardBeltRefund(cells: readonly Cell[], words: Readonly<Uint16Array>, tierCash: (tier: number) => number): { refund: number; tiles: number; crossings: number } {
  let refund = 0;
  let tiles = 0;
  let crossings = 0;
  const seen = new Set<number>();
  for (const { x, y } of cells) {
    const c = y * W + x;
    if (seen.has(c)) continue;
    seen.add(c);
    const w = words[c] ?? 0;
    if (w === 0) continue;
    tiles++;
    refund += tierCash(wordTierA(w));
    if (isJunction(w)) {
      crossings++;
      refund += tierCash(wordTierB(w));
    }
  }
  return { refund, tiles, crossings };
}

// ---------------------------------------------------------------- underground

export interface MineRun {
  /** GhostSpec fields: the run starts at x and extends along dir (E or W). */
  x: number;
  y: number;
  dir: Dir;
  length: number;
  cells: Cell[];
}

/** Underground belts are row-locked (03 §4.4): the run keeps the start row and goes toward the finger's column. */
export function mineRun(start: Cell, cur: Cell, defaultDir: Dir = DIR.E): MineRun {
  const dir: Dir = cur.x > start.x ? DIR.E : cur.x < start.x ? DIR.W : defaultDir === DIR.W ? DIR.W : DIR.E;
  const length = Math.abs(cur.x - start.x) + 1;
  const step = dir === DIR.W ? -1 : 1;
  const cells: Cell[] = [];
  for (let i = 0; i < length; i++) cells.push({ x: start.x + step * i, y: start.y });
  return { x: start.x, y: start.y, dir, length, cells };
}

/** The run cut before cell column `stopX` (exclusive): the valid prefix before the first bad cell. */
export function truncateRun(run: MineRun, stopX: number): MineRun | null {
  const k = run.cells.findIndex((c) => c.x === stopX);
  if (k <= 0) return null;
  return { ...run, length: k, cells: run.cells.slice(0, k) };
}

export interface LiftEnds {
  x: number;
  foot: number;
  top: number;
}

/** Lift by two endpoints (03 §4.5): a top above the foot, in the foot's column ±1 (slop). Null when not a top. */
export function liftEnds(foot: Cell, top: Cell): LiftEnds | null {
  if (Math.abs(top.x - foot.x) > 1 || top.y >= foot.y) return null;
  return { x: foot.x, foot: foot.y, top: Math.max(0, top.y) };
}

/** 02 §3.4: 1 Lift Foot Kit covers H ≤ 31; one Lift Rail per further 32 rows. */
export function liftRails(foot: number, top: number): number {
  return Math.max(0, Math.ceil((foot - top - 31) / 32));
}

/** Lift chip (03 §4.5 step 3): "H 45 · Foot Kit + 1 Rail · 30/min · 30 s". */
export function liftChip(foot: number, top: number): string {
  const h = foot - top;
  const rails = liftRails(foot, top);
  const kits = rails > 0 ? `Foot Kit + ${rails} Rail${rails > 1 ? 's' : ''}` : 'Foot Kit';
  const transit = Math.round((h * 40) / 3 / 20);
  return `H ${h} · ${kits} · 30/min · ${transit} s`;
}

/** Drill sites (02 §2.4): 2×2 on rows top−2…top−1 over columns {x0, x0+1} or {x0+1, x0+2} of discovered lodes. */
export function drillSites(lodes: readonly Lode[], visible: (l: Lode) => boolean): { cell: Cell; lode: number }[] {
  const out: { cell: Cell; lode: number }[] = [];
  for (const l of lodes) {
    if (!l.discovered || !visible(l)) continue;
    out.push({ cell: { x: l.x0, y: l.top - 2 }, lode: l.id }, { cell: { x: l.x0 + 1, y: l.top - 2 }, lode: l.id });
  }
  return out;
}

/** Snap a drill footprint to the nearest site within 1 cell (03 §4.9), else null. `pick` filters candidates. */
export function snapDrill(at: Cell, sites: readonly { cell: Cell; lode: number }[], pick: (c: Cell) => boolean = () => true): Cell | null {
  let best: Cell | null = null;
  let bestD = 2;
  for (const s of sites) {
    const d = Math.max(Math.abs(s.cell.x - at.x), Math.abs(s.cell.y - at.y));
    if (d < bestD && pick(s.cell)) {
      best = s.cell;
      bestD = d;
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

/**
 * Footprint min corner that puts a fractional plane point (fx, fy) in the middle of a w × h piece. Even sizes break
 * the tie toward the touched cell: a tap on a cell's centre makes it the 2×2's min corner (only the near 40% of the
 * cell picks the neighbour), so a dead-centre tap never flips on rounding.
 */
const FOOTPRINT_BIAS = 0.1;
export function footprintAt(fx: number, fy: number, w: number, h: number): Cell {
  const at = (f: number, n: number): number => (n === 1 ? Math.floor(f) : Math.round(f - n / 2 + FOOTPRINT_BIAS));
  return { x: at(fx, w), y: at(fy, h) };
}

export function inFootprint(c: Cell, x: number, y: number, w: number, h: number): boolean {
  return c.x >= x && c.x < x + w && c.y >= y && c.y < y + h;
}

// ---------------------------------------------------------------- Kits

/** Kit units in the bay by Kit id (metered Kits count their remaining units, canon §4.8). */
export function kitsInCargo(cargo: readonly CargoItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cargo) {
    if (c.kind !== 'kit') continue;
    out[c.id] = (out[c.id] ?? 0) + (KIT_METER[c.id] !== undefined ? (c.units ?? kitUnits(c.id)) : 1);
  }
  return out;
}

export interface ShoppingLine {
  kit: string;
  /** Units the pending ghosts consume, and units carried. */
  needUnits: number;
  haveUnits: number;
  /** Whole Kits needed, carried towards it, and still to buy. */
  needKits: number;
  haveKits: number;
  buyKits: number;
}

/** Shopping list (02 §2.9; 03 §4.6): Kits the pending underground ghosts still need against the bay. */
export function shoppingList(ghosts: readonly GhostView[], carried: Readonly<Record<string, number>>): ShoppingLine[] {
  const need: Record<string, number> = {};
  const order: string[] = [];
  for (const g of ghosts) {
    if (!g.kit) continue;
    if (need[g.kit] === undefined) {
      need[g.kit] = 0;
      order.push(g.kit);
    }
    need[g.kit] += g.kitUnits;
  }
  return order.map((kit) => {
    const meter = kitUnits(kit);
    const needUnits = need[kit];
    const haveUnits = carried[kit] ?? 0;
    const needKits = Math.ceil(needUnits / meter);
    const haveKits = Math.min(needKits, Math.ceil(Math.min(haveUnits, needUnits) / meter));
    const buyKits = Math.ceil(Math.max(0, needUnits - haveUnits) / meter);
    return { kit, needUnits, haveUnits, needKits, haveKits, buyKits };
  });
}

/** "Kits: 3 needed, 2 carried" (03 §4.1 pending chip); short = some Kit still to buy. */
export function shoppingSummary(lines: readonly ShoppingLine[]): { text: string; short: boolean } {
  let need = 0;
  let have = 0;
  let short = false;
  for (const l of lines) {
    need += l.needKits;
    have += l.haveKits;
    if (l.buyKits > 0) short = true;
  }
  return { text: `Kits: ${need} needed, ${have} carried`, short };
}

// ---------------------------------------------------------------- cards (03 §2.3–2.4 tray)

export type Tool = BuildingKind | 'bulldoze';
export type TrayTab = 'logistics' | 'process' | 'storage' | 'extract' | 'tools';

export const TABS: Readonly<Record<Plane, readonly { id: TrayTab; label: string }[]>> = {
  yard: [
    { id: 'logistics', label: 'Logistics' },
    { id: 'process', label: 'Process' },
    { id: 'storage', label: 'Storage' },
    { id: 'tools', label: 'Tools' },
  ],
  mine: [
    { id: 'logistics', label: 'Logistics' },
    { id: 'extract', label: 'Extract' },
    { id: 'tools', label: 'Tools' },
  ],
};

const TAB_TOOLS: Readonly<Record<Plane, Partial<Record<TrayTab, readonly Tool[]>>>> = {
  yard: { logistics: ['belt', 'router', 'headframe'], process: ['smelter', 'assembler'], storage: ['bin', 'export'], tools: ['bulldoze'] },
  mine: { logistics: ['belt', 'router', 'lift'], extract: ['autoDrill'], tools: ['bulldoze'] },
};

/** 02 §9.2: until the first ingot only the pieces the survey set needs are highlighted. */
const FIRST_PIECES: readonly Tool[] = ['autoDrill', 'lift', 'belt'];

export interface CardModel {
  tool: Tool;
  name: string;
  /** Price (Yard) or Kits in the bay (underground). */
  sub: string;
  locked: boolean;
  /** "Unlocks: Discover a lode" when locked. */
  lockText: string | null;
  highlight: boolean;
}

export interface CardDeps {
  unlocked(rung: Rung): boolean;
  /** Kit units in the bay. */
  carried: Readonly<Record<string, number>>;
  /** v1 content is visible in this build. */
  v1: boolean;
}

/** Tools a plane offers (all tabs), in tray order. */
export function planeTools(plane: Plane): Tool[] {
  const out: Tool[] = [];
  for (const t of TABS[plane]) for (const k of TAB_TOOLS[plane][t.id] ?? []) if (!out.includes(k)) out.push(k);
  return out;
}

/**
 * The tray tab that holds `tool` on `plane` (Extract for the Auto-Drill, Logistics for the Lift); `current` when it
 * already does (Bulldoze sits on Tools only), null when no tab has it.
 */
export function tabOf(plane: Plane, tool: Tool, current?: TrayTab): TrayTab | null {
  if (current && TAB_TOOLS[plane][current]?.includes(tool)) return current;
  for (const t of TABS[plane]) if (TAB_TOOLS[plane][t.id]?.includes(tool)) return t.id;
  return null;
}

export function toolOnPlane(tool: Tool, plane: Plane): boolean {
  if (tool === 'bulldoze') return true;
  const d = BUILDINGS[tool];
  return plane === 'yard' ? d.yard !== null : d.mine !== null;
}

export function cardsFor(plane: Plane, tab: TrayTab, deps: CardDeps): CardModel[] {
  const firstIngot = deps.unlocked('U3');
  return (TAB_TOOLS[plane][tab] ?? []).map((tool) => {
    if (tool === 'bulldoze') return { tool, name: 'Bulldoze', sub: 'Remove', locked: false, lockText: null, highlight: false };
    const spec = BUILDINGS[tool].mks[0];
    const locked = (spec.scope === 'v1' && !deps.v1) || !deps.unlocked(spec.rung);
    let sub: string;
    if (plane === 'yard') sub = tool === 'belt' ? `${formatCash(spec.cash)}/tile` : formatCash(spec.cash);
    else {
      const kit = spec.kit ?? '';
      const units = deps.carried[kit] ?? 0;
      const kits = Math.ceil(units / kitUnits(kit));
      sub = tool === 'lift' ? `Kit ×${kits} · R${deps.carried[LIFT_RAIL_KIT] ?? 0}` : `Kit ×${kits}`;
    }
    return {
      tool,
      name: shortName(tool),
      sub,
      locked,
      lockText: locked ? unlockText(spec.rung) : null,
      highlight: !locked && !firstIngot && FIRST_PIECES.includes(tool),
    };
  });
}

// ---------------------------------------------------------------- layout (03 §2.3–2.4, §1.5)

export type DockId = 'done' | 'undo' | 'redo' | 'pan' | 'rotate' | 'clear' | 'ok';

export interface DockSlot {
  id: DockId;
  x: number;
  w: number;
}

export const DOCK_H = 56;
export const TRAY_H = 128;
export const BTN = 44;
export const OK_W = 56;

/**
 * Dock band buttons (03 §2.3; UX review M8): [✕ Done] [↶] [↷] … [✋] [↻] [✗] [✓], 44-pt targets, ✓ 56 pt on the
 * dominant side 12 pt from ✗. At 375 pt: ✕ 8, ↶ 56, ↷ 104, ✋ 159, ↻ 207, ✗ 255, ✓ 311–367; the right group
 * follows the right edge (+18 at 393). Narrower phones tighten the margins (360 pt), then move ✋ to the zoom
 * stack (320 pt) so no target shrinks below 44 pt. Left-handed mirrors the band.
 */
export function dockLayout(width: number, leftHanded: boolean): DockSlot[] {
  const fits = (edge: number, okGap: number, withPan: boolean): DockSlot[] | null => {
    const ok = width - edge - OK_W;
    const clear = ok - okGap - BTN;
    const rotate = clear - 4 - BTN;
    const pan = rotate - 4 - BTN;
    const redoEnd = edge + 2 * (BTN + 4) + BTN;
    if ((withPan ? pan : rotate) < redoEnd + 4) return null;
    const slots: DockSlot[] = [
      { id: 'done', x: edge, w: BTN },
      { id: 'undo', x: edge + BTN + 4, w: BTN },
      { id: 'redo', x: edge + 2 * (BTN + 4), w: BTN },
    ];
    if (withPan) slots.push({ id: 'pan', x: pan, w: BTN });
    slots.push({ id: 'rotate', x: rotate, w: BTN }, { id: 'clear', x: clear, w: BTN }, { id: 'ok', x: ok, w: OK_W });
    return slots;
  };
  const slots = fits(8, 12, true) ?? fits(4, 8, true) ?? fits(4, 8, false) ?? (fits(2, 4, false) as DockSlot[]);
  return leftHanded ? slots.map((s) => ({ ...s, x: width - s.x - s.w })) : slots;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The world area (canon §3.12 clear rect above the dock and tray), CSS px. */
export function worldArea(width: number, height: number, insetTop: number, insetBottom: number, hudRow = 44): Rect {
  return { x0: 0, y0: insetTop + hudRow, x1: width, y1: height - insetBottom - TRAY_H - DOCK_H };
}

export const LOUPE = { size: 88, above: 120, side: 64 } as const;

/**
 * Loupe placement (canon §3.12; 03 §4.9): 120 pt above the finger, offset to the non-dominant side, flipped to
 * the other side when it would leave the screen, and never below the finger. Returns its top-left corner.
 */
export function loupePlace(fx: number, fy: number, area: Rect, leftHanded: boolean): { x: number; y: number } {
  const s = LOUPE.size;
  const side = leftHanded ? 1 : -1;
  let cx = fx + side * LOUPE.side;
  if (cx - s / 2 < area.x0 + 4 || cx + s / 2 > area.x1 - 4) cx = fx - side * LOUPE.side;
  cx = Math.max(area.x0 + 4 + s / 2, Math.min(area.x1 - 4 - s / 2, cx));
  const cy = Math.max(area.y0 + 4 + s / 2, Math.min(fy - LOUPE.above, fy - s / 2));
  return { x: cx - s / 2, y: cy - s / 2 };
}
