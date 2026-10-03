// Goal chip and Next Goals (01 §2.3, §2.5–2.6; canon §5.2 onboarding beats 1–7; 03 §6.2). The chip is one
// Dot-voiced action; Next Goals (≤ 3) adds the next upgrade with its part check and the next lode or bonus.
// Pure functions of a snapshot the app builds about twice a second. PURE MODULE.
import { INCENTIVES, LINES, SCRIPTED_LODE_TOP, TILE_FT, type Line } from '../shared/canon';
import { scopeAtLeast } from '../shared/scope';
import type { Scope } from '../shared/types';
import { StoryLedger, obFlag } from './ledger';
import { grouped } from './script';

export interface GoalSnapshot {
  scope: Scope;
  flags: Readonly<Record<string, boolean>>;
  podX: number;
  /** Pod centre row (0 on the Rim and in the sky). */
  row: number;
  onRim: boolean;
  fuelFrac: number;
  cargoUsed: number;
  baySlots: number;
  /** Items the Assay would buy. */
  sellable: number;
  cash: number;
  deepestRow: number;
  tiers: Readonly<Record<Line, number>>;
  /** Column of Dot's survey shaft, or −1 if unknown. */
  surveyColumn: number;
  scriptedLodeFound: boolean;
}

export interface Goal {
  text: string;
  progress?: string;
}

/** The Garage card shape Next Goals reads (structurally world/api UpgradeCard). */
export interface GoalUpgrade {
  line: Line;
  name: string;
  price: number;
  available: boolean;
  blocker: string | null;
  parts: readonly { item: string; need: number; have: number }[];
}

/** First t2 price (canon §2.6). */
const FIRST_UPGRADE = 750;
/** Within this many tiles of the shaft mouth the chip teaches braking (01 §2.5). */
const MOUTH_TILES = 2;
/** Row above the scripted lode where the access dig ends (01 §2.5: r44). */
const ACCESS_ROW = SCRIPTED_LODE_TOP - 2;
const LOW_FUEL = 0.2;

const goal = (text: string, progress?: string): Goal => (progress === undefined ? { text } : { text, progress });
const ft = (row: number): string => `${grouped(row * TILE_FT)} ft`;

/** Contextual hints that win over the script step while onboarding (01 §2.5 "Bay full", "Fuel low", the mouth). */
function contextual(s: GoalSnapshot, L: StoryLedger): Goal | null {
  const underground = s.row >= 1;
  if (underground && s.cargoUsed >= s.baySlots) return goal('Bay full — head up');
  if (underground && s.fuelFrac <= LOW_FUEL) return goal('Fuel low: the tick shows your way home');
  const nearMouth = s.surveyColumn >= 0 && Math.abs(s.podX - (s.surveyColumn + 0.5)) <= MOUTH_TILES;
  if (s.onRim && nearMouth && L.hasBeat('S1') && !L.hasBeat('S5')) return goal("Dot's shaft: long drop. Hold ↑ to brake");
  return null;
}

/** Beats 1–3: refuel, first dig and sale, first t2. */
function earlySteps(s: GoalSnapshot, L: StoryLedger): Goal | null {
  if (!L.hasMilestone('toppedOff')) return goal('Fill up at the Pump House');
  if (!L.hasMilestone('payday')) {
    if (s.onRim) return goal(s.sellable > 0 ? 'Sell at the Assay Office' : 'Roll off the pad, then push down');
    return goal(s.cargoUsed > 0 ? 'Fill your bay, then push up to fly' : 'Push down to dig for ore');
  }
  if (!L.hasMilestone('basketCase')) {
    if (s.cash >= FIRST_UPGRADE) return goal('Upgrade at the Garage');
    if (s.onRim && s.sellable > 0) return goal('Sell at the Assay Office');
    return goal(`Earn $${FIRST_UPGRADE} for a Garage upgrade`, `$${grouped(s.cash)}`);
  }
  return null;
}

/** Beats 4–5: 500 ft, the survey ping, the scripted lode, the Starter Kit. */
function lodeSteps(s: GoalSnapshot, L: StoryLedger): Goal | null {
  if (!L.hasBeat('S1') && !L.hasBeat('S2')) return nextBonus(s);
  if (!s.scriptedLodeFound) return goal("Follow Dot's shaft down to her lode");
  if (!L.has(obFlag('kit'))) return goal('Collect your Starter Kit at the Shed');
  return null;
}

/** Beat 6: drill, lift, belt, FirstLiftDelivery, first Wire, first Hull Plate (01 §2.6). */
function factorySteps(s: GoalSnapshot, L: StoryLedger): Goal | null {
  if (!L.has(obFlag('drill'))) return goal(s.row < ACCESS_ROW ? 'Dig down at the chevrons' : 'Place the drill on the lode');
  if (!L.has(obFlag('lift'))) return goal("Hang the lift in Dot's shaft");
  if (!L.has(obFlag('belt'))) return goal('Belt the drill to the lift');
  if (!L.hasBeat('S6') || !L.has(obFlag('ingot'))) return goal('Belt the Headframe to the Smelter');
  if (!L.has(obFlag('assembler'))) return goal('Build an Assembler: Wire');
  if (!L.hasMilestone('plated')) return goal('Stockpile iron and cobalt');
  return null;
}

/** Beat 7: the first t3 bought with parts. */
function hasT3(s: GoalSnapshot): boolean {
  for (const line of LINES) if (s.tiers[line] >= 3) return true;
  return false;
}

/** The next unpaid depth bonus (canon §3.8), as a goal. */
function nextBonus(s: GoalSnapshot): Goal | null {
  const inc = INCENTIVES.find((i) => s.deepestRow < i.row);
  return inc ? goal(`Dig to ${grouped(inc.ft)} ft for a $${grouped(inc.cash)} bonus`, ft(s.deepestRow)) : null;
}

/** The goal chip: one action, or null when there is nothing to suggest (M0 has no chip, 01 §2.8). */
export function nextGoal(s: GoalSnapshot): Goal | null {
  if (!scopeAtLeast(s.scope, 'mvp')) return null;
  const L = new StoryLedger(s.flags as Record<string, boolean>);
  const steps = earlySteps(s, L) ?? lodeSteps(s, L) ?? factorySteps(s, L);
  const onboarding = steps !== null || !hasT3(s);
  if (onboarding) {
    const hint = contextual(s, L);
    if (hint) return hint;
  }
  return steps ?? (hasT3(s) ? nextBonus(s) : goal('Buy a tier-3 upgrade with parts'));
}

function lineLabel(line: Line): string {
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function partCheck(parts: GoalUpgrade['parts']): string {
  return parts.map((p) => `${p.item} ${grouped(p.have)}/${grouped(p.need)}`).join(' · ');
}

/** The next tier worth buying: the cheapest ready one, else the cheapest still out of reach. */
function upgradeGoal(s: GoalSnapshot, upgrades: readonly GoalUpgrade[]): string | null {
  const open = upgrades.filter((u) => u.available && u.price > 0).sort((a, b) => a.price - b.price);
  const ready = open.find((u) => u.blocker === null);
  if (ready) return `${ready.name} ${lineLabel(ready.line)}: ready to buy`;
  const next = open[0];
  if (!next) return null;
  const gap = next.price - s.cash;
  const cash = gap > 0 ? `$${grouped(gap)} to go` : 'cash ready';
  return next.parts.length > 0 ? `${next.name}: ${cash} · ${partCheck(next.parts)}` : `${next.name} ${lineLabel(next.line)}: ${cash}`;
}

/** The next lode or bonus. */
function depthGoal(s: GoalSnapshot, L: StoryLedger): string | null {
  if (L.hasBeat('S1') && !s.scriptedLodeFound) return `Copper lode: ${ft(SCRIPTED_LODE_TOP)}, beside Dot's shaft`;
  return nextBonus(s)?.text ?? null;
}

/** Next Goals (≤ 3, 01 §2.3): the chip's action, the next upgrade with its part check, the next lode or bonus. */
export function nextGoals(s: GoalSnapshot, upgrades: readonly GoalUpgrade[]): string[] {
  if (!scopeAtLeast(s.scope, 'mvp')) return [];
  const L = new StoryLedger(s.flags as Record<string, boolean>);
  const out: string[] = [];
  for (const g of [nextGoal(s)?.text, upgradeGoal(s, upgrades), depthGoal(s, L)]) {
    if (g && !out.includes(g)) out.push(g);
  }
  return out.slice(0, 3);
}
