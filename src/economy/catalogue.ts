// Upgrade catalogue: names, prices, stats, parts and scope gating for the 7 lines × 7 tiers
// (canon §2.6, §4.2, §4.3.5, §5.5; 01 §5.1, §6.2). PURE MODULE.
import { BAY, DRILL, ENGINE, HULL, LINES, RADIATOR, SALVAGE_MIN, SALVAGE_RATE, SCANNER, STEP_HZ, TANK, TIER_PRICE, lineTierName, type Line } from '../shared/canon';
import { scopeAtLeast } from '../shared/scope';
import type { Scope } from '../shared/types';
import { UPGRADE_PARTS, type PartReq } from './parts';

export const MAX_TIER = 7;

const TABLES = { drill: DRILL, hull: HULL, engine: ENGINE, tank: TANK, radiator: RADIATOR, bay: BAY, scanner: SCANNER } as const;

/** The four Garage lines of the M0 style test (canon §5.5: Drill/Engine/Tank/Bay t1–t3, cash only). */
const M0_LINES: ReadonlySet<Line> = new Set<Line>(['drill', 'engine', 'tank', 'bay']);
const M0_MAX_TIER = 3;
const MVP_MAX_TIER = 5;
/** MVP Scanner stops at Dowser (t3); Tin Ear is t1 and t2 does not exist. */
const MVP_SCANNER_MAX_TIER = 3;

export function tierExists(line: Line, tier: number): boolean {
  return Number.isInteger(tier) && tier >= 1 && tier <= MAX_TIER && TABLES[line][tier - 1] != null;
}

export function tierName(line: Line, tier: number): string {
  return lineTierName(line, tier) ?? '—';
}

export function tierPrice(tier: number): number {
  return TIER_PRICE[tier - 1] ?? 0;
}

/** One-line stat of a tier, e.g. "0.33 s/tile", "160 hp · lifts 125", "×0.9 heat", "lodes within 6". */
export function tierStat(line: Line, tier: number): string {
  if (!tierExists(line, tier)) return '—';
  const i = tier - 1;
  switch (line) {
    case 'drill':
      return `${(DRILL[i].steps / STEP_HZ).toFixed(2)} s/tile`;
    case 'hull':
      return `${HULL[i].hp} HP`;
    case 'engine':
      return `${ENGINE[i].hp} hp · lifts ${ENGINE[i].cap}`;
    case 'tank':
      return `${TANK[i].liters} L`;
    case 'radiator': {
      const r = RADIATOR[i]!.r;
      return `×${Number.isInteger(r) ? r.toFixed(1) : r} heat`;
    }
    case 'bay':
      return `${BAY[i]!.slots} slots`;
    case 'scanner': {
      const radius = SCANNER[i]!.lodeRadius;
      return radius <= 1 ? 'adjacent lodes' : `lodes within ${radius}`;
    }
  }
}

/** Lowest existing tier above `installed`, or null when the line is maxed. */
export function nextTier(line: Line, installed: number): number | null {
  for (let t = installed + 1; t <= MAX_TIER; t++) if (tierExists(line, t)) return t;
  return null;
}

/** Does this build sell anything on the line? (M0: four lines; MVP and v1: all seven.) */
export function lineInScope(scope: Scope, line: Line): boolean {
  return scope !== 'm0' || M0_LINES.has(line);
}

/** Canon §5.5 ledger: M0 Drill/Engine/Tank/Bay t1–t3; MVP six lines t1–t5 + Tin Ear/Dowser; v1 everything. */
export function tierInScope(scope: Scope, line: Line, tier: number): boolean {
  if (!tierExists(line, tier) || !lineInScope(scope, line)) return false;
  switch (scope) {
    case 'm0':
      return tier <= M0_MAX_TIER;
    case 'mvp':
      return tier <= (line === 'scanner' ? MVP_SCANNER_MAX_TIER : MVP_MAX_TIER);
    case 'v1':
      return true;
  }
}

/** Parts due for a tier (canon §4.3.5: t3+ from MVP; the M0 test is cash only). */
export function partsFor(scope: Scope, line: Line, tier: number): readonly PartReq[] {
  if (!scopeAtLeast(scope, 'mvp')) return [];
  return UPGRADE_PARTS[line][tier - 1] ?? [];
}

/** Cash to buy every tier of every line in order (canon §2.6: $3,887,750). */
export function costToMax(): number {
  let sum = 0;
  for (const line of LINES) for (let t = 2; t <= MAX_TIER; t++) if (tierExists(line, t)) sum += tierPrice(t);
  return sum;
}

/** IPV: the prices of the installed tiers over the 7 lines (canon §4.2). */
export function installedValue(tiers: Readonly<Record<Line, number>>): number {
  let sum = 0;
  for (const line of LINES) sum += tierPrice(tiers[line]);
  return sum;
}

/** Salvage fee = max($25, round(0.08 × IPV)), always charged (canon §4.2; 01 §6.2). */
export function salvageFee(tiers: Readonly<Record<Line, number>>): number {
  return Math.max(SALVAGE_MIN, Math.round(SALVAGE_RATE * installedValue(tiers)));
}
