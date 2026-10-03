// Story → app state (01 §2.3; 03 §6.2, §6.5): radio beats join the radio queue, milestones become a 'good'
// toast (the office log reads them back from the world's flags), 'trip-end' raises the trip summary with Next
// Goals, and the goal chip refreshes at ≤ 2 Hz. A pending trip summary's Next Goals refresh with the chip: it
// shows after the pad's sheet closes, so a sale made there must already count. The controller forwards drained
// events and frame ticks here, and asks for a prompt refresh after a world action or a sheet closing.
// The chip's factory steps (01 §2.6) read what the factory reached from its views, and a ghost job the pod holds
// in vain names its fix. M0 builds have no story (01 §2.8), so the feed stays silent there.
import { BUILDINGS, kitUnits, type EntityView, type Err, type ErrCode, type FactoryApi, type GhostView } from '../factory/api';
import { cargoSlotsUsed, itemSlots } from '../pod';
import { F, T } from '../shared/types';
import { scopeAtLeast } from '../shared/scope';
import type { GameEvent } from '../shared/events';
import { TripTracker, nextGoal, nextGoals, type GoalSnapshot, type TripStats } from '../story';
import type { WorldApi } from '../world/api';
import { errText, ghostRefusalText, kitCount, kitsForUnits } from '../world/factoryText';
import type { AppState, GoalChip, RadioMessage, Toast } from './types';

/** Goal chip refresh period (≤ 2 Hz). */
export const GOAL_REFRESH_MS = 500;

/** The recipe "Build an Assembler: Wire" asks for (01 §2.6; 02 §4.2 A2: 1 Copper Ingot → 2 Wire). */
export const WIRE_RECIPE = 'A2';

/** The GoalSnapshot fields read from the factory views. */
export type FactoryFacts = Pick<GoalSnapshot, 'drillFeedsLift' | 'liftAtHeadframe' | 'wireAssembler' | 'wireStock'>;

/** An Auto-Drill beside a lift's foot cell pushes straight into it (02 §3.4 "an adjacent drill"). */
function drillBesideFoot(d: EntityView, lift: EntityView): boolean {
  const foot = lift.y + lift.h - 1;
  return foot >= d.y && foot < d.y + d.h && (lift.x === d.x - 1 || lift.x === d.x + d.w);
}

/** What the factory has reached, for the goal chip's beat-6 steps (01 §2.6). Null factory (M0): nothing. */
export function factoryFacts(f: FactoryApi | null): FactoryFacts {
  const out: FactoryFacts = { drillFeedsLift: false, liftAtHeadframe: false, wireAssembler: false, wireStock: 0 };
  if (!f) return out;
  const drills: EntityView[] = [];
  const lifts: EntityView[] = [];
  const headframes: EntityView[] = [];
  for (const e of f.entities()) {
    if (e.kind === 'autoDrill') drills.push(e);
    else if (e.kind === 'lift') lifts.push(e);
    else if (e.kind === 'headframe') headframes.push(e);
    else if (e.kind === 'assembler' && e.recipe === WIRE_RECIPE) out.wireAssembler = true;
  }
  for (const l of lifts) {
    // A row-0 top feeds the Headframe standing over its column (02 §3.4).
    if (l.y === 0 && headframes.some((h) => l.x >= h.x && l.x < h.x + h.w)) out.liftAtHeadframe = true;
    if (drills.some((d) => drillBesideFoot(d, l))) out.drillFeedsLift = true;
  }
  out.wireStock = f.stockpileCount('wire');
  return out;
}

/** First row of the job's column that is not open air (a blocked shaft), or undefined. */
function solidRow(w: WorldApi, g: GhostView): number | undefined {
  for (let r = g.y; r < g.y + g.h; r++) if (w.terrain.get(g.x, r) !== T.AIR) return r;
  return undefined;
}

/**
 * The refusal as completeGhost reported it, rebuilt from the code WorldApi.ghostProgress() carries plus the job:
 * the cargo Kit, and for a column the row ghostRefusalText needs (no lift under a rail yet, else the blocked row).
 */
function refusalOf(w: WorldApi, g: GhostView, code: ErrCode): Err {
  const e: Err = { ok: false, code };
  if (code === 'E_KIT') {
    e.item = g.kit;
    e.need = g.kitUnits;
  } else if (code === 'E_COLUMN') {
    const below = g.y + g.h;
    const lifted = w.factory?.entities().some((x) => x.kind === 'lift' && x.x === g.x && x.y === below) ?? false;
    e.y = g.part === 'rail' && !lifted ? below : solidRow(w, g);
  }
  return e;
}

/**
 * The goal chip's fix for the ghost job the pod is holding while it keeps being refused (PLAYER-6), or null. Pip
 * standing in an occupant's footprint (E_POD) is named as such; anything else reads as the refusal toast.
 */
export function blockedGoalText(w: WorldApi): string | null {
  const p = w.ghostProgress();
  if (!p?.blocked) return null;
  const g = w.factory?.ghosts().find((j) => j.id === p.id) ?? null;
  if (p.blocked === 'E_POD') {
    const site = !g ? 'build site' : g.kind === 'autoDrill' ? 'drill site' : `${BUILDINGS[g.kind].name} site`;
    return `Move Pip off the ${site} so it can build`;
  }
  return g ? ghostRefusalText(g, refusalOf(w, g, p.blocked)) : errText({ ok: false, code: p.blocked });
}

/** The survey drill's site (factory.surveyPlan, the Auto-Drill's footprint) is open air. No factory: true. */
export function drillSiteOpen(w: WorldApi): boolean {
  const f = w.factory;
  if (!f) return true;
  const { drill } = f.surveyPlan();
  const { w: dw, h: dh } = BUILDINGS.autoDrill;
  for (let y = drill.y; y < drill.y + dh; y++) {
    for (let x = drill.x; x < drill.x + dw; x++) if (w.terrain.get(x, y) !== T.AIR) return false;
  }
  return true;
}

/**
 * The Shed errand for the oldest pending ghost whose Kit the bay cannot cover (02 §2.9 shopping list): "Load …"
 * when the Stockpile holds enough, else "Buy …"; null when the bay covers every ghost.
 */
export function kitErrand(w: WorldApi): string | null {
  const f = w.factory;
  if (!f) return null;
  const need = new Map<string, number>();
  for (const g of f.ghosts()) if (g.kit) need.set(g.kit, (need.get(g.kit) ?? 0) + g.kitUnits);
  if (need.size === 0) return null;
  const carried = new Map<string, number>();
  for (const c of w.pod.cargo) if (c.kind === 'kit') carried.set(c.id, (carried.get(c.id) ?? 0) + (c.units ?? kitUnits(c.id)));
  for (const [kit, units] of need) {
    const short = units - (carried.get(kit) ?? 0);
    if (short <= 0) continue;
    const n = kitsForUnits(kit, short);
    const stocked = w.kitShop().find((k) => k.id === kit)?.inStockpile ?? 0;
    return `${stocked >= n ? 'Load' : 'Buy'} ${kitCount(kit, n)} at the Shed`;
  }
  return null;
}

export interface StoryFeedDeps {
  state: Pick<AppState, 'radio' | 'goal' | 'tripSummary'>;
  world(): WorldApi;
  toast(text: string, tone: Toast['tone']): void;
}

/** Column of Dot's survey shaft: the SURVEY-flagged cell on row 1 (canon §3.2 pass 5), or −1. */
export function surveyColumnOf(world: WorldApi): number {
  const grid = world.terrain;
  if (!grid) return -1;
  for (let x = 0; x < grid.w; x++) if (grid.hasFlag(x, 1, F.SURVEY)) return x;
  return -1;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

function sameGoal(a: GoalChip | null, b: GoalChip | null): boolean {
  if (a === null || b === null) return a === b;
  return a.text === b.text && a.progress === b.progress && sameList(a.next ?? [], b.next ?? []);
}

export class StoryFeed {
  private readonly trip = new TripTracker();
  private radioId = 0;
  private lastGoalAt = Number.NEGATIVE_INFINITY;
  private columnOf: { world: WorldApi; col: number } | null = null;

  constructor(private readonly deps: StoryFeedDeps) {}

  private get active(): boolean {
    return scopeAtLeast(this.deps.world().scope, 'mvp');
  }

  /** A new world (new game, import, Safe Mode): forget the old one's transmissions, goal and trip. */
  reset(): void {
    const s = this.deps.state;
    if (s.radio.peek().length > 0) s.radio.value = [];
    s.goal.value = null;
    s.tripSummary.value = null;
    this.trip.reset();
    this.lastGoalAt = Number.NEGATIVE_INFINITY;
    this.columnOf = null;
  }

  onEvents(events: readonly GameEvent[], now: number): void {
    if (!this.active) return;
    const w = this.deps.world();
    // A save loaded mid-trip: summarise from here on.
    if (!this.trip.tracking && w.story.underground) this.trip.begin(w.pod.fuel, w.stepNo);
    let radio: RadioMessage[] | null = null;
    for (const e of events) {
      if (e.t === 'radio') {
        radio ??= this.deps.state.radio.peek().slice();
        radio.push({ id: ++this.radioId, beat: e.beat, sender: e.sender, cards: e.cards, at: now });
      } else if (e.t === 'milestone') {
        this.deps.toast(`Milestone: ${e.title}`, 'good');
      }
      const done = this.trip.onEvent(e, w.pod.fuel, w.stepNo);
      if (done) this.showTrip(done);
    }
    if (radio) this.deps.state.radio.value = radio;
  }

  /** Per frame: fuel bookkeeping for the trip; the goal chip (and a pending trip summary's Next Goals) at ≤ 2 Hz. */
  tick(now: number): void {
    if (!this.active) return;
    this.trip.sampleFuel(this.deps.world().pod.fuel);
    if (now - this.lastGoalAt < GOAL_REFRESH_MS) return;
    this.lastGoalAt = now;
    const snap = this.snapshot();
    const g = nextGoal(snap);
    const list = nextGoals(snap, this.deps.world().garageCards());
    // The chip already says its own action; its Next Goals list is the rest.
    const next: GoalChip | null = g ? { ...g, next: list.filter((t) => t !== g.text) } : null;
    if (!sameGoal(this.deps.state.goal.peek(), next)) this.deps.state.goal.value = next;
    // Landing on the Assay pad opens its sheet at once and the summary waits under it: it must not still say
    // "Sell at the Assay Office" with the old "$ to go" once it shows (PLAYER-7).
    const ts = this.deps.state.tripSummary.peek();
    if (ts && !sameList(ts.nextGoals, list)) this.deps.state.tripSummary.value = { ...ts, nextGoals: list };
  }

  /** The world changed under a sheet (a sale, a purchase) or a sheet closed: refresh the goals on the next tick. */
  refresh(): void {
    this.lastGoalAt = Number.NEGATIVE_INFINITY;
  }

  private showTrip(t: TripStats): void {
    const snap = this.snapshot();
    this.deps.state.tripSummary.value = { ...t, nextGoals: nextGoals(snap, this.deps.world().garageCards()) };
  }

  private surveyColumn(w: WorldApi): number {
    if (this.columnOf?.world !== w) this.columnOf = { world: w, col: surveyColumnOf(w) };
    return this.columnOf.col;
  }

  private snapshot(): GoalSnapshot {
    const w = this.deps.world();
    const pod = w.pod;
    const stats = w.stats();
    let sellable = 0;
    let kitSlots = 0;
    for (const c of pod.cargo) {
      if (c.kind === 'kit') kitSlots += itemSlots(c);
      else sellable++;
    }
    const scripted = w.terrain?.lodes.find((l) => l.scripted);
    return {
      scope: w.scope,
      flags: w.story.flags,
      podX: pod.x,
      row: pod.row,
      onRim: pod.grounded && pod.y > 0,
      fuelFrac: stats.maxFuel > 0 ? pod.fuel / stats.maxFuel : 0,
      cargoUsed: cargoSlotsUsed(pod.cargo),
      baySlots: stats.baySlots,
      sellable,
      cash: w.wallet.cash,
      deepestRow: w.story.deepestRow,
      tiers: pod.tiers,
      surveyColumn: this.surveyColumn(w),
      scriptedLodeFound: scripted?.discovered ?? false,
      kitSlots,
      ...factoryFacts(w.factory),
      drillSiteOpen: drillSiteOpen(w),
      kitErrand: kitErrand(w),
      buildBlocked: blockedGoalText(w),
    };
  }
}
