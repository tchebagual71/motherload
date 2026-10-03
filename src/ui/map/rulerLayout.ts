// Depth ruler geometry (canon §3.12; 03 §2.1–2.2, §4.11). Pure. All values in pt (CSS px), y down.
// A 24-pt rail on the dominant edge (one-handed: the non-dominant one) with a 44-pt hit strip extending inward,
// from 8 pt below the clear rect's top to 12 pt above the context button. A rail on the left edge sits 24 pt in,
// clear of the back-swipe edge (03 §1.5).
import { BANDS, TOUCH } from '../../shared/canon';
import { CLUSTER_BOTTOM_MARGIN, SLOT_GEOMETRY, THRUST_LAYOUT, type ControlSize } from '../../input/zones';

export const RULER_RAIL = 24;
export const RULER_HIT = TOUCH.minHit;
const TOP_GAP = 8;
const CONTEXT_GAP = 12;
const LEFT_EDGE_GAP = 24;
/** Context button heights (03 §1.5: 48 / 52 / 56 by control size; 52 in the THRUST layout). */
export const CONTEXT_SIZE: Record<ControlSize, number> = { S: 48, M: 52, L: 56 };

export interface RulerViewport {
  w: number;
  h: number;
  /** Safe-area insets. */
  it: number;
  ib: number;
  il: number;
  ir: number;
}

export interface RulerSettings {
  controlSize: ControlSize;
  thrustButton: boolean;
  leftHanded: boolean;
  oneHanded: boolean;
}

export interface RulerGeometry {
  side: 'left' | 'right';
  /** Rail x range. */
  railX0: number;
  railX1: number;
  /** Hit strip x range (contains the rail). */
  hitX0: number;
  hitX1: number;
  top: number;
  bottom: number;
}

/** Top of the context button: it sits one cluster gap above the 2×2 slot cluster (03 §2.1–2.2). */
export function contextTop(v: RulerViewport, s: RulerSettings): number {
  const { slot, gap } = s.thrustButton ? THRUST_LAYOUT : SLOT_GEOMETRY[s.controlSize];
  const clusterTop = v.h - v.ib - CLUSTER_BOTTOM_MARGIN - 2 * slot - gap;
  const size = s.thrustButton ? CONTEXT_SIZE.M : CONTEXT_SIZE[s.controlSize];
  return clusterTop - gap - size;
}

export function rulerGeometry(v: RulerViewport, s: RulerSettings): RulerGeometry {
  const dominantRight = !s.leftHanded;
  const right = s.oneHanded ? !dominantRight : dominantRight;
  const top = v.it + TOUCH.hudRow + TOP_GAP;
  let bottom = contextTop(v, s) - CONTEXT_GAP;
  // One-handed puts the rail on the stick side: keep its hit strip above the stick zone (0.45 H, canon §3.12).
  if (s.oneHanded) bottom = Math.min(bottom, 0.45 * v.h - CONTEXT_GAP);
  bottom = Math.max(top + RULER_HIT, bottom);
  if (right) {
    const x1 = v.w - v.ir;
    return { side: 'right', railX0: x1 - RULER_RAIL, railX1: x1, hitX0: x1 - RULER_HIT, hitX1: x1, top, bottom };
  }
  const x0 = v.il + LEFT_EDGE_GAP;
  return { side: 'left', railX0: x0, railX1: x0 + RULER_RAIL, hitX0: x0, hitX1: x0 + RULER_HIT, top, bottom };
}

/** Rail y of a mine row: the rail maps rows 0 … floorRow onto its height (03 §4.11). */
export function rowToRail(row: number, floorRow: number, top: number, bottom: number): number {
  const t = Math.max(0, Math.min(1, row / floorRow));
  return top + t * (bottom - top);
}

/** Band segments of the rail (canon §2.5) down to the floor: [top row, bottom row exclusive, band index]. */
export function railBands(floorRow: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  BANDS.forEach((b, i) => {
    if (b.top >= floorRow) return;
    out.push([b.top, Math.min(floorRow, b.bottom + 1), i]);
  });
  return out;
}
