// Depth ruler build-mode scrub (03 §4.11 "Build: … dragging scrubs the camera (to discovered rows + 4)"; §4.12
// MVP "ruler scrub"). The build session owns the camera; this drives it only through its public view API: the
// [Yard│Mine] switch, the screen position of a cell and the drag pan, so the session's own pan bounds (seen rows
// + 4, 03 §5) still apply. Pure apart from the session it is handed.
import { MINE_PAN_MARGIN } from '../build/camera';
import type { BuildSession } from '../build/session';

/** The slice of the build session the scrub uses. */
export type ScrubSession = Pick<BuildSession, 'active' | 'plane' | 'cam' | 'setPlane' | 'cellScreen' | 'pan'>;

/** Deepest row the scrub can reach: the discovered rows + 4 (03 §4.11, §5). */
export function scrubLimit(deepestRow: number): number {
  return Math.max(0, deepestRow) + MINE_PAN_MARGIN;
}

/**
 * Move the Mine build camera's centre to `row` (the Yard view switches to the Mine first: the rail is a depth
 * ruler). Returns the row aimed at, or null when build mode is not on or the renderer is not up yet.
 */
export function scrubBuildCamera(build: ScrubSession, row: number, deepestRow: number): number | null {
  if (!build.active) return null;
  if (build.plane !== 'mine') build.setPlane('mine');
  const target = Math.max(0, Math.min(scrubLimit(deepestRow), row));
  const cam = build.cam;
  const x = Math.floor(cam.cx);
  const y = Math.floor(cam.cy);
  const a = build.cellScreen(x, y);
  const b = build.cellScreen(x, y + 1);
  if (!a || !b) return null;
  const d = target - cam.cy;
  if (d === 0) return target;
  // pan() drags the view: the camera moves against the finger by the plane delta of the screen delta, so a drag of
  // −d rows' worth of screen moves the centre d rows down.
  build.pan(-(b.x - a.x) * d, -(b.y - a.y) * d);
  return target;
}
