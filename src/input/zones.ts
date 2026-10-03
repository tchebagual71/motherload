// Touch-zone geometry for pod mode (canon §3.12; 03 §1.5, §2.1–2.2). Pure: no DOM.
// All values are CSS px (= pt). y grows downwards (screen space).
import { TOUCH } from '../shared/canon';

export type ControlSize = 'S' | 'M' | 'L';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What input needs to know about the viewport (supplied by app/ via getLayout). */
export interface InputLayout {
  width: number;
  height: number;
  /** Control zone height including the bottom inset (canon §3.12). */
  controlZone: number;
  /** Top inset + HUD row. */
  clearTop: number;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** Bottom safe-area inset implied by a layout: the control zone minus its base height for this size. */
export function bottomInsetOf(layout: InputLayout, size: ControlSize): number {
  return Math.max(0, layout.controlZone - TOUCH.controlZone[size]);
}

/**
 * Stick spawn zone (canon §3.12): x 24 … min(0.55 W, 300), y 0.45 H … H − bottom inset.
 * Left-handed mirrors x (03 §1.5), which also keeps the 24-pt back-swipe exclusion on the right edge.
 */
export function stickSpawnZone(layout: InputLayout, size: ControlSize, leftHanded: boolean): Rect {
  const edge = 24;
  const far = Math.min(0.55 * layout.width, TOUCH.stickZoneMaxPt);
  const y0 = 0.45 * layout.height;
  const y1 = layout.height - bottomInsetOf(layout, size);
  return leftHanded
    ? { x0: layout.width - far, y0, x1: layout.width - edge, y1 }
    : { x0: edge, y0, x1: far, y1 };
}

/** Slot size and gap per control size (03 §1.5: slots 56/60/64, gaps 10/12/14). */
export const SLOT_GEOMETRY: Record<ControlSize, { slot: number; gap: number }> = {
  S: { slot: 56, gap: 10 },
  M: { slot: 60, gap: 12 },
  L: { slot: 64, gap: 14 },
};
/** THRUST layout (03 §1.5): 64-pt THRUST left of a 2×2 cluster of 52-pt slots, gaps 12. */
export const THRUST_LAYOUT = { slot: 52, gap: 12, thrust: 64 } as const;
/** Cluster margins from the wireframes (03 §2.1–2.2): 16 from the side edge, 12 above the bottom inset. */
export const CLUSTER_SIDE_MARGIN = 16;
export const CLUSTER_BOTTOM_MARGIN = 12;

export interface ControlRects {
  /** Quick slots 0..3 in reading order (top-left, top-right, bottom-left, bottom-right). */
  slots: [Rect, Rect, Rect, Rect];
  thrust: Rect | null;
}

/** Slot size and gap: the THRUST layout and one-handed mode use the 2×2 cluster of 52-pt slots (canon §3.12). */
export function slotGeometry(size: ControlSize, thrustButton: boolean, oneHanded = false): { slot: number; gap: number } {
  return thrustButton || oneHanded ? THRUST_LAYOUT : SLOT_GEOMETRY[size];
}

/** Quick-slot cluster (and optional THRUST button) in the dominant bottom corner. */
export function controlRects(
  width: number,
  height: number,
  bottomInset: number,
  size: ControlSize,
  thrustButton: boolean,
  leftHanded: boolean,
  oneHanded = false,
): ControlRects {
  const { slot, gap } = slotGeometry(size, thrustButton, oneHanded);
  const bottom = height - bottomInset - CLUSTER_BOTTOM_MARGIN;
  const rowTop = [bottom - 2 * slot - gap, bottom - slot];
  // Columns measured from the dominant edge: col 0 is the outer column on that side.
  const outer = leftHanded ? CLUSTER_SIDE_MARGIN : width - CLUSTER_SIDE_MARGIN - slot;
  const inner = leftHanded ? outer + slot + gap : outer - slot - gap;
  const colLeft = leftHanded ? [outer, inner] : [inner, outer];
  const rect = (col: number, row: number): Rect => ({
    x0: colLeft[col],
    y0: rowTop[row],
    x1: colLeft[col] + slot,
    y1: rowTop[row] + slot,
  });
  const slots: ControlRects['slots'] = [rect(0, 0), rect(1, 0), rect(0, 1), rect(1, 1)];
  let thrust: Rect | null = null;
  if (thrustButton) {
    const t = THRUST_LAYOUT.thrust;
    const x0 = leftHanded ? colLeft[1] + slot + gap : colLeft[0] - gap - t;
    thrust = { x0, y0: bottom - t, x1: x0 + t, y1: bottom };
  }
  return { slots, thrust };
}

/** Where the 40% rest-hint ring sits (03 §3.1: first 3 trips), inside the spawn zone, mid control zone. */
export function restHintCentre(layout: InputLayout, size: ControlSize, leftHanded: boolean): { x: number; y: number } {
  const zone = stickSpawnZone(layout, size, leftHanded);
  const r = TOUCH.stickRadius[size];
  const y = layout.height - bottomInsetOf(layout, size) - TOUCH.controlZone[size] / 2;
  const x = leftHanded ? zone.x1 - r - 24 : zone.x0 + r + 24;
  return { x, y };
}

/** Context button size per control size (03 §1.5: 48 / 52 / 56). */
export const CONTEXT_SIZE: Record<ControlSize, number> = { S: 48, M: 52, L: 56 };

/**
 * Context button (03 §3.5; wireframes 03 §2.1–2.2): centred over the slot cluster, one cluster gap above it.
 * Mirrors with the cluster.
 */
export function contextRect(
  width: number,
  height: number,
  bottomInset: number,
  size: ControlSize,
  thrustButton: boolean,
  leftHanded: boolean,
  oneHanded = false,
): Rect {
  const { slots } = controlRects(width, height, bottomInset, size, thrustButton, leftHanded, oneHanded);
  const { gap } = slotGeometry(size, thrustButton, oneHanded);
  const c = CONTEXT_SIZE[size];
  const cx = (Math.min(slots[0].x0, slots[1].x0) + Math.max(slots[0].x1, slots[1].x1)) / 2;
  const y1 = slots[0].y0 - gap;
  return { x0: cx - c / 2, y0: y1 - c, x1: cx + c / 2, y1 };
}

/** One-handed virtual-origin height (canon §3.12): 0.70 H. */
export const ONE_HANDED_ORIGIN_Y = 0.7;
/** One-handed stick zone top (03 §3.6): pointer-downs at y ≥ 0.45 H, off the controls. */
export const ONE_HANDED_ZONE_Y = 0.45;

/**
 * One-handed stick zone (03 §3.6): y ≥ 0.45 H across the screen, keeping the 24-pt back-swipe exclusion on the
 * non-dominant edge (03 §1.1).
 */
export function oneHandedZone(layout: InputLayout, size: ControlSize, leftHanded: boolean): Rect {
  const edge = 24;
  const y1 = layout.height - bottomInsetOf(layout, size);
  return leftHanded
    ? { x0: 0, y0: ONE_HANDED_ZONE_Y * layout.height, x1: layout.width - edge, y1 }
    : { x0: edge, y0: ONE_HANDED_ZONE_Y * layout.height, x1: layout.width, y1 };
}

/**
 * One-handed virtual origin (canon §3.12): the pod's screen x at 0.70 H, kept a stick radius inside the screen so
 * its 40% ring stays visible. With no pod position yet, the screen centre.
 */
export function virtualOrigin(layout: InputLayout, size: ControlSize, podX: number | null): { x: number; y: number } {
  const r = TOUCH.stickRadius[size];
  const x = podX === null || !Number.isFinite(podX) ? layout.width / 2 : podX;
  return { x: Math.min(Math.max(x, r), layout.width - r), y: ONE_HANDED_ORIGIN_Y * layout.height };
}
