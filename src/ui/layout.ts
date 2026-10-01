// HUD row geometry (canon §3.12; 03 §6.1). Pure.
import { TOUCH } from '../shared/canon';

/** Pill widths per anchor viewport width: fuel, hull, cargo, info (menu is fixed at 44). */
const HUD_ANCHORS: readonly { w: number; cols: readonly [number, number, number, number] }[] = [
  { w: 360, cols: [78, 64, 62, 80] },
  { w: 375, cols: [84, 68, 64, 83] },
  { w: 393, cols: [88, 72, 68, 89] },
  { w: 430, cols: [96, 80, 74, 104] },
];
export const HUD_MARGIN = 8;
export const HUD_GAP = 4;
export const HUD_MENU = TOUCH.minHit;
export const HUD_PILL_H = 36;
/** Wider rows (tablets, desktop) keep the pills at this row width's sizes; the menu stays right-aligned. */
export const HUD_MAX_ROW = 516;

/** Width the four pills share at a given row width. */
function pillBudget(width: number): number {
  return width - 2 * HUD_MARGIN - 4 * HUD_GAP - HUD_MENU;
}

/**
 * Column widths [fuel, hull, cargo, info, menu] for a HUD row `width` pt wide (viewport minus side insets).
 * Interpolates the 03 §6.1 table between its anchors and scales proportionally outside it; the integer
 * widths always fill the row exactly (rounding slack goes to the info pill).
 */
export function hudColumns(rowWidth: number): [number, number, number, number, number] {
  const width = Math.min(rowWidth, HUD_MAX_ROW);
  const budget = pillBudget(width);
  const first = HUD_ANCHORS[0];
  const last = HUD_ANCHORS[HUD_ANCHORS.length - 1];
  let raw: number[];
  if (width <= first.w) raw = scaleTo(first.cols, budget);
  else if (width >= last.w) raw = scaleTo(last.cols, budget);
  else {
    let i = 0;
    while (HUD_ANCHORS[i + 1].w < width) i++;
    const a = HUD_ANCHORS[i];
    const b = HUD_ANCHORS[i + 1];
    const t = (width - a.w) / (b.w - a.w);
    raw = scaleTo(a.cols.map((c, k) => c + (b.cols[k] - c) * t), budget);
  }
  const cols = raw.map((c) => Math.floor(c));
  cols[3] += budget - (cols[0] + cols[1] + cols[2] + cols[3]);
  return [cols[0], cols[1], cols[2], cols[3], HUD_MENU];
}

function scaleTo(cols: readonly number[], budget: number): number[] {
  const sum = cols.reduce((s, c) => s + c, 0);
  return cols.map((c) => (c * budget) / sum);
}

/** HUD digit size (03 §1.5): 15 pt × text scale, capped at 15 pt below 380-pt width, else at 17. */
export function hudDigitPt(width: number, textScale = 1): number {
  return Math.min(15 * textScale, width < 380 ? 15 : 17);
}
