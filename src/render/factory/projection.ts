// Build cameras and plane picking (canon §3.4; 03 §4.1, §5; 04 §6.2). Pure math: no three, no DOM, so the
// projection is unit-testable and exactly what the renderer's orthographic camera draws.
//
// World: x right, y up (y = 0 at the Rim surface), z toward the camera. Planes (factory/api):
//   Yard cell (x, row k) spans x..x+1, z ∈ [−1−k, −k] on the plateau y = 0 — plane coords (x, y = −z).
//   Mine cell (x, row r) spans x..x+1, y ∈ [−(r+1), −r]; picks on the slab front z = +0.5 — plane coords (x, y = −y).
// A BuildCamera's (cx, cy) is the world point drawn at the viewport centre (W/2, H/2).
import { CAMERA, MINE_H, MINE_W } from '../../shared/canon';
import { YARD_MAX_ROWS, type Cell, type Plane, type ViewRect } from '../../factory/api';
import type { BuildCamera, ViewportLayout } from '../api';
import { DEG, cameraBasis, clamp, lerp, quantizeDeg, smoothstep, type CameraPose, type Vec3 } from '../camera';

/** Yard pick plane (02 §2.1): the plateau top. */
export const YARD_PLANE_Y = 0;
/** Mine pick plane (render/api): the slab front face. */
export const MINE_PLANE_Z = 0.5;
/** Play ↔ build camera tween (03 §4.1 "the camera returns in 0.35 s"). */
export const BUILD_ENTER_S = 0.35;
/** Yard ↔ Mine plane swap (03 §4.1 "planes swap in a 0.6-s flight"). */
export const BUILD_PLANE_S = 0.6;
/** Yard yaw snap (03 §5: 4 yaw snaps, 300 ms each). */
export const BUILD_YAW_S = 0.3;

export type Ppu = { min: number; max: number };
/** Zoom range per build plane (canon §3.4: Yard 39–64, Mine 47–60). */
export const BUILD_ZOOM: Readonly<Record<Plane, Ppu>> = {
  yard: { min: CAMERA.surfaceBuild.zoomMin, max: CAMERA.surfaceBuild.zoomMax },
  mine: { min: CAMERA.undergroundBuild.zoomMin, max: CAMERA.undergroundBuild.zoomMax },
};

export function newPose(): CameraPose {
  return {
    yaw: 0,
    pitch: 0,
    ppu: 1,
    t: 0,
    anchor: 0.5,
    lookAt: { x: 0, y: 0, z: 0 },
    dir: { x: 0, y: 0, z: 1 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  };
}

export function copyPose(src: CameraPose, out: CameraPose): CameraPose {
  out.yaw = src.yaw;
  out.pitch = src.pitch;
  out.ppu = src.ppu;
  out.t = src.t;
  out.anchor = src.anchor;
  copyVec(src.lookAt, out.lookAt);
  copyVec(src.dir, out.dir);
  copyVec(src.right, out.right);
  copyVec(src.up, out.up);
  return out;
}

function copyVec(a: Vec3, out: Vec3): void {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
}

/** Yard: 45° + n·90° (canon §3.4); Mine: 8°. */
export function buildYawDeg(cam: Pick<BuildCamera, 'plane' | 'yaw'>): number {
  return cam.plane === 'yard' ? CAMERA.surfaceBuild.yaw + 90 * (cam.yaw & 3) : CAMERA.undergroundBuild.yaw;
}

export function buildPitchDeg(plane: Plane): number {
  return plane === 'yard' ? CAMERA.surfaceBuild.pitch : CAMERA.undergroundBuild.pitch;
}

/** The camera's ppu clamped to the plane's zoom range (floors: Yard 39, Mine 47). */
export function buildPpu(cam: Pick<BuildCamera, 'plane' | 'ppu'>): number {
  const z = BUILD_ZOOM[cam.plane];
  return Number.isFinite(cam.ppu) ? clamp(cam.ppu, z.min, z.max) : z.min;
}

/** The settled pose of a build camera: its angles, ppu and the plane point (cx, cy) at the screen centre. */
export function buildPose(cam: BuildCamera, out: CameraPose): CameraPose {
  out.yaw = buildYawDeg(cam);
  out.pitch = buildPitchDeg(cam.plane);
  out.ppu = buildPpu(cam);
  out.t = cam.plane === 'mine' ? 1 : 0;
  out.anchor = 0.5;
  cameraBasis(out.yaw, out.pitch, out.dir, out.right, out.up);
  const l = out.lookAt;
  if (cam.plane === 'yard') {
    l.x = cam.cx;
    l.y = YARD_PLANE_Y;
    l.z = -cam.cy;
  } else {
    l.x = cam.cx;
    l.y = -cam.cy;
    l.z = MINE_PLANE_Z;
  }
  return out;
}

/** Shortest signed difference b − a in degrees, in (−180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** Pose between a and b (k = 0 → a): yaw on the short way round, then the basis from the blended angles. */
export function blendPose(a: CameraPose, b: CameraPose, k: number, out: CameraPose): CameraPose {
  out.yaw = a.yaw + angleDelta(a.yaw, b.yaw) * k;
  out.pitch = lerp(a.pitch, b.pitch, k);
  out.ppu = lerp(a.ppu, b.ppu, k);
  out.t = lerp(a.t, b.t, k);
  out.anchor = lerp(a.anchor, b.anchor, k);
  out.lookAt.x = lerp(a.lookAt.x, b.lookAt.x, k);
  out.lookAt.y = lerp(a.lookAt.y, b.lookAt.y, k);
  out.lookAt.z = lerp(a.lookAt.z, b.lookAt.z, k);
  cameraBasis(out.yaw, out.pitch, out.dir, out.right, out.up);
  return out;
}

/**
 * Pixel Lab tile-face foreshortening of a settled build camera (03 §9.3): the plateau tile seen from above on the
 * Yard (1, at every yaw snap), the slab front foreshortened by the pitch underground.
 */
export function buildFaceCos(plane: Plane): number {
  return plane === 'yard' ? 1 : Math.cos(buildPitchDeg('mine') * DEG);
}

/** The play camera's face: the slab front foreshortened by its yaw (the play rule, renderer.updateCamera). */
export function playFaceCos(pose: Pick<CameraPose, 'yaw'>): number {
  return Math.cos(pose.yaw * DEG);
}

/** Smallest face cosine a snap accepts: a degenerate face (a view along it) must never flip or explode the zoom. */
const MIN_FACE_COS = 0.25;

/** Whole RT pixels per tile face (ppu × faceCos), rounded UP so a canon zoom floor holds. */
export function snapFacePpu(ppu: number, faceCos: number, dpr: number, k: number): number {
  const face = Math.max(MIN_FACE_COS, faceCos);
  const px = Math.max(1, Math.ceil((ppu * face * dpr) / k - 1e-6));
  return (px * k) / (dpr * face);
}

/**
 * Pixel Lab zoom snap for a settled build camera (03 §9.3): whole RT pixels per tile face, rounded UP so the
 * canon floor holds (Yard: SE 39, iPhone 15 30 px → 40.0 ppu; Mine: SE 46, iPhone 15 35 px → 47.7 ppu).
 */
export function snapBuildPpu(ppu: number, plane: Plane, dpr: number, k: number): number {
  return snapFacePpu(ppu, buildFaceCos(plane), dpr, k);
}

/**
 * Pixel Lab snap of the pose the build rig shows (03 §9.3). Settled: the zoom rounds UP to whole RT px per tile
 * face. Tweening: angles step `angleStep`° and the zoom snaps against the face the rig blends between the poses it
 * flies from and to — never against cos(yaw): a Yard camera at yaw 135° or 225° looks down on the plateau, and
 * cos(yaw) ≤ 0 there would mirror or explode the frustum mid-tween.
 */
export function snapBuildPixelPose(p: CameraPose, rig: BuildCameraRig, dpr: number, k: number, angleStep: number): void {
  const cam = rig.camera;
  if (cam && rig.settled) {
    p.ppu = snapBuildPpu(p.ppu, cam.plane, dpr, k);
    return;
  }
  p.yaw = quantizeDeg(p.yaw, angleStep);
  p.pitch = quantizeDeg(p.pitch, angleStep);
  p.ppu = snapFacePpu(p.ppu, rig.faceCos(), dpr, k);
  cameraBasis(p.yaw, p.pitch, p.dir, p.right, p.up);
}

// ---------------------------------------------------------------------------------------------
// Projection (orthographic): screen px ↔ world
// ---------------------------------------------------------------------------------------------

/** The camera-plane point (through lookAt, ⟂ dir) drawn at CSS px (px, py). */
export function screenPoint(pose: CameraPose, layout: Pick<ViewportLayout, 'width' | 'height'>, px: number, py: number, out: Vec3): Vec3 {
  const u = (px - layout.width / 2) / pose.ppu;
  const v = (layout.height / 2 - py) / pose.ppu;
  const l = pose.lookAt, r = pose.right, up = pose.up;
  out.x = l.x + r.x * u + up.x * v;
  out.y = l.y + r.y * u + up.y * v;
  out.z = l.z + r.z * u + up.z * v;
  return out;
}

const _p: Vec3 = { x: 0, y: 0, z: 0 };

/** Plane point (x, y = −z) on the Yard plateau under CSS px, or false when the view runs parallel to it. */
export function screenToYardPoint(pose: CameraPose, layout: Pick<ViewportLayout, 'width' | 'height'>, px: number, py: number, out: { x: number; y: number }): boolean {
  const d = pose.dir;
  if (Math.abs(d.y) < 1e-6) return false;
  const p = screenPoint(pose, layout, px, py, _p);
  const s = (YARD_PLANE_Y - p.y) / d.y;
  out.x = p.x + d.x * s;
  out.y = -(p.z + d.z * s);
  return true;
}

/** Plane point (x, y = −world y) on the slab front under CSS px, or false when the view runs parallel to it. */
export function screenToMinePoint(pose: CameraPose, layout: Pick<ViewportLayout, 'width' | 'height'>, px: number, py: number, out: { x: number; y: number }): boolean {
  const d = pose.dir;
  if (Math.abs(d.z) < 1e-6) return false;
  const p = screenPoint(pose, layout, px, py, _p);
  const s = (MINE_PLANE_Z - p.z) / d.z;
  out.x = p.x + d.x * s;
  out.y = -(p.y + d.y * s);
  return true;
}

/** CSS px of a world point. */
export function projectToScreen(pose: CameraPose, layout: Pick<ViewportLayout, 'width' | 'height'>, x: number, y: number, z: number, out: { x: number; y: number }): { x: number; y: number } {
  const l = pose.lookAt;
  const dx = x - l.x, dy = y - l.y, dz = z - l.z;
  const u = dx * pose.right.x + dy * pose.right.y + dz * pose.right.z;
  const v = dx * pose.up.x + dy * pose.up.y + dz * pose.up.z;
  out.x = layout.width / 2 + u * pose.ppu;
  out.y = layout.height / 2 - v * pose.ppu;
  return out;
}

/** World point of a plane cell's centre on its pick plane. */
export function cellCentreWorld(plane: Plane, x: number, y: number, out: Vec3): Vec3 {
  if (plane === 'yard') {
    out.x = x + 0.5;
    out.y = YARD_PLANE_Y;
    out.z = -y - 0.5;
  } else {
    out.x = x + 0.5;
    out.y = -y - 0.5;
    out.z = MINE_PLANE_Z;
  }
  return out;
}

/** Yard cell holding a plane point, or null outside rows 1..32 × columns 0..47 (row 0 is the Rim strip). */
export function yardCellOf(p: { x: number; y: number }): Cell | null {
  const x = Math.floor(p.x);
  const row = Math.floor(p.y);
  if (x < 0 || x >= MINE_W || row < 1 || row > YARD_MAX_ROWS) return null;
  return { x, y: row };
}

/** Mine cell holding a plane point, or null off the slab. */
export function mineCellOf(p: { x: number; y: number }): Cell | null {
  const x = Math.floor(p.x);
  const row = Math.floor(p.y);
  if (x < 0 || x >= MINE_W || row < 0 || row >= MINE_H) return null;
  return { x, y: row };
}

// ---------------------------------------------------------------------------------------------
// View rectangles (04 §3.3 culling) and ray picking
// ---------------------------------------------------------------------------------------------

const CORNERS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const;
/** Heights of the Yard volume the rect must cover (plateau and the tallest building tops, canon §3.1). */
const YARD_SPAN_Y = [0, 3] as const;
/** Slab depth span (back wall to front face). */
const MINE_SPAN_Z = [-1, MINE_PLANE_Z] as const;

/**
 * Cells of `plane` the viewport can show, grown by `margin` cells and clamped to the plane; false when none.
 * The four screen corners are carried along the view direction onto the plane's near and far layers. The mine
 * shows only through the slab's front face: a camera behind it (a Yard yaw of 135° or 225°) sees none of it.
 */
export function planeViewRect(pose: CameraPose, layout: Pick<ViewportLayout, 'width' | 'height'>, plane: Plane, margin: number, out: ViewRect): boolean {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const d = pose.dir;
  if (plane === 'mine' && d.z <= 1e-6) return false;
  const spans = plane === 'yard' ? YARD_SPAN_Y : MINE_SPAN_Z;
  for (let k = 0; k < CORNERS.length; k++) {
    const p = screenPoint(pose, layout, CORNERS[k][0] * layout.width, CORNERS[k][1] * layout.height, _p);
    for (let j = 0; j < spans.length; j++) {
      const level = spans[j];
      let px: number, py: number;
      if (plane === 'yard') {
        const s = (level - p.y) / d.y;
        px = p.x + d.x * s;
        py = -(p.z + d.z * s);
      } else {
        const s = (level - p.z) / d.z;
        px = p.x + d.x * s;
        py = -(p.y + d.y * s);
      }
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    }
  }
  const rows = plane === 'yard' ? YARD_MAX_ROWS + 1 : MINE_H;
  out.plane = plane;
  out.x0 = Math.max(0, Math.floor(x0) - margin);
  out.x1 = Math.min(MINE_W - 1, Math.ceil(x1) + margin);
  out.y0 = Math.max(0, Math.floor(y0) - margin);
  out.y1 = Math.min(rows - 1, Math.ceil(y1) + margin);
  return Number.isFinite(x0) && out.x0 <= out.x1 && out.y0 <= out.y1;
}

/** Ray toward the scene through CSS px: origin on the camera plane, direction −dir (unit). */
export function screenRay(pose: CameraPose, layout: Pick<ViewportLayout, 'width' | 'height'>, px: number, py: number, origin: Vec3, dir: Vec3): void {
  screenPoint(pose, layout, px, py, origin);
  // Start well in front of everything so boxes on either side of the look-at plane are hit with t ≥ 0.
  origin.x += pose.dir.x * RAY_BACK;
  origin.y += pose.dir.y * RAY_BACK;
  origin.z += pose.dir.z * RAY_BACK;
  dir.x = -pose.dir.x;
  dir.y = -pose.dir.y;
  dir.z = -pose.dir.z;
}
const RAY_BACK = 200;

/** Entry distance of a ray into an axis-aligned box (slab method), or Infinity when it misses. */
export function rayBox(o: Vec3, d: Vec3, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
  const span = { t0: 0, t1: Infinity };
  if (!slab(o.x, d.x, minX, maxX, span) || !slab(o.y, d.y, minY, maxY, span) || !slab(o.z, d.z, minZ, maxZ, span)) return Infinity;
  return span.t0;
}

/** Clip a ray's [t0, t1] to one axis slab; false when it leaves the slab empty. */
function slab(o: number, d: number, lo: number, hi: number, span: { t0: number; t1: number }): boolean {
  if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
  const a = (lo - o) / d;
  const b = (hi - o) / d;
  span.t0 = Math.max(span.t0, Math.min(a, b));
  span.t1 = Math.min(span.t1, Math.max(a, b));
  return span.t0 <= span.t1;
}

/** Eased transition progress (smoothstep), the shape every build tween uses. */
export function ease(k: number): number {
  return smoothstep(0, 1, k);
}

// ---------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------

/**
 * The build camera on top of the play rig: tweens play → build in 0.35 s, Yard ↔ Mine in 0.6 s, a Yard yaw snap
 * in 0.3 s and build → play in 0.35 s (blending toward the live play pose); pans and zooms apply at once.
 */
export class BuildCameraRig {
  /** Displayed pose while active. */
  readonly pose = newPose();
  private readonly target = newPose();
  private readonly from = newPose();
  private readonly camState: BuildCamera = { plane: 'yard', cx: 0, cy: 0, ppu: 0, yaw: 0 };
  private hasCam = false;
  private exiting = false;
  private k = 1;
  private dur = BUILD_ENTER_S;
  /** Pixel Lab tile faces the tween flies from and to (null = the live play camera's) and the play face last seen. */
  private fromFace = 1;
  private toFace: number | null = 1;
  private playFace = 1;

  /** The build camera, or null (in play, or leaving build). */
  get camera(): Readonly<BuildCamera> | null {
    return this.hasCam ? this.camState : null;
  }
  /** Showing a build camera or tweening to or from one. */
  get active(): boolean {
    return this.hasCam || this.exiting;
  }
  /** No tween running. */
  get settled(): boolean {
    return this.k >= 1;
  }
  /** Tween progress 0..1 (1 when settled). */
  get progress(): number {
    return this.k;
  }

  /**
   * Tile-face foreshortening of the pose shown (Pixel Lab zoom snap, 03 §9.3): the settled plane's face, or during a
   * tween the eased blend of the faces it flies between (the play camera's when entering or leaving). Always > 0.
   */
  faceCos(): number {
    const to = this.toFace ?? this.playFace;
    return this.k >= 1 ? to : lerp(this.fromFace, to, ease(this.k));
  }

  /** `shown` is the pose on screen now (the tween starts from it). */
  set(cam: BuildCamera | null, shown: CameraPose): void {
    const face = this.active ? this.faceCos() : playFaceCos(shown);
    if (!cam) {
      if (!this.hasCam) return;
      this.hasCam = false;
      this.exiting = true;
      this.fromFace = face;
      this.toFace = null;
      this.start(shown, BUILD_ENTER_S);
      return;
    }
    const prev = this.camState;
    const entering = !this.hasCam || this.exiting;
    const planeSwap = !entering && prev.plane !== cam.plane;
    const yawSnap = !entering && !planeSwap && cam.plane === 'yard' && (prev.yaw & 3) !== (cam.yaw & 3);
    prev.plane = cam.plane;
    prev.cx = cam.cx;
    prev.cy = cam.cy;
    prev.ppu = cam.ppu;
    prev.yaw = cam.yaw;
    this.hasCam = true;
    this.exiting = false;
    buildPose(prev, this.target);
    if (entering || planeSwap || yawSnap) this.fromFace = face;
    this.toFace = buildFaceCos(cam.plane);
    if (entering) this.start(shown, BUILD_ENTER_S);
    else if (planeSwap) this.start(shown, BUILD_PLANE_S);
    else if (yawSnap) this.start(shown, BUILD_YAW_S);
    else if (this.k >= 1) copyPose(this.target, this.pose);
  }

  /** Advance the tween by dt seconds; `play` is the live play-camera pose (the exit target). */
  update(dt: number, play: CameraPose): CameraPose {
    this.playFace = playFaceCos(play);
    if (this.k < 1) this.k = Math.min(1, this.k + dt / this.dur);
    const e = ease(this.k);
    if (this.exiting) {
      blendPose(this.from, play, e, this.pose);
      if (this.k >= 1) this.exiting = false;
    } else if (this.hasCam) {
      if (this.k < 1) blendPose(this.from, this.target, e, this.pose);
      else copyPose(this.target, this.pose);
    }
    return this.pose;
  }

  private start(shown: CameraPose, dur: number): void {
    copyPose(shown, this.from);
    this.k = 0;
    this.dur = dur;
  }
}
