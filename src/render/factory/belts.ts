// Belt tiles from the factory's belt word layer (04 §4.1; 02 §2.1): which tiles run straight, turn a corner or
// cross as a Junction, and where a line starts or ends (the chevrons fade there). Pure: mirrors the factory's
// published word layout (factory/api beltWords) and its corner rule (straight-behind wins, else one side feeder).
import { MINE_W } from '../../shared/canon';
import type { Dir } from '../../factory/api';

/** Word bits (factory/api beltWords): 15 present, 14 junction, tierA 12–13, dirA 10–11, tierB 8–9, dirB 6–7. */
export const BELT_PRESENT = 0x8000;
export const BELT_JUNCTION = 0x4000;

const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

export function wordDirA(w: number): Dir {
  return ((w >> 10) & 3) as Dir;
}
export function wordDirB(w: number): Dir {
  return ((w >> 6) & 3) as Dir;
}
export function wordTierA(w: number): number {
  return (w >> 12) & 3;
}
export function isJunctionWord(w: number): boolean {
  return (w & BELT_JUNCTION) !== 0;
}
/** Tier of the slot travelling `dir` in word w, 0 if none. */
export function slotTier(w: number, dir: number): number {
  if ((w & BELT_PRESENT) === 0) return 0;
  if (((w >> 10) & 3) === dir) return (w >> 12) & 3;
  if ((w & BELT_JUNCTION) !== 0 && ((w >> 6) & 3) === dir) return (w >> 8) & 3;
  return 0;
}

function wordAt(words: Readonly<Uint16Array>, rows: number, x: number, y: number): number {
  if (x < 0 || x >= MINE_W || y < 0 || y >= rows) return 0;
  return words[y * MINE_W + x];
}

/**
 * Travel direction entering slot (x, y, dir): `dir` when fed straight from behind, a side feeder's direction
 * when that tile turns a corner, or −1 when nothing feeds it (a line tail). Junction slots only pass straight.
 */
export function entryDir(words: Readonly<Uint16Array>, rows: number, x: number, y: number, dir: number): number {
  const back = (dir + 2) & 3;
  if (slotTier(wordAt(words, rows, x + DX[back], y + DY[back]), dir) !== 0) return dir;
  if (isJunctionWord(wordAt(words, rows, x, y))) return -1;
  for (const e of [(dir + 1) & 3, (dir + 3) & 3]) {
    // A side feeder sits on the side it comes from, i.e. opposite its travel direction e.
    const s = (e + 2) & 3;
    if (slotTier(wordAt(words, rows, x + DX[s], y + DY[s]), e) !== 0) return e;
  }
  return -1;
}

/** Whether slot (x, y, dir) passes its items on to a downstream belt slot that takes them from it. */
export function feedsOn(words: Readonly<Uint16Array>, rows: number, x: number, y: number, dir: number): boolean {
  const nx = x + DX[dir], ny = y + DY[dir];
  const w = wordAt(words, rows, nx, ny);
  if ((w & BELT_PRESENT) === 0) return false;
  if (isJunctionWord(w)) return slotTier(w, dir) !== 0;
  const e = wordDirA(w);
  if (e === ((dir + 2) & 3)) return false;
  return entryDir(words, rows, nx, ny, e) === dir;
}

export const SHAPE_STRAIGHT = 0;
export const SHAPE_CORNER = 1;
export const SHAPE_JUNCTION = 2;

/** One rendered belt tile (a Junction is one tile carrying two straight chevron runs). */
export interface BeltTile {
  x: number;
  y: number;
  /** Exit (travel) direction; a Junction's first slot. */
  dir: Dir;
  /** Corners: the entry travel direction; otherwise = dir. */
  entry: Dir;
  shape: number;
  /** Corners: +1 when the exit is the entry turned clockwise (dir index + 1), −1 anticlockwise. */
  turn: number;
  tier: number;
  /** No upstream slot (chevrons grow in at the entry edge). */
  tail: boolean;
  /** Feeds no further belt (chevrons shrink out at the exit edge). */
  head: boolean;
  /** Junctions: the second slot's direction and its line ends. */
  dirB: Dir;
  tailB: boolean;
  headB: boolean;
}

/** Decode every belt tile of a plane's word layer (rows × 48), in cell order. */
export function beltTiles(words: Readonly<Uint16Array>, rows: number): BeltTile[] {
  const out: BeltTile[] = [];
  const n = Math.min(words.length, rows * MINE_W);
  for (let i = 0; i < n; i++) {
    const w = words[i];
    if ((w & BELT_PRESENT) === 0) continue;
    const x = i % MINE_W;
    const y = (i - x) / MINE_W;
    const dir = wordDirA(w);
    const junction = isJunctionWord(w);
    const entry = entryDir(words, rows, x, y, dir);
    const corner = !junction && entry >= 0 && entry !== dir;
    const dirB = junction ? wordDirB(w) : dir;
    out.push({
      x,
      y,
      dir,
      entry: (corner ? entry : dir) as Dir,
      shape: junction ? SHAPE_JUNCTION : corner ? SHAPE_CORNER : SHAPE_STRAIGHT,
      turn: corner ? (((dir - entry) & 3) === 1 ? 1 : -1) : 0,
      tier: wordTierA(w),
      tail: entry < 0,
      head: !feedsOn(words, rows, x, y, dir),
      dirB,
      tailB: junction ? entryDir(words, rows, x, y, dirB) < 0 : false,
      headB: junction ? !feedsOn(words, rows, x, y, dirB) : false,
    });
  }
  return out;
}

/**
 * Belt tiles along a painted path (build preview; 03 §4.4): each cell faces the next one, the last faces `endDir`
 * (or keeps the last step's direction), and a direction change makes a corner.
 */
export function pathTiles(path: readonly { x: number; y: number }[], endDir?: Dir): BeltTile[] {
  const out: BeltTile[] = [];
  let prevDir = -1;
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    let dir: number;
    if (i + 1 < path.length) dir = dirBetween(c, path[i + 1]);
    else dir = endDir ?? (prevDir >= 0 ? prevDir : 0);
    if (dir < 0) dir = prevDir >= 0 ? prevDir : 0;
    const entry = prevDir >= 0 ? prevDir : dir;
    const corner = entry !== dir && ((dir - entry) & 3) !== 2;
    out.push({
      x: c.x,
      y: c.y,
      dir: dir as Dir,
      entry: (corner ? entry : dir) as Dir,
      shape: corner ? SHAPE_CORNER : SHAPE_STRAIGHT,
      turn: corner ? (((dir - entry) & 3) === 1 ? 1 : -1) : 0,
      tier: 1,
      tail: i === 0,
      head: i === path.length - 1,
      dirB: dir as Dir,
      tailB: false,
      headB: false,
    });
    prevDir = dir;
  }
  return out;
}

/** Direction from cell a to its 4-neighbour b, or −1 when they are not adjacent. */
export function dirBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return -1;
  return dx === 1 ? 0 : dy === 1 ? 1 : dx === -1 ? 2 : 3;
}
