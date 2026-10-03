import { describe, expect, it, vi } from 'vitest';
import { needsResumeCountdown, needsSheetCountdown, TimeController } from '../../src/app/time';
import { TOUCH } from '../../src/shared/canon';

const GROUNDED = { grounded: true, vx: 0, vy: 0 };
const AIRBORNE = { grounded: false, vx: 0, vy: -1 };

describe('resume gate predicates (canon §4.5)', () => {
  it('counts down when airborne or faster than 3 tiles/s', () => {
    expect(needsResumeCountdown(GROUNDED)).toBe(false);
    expect(needsResumeCountdown(AIRBORNE)).toBe(true);
    expect(needsResumeCountdown({ grounded: true, vx: 2.9, vy: 0 })).toBe(false);
    expect(needsResumeCountdown({ grounded: true, vx: 2.5, vy: 2.5 })).toBe(true); // |v| = 3.54
  });

  it('leaving a sheet counts down only when airborne with |vy| > 5.88', () => {
    expect(needsSheetCountdown({ grounded: false, vx: 0, vy: -5.8 })).toBe(false);
    expect(needsSheetCountdown({ grounded: false, vx: 0, vy: -6 })).toBe(true);
    expect(needsSheetCountdown({ grounded: true, vx: 0, vy: -6 })).toBe(false);
  });
});

describe('TimeController', () => {
  it('runs the pod only with no reasons and no countdown', () => {
    const t = new TimeController();
    expect(t.podRunning).toBe(true);
    t.raise('menu');
    expect(t.podRunning).toBe(false);
    t.clear('menu');
    expect(t.podRunning).toBe(true);
  });

  it('notifies on changes only', () => {
    const onChange = vi.fn();
    const t = new TimeController(onChange);
    expect(t.raise('title')).toBe(true);
    expect(t.raise('title')).toBe(false);
    expect(t.clear('menu')).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('derives one overlay by precedence', () => {
    const t = new TimeController();
    t.raise('interrupt');
    expect(t.overlay()).toBe('interrupt');
    t.raise('death');
    expect(t.overlay()).toBe('death');
    t.raise('upright');
    expect(t.overlay()).toBe('upright');
    t.raise('title');
    expect(t.overlay()).toBe('title');
    t.raise('safemode');
    expect(t.overlay()).toBe('safemode');
    t.raise('ctxlost');
    expect(t.overlay()).toBe('safemode');
  });

  it('pauses without an overlay for sheets', () => {
    const t = new TimeController();
    t.setSheet('sheet', GROUNDED);
    expect(t.overlay()).toBeNull();
    expect(t.podRunning).toBe(false);
  });

  it('context loss shows "Restoring graphics…" over death and the resume card, under the upright card (APP-11)', () => {
    const t = new TimeController();
    t.raise('ctxlost');
    expect(t.overlay()).toBe('ctxlost');
    expect(t.podRunning).toBe(false);
    t.raise('death');
    t.raise('interrupt');
    expect(t.overlay()).toBe('ctxlost');
    t.raise('upright');
    expect(t.overlay()).toBe('upright');
  });

  it('ignores interrupt while a modal state holds the pod, unless forced', () => {
    const t = new TimeController();
    t.setSheet('menu', GROUNDED);
    expect(t.interrupt()).toBe(false);
    expect(t.has('interrupt')).toBe(false);
    expect(t.interrupt(true)).toBe(true);
    expect(t.has('interrupt')).toBe(true);
  });

  it('resumes at once when grounded and still', () => {
    const t = new TimeController();
    t.interrupt();
    t.resume(GROUNDED);
    expect(t.podRunning).toBe(true);
    expect(t.overlay()).toBeNull();
  });

  it('runs the 1.5 s countdown when resuming airborne', () => {
    const t = new TimeController();
    t.interrupt();
    t.resume(AIRBORNE);
    expect(t.overlay()).toBe('countdown');
    expect(t.countdownMs).toBe(TOUCH.resumeCountdownMs);
    expect(t.tick(1_000)).toBe(false);
    expect(t.podRunning).toBe(false);
    expect(t.tick(600)).toBe(true);
    expect(t.podRunning).toBe(true);
    expect(t.overlay()).toBeNull();
  });

  it('a new interrupt cancels a running countdown', () => {
    const t = new TimeController();
    t.interrupt();
    t.resume(AIRBORNE);
    t.interrupt();
    expect(t.countdownMs).toBe(0);
    expect(t.overlay()).toBe('interrupt');
  });

  it('holds the countdown while another reason is active', () => {
    const t = new TimeController();
    t.startCountdown();
    t.raise('menu');
    expect(t.tick(5_000)).toBe(false);
    expect(t.countdownMs).toBe(TOUCH.resumeCountdownMs);
    t.clear('menu');
    expect(t.tick(TOUCH.resumeCountdownMs)).toBe(true);
  });

  it('closing a sheet while falling fast gets the countdown', () => {
    const t = new TimeController();
    t.setSheet('sheet', GROUNDED);
    t.setSheet(null, { grounded: false, vx: 0, vy: -7 });
    expect(t.overlay()).toBe('countdown');
  });

  it('switching sheets swaps the reason without a gate', () => {
    const t = new TimeController();
    t.setSheet('menu', GROUNDED);
    t.setSheet('settings', { grounded: false, vx: 0, vy: -9 });
    expect(t.activeReasons()).toEqual(['settings']);
    expect(t.countdownMs).toBe(0);
  });

  it('leaving the title applies the full gate only for a cold-loaded save', () => {
    const fresh = new TimeController();
    fresh.raise('title');
    fresh.leaveTitle(AIRBORNE, false);
    expect(fresh.podRunning).toBe(true);
    const cold = new TimeController();
    cold.raise('title');
    cold.leaveTitle(AIRBORNE, true);
    expect(cold.overlay()).toBe('countdown');
  });
});
