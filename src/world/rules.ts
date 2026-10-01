// Per-step world rules on top of the pod step: depth records, Co-op incentives and the trip cycle
// (canon §3.8, §3.9; 01 §2.2, §3.10). PURE MODULE.
import { INCENTIVES } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import type { StoryState, Wallet } from './api';

export type Emit = (e: GameEvent) => void;

export function newStory(): StoryState {
  return {
    deepestRow: 0,
    trips: 0,
    tripDeepestRow: 0,
    underground: false,
    incentivesPaid: [],
    flags: {},
    coopCreditReadyStep: 0,
    destructions: 0,
  };
}

/** Deepest-row record and the first-reach incentives at r40 / r80 / r280. `row` = the pod centre's row. */
export function updateDepth(story: StoryState, wallet: Wallet, row: number, emit: Emit): void {
  if (row <= story.deepestRow) return;
  story.deepestRow = row;
  emit({ t: 'depth-record', row });
  for (const inc of INCENTIVES) {
    if (row < inc.row || story.incentivesPaid.includes(inc.row)) continue;
    story.incentivesPaid.push(inc.row);
    wallet.cash += inc.cash;
    wallet.lifetimeEarned += inc.cash;
    emit({ t: 'incentive', row: inc.row, ft: inc.ft, cash: inc.cash });
  }
}

/**
 * Trip cycle (01 §3.10). A trip starts the first step the pod centre is at r ≥ 1 ('left-rim') and ends
 * on the first step grounded on the Rim after that ('trip-end'). Returns true on trip end.
 */
export function updateTrip(story: StoryState, row: number, onRim: boolean, emit: Emit): boolean {
  if (row >= 1) {
    if (!story.underground) {
      story.underground = true;
      emit({ t: 'left-rim' });
    }
    if (row > story.tripDeepestRow) story.tripDeepestRow = row;
    return false;
  }
  if (!story.underground || !onRim) return false;
  story.trips++;
  emit({ t: 'trip-end', trip: story.trips, deepestRow: story.tripDeepestRow });
  resetTrip(story);
  return true;
}

/** Forget the current trip (trip end, respawn). */
export function resetTrip(story: StoryState): void {
  story.underground = false;
  story.tripDeepestRow = 0;
}
