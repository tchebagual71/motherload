// Assists as intent shaping (01 §6.4): Landing Assist and Steady Drill rewrite the player's intent before the
// step, so the pod rules, fuel burn and replays stay the canon ones. PURE MODULE.
import { AIR_DRAG, G, LANDING_ASSIST_V, STEADY_DRILL_ENGAGE_STEPS, STEP, THRUST_STICK_DEADZONE } from '../shared/canon';
import { skyFade } from './physics';
import { cargoMass, engineOf, thrustAccel } from './stats';
import type { PodIntent, PodState } from './types';

export interface AssistFlags {
  landingAssist: boolean;
  steadyDrill: boolean;
}

/** Stick output is exactly 0 inside the dead zone; this only absorbs float noise. */
const NEUTRAL_EPS = 0.05;

function stickNeutral(i: Readonly<PodIntent>): boolean {
  return !i.thrust && Math.abs(i.sx) < NEUTRAL_EPS && Math.abs(i.sy) < NEUTRAL_EPS;
}

/**
 * Landing Assist thrust s_t (0..1): with the stick neutral and the pod falling faster than 5.5 tiles/s, the
 * thrust that brings v_y back to −5.5 this step (v' = (v + (s_t·fade·a − g)·dt)·drag, canon §3.6). 0 when
 * the assist has nothing to do. Too heavy or in the sky's fade it simply saturates at 1.
 */
export function landingAssistThrust(pod: Readonly<PodState>, intent: Readonly<PodIntent>): number {
  if (pod.grounded || pod.dig || pod.destroyed || pod.vy >= -LANDING_ASSIST_V || !stickNeutral(intent)) return 0;
  const accel = thrustAccel(engineOf(pod.tiers.engine).cap, cargoMass(pod.cargo)) * skyFade(pod.y);
  if (accel <= 0) return 1;
  const st = ((-LANDING_ASSIST_V / AIR_DRAG - pod.vy) / STEP + G) / accel;
  return st <= 0 ? 0 : st >= 1 ? 1 : st;
}

/** The stick-up value that gives thrust s_t (inverse of s_t = (sy − 0.35)/0.65). */
export function stickForThrust(st: number): number {
  return st <= 0 ? 0 : THRUST_STICK_DEADZONE + (1 - THRUST_STICK_DEADZONE) * st;
}

/** Write `raw` shaped by the enabled assists into `out` (reused; no allocation) and return it. */
export function applyAssists(pod: Readonly<PodState>, raw: Readonly<PodIntent>, flags: Readonly<AssistFlags>, out: PodIntent): PodIntent {
  out.sx = raw.sx;
  out.sy = raw.sy;
  out.thrust = raw.thrust;
  out.fireSlot = raw.fireSlot;
  out.digEngage = flags.steadyDrill ? STEADY_DRILL_ENGAGE_STEPS : raw.digEngage;
  if (flags.landingAssist) {
    const st = landingAssistThrust(pod, raw);
    if (st > 0) out.sy = stickForThrust(st);
  }
  return out;
}
