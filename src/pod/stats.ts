// Derived pod stats, cargo mass/slots and closed-form pod numbers (canon §2.6, §3.3, §3.6, §3.7, §4.8;
// 01 §3.3–3.7). PURE MODULE: only + − × ÷, sqrt, floor/min/max/abs.
import {
  AIR_DRAG,
  BAY,
  DRILL,
  ENGINE,
  G,
  HARD_LANDING_K,
  HARD_LANDING_V,
  HULL,
  MINERALS,
  POD_BASE_MASS,
  RADIATOR,
  RELIC_MASS,
  SCANNER,
  STEP,
  TANK,
  TILE_FT,
  FUEL_MOVE_K,
} from '../shared/canon';
import type { CargoItem } from '../shared/types';
import type { PodStats } from '../world/api';
import type { PodState } from './types';

const MAX_TIER = 7;

/** Clamp an installed tier to 1..7 and return its 0-based table index. */
function tierIndex(tier: number): number {
  return (tier < 1 ? 1 : tier > MAX_TIER ? MAX_TIER : tier) - 1;
}

/** Row of a sparse tier table; a missing tier falls back to the nearest lower existing one (canon §2.6 "—"). */
function nearestLower<R>(table: readonly (R | null)[], tier: number): R {
  for (let i = tierIndex(tier); i >= 0; i--) {
    const row = table[i];
    if (row) return row;
  }
  throw new Error('tier table has no t1 row');
}

export const engineOf = (tier: number) => ENGINE[tierIndex(tier)];
export const drillStepsOf = (tier: number): number => DRILL[tierIndex(tier)].steps;
export const maxFuelOf = (tier: number): number => TANK[tierIndex(tier)].liters;
export const maxHullOf = (tier: number): number => HULL[tierIndex(tier)].hp;
export const radiatorOf = (tier: number): number => nearestLower(RADIATOR, tier).r;
export const baySlotsOf = (tier: number): number => nearestLower(BAY, tier).slots;
export const scannerRadiusOf = (tier: number): number => nearestLower(SCANNER, tier).lodeRadius;

// ---------- Cargo (canon §3.7, §4.8) ----------

interface KitSpec {
  slots: number;
  mass: number;
}
/**
 * Kit, Drum and Pack slot/mass by id (canon §4.8, §2.8). Ids are matched exactly, then by prefix so
 * Mk-tagged ids such as 'autoDrill2' resolve; unknown ids count as a small Kit.
 */
const KIT_SPECS: Readonly<Record<string, KitSpec>> = {
  belt: { slots: 1, mass: 1 },
  router: { slots: 1, mass: 1 },
  shoring: { slots: 1, mass: 1 },
  lamp: { slots: 1, mass: 1 },
  chute: { slots: 1, mass: 1 },
  liftRail: { slots: 1, mass: 2 },
  autoDrill: { slots: 1, mass: 5 },
  liftFoot: { slots: 1, mass: 5 },
  magmaTap: { slots: 1, mass: 5 },
  gasTap: { slots: 1, mass: 5 },
  depot: { slots: 2, mass: 20 },
  fuelDrum: { slots: 1, mass: 5 },
  weldPack: { slots: 1, mass: 3 },
};
const KIT_IDS = Object.keys(KIT_SPECS);
const SMALL_KIT: KitSpec = { slots: 1, mass: 1 };

export function kitSpec(id: string): KitSpec {
  const exact = KIT_SPECS[id];
  if (exact) return exact;
  for (const k of KIT_IDS) if (id.startsWith(k)) return KIT_SPECS[k];
  return SMALL_KIT;
}

export function itemMass(item: CargoItem): number {
  switch (item.kind) {
    case 'mineral':
      return MINERALS[item.tier - 1]?.mass ?? 1;
    case 'relic':
      return RELIC_MASS;
    case 'kit':
      return kitSpec(item.id).mass;
  }
}

export function itemSlots(item: CargoItem): number {
  return item.kind === 'kit' ? kitSpec(item.id).slots : 1;
}

/** Σ cargo mass in mu (allocation-free; called every step). */
export function cargoMass(cargo: readonly CargoItem[]): number {
  let m = 0;
  for (let i = 0; i < cargo.length; i++) m += itemMass(cargo[i]);
  return m;
}

export function cargoSlotsUsed(cargo: readonly CargoItem[]): number {
  let n = 0;
  for (let i = 0; i < cargo.length; i++) n += itemSlots(cargo[i]);
  return n;
}

/** Can `item` fit in the bay? (Digging into a full bay destroys the specimen, canon §3.7.) */
export function bayHasRoom(pod: Readonly<PodState>, item: CargoItem): boolean {
  return cargoSlotsUsed(pod.cargo) + itemSlots(item) <= baySlotsOf(pod.tiers.bay);
}

// ---------- Stats ----------

export function podStats(pod: Readonly<PodState>): PodStats {
  const t = pod.tiers;
  const engine = engineOf(t.engine);
  return {
    maxFuel: maxFuelOf(t.tank),
    maxHull: maxHullOf(t.hull),
    engineHp: engine.hp,
    hoverCap: engine.cap,
    vUp: engine.vUp,
    digSteps: drillStepsOf(t.drill),
    radiator: radiatorOf(t.radiator),
    baySlots: baySlotsOf(t.bay),
    cargoMass: cargoMass(pod.cargo),
    scannerLodeRadius: scannerRadiusOf(t.scanner),
  };
}

/** TOO HEAVY (01 §3.3): at m ≥ C_e full thrust no longer climbs. */
export function isTooHeavy(pod: Readonly<PodState>): boolean {
  return cargoMass(pod.cargo) >= engineOf(pod.tiers.engine).cap;
}

/** Thrust acceleration at s_t = 1: T_e / (M0 + m), T_e = g(M0 + C_e) (canon §3.6). */
export function thrustAccel(hoverCap: number, cargo: number): number {
  return (G * (POD_BASE_MASS + hoverCap)) / (POD_BASE_MASS + cargo);
}

/**
 * Steady full-thrust climb speed (tiles/s) for the pod's current load: the fixed point of
 * v ← (v + a·dt)·drag, clamped to V_up; 0 when too heavy (01 §3.3 table).
 */
export function climbSpeed(pod: Readonly<PodState>): number {
  const engine = engineOf(pod.tiers.engine);
  const m = cargoMass(pod.cargo);
  if (m >= engine.cap) return 0;
  const a = thrustAccel(engine.cap, m) - G;
  const v = (a * STEP * AIR_DRAG) / (1 - AIR_DRAG);
  return v < engine.vUp ? v : engine.vUp;
}

/** Deep Heat burn multiplier (canon §4.4; 01 §3.5): 1 + 0.25 per 1,000 ft below 1,612 ft, capped ×1.5. */
export function deepHeatFactor(row: number): number {
  const h = 1 + (0.25 * (TILE_FT * row - 1612)) / 1000;
  return h < 1 ? 1 : h > 1.5 ? 1.5 : h;
}

/**
 * Return Tick (01 §3.5): litres to climb from the pod's row to the Rim at full thrust and the
 * current load, L_ret = Σ_rows 0.00084·P·heat(r) / v_climb. Ignores digging and routing.
 * Infinity when the pod is too heavy to climb.
 */
export function returnTickLiters(pod: Readonly<PodState>, deepHeat: boolean): number {
  const v = climbSpeed(pod);
  if (v <= 0) return Infinity;
  const perRow = (FUEL_MOVE_K * engineOf(pod.tiers.engine).hp) / v;
  if (!deepHeat) return perRow * pod.row;
  let heat = 0;
  for (let r = 0; r < pod.row; r++) heat += deepHeatFactor(r);
  return perRow * heat;
}

/** Hard landing damage (canon §3.3): ⌊0.5952·v⌋ HP from 5.88 tiles/s (3 at the threshold, 8 at terminal). */
export function landingDamage(v: number): number {
  return v >= HARD_LANDING_V ? Math.floor(HARD_LANDING_K * v) : 0;
}
