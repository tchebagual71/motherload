// Stick sectors: 90° sectors with ±10° hysteresis (canon §3.6; 03 §3.2). PURE MODULE.
// Comparison-only (no atan2) so the step stays bit-exact across engines. Entry boundaries match
// input/sectors.ts (right [−45°, 45°), up [45°, 135°), left [135°, 225°), down [225°, 315°)).
import type { DigDir, Sector } from './types';

/** tan(45° + DIG_HYSTERESIS_DEG): a held sector is kept while the stick stays within ±55° of its centre. */
export const TAN_LEAVE = 1.4281480067421144;

function enterSector(sx: number, sy: number): Exclude<Sector, 'none'> {
  if (sx > 0 && sy < sx && sy >= -sx) return 'right';
  if (sy > 0 && sy >= sx && sy > -sx) return 'up';
  if (sx < 0 && sy <= -sx && sy > sx) return 'left';
  return 'down';
}

function withinLeave(sx: number, sy: number, s: Exclude<Sector, 'none'>): boolean {
  switch (s) {
    case 'right':
      return sx > 0 && Math.abs(sy) <= TAN_LEAVE * sx;
    case 'left':
      return sx < 0 && Math.abs(sy) <= -TAN_LEAVE * sx;
    case 'up':
      return sy > 0 && Math.abs(sx) <= TAN_LEAVE * sy;
    case 'down':
      return sy < 0 && Math.abs(sx) <= -TAN_LEAVE * sy;
  }
}

/** Sector for stick (sx, sy) (sy up-positive), keeping `prev` inside its ±55° leave range. */
export function nextSector(sx: number, sy: number, prev: Sector): Sector {
  if (sx === 0 && sy === 0) return 'none';
  if (prev !== 'none' && withinLeave(sx, sy, prev)) return prev;
  return enterSector(sx, sy);
}

/** Dig direction a sector pushes toward; never up (canon §3.6). */
export function digDirOf(sector: Sector): DigDir | null {
  return sector === 'down' || sector === 'left' || sector === 'right' ? sector : null;
}
