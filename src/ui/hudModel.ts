// HUD view model (03 §6.1): everything the HUD row shows, derived from world state. Pure.
import { FUEL_WARNINGS, HULL_WARNING } from '../shared/canon';
import type { PodState } from '../pod/types';
import type { PodStats, Wallet } from '../world/api';
import { formatCashHud, formatDepth, formatHp, formatLitres } from './format';

export type MassTone = 'ok' | 'amber' | 'red';
/** -1 = none; 0/1/2 = below 20 / 10 / 5 % (canon §4.2). */
export type FuelWarn = -1 | 0 | 1 | 2;

export interface HudModel {
  fuelText: string;
  fuelFrac: number;
  fuelWarn: FuelWarn;
  hullText: string;
  hullFrac: number;
  hullLow: boolean;
  cargoText: string;
  cargoFrac: number;
  /** Cargo mass as a fraction of the engine's hover cap (01 §3.3). */
  massFrac: number;
  massTone: MassTone;
  tooHeavy: boolean;
  /** Info pill: surface shows cash over depth, underground depth over cash. */
  underground: boolean;
  cash: string;
  depth: string;
  inDebt: boolean;
}

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);

export function fuelWarnLevel(frac: number): FuelWarn {
  if (frac < FUEL_WARNINGS[2]) return 2;
  if (frac < FUEL_WARNINGS[1]) return 1;
  if (frac < FUEL_WARNINGS[0]) return 0;
  return -1;
}

/** Cargo bar colour (03 §6.1): amber at mass ≥ 50% of hover cap, red at ≥ 75%. */
export function massTone(massFrac: number): MassTone {
  if (massFrac >= 0.75) return 'red';
  if (massFrac >= 0.5) return 'amber';
  return 'ok';
}

export function hudModel(pod: Readonly<PodState>, stats: Readonly<PodStats>, wallet: Readonly<Wallet>): HudModel {
  const fuelFrac = stats.maxFuel > 0 ? clamp01(pod.fuel / stats.maxFuel) : 0;
  const hullFrac = stats.maxHull > 0 ? clamp01(pod.hull / stats.maxHull) : 0;
  const massFrac = stats.hoverCap > 0 ? stats.cargoMass / stats.hoverCap : 0;
  const used = pod.cargo.length;
  return {
    fuelText: formatLitres(pod.fuel),
    fuelFrac,
    fuelWarn: fuelWarnLevel(fuelFrac),
    hullText: formatHp(pod.hull),
    hullFrac,
    hullLow: hullFrac < HULL_WARNING,
    cargoText: String(used),
    cargoFrac: stats.baySlots > 0 ? clamp01(used / stats.baySlots) : 0,
    massFrac,
    massTone: massTone(massFrac),
    // At m = cap the pod only hovers; above it full thrust only slows a fall (01 §3.3).
    tooHeavy: stats.cargoMass > stats.hoverCap,
    underground: pod.row >= 1,
    cash: formatCashHud(wallet.cash),
    depth: formatDepth(pod.row),
    inDebt: wallet.debt > 0,
  };
}

/** By FuelWarn level 0 / 1 / 2. */
const FUEL_ALERT: readonly string[] = ['Fuel low', 'Fuel very low', 'Fuel critical'];

/**
 * Screen-reader alert for warnings the HUD just crossed into (03 §7: warnings `aria-live="assertive"`),
 * or null. The HUD itself is not a live region: fuel, depth and cash change many times a second.
 */
export function hudAlert(prev: Readonly<HudModel> | null, next: Readonly<HudModel>): string | null {
  if (!prev) return null;
  const parts: string[] = [];
  if (next.hullLow && !prev.hullLow) parts.push(`Hull low, ${next.hullText} HP left`);
  if (next.fuelWarn > prev.fuelWarn) parts.push(`${FUEL_ALERT[next.fuelWarn]}, ${next.fuelText} left`);
  if (next.tooHeavy && !prev.tooHeavy) parts.push('Too heavy to climb');
  return parts.length > 0 ? parts.join('. ') : null;
}
