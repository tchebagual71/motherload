// Style-test gallery bookmarks (03 §9.4 item 4; INT-4, UI-4): six views of a scratch claim with the live seed,
// drawn time-frozen so the A/B flip compares identical frames. The scratch claim is M0-scoped so the debug
// Hardrock/Magma strip exists in every build; the player's world is never touched.
import type { CameraMode } from '../render/api';
import { revealAround } from '../pod';
import type { PodState } from '../pod/types';
import { POD_H, START_X } from '../shared/canon';
import { T } from '../shared/types';
import { M0_DEBUG_STRIP } from '../terrain/scope';
import type { WorldApi } from '../world/api';
import { World } from '../world/world';

export interface StyleView {
  world: WorldApi;
  mode: CameraMode;
}

/** 03 §9.4: Yard wide; Rim; shaft at row 2; B1 ore at row 40; Hardrock + Magma strip; Yard build with belts. */
export const STYLE_BOOKMARKS = 6;
const MODES: readonly CameraMode[] = ['build', 'play', 'play', 'play', 'play', 'build'];
const STAND_Y = POD_H / 2;
/** The strip bookmark stands the pod just above the strip, mid-width, so rows below show Hardrock and Magma. */
const STRIP_X = (M0_DEBUG_STRIP.x0 + M0_DEBUG_STRIP.x1) >> 1;
const STRIP_ROW = M0_DEBUG_STRIP.top - 2;

function place(pod: PodState, x: number, y: number, grounded: boolean): void {
  pod.x = pod.prevX = x;
  pod.y = pod.prevY = y;
  pod.vx = pod.vy = 0;
  pod.grounded = grounded;
  pod.dig = null;
  pod.thrust = 0;
  pod.digging = false;
  pod.row = Math.max(0, Math.floor(-y));
}

/** Stand the pod in a carved cell (x, r) on a solid floor. */
function standIn(w: World, x: number, r: number): void {
  const g = w.terrain;
  g.set(x, r, T.AIR);
  g.markDug(x, r);
  if (g.get(x, r + 1) === T.AIR) g.set(x, r + 1, T.DIRT);
  place(w.pod, x + 0.5, -(r + 1) + STAND_Y, true);
}

function stage(w: World, i: number): void {
  const pod = w.pod;
  switch (i) {
    case 0: // Yard wide: the build camera over the Yard from mid-Rim
    case 5: // Yard build with belts: the build camera at Dot's Headframe and belt demo
      place(pod, i === 0 ? 24 : w.meta.surveyColumn + 0.5, STAND_Y, true);
      break;
    case 1:
      place(pod, START_X + 0.5, STAND_Y, true);
      break;
    case 2:
      for (let r = 0; r <= 2; r++) standIn(w, START_X + 1, r);
      break;
    case 3:
      w.debugTeleport(40);
      break;
    case 4:
      standIn(w, STRIP_X, STRIP_ROW);
      break;
  }
  revealAround(w.terrain, Math.floor(pod.x), Math.max(0, Math.floor(-pod.y)));
}

/** Bookmark factory: one scratch claim per seed, re-staged per bookmark. */
export function createStyleViews(): (seed: number, i: number) => StyleView | null {
  let scratch: World | null = null;
  return (seed, i) => {
    if (!Number.isInteger(i) || i < 0 || i >= STYLE_BOOKMARKS) return null;
    if (!scratch || scratch.seed !== seed >>> 0) scratch = new World({ seed, scope: 'm0' });
    stage(scratch, i);
    // A fresh view object per bookmark: the renderer re-frames (snaps its camera) whenever the world changes.
    return { world: Object.create(scratch) as WorldApi, mode: MODES[i] };
  };
}
