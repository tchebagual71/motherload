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
  /** Bay slots the Kits aboard take (the Starter Kit is 5). */
  kitSlots: number;
  // ---- What the factory has reached (01 §2.6 steps the ghost events cannot tell; read from the factory views).
  /** An Auto-Drill stands beside a lift foot and feeds it directly (02 §3.4): no belt is needed. */
  drillFeedsLift: boolean;
  /** A lift's top section reaches row 0, i.e. its Headframe (02 §3.4): every rail is built. */
  liftAtHeadframe: boolean;
  /** An Assembler is set to Wire (02 §4.2 A2). */
  wireAssembler: boolean;
  /** Wire in the Stockpile. */
  wireStock: number;
  /** The survey drill's 2×2 site above the scripted lode is dug out (01 §2.5: the access dig ends with it). */
  drillSiteOpen: boolean;
  /**
   * Shed errand for Kits the pending ghosts need and the bay lacks (e.g. after a salvage lost them), such as
   * "Buy 1 Lift Rail at the Shed"; null when the bay covers every ghost.
   */
  kitErrand: string | null;
  /**
   * Fix for the ghost job the pod is holding while it keeps being refused (WorldApi.ghostProgress().blocked),
   * e.g. "Move Pip off the drill site so it can build"; null when nothing is blocked.
   */
  buildBlocked: string | null;
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

/** The scripted lode is found: S5 fired, or the terrain says so (01 §2.5: falling in early finds it sooner). */
function lodeFound(s: GoalSnapshot, L: StoryLedger): boolean {
  return s.scriptedLodeFound || L.hasBeat('S5');
}

/**
 * The bay is full of ore. Not while it holds the Kits the next build steps spend (INT-10): the Starter Kit's 5
 * slots fill a small bay during the access dig, and placing the drill and the lift is what frees them.
 */
function bayFull(s: GoalSnapshot, L: StoryLedger): boolean {
  if (s.cargoUsed < s.baySlots) return false;
  return s.kitSlots === 0 || !L.has(obFlag('kit')) || (drillDone(L) && liftDone(s, L) && beltDone(s, L));
}

/** Contextual hints that win over the script step while onboarding (01 §2.5 "Bay full", "Fuel low", the mouth). */
function contextual(s: GoalSnapshot, L: StoryLedger): Goal | null {
  const underground = s.row >= 1;
  if (underground && bayFull(s, L)) return goal('Bay full — head up');
  if (underground && s.fuelFrac <= LOW_FUEL) return goal('Fuel low: the tick shows your way home');
  const nearMouth = s.surveyColumn >= 0 && Math.abs(s.podX - (s.surveyColumn + 0.5)) <= MOUTH_TILES;
  if (s.onRim && nearMouth && L.hasBeat('S1') && !L.hasBeat('S5')) return goal("Dot's shaft: long drop. Hold ↑ to brake");
  return null;
}

/** Beats 1–3: refuel, first dig and sale, first t2. */
function earlySteps(s: GoalSnapshot, L: StoryLedger): Goal | null {
  const refuel = refuelStep(L);
  if (refuel) return refuel;
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

/** Beat 1 alone: the refuel. */
function refuelStep(L: StoryLedger): Goal | null {
  return L.hasMilestone('toppedOff') ? null : goal('Fill up at the Pump House');
}

/** Beats 4–5: 500 ft, the survey ping, the scripted lode, the Starter Kit. */
function lodeSteps(s: GoalSnapshot, L: StoryLedger): Goal | null {
  if (!lodeFound(s, L)) return L.hasBeat('S1') || L.hasBeat('S2') ? goal("Follow Dot's shaft down to her lode") : nextBonus(s);
  if (!L.has(obFlag('kit'))) return goal('Collect your Starter Kit at the Shed');
  return null;
}

// Beat 6 is read from what the factory reached, not from build events alone (INT-1): the survey plan's drill sits
// beside the lift foot and feeds it with no belt ghost ever built, and Assemblers are Yard buildings placed at
// once (no ghost-complete). FirstLiftDelivery (S6) closes the drill, lift and belt steps for good.

/** The Auto-Drill was built by proximity. */
function drillDone(L: StoryLedger): boolean {
  return L.has(obFlag('drill')) || L.hasBeat('S6');
}
/** The lift reaches its Headframe: 'ghost-complete' fires for the foot section while the Lift Rail still waits. */
function liftDone(s: GoalSnapshot, L: StoryLedger): boolean {
  return s.liftAtHeadframe || L.hasBeat('S6');
}
/** Drill ore reaches the lift: a drill beside the foot, or an underground belt built from a ghost. */
function beltDone(s: GoalSnapshot, L: StoryLedger): boolean {
  return s.drillFeedsLift || L.has(obFlag('belt')) || L.hasBeat('S6');
}
/**
 * An Assembler is set to Wire, or Wire is stocked (the Assembler may move on to Hull Plate). After the first t3
 * (beat 7) the onboarding is over: spending that Wire does not bring the step back.
 */
function wireDone(s: GoalSnapshot): boolean {
  return s.wireAssembler || s.wireStock > 0 || hasT3(s);
}

/** Beat 6: drill, lift, belt, FirstLiftDelivery, first Wire, first Hull Plate (01 §2.6). */
function factorySteps(s: GoalSnapshot, L: StoryLedger): Goal | null {
  if (!drillDone(L)) {
    if (!s.drillSiteOpen) return goal(s.row < ACCESS_ROW ? 'Dig down at the chevrons' : 'Dig out the drill site');
    return goal(s.kitErrand ?? 'Place the drill on the lode');
  }
  // A ghost waiting on a Kit the bay lost (a salvage) builds nothing until the Shed trip: name the trip.
  if (!liftDone(s, L)) return goal(s.kitErrand ?? "Hang the lift in Dot's shaft");
  if (!beltDone(s, L)) return goal(s.kitErrand ?? 'Belt the drill to the lift');
  if (!L.hasBeat('S6') || !L.has(obFlag('ingot'))) return goal('Belt the Headframe to the Smelter');
  if (!wireDone(s)) return goal('Build an Assembler: Wire');
  if (!L.hasMilestone('plated')) return goal('Stockpile iron and cobalt');
  return null;
}

/**
 * The script step. Falling into Dot's shaft early is allowed (01 §2.5: "the Starter Kit is simply ready sooner"):
 * once the scripted lode is found, the Kit and the factory come before the first sale and the first t2 (PLAYER-9);
 * only the refuel stays ahead of them.
 */
function scriptSteps(s: GoalSnapshot, L: StoryLedger): Goal | null {
  if (lodeFound(s, L)) return refuelStep(L) ?? lodeSteps(s, L) ?? factorySteps(s, L) ?? earlySteps(s, L);
  return earlySteps(s, L) ?? lodeSteps(s, L) ?? factorySteps(s, L);
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

/**
 * The goal chip: one action, or null when there is nothing to suggest (M0 has no chip, 01 §2.8). A ghost job the
 * pod holds in vain names its fix first, onboarding or not (PLAYER-6): the build ring is waiting on the player.
 */
export function nextGoal(s: GoalSnapshot): Goal | null {
  if (!scopeAtLeast(s.scope, 'mvp')) return null;
  if (s.buildBlocked) return goal(s.buildBlocked);
  const L = new StoryLedger(s.flags as Record<string, boolean>);
  const steps = scriptSteps(s, L);
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
  if (L.hasBeat('S1') && !lodeFound(s, L)) return `Copper lode: ${ft(SCRIPTED_LODE_TOP)}, beside Dot's shaft`;
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
