// Story → app state (01 §2.3; 03 §6.2, §6.5): radio beats join the radio queue, milestones become a 'good'
// toast (the office log reads them back from the world's flags), 'trip-end' raises the trip summary with Next
// Goals, and the goal chip refreshes at ≤ 2 Hz. A pending trip summary's Next Goals refresh with the chip: it
// shows after the pad's sheet closes, so a sale made there must already count. The controller forwards drained
// events and frame ticks here, and asks for a prompt refresh after a world action or a sheet closing.
// M0 builds have no story (01 §2.8), so the feed stays silent there.
import { cargoSlotsUsed } from '../pod';
import { F } from '../shared/types';
import { scopeAtLeast } from '../shared/scope';
import type { GameEvent } from '../shared/events';
import { TripTracker, nextGoal, nextGoals, type GoalSnapshot, type TripStats } from '../story';
import type { WorldApi } from '../world/api';
import type { AppState, GoalChip, RadioMessage, Toast } from './types';

/** Goal chip refresh period (≤ 2 Hz). */
export const GOAL_REFRESH_MS = 500;

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
    for (const c of pod.cargo) if (c.kind !== 'kit') sellable++;
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
    };
  }
}
