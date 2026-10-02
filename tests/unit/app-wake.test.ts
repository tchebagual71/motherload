import { describe, expect, it, vi } from 'vitest';
import type { Overlay } from '../../src/app/types';
import { inPlay, WAKE_IDLE_MS, WakePolicy, type WakeTimers } from '../../src/app/wakePolicy';

/** Manual timers: run() fires everything due by `now`. */
function clock() {
  let now = 0;
  let pending: { at: number; fn: () => void }[] = [];
  const timers: WakeTimers = {
    set: (fn, ms) => {
      const t = { at: now + ms, fn };
      pending.push(t);
      return t;
    },
    clear: (h) => {
      pending = pending.filter((t) => t !== h);
    },
  };
  const advance = (ms: number): void => {
    now += ms;
    const due = pending.filter((t) => t.at <= now);
    pending = pending.filter((t) => t.at > now);
    for (const t of due) t.fn();
  };
  return { timers, advance };
}

describe('Wake Lock policy (03 §3.8, 25-s idle rule)', () => {
  it('play means no overlay but the countdown, and no sheet', () => {
    expect(inPlay(null, null)).toBe(true);
    expect(inPlay('countdown', null)).toBe(true);
    for (const o of ['title', 'interrupt', 'upright', 'death', 'safemode'] as Overlay[]) expect(inPlay(o, null)).toBe(false);
    expect(inPlay(null, 'menu')).toBe(false);
  });

  it('holds the lock in play and releases it 25 s after the pod was held (Tap to resume, menu)', () => {
    const lock = { want: vi.fn() };
    const c = clock();
    const p = new WakePolicy(lock, c.timers);
    p.update(false); // the title: nothing requested yet
    expect(lock.want).not.toHaveBeenCalled();
    p.update(true); // Play
    expect(lock.want).toHaveBeenLastCalledWith(true);
    p.update(false); // "Tap to resume"
    c.advance(WAKE_IDLE_MS - 1);
    expect(lock.want).toHaveBeenLastCalledWith(true);
    c.advance(1);
    expect(lock.want).toHaveBeenLastCalledWith(false);
    p.update(true); // resumed
    expect(lock.want).toHaveBeenLastCalledWith(true);
  });

  it('a short pause (a shop sheet, the death card) keeps the lock', () => {
    const lock = { want: vi.fn() };
    const c = clock();
    const p = new WakePolicy(lock, c.timers);
    p.update(true);
    p.update(false);
    c.advance(3_000);
    p.update(true);
    c.advance(WAKE_IDLE_MS * 2);
    expect(lock.want.mock.calls.map((a) => a[0])).toEqual([true, true]);
  });
});
