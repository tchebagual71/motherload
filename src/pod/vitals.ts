// Fuel, hull, damage, warnings and destruction (canon §3.3, §4.2; 01 §3.5, §3.6, §3.11). PURE MODULE.
import { FUEL_WARNINGS, HULL_WARNING } from '../shared/canon';
import type { DamageCause, GameEvent } from '../shared/events';
import { maxFuelOf, maxHullOf } from './stats';
import type { PodState } from './types';

export function burnFuel(pod: PodState, liters: number): void {
  if (liters <= 0) return;
  const f = pod.fuel - liters;
  pod.fuel = f > 0 ? f : 0;
}

export function applyDamage(pod: PodState, amount: number, cause: DamageCause, out: GameEvent[]): void {
  if (amount <= 0) return;
  const h = pod.hull - amount;
  pod.hull = h > 0 ? h : 0;
  out.push({ t: 'damage', amount, cause });
}

/** Deepest fuel warning level (0 = 20%, 1 = 10%, 2 = 5%) the fraction has reached, or −1. */
function fuelWarnLevel(frac: number): number {
  for (let lvl = FUEL_WARNINGS.length - 1; lvl >= 0; lvl--) if (frac <= FUEL_WARNINGS[lvl]) return lvl;
  return -1;
}

/**
 * End-of-step checks: destruction on hull ≤ 0 or fuel = 0 (emitted once), otherwise fuel warnings
 * (each level once until refuelled above it) and the hull warning (once until repaired to ≥ 25%).
 */
export function checkVitals(pod: PodState, out: GameEvent[]): void {
  if (pod.hull <= 0 || pod.fuel <= 0) {
    destroy(pod, destructionCause(pod), out);
    return;
  }
  const level = fuelWarnLevel(pod.fuel / maxFuelOf(pod.tiers.tank));
  if (level > pod.fuelWarn) out.push({ t: 'fuel-warning', level: level as 0 | 1 | 2 });
  pod.fuelWarn = level;

  const low = pod.hull < HULL_WARNING * maxHullOf(pod.tiers.hull);
  if (low && !pod.hullWarned) out.push({ t: 'hull-warning' });
  pod.hullWarned = low;
}

/** What destroyed (or would destroy) the pod: a breached hull wins over an empty tank. */
export function destructionCause(pod: Readonly<PodState>): 'hull' | 'fuel' {
  return pod.hull <= 0 ? 'hull' : 'fuel';
}

function destroy(pod: PodState, cause: 'hull' | 'fuel', out: GameEvent[]): void {
  pod.destroyed = true;
  pod.dig = null;
  pod.digging = false;
  pod.thrust = 0;
  pod.magmaPending = 0;
  pod.engageSteps = 0;
  pod.engageDir = null;
  out.push({ t: 'destroyed', cause });
}
