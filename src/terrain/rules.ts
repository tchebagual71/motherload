// Static terrain rules shared by the generator and its callers. PURE MODULE.
import { BAND_ROWS, MINE_W, RIM_BUILDINGS } from '../shared/canon';

/** True when Rim column x lies under one of the four Rim buildings / pads (canon §2.4). */
export function isUnderRimPad(x: number): boolean {
  for (const b of RIM_BUILDINGS) if (x >= b.x0 && x <= b.x1) return true;
  return false;
}

/**
 * Valid Headframe column (02 §2.2): column c is clear of the Rim buildings and the 2×2 Headframe
 * fits at {c, c+1} or {c−1, c} without touching one. Yields 5–9, 14–29, 34–39, 44–47 (31 columns).
 */
export function isValidHeadframeColumn(c: number): boolean {
  if (c < 0 || c >= MINE_W || isUnderRimPad(c)) return false;
  return isFreeYardColumn(c + 1) || isFreeYardColumn(c - 1);
}

function isFreeYardColumn(x: number): boolean {
  return x >= 0 && x < MINE_W && !isUnderRimPad(x);
}

/** 64-row worldgen band (0–9 for the diggable rows; canon §3.1) that seeds row r. */
export function genBandOf(row: number): number {
  return Math.floor(row / BAND_ROWS);
}
