// Pod movement: thrust, drag, friction, collisions, landings, gap skim (canon §3.6; 01 §3.2, §3.3, §3.6).
// PURE MODULE; only + − × ÷ and floor/round/min/max/abs so replays are bit-exact.
import {
  AIR_DRAG,
  BOUNCE_VY,
  FALL_CAP_V,
  FUEL_MOVE_K,
  G,
  GAP_SKIM_VX,
  GROUND_FRICTION,
  HORIZONTAL_THRUST_FRAC,
  SKY_FADE_ROWS,
  SKY_ROWS,
  STEP,
  THRUST_STICK_DEADZONE,
  VX_MAX,
} from '../shared/canon';
import type { GameEvent } from '../shared/events';
import type { TerrainGrid } from '../terrain/grid';
import { YHit, isSupported, moveX, moveY } from './collision';
import { cargoMass, engineOf, landingDamage, thrustAccel } from './stats';
import type { PodIntent, PodState } from './types';
import { applyDamage, burnFuel } from './vitals';

/** Grounded |v_x| below this snaps to rest, so friction reaches a true stop. */
const REST_VX = 1e-3;
/** Net upward acceleration needed to leave the ground; absorbs float noise at m = C_e (pure hover). */
const LIFT_OFF_A = 1e-9;
/** Column-snap ease while pushing Down over open air, tiles per step (03 §3.2: ≤ 0.5 tile). */
const DROP_IN_EASE = 0.05;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** s_t = clamp((stick_y − 0.35)/0.65, 0, 1), or 1 with the THRUST button (canon §3.6). */
export function thrustInput(intent: PodIntent): number {
  if (intent.thrust) return 1;
  return clamp((intent.sy - THRUST_STICK_DEADZONE) / (1 - THRUST_STICK_DEADZONE), 0, 1);
}

/** Thrust fades linearly to 0 over the top SKY_FADE_ROWS of the sky (01 §3.2). */
export function skyFade(y: number): number {
  return clamp((SKY_ROWS - y) / SKY_FADE_ROWS, 0, 1);
}

/**
 * One free-movement step (the pod is not digging). `dropIn`: grounded, pushing Down over open air,
 * so ease toward the column centre and fall in. `heat`: Deep Heat burn multiplier (1 when off).
 */
export function physicsStep(pod: PodState, grid: TerrainGrid, intent: PodIntent, floor: number, heat: number, dropIn: boolean, out: GameEvent[]): void {
  const engine = engineOf(pod.tiers.engine);
  const accel = thrustAccel(engine.cap, cargoMass(pod.cargo));
  const wasGrounded = pod.grounded;
  const st = thrustInput(intent);
  const sx = wasGrounded && pod.sector === 'down' ? 0 : clamp(intent.sx, -1, 1);
  const fade = skyFade(pod.y);

  burnFuel(pod, FUEL_MOVE_K * engine.hp * Math.max(st, Math.abs(sx)) * STEP * heat);
  pod.thrust = st * fade;
  if (sx !== 0) pod.facing = sx > 0 ? 1 : -1;

  const vy0 = pod.vy;
  integrate(pod, st * fade * accel - G, sx * HORIZONTAL_THRUST_FRAC * fade * accel, sx !== 0, wasGrounded, engine.vUp);

  // Gap skim (01 §3.2): fast enough and not pushing Down, a grounded pod rides over 1-wide gaps.
  const skim = wasGrounded && Math.abs(pod.vx) >= GAP_SKIM_VX && pod.sector !== 'down';

  if (dropIn) easeToColumnCentre(pod, grid, floor);
  if (moveX(pod, grid, pod.vx * STEP, floor)) pod.vx = 0;
  const y0 = pod.y;
  const hit = moveY(pod, grid, pod.vy * STEP, floor, skim);
  if (hit === YHit.Floor) land(pod, contactSpeed(vy0, pod.vy, y0 - pod.y), out);
  else if (hit === YHit.Ceiling && pod.vy > 0) pod.vy *= BOUNCE_VY;

  pod.grounded = pod.vy <= 0 && isSupported(pod, grid, floor, skim);
  if (pod.grounded) pod.vy = 0;
  pod.airSteps = pod.grounded ? 0 : pod.airSteps + 1;
}

function integrate(pod: PodState, ay: number, ax: number, drive: boolean, grounded: boolean, vUp: number): void {
  if (grounded) {
    pod.vy = ay > LIFT_OFF_A ? (pod.vy + ay * STEP) * AIR_DRAG : 0; // lift-off needs net upward thrust
    if (drive) pod.vx += ax * STEP;
    else {
      pod.vx *= GROUND_FRICTION;
      if (Math.abs(pod.vx) < REST_VX) pod.vx = 0;
    }
  } else {
    pod.vy = (pod.vy + ay * STEP) * AIR_DRAG;
    pod.vx = (pod.vx + ax * STEP) * AIR_DRAG;
  }
  pod.vy = clamp(pod.vy, -FALL_CAP_V, vUp);
  pod.vx = clamp(pod.vx, -VX_MAX, VX_MAX);
}

/**
 * Downward speed at the instant of touchdown: the step's velocity interpolated to the fraction of the
 * step travelled before contact. Independent of where step boundaries fall, and it reproduces the
 * 01 §3.6 fall-height table (to its 0.1-row rounding).
 */
function contactSpeed(vyStart: number, vyEnd: number, fell: number): number {
  const full = -vyEnd * STEP;
  const frac = full > 0 ? clamp(fell / full, 0, 1) : 1;
  return -(vyStart + (vyEnd - vyStart) * frac);
}

/** Touchdown: 'landed', hard-landing damage, and a small bounce (v_y × −0.2) after a hard landing. */
function land(pod: PodState, v: number, out: GameEvent[]): void {
  out.push({ t: 'landed', v });
  const dmg = landingDamage(v);
  if (dmg > 0) {
    applyDamage(pod, dmg, 'landing', out);
    pod.vy = v * -BOUNCE_VY;
  } else {
    pod.vy = 0;
  }
}

function easeToColumnCentre(pod: PodState, grid: TerrainGrid, floor: number): void {
  const d = Math.floor(pod.x) + 0.5 - pod.x;
  moveX(pod, grid, clamp(d, -DROP_IN_EASE, DROP_IN_EASE), floor);
}
