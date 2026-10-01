import { describe, expect, it } from 'vitest';
import type { PointerSample } from '../../src/input/arbiter';
import { SlotPress } from '../../src/input/arming';
import { footprintRadius, slotDecision, slotKind } from '../../src/input/slots';
import { TOUCH } from '../../src/shared/canon';

const p = (x: number, y: number, t: number, id = 7): PointerSample => ({ id, x, y, t });
const machine = () => new SlotPress({ armMs: TOUCH.explosiveArmMs, cancelSlidePt: TOUCH.explosiveCancelSlidePt });

// 03 §13 "Arming": release at 200 ms: nothing; slide 30 pt: cancel; 300 ms: fires.
describe('SlotPress (explosives and beacons)', () => {
  it('release before the ring fills cancels', () => {
    const m = machine();
    m.down(0, 'armed', p(300, 700, 1000));
    expect(m.progress(1100)).toBeCloseTo(0.4, 6);
    expect(m.up(p(300, 700, 1200))).toEqual({ kind: 'cancel', slot: 0, reason: 'early' });
    expect(m.pressing).toBe(false);
  });

  it('release after the ring fills fires', () => {
    const m = machine();
    m.down(1, 'armed', p(300, 700, 1000));
    expect(m.progress(1300)).toBe(1);
    expect(m.up(p(305, 702, 1300))).toEqual({ kind: 'fire', slot: 1 });
  });

  it('fires at exactly the arm time', () => {
    const m = machine();
    m.down(1, 'armed', p(0, 0, 0));
    expect(m.up(p(0, 0, TOUCH.explosiveArmMs))).toEqual({ kind: 'fire', slot: 1 });
  });

  it('a slide beyond 24 pt cancels at once, and the later release stays cancelled', () => {
    const m = machine();
    m.down(0, 'armed', p(300, 700, 0));
    expect(m.move(p(320, 700, 50))).toBe(false); // 20 pt
    expect(m.move(p(330, 700, 100))).toBe(true); // 30 pt
    expect(m.pressing).toBe(false);
    expect(m.captured).toBe(true);
    expect(m.progress(400)).toBe(0);
    m.move(p(300, 700, 350)); // sliding back does not re-arm
    expect(m.up(p(300, 700, 400))).toEqual({ kind: 'cancel', slot: 0, reason: 'slide' });
    expect(m.captured).toBe(false);
  });

  it('a slide detected only at release still cancels', () => {
    const m = machine();
    m.down(2, 'armed', p(0, 0, 0));
    expect(m.up(p(0, 40, 500))).toEqual({ kind: 'cancel', slot: 2, reason: 'slide' });
  });

  it('ignores other pointers and a second press', () => {
    const m = machine();
    expect(m.down(0, 'armed', p(0, 0, 0, 1))).toBe(true);
    expect(m.down(1, 'armed', p(50, 0, 10, 2))).toBe(false);
    expect(m.move(p(500, 500, 20, 2))).toBe(false);
    expect(m.up(p(0, 0, 300, 2))).toBeNull();
    expect(m.up(p(0, 0, 300, 1))).toEqual({ kind: 'fire', slot: 0 });
  });

  it('cancel() drops the press without firing', () => {
    const m = machine();
    m.down(0, 'armed', p(0, 0, 0));
    m.cancel();
    expect(m.up(p(0, 0, 400))).toBeNull();
  });
});

describe('SlotPress (Jerrycan, Patch Kit)', () => {
  it('fires on any release, with no ring', () => {
    const m = machine();
    m.down(2, 'instant', p(0, 0, 0));
    expect(m.progress(100)).toBe(0);
    expect(m.up(p(0, 0, 80))).toEqual({ kind: 'fire', slot: 2 });
  });

  it('slide-off cancels', () => {
    const m = machine();
    m.down(3, 'instant', p(0, 0, 0));
    m.move(p(0, -30, 40));
    expect(m.up(p(0, -30, 60))).toEqual({ kind: 'cancel', slot: 3, reason: 'slide' });
  });
});

describe('slot policy', () => {
  const ctx = { count: 3, grounded: true, fuelFrac: 0.5, hullFrac: 0.5 };
  it('arms explosives and beacons; Jerrycan / Patch Kit are instant', () => {
    expect(slotKind('pop')).toBe('armed');
    expect(slotKind('megaPop')).toBe('armed');
    expect(slotKind('hopBeacon')).toBe('armed');
    expect(slotKind('homingBeacon')).toBe('armed');
    expect(slotKind('jerrycan')).toBe('instant');
    expect(slotKind('patchKit')).toBe('instant');
  });
  it('refuses empty slots, airborne grounded-only items and top-ups when ≥ 90% full', () => {
    expect(slotDecision('pop', { ...ctx, count: 0 })).toEqual({ ok: false, reason: 'empty' });
    expect(slotDecision('pop', { ...ctx, grounded: false })).toEqual({ ok: false, reason: 'airborne' });
    expect(slotDecision('jerrycan', { ...ctx, grounded: false })).toEqual({ ok: true, kind: 'instant' });
    expect(slotDecision('jerrycan', { ...ctx, fuelFrac: 0.9 })).toEqual({ ok: false, reason: 'full' });
    expect(slotDecision('patchKit', { ...ctx, hullFrac: 0.95 })).toEqual({ ok: false, reason: 'full' });
    expect(slotDecision('megaPop', ctx)).toEqual({ ok: true, kind: 'armed' });
  });
  it('footprints follow canon §2.7', () => {
    expect(footprintRadius('pop')).toBe(1);
    expect(footprintRadius('megaPop')).toBe(2);
    expect(footprintRadius('hopBeacon')).toBe(0);
  });
});
