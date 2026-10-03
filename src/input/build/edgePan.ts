// Edge auto-pan (canon §3.12; 03 §4.2, 04 §6.2): while a stroke drags within 40 pt of a world-area edge, the view
// pans toward that edge, ramping from 2 tiles/s at the margin's inner border to 8 tiles/s at the edge. Pure.
import { TOUCH } from '../../shared/canon';

export const EDGE_PAN = { marginPt: TOUCH.edgePanMarginPt, minTilesPerS: 2, maxTilesPerS: 8 } as const;

/** The world area: the screen between the build top bar and the dock (CSS px). */
export interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Speed for a finger `d` pt inside an edge (d ≤ 0 = on or past it): 0 outside the margin. */
export function edgeSpeed(d: number): number {
  const m = EDGE_PAN.marginPt;
  if (d >= m) return 0;
  const k = 1 - Math.max(0, d) / m;
  return EDGE_PAN.minTilesPerS + (EDGE_PAN.maxTilesPerS - EDGE_PAN.minTilesPerS) * k;
}

/**
 * Screen-space pan velocity in tiles/s toward the edges the finger is near (x right, y down); writes `out` and
 * returns whether it is non-zero. A finger past an edge (over the dock) pans at the full 8 tiles/s.
 */
export function edgePanVelocity(x: number, y: number, r: WorldRect, out: { vx: number; vy: number }): boolean {
  const left = edgeSpeed(x - r.x0);
  const right = edgeSpeed(r.x1 - x);
  const top = edgeSpeed(y - r.y0);
  const bottom = edgeSpeed(r.y1 - y);
  out.vx = right - left;
  out.vy = bottom - top;
  return out.vx !== 0 || out.vy !== 0;
}
