// Build camera state (canon §3.4; 03 §5): which plane, centre, zoom and Yard yaw, with the zoom floors, pan
// bounds and the default view on entering build mode. Pure; the renderer draws it (BuildRendererApi).
import type { BuildingKind, EntityView, Plane } from '../../factory/api';
import type { BuildCamera } from '../../render/api';
import { CAMERA, MINE_W } from '../../shared/canon';

/** Canon §3.4: surface build 39–64 ppu (≥ 44 with a 1×1 tool); underground build 47–60. */
export const BUILD_ZOOM = {
  yard: { min: CAMERA.surfaceBuild.zoomMin, max: CAMERA.surfaceBuild.zoomMax, base: CAMERA.surfaceBuild.ppu, oneByOne: 44 },
  mine: { min: CAMERA.undergroundBuild.zoomMin, max: CAMERA.undergroundBuild.zoomMax, base: CAMERA.undergroundBuild.ppu, oneByOne: CAMERA.undergroundBuild.ppu },
} as const;

/** Zoom-button step (one press). */
export const ZOOM_STEP = 1.15;
/** Underground pan bounds: seen rows + 4 (03 §5). */
export const MINE_PAN_MARGIN = 4;
/** Yard view row on entry: the near rows with the Rim at the bottom of the view. */
export const YARD_VIEW_ROW = 4;
/** A Headframe within this many columns of the pod centres the Yard view on entry. */
export const HEADFRAME_REACH = 12;

/** 1×1 tools (Belt, Router) ease the Yard zoom to 44 ppu (03 §4.9 zoom floor). */
export function isOneByOne(tool: BuildingKind | 'bulldoze' | null): boolean {
  return tool === 'belt' || tool === 'router';
}

export function zoomFloor(plane: Plane, oneByOne: boolean): number {
  const z = BUILD_ZOOM[plane];
  return oneByOne ? Math.max(z.min, z.oneByOne) : z.min;
}

export function clampPpu(plane: Plane, ppu: number, oneByOne = false): number {
  return Math.max(zoomFloor(plane, oneByOne), Math.min(BUILD_ZOOM[plane].max, ppu));
}

export interface PlaneBounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Centre bounds: the Yard's 48 columns × purchased rows (+ the Rim strip); the mine to the seen rows + 4. */
export function planeBounds(plane: Plane, yardRows: number, deepestRow: number): PlaneBounds {
  if (plane === 'yard') return { x0: 0, x1: MINE_W, y0: 0, y1: Math.max(4, yardRows + 1) };
  return { x0: 0, x1: MINE_W, y0: 0, y1: Math.max(8, deepestRow + MINE_PAN_MARGIN) };
}

export function clampCamera(cam: BuildCamera, b: PlaneBounds): BuildCamera {
  const cx = Math.max(b.x0, Math.min(b.x1, cam.cx));
  const cy = Math.max(b.y0, Math.min(b.y1, cam.cy));
  return cx === cam.cx && cy === cam.cy ? cam : { ...cam, cx, cy };
}

export interface ViewSource {
  /** Pod centre in world units (x right, y up; y = 0 at the Rim). */
  podX: number;
  podY: number;
  entities: readonly Pick<EntityView, 'kind' | 'plane' | 'x' | 'y' | 'w'>[];
}

/** The plane build mode opens on (03 §4.1): Mine when the pod is below the Rim, else the Yard. */
export function entryPlane(podY: number): Plane {
  return podY < 0 ? 'mine' : 'yard';
}

/**
 * Default build camera (03 §4.1, §5): the Yard centred on the Headframe nearest the pod (within 12 columns), else
 * on the pod's column; the mine centred on the pod.
 */
export function defaultCamera(plane: Plane, v: ViewSource, yaw: BuildCamera['yaw'] = 0): BuildCamera {
  if (plane === 'mine') {
    return { plane, cx: v.podX, cy: Math.max(0, -v.podY), ppu: BUILD_ZOOM.mine.base, yaw: 0 };
  }
  let cx = v.podX;
  let best = HEADFRAME_REACH + 1;
  for (const e of v.entities) {
    if (e.plane !== 'yard' || (e.kind as BuildingKind) !== 'headframe') continue;
    const hx = e.x + e.w / 2;
    const d = Math.abs(hx - v.podX);
    if (d < best) {
      best = d;
      cx = hx;
    }
  }
  return { plane, cx: Math.max(0, Math.min(MINE_W, cx)), cy: YARD_VIEW_ROW, ppu: BUILD_ZOOM.yard.base, yaw };
}
