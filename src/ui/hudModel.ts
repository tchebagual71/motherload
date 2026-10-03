// HUD view model (03 §6.1): everything the HUD row shows, derived from world state. Pure.
import {
  HULL_WARNING,
  RETURN_TICK_RED,
  RETURN_TICK_TRAINING_TANK,
  RETURN_TICK_TRAINING_TRIPS,
  fuelWarnLevel as canonFuelWarn,
} from '../shared/canon';
import type { PodState } from '../pod/types';
import type { PodStats, Wallet } from '../world/api';
import { formatCashHud, formatDepth, formatHp, formatLitres } from './format';

export type MassTone = 'ok' | 'amber' | 'red';
/** -1 = none; 0/1/2 = at or below 20 / 10 / 5 % (canon §4.2). */
export type FuelWarn = -1 | 0 | 1 | 2;

/** Return Tick input (01 §3.5): L_ret from WorldApi.returnFuel(), and whether the setting shows it now. */
export interface ReturnTickInput {
  liters: number;
  shown: boolean;
}

export interface HudModel {
  fuelText: string;
  fuelFrac: number;
  fuelWarn: FuelWarn;
  /** Return Tick position on the fuel bar (0..1), or null when hidden (01 §3.5). */
  returnTick: number | null;
  /** Fuel below 1.25 × L_ret: the bar turns red (canon §4.4). */
  fuelShort: boolean;
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

/** The sim's own rule (canon fuelWarnLevel), so the beep and the pulse agree at exactly 20 / 10 / 5 % (INT-13). */
export const fuelWarnLevel: (frac: number) => FuelWarn = canonFuelWarn;

/**
 * Return Tick visibility (canon §4.4): Training shows it until the first t3 Tank or 10 trips; any assist forces it
 * on; Hardcore (v1) forces it off.
 */
export function returnTickOn(
  setting: 'training' | 'on' | 'off',
  p: { tankTier: number; trips: number; assisted: boolean; hardcore?: boolean },
): boolean {
  if (p.hardcore) return false;
  if (p.assisted || setting === 'on') return true;
  if (setting === 'off') return false;
  return p.tankTier < RETURN_TICK_TRAINING_TANK && p.trips < RETURN_TICK_TRAINING_TRIPS;
}

/** Tick position and red-bar flag for L_ret at the pod's row (nothing on the Rim or above it). */
function returnTickState(row: number, maxFuel: number, fuel: number, ret: ReturnTickInput | undefined): { tick: number | null; short: boolean } {
  if (!ret?.shown || row < 1 || maxFuel <= 0) return { tick: null, short: false };
  // Too heavy to climb: no tick, and the trip home is already short.
  if (!Number.isFinite(ret.liters)) return { tick: null, short: true };
  return { tick: clamp01(ret.liters / maxFuel), short: fuel < RETURN_TICK_RED * ret.liters };
}

/** Cargo bar colour (03 §6.1): amber at mass ≥ 50% of hover cap, red at ≥ 75%. */
export function massTone(massFrac: number): MassTone {
  if (massFrac >= 0.75) return 'red';
  if (massFrac >= 0.5) return 'amber';
  return 'ok';
}

export function hudModel(pod: Readonly<PodState>, stats: Readonly<PodStats>, wallet: Readonly<Wallet>, ret?: ReturnTickInput): HudModel {
  const fuelFrac = stats.maxFuel > 0 ? clamp01(pod.fuel / stats.maxFuel) : 0;
  const hullFrac = stats.maxHull > 0 ? clamp01(pod.hull / stats.maxHull) : 0;
  const massFrac = stats.hoverCap > 0 ? stats.cargoMass / stats.hoverCap : 0;
  // Slots, not items: a Depot Kit takes 2 (canon §3.7; INT-14).
  const used = stats.slotsUsed;
  const tick = returnTickState(pod.row, stats.maxFuel, pod.fuel, ret);
  return {
    fuelText: formatLitres(pod.fuel),
    fuelFrac,
    fuelWarn: fuelWarnLevel(stats.maxFuel > 0 ? pod.fuel / stats.maxFuel : 0),
    returnTick: tick.tick,
    fuelShort: tick.short,
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
