// Stick sectors with ±10° hysteresis (03 §3.2). Pure. The pod keeps the authoritative sector in
// PodState.sector; input uses this for the stick visual (which way a push will act).
import type { Sector } from '../pod/types';

const HYSTERESIS_DEG = 10;
/** Sector centres in screen-math degrees (0 = right, 90 = up). */
const CENTRE: Readonly<Record<Exclude<Sector, 'none'>, number>> = { right: 0, up: 90, left: 180, down: 270 };

/** Stick angle in degrees, [0, 360), 0 = right, counter-clockwise (sy is UP-positive). */
export function stickAngleDeg(sx: number, sy: number): number {
  const a = (Math.atan2(sy, sx) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
}

/** Smallest absolute difference between two angles in degrees. */
function angleDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function enterSector(deg: number): Exclude<Sector, 'none'> {
  if (deg < 45 || deg >= 315) return 'right';
  if (deg < 135) return 'up';
  if (deg < 225) return 'left';
  return 'down';
}

/** Sector for a stick vector, keeping `prev` while the angle stays within its ±55° leave range. */
export function stickSector(sx: number, sy: number, prev: Sector): Sector {
  if (sx === 0 && sy === 0) return 'none';
  const deg = stickAngleDeg(sx, sy);
  if (prev !== 'none' && angleDelta(deg, CENTRE[prev]) <= 45 + HYSTERESIS_DEG) return prev;
  return enterSector(deg);
}
