import { describe, expect, it } from 'vitest';
import { armingRadius, FixedStepper, STEP_MS } from '../../src/app/loop';
import { clipToast, MAX_TOASTS, pruneToasts, pushToast, TOAST_MS } from '../../src/app/toasts';
import { MEGA_POP_RADIUS, POP_RADIUS } from '../../src/shared/canon';

describe('FixedStepper (canon §3.5)', () => {
  it('runs one step per 60 Hz frame and accumulates remainders', () => {
    const s = new FixedStepper();
    expect(s.advance(STEP_MS)).toBe(1);
    expect(s.advance(STEP_MS / 2)).toBe(0);
    expect(s.alpha).toBeCloseTo(0.5, 6);
    expect(s.advance(STEP_MS / 2)).toBe(1);
  });

  it('runs two steps per 30 Hz frame (counters are in steps)', () => {
    const s = new FixedStepper();
    let steps = 0;
    for (let i = 0; i < 30; i++) steps += s.advance(1000 / 30);
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(60);
  });

  it('caps at 5 steps per frame and drops the excess wall time', () => {
    const s = new FixedStepper();
    expect(s.advance(10_000)).toBe(5); // clamped to 250 ms = 15 steps, capped at 5
    expect(s.alpha).toBeLessThan(1);
    expect(s.advance(0)).toBeLessThanOrEqual(1);
  });

  it('ignores negative dt and keeps alpha in [0, 1)', () => {
    const s = new FixedStepper();
    expect(s.advance(-50)).toBe(0);
    expect(s.alpha).toBe(0);
    s.advance(STEP_MS * 0.999);
    expect(s.alpha).toBeLessThan(1);
  });
});

describe('arming footprint', () => {
  it('shows the blast radius for explosives only', () => {
    expect(armingRadius('pop')).toBe(POP_RADIUS);
    expect(armingRadius('megaPop')).toBe(MEGA_POP_RADIUS);
    expect(armingRadius('hopBeacon')).toBe(0);
    expect(armingRadius(undefined)).toBe(0);
  });
});

describe('toasts (03 §6.2)', () => {
  it('keeps at most two, newest last, for 2.5 s', () => {
    let l = pushToast([], 1, 'a', 'info', 0);
    l = pushToast(l, 2, 'b', 'warn', 10);
    l = pushToast(l, 3, 'c', 'good', 20);
    expect(l.map((t) => t.text)).toEqual(['b', 'c']);
    expect(l).toHaveLength(MAX_TOASTS);
    expect(l[1].until).toBe(20 + TOAST_MS);
  });

  it('refreshes a repeated text instead of stacking it', () => {
    let l = pushToast([], 1, 'Bay full', 'warn', 0);
    l = pushToast(l, 2, 'Bay full', 'warn', 1_000);
    expect(l).toHaveLength(1);
    expect(l[0].id).toBe(2);
  });

  it('prunes expired toasts and returns the same list when nothing expired', () => {
    const l = pushToast([], 1, 'a', 'info', 0);
    expect(pruneToasts(l, 100)).toBe(l);
    expect(pruneToasts(l, TOAST_MS)).toEqual([]);
  });

  it('clips to 40 characters', () => {
    expect(clipToast('x'.repeat(60))).toHaveLength(40);
    expect(clipToast('short')).toBe('short');
  });
});
