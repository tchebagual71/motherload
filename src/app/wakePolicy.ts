// When the screen Wake Lock is held (03 §3.8: a nice-to-have, never relied on). Held while the player is in
// play; released once the pod has been held by the title, a card or a sheet for WAKE_IDLE_MS (03's 25-s idle
// rule), so a game left on "Tap to resume" or in a menu lets the phone auto-lock. Pure apart from the timers.
import type { WakeLockHandle } from '../platform/wakeLock';
import type { Overlay, SheetId } from './types';

export const WAKE_IDLE_MS = 25_000;

/** In play: no overlay but the resume countdown, and no sheet. */
export function inPlay(overlay: Overlay, sheet: SheetId): boolean {
  return (overlay === null || overlay === 'countdown') && sheet === null;
}

export interface WakeTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const browserTimers: WakeTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class WakePolicy {
  private playing = false;
  private idleTimer: unknown = null;

  constructor(
    private readonly lock: Pick<WakeLockHandle, 'want'>,
    private readonly timers: WakeTimers = browserTimers,
    private readonly idleMs = WAKE_IDLE_MS,
  ) {}

  /** Call whenever the overlay or sheet changes. Boot starts paused (title): nothing is held until play. */
  update(playing: boolean): void {
    if (playing === this.playing) return;
    this.playing = playing;
    this.cancelIdle();
    if (playing) {
      this.lock.want(true);
      return;
    }
    this.idleTimer = this.timers.set(() => {
      this.idleTimer = null;
      this.lock.want(false);
    }, this.idleMs);
  }

  dispose(): void {
    this.cancelIdle();
    this.lock.want(false);
  }

  private cancelIdle(): void {
    if (this.idleTimer === null) return;
    this.timers.clear(this.idleTimer);
    this.idleTimer = null;
  }
}
