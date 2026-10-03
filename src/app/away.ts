// Visible-idle away (02 §8.1 steps 1–2; 04 §3.7 "away: hidden, or visible 5 min without input"). MVP: the factory
// sleeps while away and nothing is credited, so this is only the start/end rule: 5 min of visible wall time with no
// input starts a rest ("Factory resting" chip), the first input ends it. Hidden is its own away (boot's lifecycle,
// after the critical save); either visibility change restarts the idle clock. Pure: the controller feeds it.
// v1 persists awayFrom / maxSavedWall (04 §4.9 AWAY) for catch-up; the MVP keeps nothing.

export const VISIBLE_IDLE_MS = 5 * 60_000;

export class AwayTracker {
  private idleMs = 0;
  private restingNow = false;

  get resting(): boolean {
    return this.restingNow;
  }

  /** Visible wall time passing (the frame's dt). True when this call starts a rest. */
  elapse(dtMs: number): boolean {
    if (this.restingNow) return false;
    this.idleMs += Math.max(0, dtMs);
    if (this.idleMs < VISIBLE_IDLE_MS) return false;
    this.restingNow = true;
    return true;
  }

  /** Player input (a touch, a key). True when it ends a rest. */
  input(): boolean {
    this.idleMs = 0;
    const was = this.restingNow;
    this.restingNow = false;
    return was;
  }

  /** The page was hidden or shown, or the world was replaced: not resting, and the idle clock starts over. */
  reset(): void {
    this.idleMs = 0;
    this.restingNow = false;
  }
}
