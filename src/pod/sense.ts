// What the pod sees and finds: SEEN/CHARTED flags and lode discovery (canon §2.6, §2.9, §3.1;
// 01 §3.12, §4.11). PURE MODULE.
import { LODE_H, LODE_W, MINE_H, MINE_W } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import { F, type Lode, type Scope } from '../shared/types';
import type { TerrainGrid } from '../terrain/grid';
import { isLodeVisible } from '../terrain/scope';
import { scannerRadiusOf } from './stats';
import type { PodState } from './types';

/** Fixed light bubble (canon §2.6), tiles, squared (cell-centre distance from the pod's cell). */
const LIGHT_R2 = 4.5 * 4.5;
/** Map charting radius (Chebyshev, canon §3.1). */
const CHART_R = 8;

/** Mark cells around the pod's cell (cx, cr): SEEN inside the light bubble, CHARTED within 8 tiles. */
export function revealAround(grid: TerrainGrid, cx: number, cr: number): void {
  const r0 = Math.max(0, cr - CHART_R);
  const r1 = Math.min(MINE_H - 1, cr + CHART_R);
  const c0 = Math.max(0, cx - CHART_R);
  const c1 = Math.min(MINE_W - 1, cx + CHART_R);
  for (let r = r0; r <= r1; r++) {
    const dr = r - cr;
    for (let c = c0; c <= c1; c++) {
      const dc = c - cx;
      const want = dc * dc + dr * dr <= LIGHT_R2 ? F.CHARTED | F.SEEN : F.CHARTED;
      if ((grid.flags[r * MINE_W + c] & want) !== want) grid.setFlag(c, r, want);
    }
  }
}

/**
 * Reveal around the pod when it changes cell (or stands in a cell not yet SEEN: spawn, load,
 * teleport), so the 17×17 sweep runs only on cell changes.
 */
export function updateVisibility(pod: Readonly<PodState>, grid: TerrainGrid): void {
  const cx = Math.floor(pod.x);
  const cr = Math.floor(-pod.y);
  const moved = cx !== Math.floor(pod.prevX) || cr !== Math.floor(-pod.prevY);
  if (moved || (cr >= 0 && !grid.hasFlag(cx, cr, F.SEEN))) revealAround(grid, cx, cr);
}

/**
 * Discover every undiscovered, in-scope lode with a cell within the Scanner radius (Chebyshev) of the
 * pod's cell. Unknown seams are never discovered (canon §2.1).
 */
export function discoverLodes(pod: Readonly<PodState>, grid: TerrainGrid, scope: Scope, out: GameEvent[]): void {
  const lodes = grid.lodes;
  if (lodes.length === 0) return;
  for (let i = 0; i < lodes.length; i++) {
    const lode = lodes[i];
    if (lode.discovered || !isLodeVisible(lode, scope) || !inScannerRange(pod, lode)) continue;
    lode.discovered = true;
    touchLode(grid, lode.x0, lode.top);
    out.push({ t: 'lode-discovered', lodeId: lode.id });
  }
}

/** Is a cell of `lode` within the Scanner radius (Chebyshev) of the pod's cell? */
export function inScannerRange(pod: Readonly<PodState>, lode: Readonly<Lode>): boolean {
  const radius = scannerRadiusOf(pod.tiers.scanner);
  const cx = Math.floor(pod.x);
  const cr = Math.floor(-pod.y);
  const dx = Math.max(0, lode.x0 - cx, cx - (lode.x0 + LODE_W - 1));
  const dr = Math.max(0, lode.top - cr, cr - (lode.top + LODE_H - 1));
  return dx <= radius && dr <= radius;
}

/** Bump the lode's chunks so renderers can show its discovered state. */
function touchLode(grid: TerrainGrid, x0: number, top: number): void {
  for (let r = top; r < top + LODE_H; r++) for (let x = x0; x < x0 + LODE_W; x++) grid.touch(x, r);
}
