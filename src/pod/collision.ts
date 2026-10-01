// Pod AABB vs the cell grid (canon §3.1; 01 §3.2). PURE MODULE.
// The pod is a POD_W × POD_H box centred on (x, y). Cell (c, r) spans x ∈ [c, c+1], y ∈ [−(r+1), −r].
// Per-step motion is < 0.3 tiles (|v| ≤ 16.8 tiles/s), so a move can enter at most one new row/column.
import { MINE_H, MINE_W, POD_H, POD_W, SEAL_ROW, SKY_ROWS } from '../shared/canon';
import { T } from '../shared/types';
import type { TerrainGrid } from '../terrain/grid';
import type { PodState } from './types';

export const HALF_W = POD_W / 2;
export const HALF_H = POD_H / 2;
/** Penetration below this is "touching", not overlapping (absorbs float error from snapping). */
const EPS = 1e-6;
/** Distance within which the pod counts as resting on / touching a cell face. */
export const CONTACT_EPS = 1e-4;
/** A side push reaches the next column from anywhere up to the cell centre (the pod is 0.86 wide). */
export const SIDE_REACH = (1 - POD_W) / 2 + CONTACT_EPS;

/**
 * First row the pod treats as a solid, undiggable scope floor: the M0 (r128) / MVP (r320) overlay.
 * In v1 (floorRow ≥ the Seal row) the real Seal, its Notch and the Hollow Heart apply instead.
 */
export function forcedFloorRow(floorRow: number): number {
  return floorRow < SEAL_ROW ? floorRow : MINE_H;
}

/** Does cell (c, r) block the pod? Solid terrain, factory occupants, the side frame and the scope floor do; mounts never. */
export function blocksPod(grid: TerrainGrid, c: number, r: number, floor: number): boolean {
  if (c < 0 || c >= MINE_W) return true;
  if (r < 0) return false;
  if (r >= floor || r >= MINE_H) return true;
  const i = r * MINE_W + c;
  return grid.terrain[i] !== T.AIR || grid.occupant[i] !== 0;
}

/** A 1-wide floor gap: open cell with blocking cells either side (gap skim, 01 §3.2). */
function isNarrowGap(grid: TerrainGrid, c: number, r: number, floor: number): boolean {
  return !blocksPod(grid, c, r, floor) && blocksPod(grid, c - 1, r, floor) && blocksPod(grid, c + 1, r, floor);
}

export const colMin = (x: number): number => Math.floor(x - HALF_W + EPS);
export const colMax = (x: number): number => Math.ceil(x + HALF_W - EPS) - 1;
export const rowMin = (y: number): number => Math.floor(-(y + HALF_H) + EPS);
export const rowMax = (y: number): number => Math.ceil(-(y - HALF_H) - EPS) - 1;

function anyBlockingInCol(grid: TerrainGrid, c: number, r0: number, r1: number, floor: number): boolean {
  for (let r = r0; r <= r1; r++) if (blocksPod(grid, c, r, floor)) return true;
  return false;
}

function anyBlockingInRow(grid: TerrainGrid, r: number, c0: number, c1: number, floor: number, bridge: boolean): boolean {
  for (let c = c0; c <= c1; c++) {
    if (blocksPod(grid, c, r, floor)) return true;
    if (bridge && isNarrowGap(grid, c, r, floor)) return true;
  }
  return false;
}

/** Move horizontally by dx, stopping flush against blocking cells or the frame. Returns true if blocked. */
export function moveX(pod: PodState, grid: TerrainGrid, dx: number, floor: number): boolean {
  if (dx === 0) return false;
  let nx = pod.x + dx;
  let blocked = false;
  const r0 = rowMin(pod.y);
  const r1 = rowMax(pod.y);
  if (dx > 0) {
    const c = colMax(nx);
    if (anyBlockingInCol(grid, c, r0, r1, floor)) {
      nx = c - HALF_W;
      blocked = true;
    }
  } else {
    const c = colMin(nx);
    if (anyBlockingInCol(grid, c, r0, r1, floor)) {
      nx = c + 1 + HALF_W;
      blocked = true;
    }
  }
  pod.x = nx;
  return blocked;
}

export const YHit = { None: 0, Floor: 1, Ceiling: 2 } as const;
export type YHit = (typeof YHit)[keyof typeof YHit];

/**
 * Move vertically by dy, stopping flush on floors and under ceilings. `bridge` treats 1-wide gaps in
 * the floor as solid (gap skim). The sky has a soft lid at SKY_ROWS (thrust is already 0 there).
 */
export function moveY(pod: PodState, grid: TerrainGrid, dy: number, floor: number, bridge: boolean): YHit {
  if (dy === 0) return YHit.None;
  let ny = pod.y + dy;
  let hit: YHit = YHit.None;
  const c0 = colMin(pod.x);
  const c1 = colMax(pod.x);
  if (dy < 0) {
    const r = rowMax(ny);
    if (anyBlockingInRow(grid, r, c0, c1, floor, bridge)) {
      ny = -r + HALF_H;
      hit = YHit.Floor;
    }
  } else {
    const r = rowMin(ny);
    if (anyBlockingInRow(grid, r, c0, c1, floor, false)) {
      ny = -(r + 1) - HALF_H;
      hit = YHit.Ceiling;
    } else if (ny + HALF_H > SKY_ROWS) {
      ny = SKY_ROWS - HALF_H;
      hit = YHit.Ceiling;
    }
  }
  pod.y = ny;
  return hit;
}

/** Is the pod resting on something (its bottom face flush with a blocking or bridged cell top)? */
export function isSupported(pod: Readonly<PodState>, grid: TerrainGrid, floor: number, bridge: boolean): boolean {
  const depth = HALF_H - pod.y; // −bottom
  const k = Math.round(depth);
  if (Math.abs(depth - k) > CONTACT_EPS) return false;
  return anyBlockingInRow(grid, k, colMin(pod.x), colMax(pod.x), floor, bridge);
}
