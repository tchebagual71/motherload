// Camera math (canon §3.4, 03 §5, 04 §5.7 snapping). Pure: no three, no DOM, so it is unit-testable.
// World: x right, y up (y = 0 at the Rim surface), z toward the camera. Angles in degrees unless noted.
import { CAMERA, MINE_W, POD_H, STEP_HZ, VX_MAX } from '../shared/canon';
import type { CameraMode, ViewportLayout } from './api';

export const DEG = Math.PI / 180;
const COS20 = Math.cos(20 * DEG);

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Surface → underground blend t = smoothstep(0, 4, rows below the Rim) (canon §3.4). */
export function blendT(podY: number): number {
  return smoothstep(0, CAMERA.blendRows, Math.max(0, -podY));
}

/** Rows the underground camera must show (03 §1.1 Safari-tab rule): 18.6 if H ≥ 800 else 16.2. */
function rowsToFit(heightPt: number): number {
  return heightPt >= 800 ? 18.6 : 16.2;
}
const PPU_FLOOR = 32;

/**
 * Underground play ppu: 41, or 38 when the viewport is < 700 pt tall; never more than fits the
 * required rows in the clear rect (Safari tab), floored at 32 (canon §3.4, 03 §1.1).
 */
export function undergroundPpu(layout: Pick<ViewportLayout, 'height' | 'clearTop'>): number {
  const base = layout.height < 700 ? CAMERA.undergroundPlay.ppuShort : CAMERA.undergroundPlay.ppu;
  const clearH = Math.max(1, layout.height - layout.clearTop);
  const fit = clearH / (rowsToFit(layout.height) * COS20);
  return Math.max(PPU_FLOOR, Math.min(base, fit));
}

export interface CameraAngles {
  yaw: number;
  pitch: number;
  ppu: number;
}

export function playAngles(t: number, layout: Pick<ViewportLayout, 'height' | 'clearTop'>, out: CameraAngles): CameraAngles {
  const s = CAMERA.surfacePlay;
  const u = CAMERA.undergroundPlay;
  out.yaw = lerp(s.yaw, u.yaw, t);
  out.pitch = lerp(s.pitch, u.pitch, t);
  out.ppu = lerp(s.ppu, undergroundPpu(layout), t);
  return out;
}

export function buildAngles(t: number, out: CameraAngles): CameraAngles {
  const s = CAMERA.surfaceBuild;
  const u = CAMERA.undergroundBuild;
  out.yaw = lerp(s.yaw, u.yaw, t);
  out.pitch = lerp(s.pitch, u.pitch, t);
  out.ppu = lerp(s.ppu, u.ppu, t);
  return out;
}

/** Quantise an angle to `step` degrees (Pixel Lab: 2.5° during the blend, 04 §5.7). */
export function quantizeDeg(a: number, step: number): number {
  return Math.round(a / step) * step;
}

// ---------------------------------------------------------------------------------------------
// Anchors (canon §3.4: from the clear rect's top)
// ---------------------------------------------------------------------------------------------

/** Anchor above ground: Rim 68% while on/near the Rim, easing to the sky anchor 50% as the pod rises. */
export function surfaceAnchor(podY: number): number {
  return lerp(CAMERA.anchors.rim, CAMERA.anchors.sky, smoothstep(1.5, 4, podY));
}

/** Underground anchor: grounded/digging/falling 35% ↔ climbing 62% by the climb blend (0..1). */
export function undergroundAnchor(climbBlend: number): number {
  return lerp(CAMERA.anchors.grounded, CAMERA.anchors.climbing, climbBlend);
}

export function anchorFraction(t: number, podY: number, climbBlend: number): number {
  return lerp(surfaceAnchor(podY), undergroundAnchor(climbBlend), t);
}

/** Screen y (CSS px from the top) of an anchor fraction inside the clear rect. */
export function anchorScreenY(layout: Pick<ViewportLayout, 'height' | 'clearTop'>, frac: number): number {
  return layout.clearTop + frac * (layout.height - layout.clearTop);
}

export const CLIMB_ENTER_V = 1.0;
export const CLIMB_LEAVE_V = 0.3;
export const CLIMB_HOLD_S = 0.3;
export const CLIMB_BLEND_S = 0.6;

/** Climbing state with the canon §3.4 hysteresis: enter at v_up > 1.0 for 0.3 s, leave at < 0.3 for 0.3 s. */
export class ClimbDetector {
  climbing = false;
  /** 0 = grounded anchor, 1 = climbing anchor; moves linearly over 0.6 s. */
  blend = 0;
  private timer = 0;

  update(vy: number, dt: number, frozen: boolean): number {
    const wantsSwitch = this.climbing ? vy < CLIMB_LEAVE_V : vy > CLIMB_ENTER_V;
    this.timer = wantsSwitch ? this.timer + dt : 0;
    // A touch freezes re-framing (canon §3.4): the state may not flip until it ends.
    if (!frozen && this.timer >= CLIMB_HOLD_S) {
      this.climbing = !this.climbing;
      this.timer = 0;
    }
    const target = this.climbing ? 1 : 0;
    const step = dt / CLIMB_BLEND_S;
    this.blend = this.blend < target ? Math.min(target, this.blend + step) : Math.max(target, this.blend - step);
    return this.blend;
  }

  reset(): void {
    this.climbing = false;
    this.blend = 0;
    this.timer = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Follow spring (ω = 8 rad/s, dead zone ±1 tile, look-ahead 1.5)
// ---------------------------------------------------------------------------------------------

export interface SpringState {
  x: number;
  v: number;
}

/**
 * Exact critically damped spring step toward a target moving at constant velocity `targetV`;
 * `target` is where the target is at the END of the step. Unconditionally stable for any dt; with
 * targetV = the pod velocity there is no steady-state lag.
 */
export function springStep(s: SpringState, target: number, targetV: number, omega: number, dt: number): void {
  const e0 = s.x - (target - targetV * dt);
  const de0 = s.v - targetV;
  const decay = Math.exp(-omega * dt);
  const k = de0 + omega * e0;
  const e = (e0 + k * dt) * decay;
  const de = (de0 - omega * k * dt) * decay;
  s.x = target + e;
  s.v = targetV + de;
}

/** One axis of the follow camera: a dead-zone window that drags a spring-driven focus. */
export class FollowAxis {
  readonly spring: SpringState = { x: 0, v: 0 };
  /** Centre of the dead-zone window. */
  goal = 0;

  snap(x: number): void {
    this.goal = x;
    this.spring.x = x;
    this.spring.v = 0;
  }

  /**
   * Drag the window so `pos` stays within `deadLow` below and `deadHigh` above its centre, then step
   * the spring toward the centre (fed the target's velocity while the window is being dragged).
   */
  update(pos: number, vel: number, deadLow: number, deadHigh: number, omega: number, dt: number): number {
    let goalV = 0;
    if (pos - this.goal > deadHigh) {
      this.goal = pos - deadHigh;
      goalV = vel;
    } else if (this.goal - pos > deadLow) {
      this.goal = pos + deadLow;
      goalV = vel;
    }
    springStep(this.spring, this.goal, goalV, omega, dt);
    return this.spring.x;
  }
}

/** Horizontal look-ahead in tiles for a pod velocity (canon §3.4: 1.5 tiles at full drive). */
export function lookAheadX(vx: number): number {
  return CAMERA.lookAhead * clamp(vx / VX_MAX, -1, 1);
}

/** Below this downward speed (tiles/s) the pod counts as not descending (grounded settling, hovering). */
export const DESCEND_V = 0.25;
/** Downward lead of the vertical focus at full fall speed (tiles). */
export const DESCEND_LEAD = 0.4;
/** Fall speed (tiles/s) at which the lead is complete. */
export const DESCEND_LEAD_V = 4;
/** The one-sided window outlives a descent by this long, so a dig or fall comes to rest on the anchor. */
export const DESCEND_HOLD_S = 0.25;

/**
 * Vertical focus offset below a falling pod (canon §3.4 visibility rule, "descending"). The symmetric
 * ±1 dead zone let the focus trail a tile above a falling or digging pod, so the pod sat a tile under
 * its 35% anchor and the rows it heads into slid under the control zone. Descending, the window is
 * one-sided (the pod may never drop below the focus) and a fall leads by up to 0.4 tiles: on the SE
 * (03 §1.2) the anchor leaves 6.2 fully clear rows below and 5.4 above, so a pod crossing into its next
 * row needs the lead to keep 6 rows clear, and 0.4 is all the rows above can give.
 */
export function descentLead(vy: number): number {
  return vy < -DESCEND_V ? DESCEND_LEAD * clamp(-vy / DESCEND_LEAD_V, 0, 1) : 0;
}

/**
 * A down dig as a steady descent: where the pod would be if it moved at the dig's average rate, and
 * that rate (tiles/s). A dig holds the pod for its first 37.5% and then slides it in, so following the
 * pod itself makes the focus lag every slide (by most of a tile with fast drills); following the steady
 * path scrolls a dig chain evenly with the pod between its anchor and 0.41 tiles above it.
 */
export interface DigDescent {
  y: number;
  vy: number;
}

/** The parts of the pod's dig state the steady path needs (pod/types DigState). */
export interface DigLike {
  readonly dir: 'down' | 'left' | 'right';
  readonly r: number;
  readonly progress: number;
  readonly total: number;
  readonly fromY: number;
}

/**
 * Turns the pod's down digs into a DigDescent per frame. The step that finishes a dig clears the
 * DigState, so its frame (the pod has just come to rest on the path's end, `digging` still set) keeps
 * the path's last step instead of dropping the descent for a frame between chained digs.
 */
export class DigDescentTracker {
  private readonly out: DigDescent = { y: 0, vy: 0 };
  private fromY = 0;
  private toY = 0;
  private total = 1;
  private held = false;

  /** `alpha` = render interpolation between the last two steps; `digging` = the last step advanced a dig. */
  update(dig: DigLike | null, podY: number, digging: boolean, alpha: number): DigDescent | null {
    if (dig && dig.dir === 'down') {
      this.fromY = dig.fromY;
      this.toY = -(dig.r + 1) + POD_H / 2; // resting on the cell's floor (pod/dig finishDig)
      this.total = Math.max(1, dig.total);
      this.held = true;
      return this.path(dig.progress - 1 + alpha);
    }
    this.held = this.held && !dig && digging && podY === this.toY;
    return this.held ? this.path(this.total - 1 + alpha) : null;
  }

  private path(progress: number): DigDescent {
    const f = clamp(progress / this.total, 0, 1);
    this.out.y = this.fromY + (this.toY - this.fromY) * f;
    this.out.vy = ((this.toY - this.fromY) * STEP_HZ) / this.total;
    return this.out;
  }
}

// ---------------------------------------------------------------------------------------------
// Pose
// ---------------------------------------------------------------------------------------------

export interface CameraPose {
  /** Degrees. */
  yaw: number;
  pitch: number;
  /** pt per world unit. */
  ppu: number;
  /** Surface → underground blend. */
  t: number;
  /** Anchor fraction in the clear rect. */
  anchor: number;
  /** World point at the screen centre. */
  lookAt: Vec3;
  /** Unit vector from lookAt toward the camera. */
  dir: Vec3;
  /** Camera right and up (unit, world). */
  right: Vec3;
  up: Vec3;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Basis for yaw/pitch (degrees): dir = from target to camera; right, up span the view plane. */
export function cameraBasis(yawDeg: number, pitchDeg: number, dir: Vec3, right: Vec3, up: Vec3): void {
  const sy = Math.sin(yawDeg * DEG);
  const cy = Math.cos(yawDeg * DEG);
  const sp = Math.sin(pitchDeg * DEG);
  const cp = Math.cos(pitchDeg * DEG);
  dir.x = sy * cp;
  dir.y = sp;
  dir.z = cy * cp;
  right.x = cy;
  right.y = 0;
  right.z = -sy;
  up.x = -sp * sy;
  up.y = cp;
  up.z = -sp * cy;
}

/** Slab x at the screen centre for an orthographic view through `lookAt` (plane z = 0.5). */
export function slabCentreX(lookAt: Vec3, yawDeg: number): number {
  return lookAt.x - (lookAt.z - 0.5) * Math.tan(yawDeg * DEG);
}

/** Max tiles of slab frame visible beyond x ∈ [0, 48] underground (03 §5). */
export const SLAB_CLAMP_MARGIN = 1;

/** Clamp a slab-centre x so at most `margin` tiles beyond the mine show; centres when the view is wider. */
export function clampSlabCentre(centreX: number, halfWidth: number, margin = SLAB_CLAMP_MARGIN): number {
  const lo = -margin + halfWidth;
  const hi = MINE_W + margin - halfWidth;
  return lo > hi ? MINE_W / 2 : clamp(centreX, lo, hi);
}

export interface RigInput {
  podX: number;
  podY: number;
  vx: number;
  vy: number;
  /** The down dig in progress, if any (the vertical follow tracks its steady path). */
  digDown?: DigDescent | null;
  layout: ViewportLayout;
  mode: CameraMode;
  touching: boolean;
}

const SNAP_DISTANCE = 12;
const BUILD_TWEEN_S = 0.25;

/** Follow camera state machine: spring follow, anchors with hysteresis, blend, build tween, slab clamp. */
export class CameraRig {
  readonly pose: CameraPose = {
    yaw: CAMERA.surfacePlay.yaw,
    pitch: CAMERA.surfacePlay.pitch,
    ppu: CAMERA.surfacePlay.ppu,
    t: 0,
    anchor: CAMERA.anchors.rim,
    lookAt: { x: 0, y: 0, z: 0 },
    dir: { x: 0, y: 0, z: 1 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  };
  readonly climb = new ClimbDetector();
  private readonly fx = new FollowAxis();
  private readonly fy = new FollowAxis();
  private buildBlend = 0;
  /** Seconds left of the one-sided vertical window (descending, plus DESCEND_HOLD_S). */
  private descendHold = 0;
  private initialised = false;
  private readonly play: CameraAngles = { yaw: 0, pitch: 0, ppu: 0 };
  private readonly build: CameraAngles = { yaw: 0, pitch: 0, ppu: 0 };

  snap(x: number, y: number): void {
    this.fx.snap(x);
    this.fy.snap(y);
    this.climb.reset();
    this.descendHold = 0;
    this.initialised = true;
  }

  get focusX(): number {
    return this.fx.spring.x;
  }
  get focusY(): number {
    return this.fy.spring.x;
  }

  update(input: RigInput, dt: number): CameraPose {
    const { podX, podY, vx, vy, layout } = input;
    if (!this.initialised || Math.abs(podX - this.fx.spring.x) > SNAP_DISTANCE || Math.abs(podY - this.fy.spring.x) > SNAP_DISTANCE) {
      this.snap(podX, podY);
    }
    const omega = CAMERA.followOmega;
    const dead = CAMERA.deadZone;
    const fxPos = this.fx.update(podX + lookAheadX(vx), vx, dead, dead, omega, dt);
    const dig = input.digDown;
    const followY = dig ? dig.y : podY - descentLead(vy);
    const followV = dig ? dig.vy : vy;
    this.descendHold = followV < -DESCEND_V ? DESCEND_HOLD_S : Math.max(0, this.descendHold - dt);
    const fyPos = this.fy.update(followY, followV, this.descendHold > 0 ? 0 : dead, dead, omega, dt);

    const t = blendT(fyPos);
    const climbBlend = this.climb.update(vy, dt, input.touching);
    const anchor = anchorFraction(t, podY, climbBlend);

    const target = input.mode === 'build' ? 1 : 0;
    const step = dt / BUILD_TWEEN_S;
    this.buildBlend = this.buildBlend < target ? Math.min(target, this.buildBlend + step) : Math.max(target, this.buildBlend - step);
    playAngles(t, layout, this.play);
    buildAngles(t, this.build);
    const k = smoothstep(0, 1, this.buildBlend);

    const pose = this.pose;
    pose.t = t;
    pose.anchor = anchor;
    pose.yaw = lerp(this.play.yaw, this.build.yaw, k);
    pose.pitch = lerp(this.play.pitch, this.build.pitch, k);
    pose.ppu = lerp(this.play.ppu, this.build.ppu, k);
    composeLookAt(pose, fxPos, fyPos, layout);
    return pose;
  }
}

/**
 * Fill basis + lookAt so the focus point lands on the anchor row, then apply the underground slab
 * clamp weighted by the blend t (pose.yaw/pitch/ppu/anchor/t must be set). The clamp slides the view
 * along the camera's right vector, which has no vertical screen component, so the focus stays on its
 * anchor row; a step s along `right` moves the slab centre (z = 0.5) by s / cos(yaw).
 */
export function composeLookAt(pose: CameraPose, focusX: number, focusY: number, layout: ViewportLayout): void {
  cameraBasis(pose.yaw, pose.pitch, pose.dir, pose.right, pose.up);
  const anchorY = anchorScreenY(layout, pose.anchor);
  const offset = (anchorY - layout.height / 2) / pose.ppu;
  const l = pose.lookAt;
  l.x = focusX + pose.up.x * offset;
  l.y = focusY + pose.up.y * offset;
  l.z = pose.up.z * offset;
  const cosYaw = Math.cos(pose.yaw * DEG);
  const centre = slabCentreX(l, pose.yaw);
  const halfWidth = layout.width / 2 / pose.ppu / cosYaw;
  const clamped = clampSlabCentre(centre, halfWidth);
  const s = (clamped - centre) * cosYaw * pose.t;
  l.x += s * pose.right.x;
  l.z += s * pose.right.z;
}

// ---------------------------------------------------------------------------------------------
// Pixel Lab sizing and snapping (canon §5.1, 04 §5.7, 03 §9.3)
// ---------------------------------------------------------------------------------------------

/** k = round(DPR × face_pt / 30), face_pt = underground ppu × cos 20°; fixed per viewport. */
export function pixelScaleK(layout: Pick<ViewportLayout, 'height' | 'clearTop' | 'dpr'>): number {
  const face = undergroundPpu(layout) * COS20;
  return Math.max(1, Math.round((layout.dpr * face) / 30));
}

/** Low-res target size: ⌈W·DPR/k⌉ × ⌈H·DPR/k⌉ + a 2-texel margin (1 per side). */
export function pixelTargetSize(deviceW: number, deviceH: number, k: number): { w: number; h: number } {
  return { w: Math.ceil(deviceW / k) + 2, h: Math.ceil(deviceH / k) + 2 };
}

/** Snap ppu so a tile face (ppu × faceCos) spans a whole number of RT pixels (03 §9.3 zoom snap). */
export function snapPixelPpu(ppu: number, dpr: number, k: number, faceCos: number): number {
  const px = Math.max(1, Math.round((ppu * faceCos * dpr) / k));
  return (px * k) / (dpr * faceCos);
}

/** RT pixels per tile face for a ppu (for tests and the info overlay). */
export function pixelsPerFace(ppu: number, dpr: number, k: number, faceCos: number): number {
  return (ppu * faceCos * dpr) / k;
}

export interface TexelSnap {
  /** Shift to add to lookAt along right / up (world units). */
  dRight: number;
  dUp: number;
  /** Integer device-px blit offsets (x right, y up) that put the unsnapped centre on screen centre. */
  offX: number;
  offY: number;
}

/**
 * Bayer-matrix phase (0..3) for an ordered dither whose gradient lives in a frame offset `texels` RT
 * texels from the view centre: the shader adds it to gl_FragCoord.xy, so the pattern stays fixed to
 * that frame while the snapped camera moves by whole texels (a gl_FragCoord-keyed dither re-dithers
 * 4–19% of the image per texel step). World frame: the snapped centre's own texel coordinate.
 */
export function bayerPhase(texels: number): number {
  return ((Math.round(texels) % 4) + 4) % 4;
}

/**
 * Snap the view centre to the RT texel grid (no texel crawl) and return the integer device-px
 * blit offset for the remainder (04 §5.7). `texel` = world units per RT pixel.
 */
export function snapToTexels(
  lookRight: number,
  lookUp: number,
  texel: number,
  k: number,
  rt: { w: number; h: number },
  device: { w: number; h: number },
  out: TexelSnap,
): TexelSnap {
  const sr = Math.round(lookRight / texel) * texel;
  const su = Math.round(lookUp / texel) * texel;
  const fracR = (lookRight - sr) / texel;
  const fracU = (lookUp - su) / texel;
  out.dRight = sr - lookRight;
  out.dUp = su - lookUp;
  out.offX = Math.round(k * (rt.w / 2 - 1 + fracR) - device.w / 2);
  out.offY = Math.round(k * (rt.h / 2 - 1 + fracU) - device.h / 2);
  return out;
}
