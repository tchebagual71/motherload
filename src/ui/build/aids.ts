// Placement of the pending ghost's DOM aids (03 §4.3 nudge arrows, §6.2 reason label): pure geometry in CSS px.
// The label stays inside the world area and clear of the top bar, the goal chip and the toast stack; the 44-pt
// arrows stay clear of the label and of the fingers that grab the ghost: with the lifted point (canon §3.12) a
// finger aiming at a footprint cell rests 44 pt below it, which is where a bare "0.9 cells off the footprint"
// arrow lands, so a tap meant for the ghost nudged it instead (BUILD-6).
import type { Rect } from './tools';

export interface Pt {
  x: number;
  y: number;
}

/** Label text metrics (12-px 800 Nunito, 8-px side padding; build.css .hf-ghost-label): a generous estimate. */
export const LABEL = { charW: 7, padX: 16, h: 22, maxW: 220, gapAbove: 30, gapBelow: 26, edge: 8 } as const;
/** Nudge arrow target (03 §4.3: 44 pt). */
export const NUDGE_BOX = 44;
/** Clearance from a fingertip's centre to an arrow's box: a finger aiming at the ghost never lands on an arrow. */
export const FINGER_CLEAR = 24;
/** Arrow distance from the footprint edge, in cells: the first try, the step outward, and the farthest try. */
export const NUDGE_REACH = { base: 0.9, step: 0.5, max: 3.4 } as const;

export function labelWidth(text: string): number {
  return Math.min(LABEL.maxW, LABEL.padX + text.length * LABEL.charW);
}

/**
 * The reason label's box (top-left x, y and size): centred over the ghost's anchor, clamped to the world area's
 * sides, and flipped below the ghost (`below`, the lowest footprint point on screen) when it would reach above
 * `topClear` (the top bar, goal chip or toast stack). Null when neither side fits.
 */
export function labelBox(anchor: Pt, below: number, w: number, h: number, area: Rect, topClear: number): { x: number; y: number; w: number; h: number } | null {
  const x = Math.max(area.x0 + LABEL.edge, Math.min(area.x1 - LABEL.edge - w, anchor.x - w / 2));
  const above = anchor.y - LABEL.gapAbove - h;
  if (above >= topClear && above + h <= area.y1) return { x, y: above, w, h };
  const under = below + LABEL.gapBelow;
  if (under >= topClear && under + h <= area.y1) return { x, y: under, w, h };
  return null;
}

/** Distance from point p to an axis-aligned box (0 inside). */
export function boxDistance(p: Pt, b: Rect): number {
  const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
  const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
  return Math.hypot(dx, dy);
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * Centre of one nudge arrow, or null when it has no clear spot. `at(reach)` is the screen point `reach` cells off
 * the footprint edge in the arrow's plane direction (the projection is affine, so pushing it out keeps the arrow on
 * its direction's line). Tries the base reach, then steps outward until the 44-pt box is inside the world area,
 * at least FINGER_CLEAR from every finger point, and off every `avoid` box (the label, the arrows placed so far).
 */
export function nudgeSpot(at: (reach: number) => Pt | null, fingers: readonly Pt[], avoid: readonly Rect[], area: Rect): Pt | null {
  const r = NUDGE_BOX / 2;
  for (let reach: number = NUDGE_REACH.base; reach <= NUDGE_REACH.max + 1e-9; reach += NUDGE_REACH.step) {
    const a = at(reach);
    if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
    const box = { x0: a.x - r, y0: a.y - r, x1: a.x + r, y1: a.y + r };
    if (box.x0 < area.x0 || box.x1 > area.x1 || box.y0 < area.y0 || box.y1 > area.y1) return null; // only farther out from here
    if (fingers.some((f) => boxDistance(f, box) < FINGER_CLEAR)) continue;
    if (avoid.some((b) => overlaps(box, b))) continue;
    return a;
  }
  return null;
}
