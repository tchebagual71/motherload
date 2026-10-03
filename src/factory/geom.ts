// Grid geometry shared by the factory internals: directions, plane sizes, cell indices, Yard rules. PURE MODULE.
import { MINE_H, MINE_W, RIM_BUILDINGS } from '../shared/canon';
import { isValidHeadframeColumn } from '../terrain/rules';
import { RIM_BUILDING_ROWS, YARD_MAX_ROWS, type Dir, type Plane } from './api';

export const W = MINE_W;
/** Yard cell rows 0..32 (row 0 is the Rim strip). */
export const YARD_H = YARD_MAX_ROWS + 1;
export const YARD = 0;
export const MINE = 1;
export type PlaneNum = 0 | 1;

export const DX: readonly number[] = [1, 0, -1, 0];
export const DY: readonly number[] = [0, 1, 0, -1];

export function opp(d: number): Dir {
  return ((d + 2) & 3) as Dir;
}
export function planeNum(p: Plane): PlaneNum {
  return p === 'yard' ? YARD : MINE;
}
export function planeName(p: number): Plane {
  return p === YARD ? 'yard' : 'mine';
}
export function planeRows(p: number): number {
  return p === YARD ? YARD_H : MINE_H;
}
export function inPlane(p: number, x: number, y: number): boolean {
  return x >= 0 && x < W && y >= 0 && y < planeRows(p);
}
export function cellOf(x: number, y: number): number {
  return y * W + x;
}
/** Neighbour cell index in direction d, or −1 off the plane. */
export function step(p: number, cell: number, d: number): number {
  const x = (cell % W) + DX[d];
  const y = Math.floor(cell / W) + DY[d];
  return inPlane(p, x, y) ? y * W + x : -1;
}

/** Yard cell under a Rim building (canon §2.4: 4×3 on Yard rows 1–3). */
export function isRimBuildingCell(x: number, y: number): boolean {
  if (y < 1 || y > RIM_BUILDING_ROWS) return false;
  for (const b of RIM_BUILDINGS) if (x >= b.x0 && x <= b.x1) return true;
  return false;
}

/** Left column of a 2-wide Headframe over survey column c: {c, c+1}, else {c−1, c} (02 §2.2). */
export function headframeX0(c: number): number {
  return isValidHeadframeColumn(c + 1) ? c : c - 1;
}

/** A Headframe at x (rows 1–2) covers a valid column (02 §2.2: 5–9, 14–29, 34–39, 44–47). */
export function headframeFits(x: number, y: number): boolean {
  return y === 1 && (isValidHeadframeColumn(x) || isValidHeadframeColumn(x + 1));
}

/** Smallest power of two ≥ n (n ≥ 1). */
export function pow2(n: number): number {
  let c = 1;
  while (c < n) c <<= 1;
  return c;
}
