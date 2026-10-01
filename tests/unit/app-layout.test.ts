import { describe, expect, it } from 'vitest';
import { computeLayout, defaultControlSize, orientationFlipped, sameLayout, toolbarOverlap } from '../../src/app/layout';
import { isLandscapePhone } from '../../src/platform/orientation';
import { TOUCH } from '../../src/shared/canon';

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

describe('computeLayout (canon §3.12)', () => {
  it('iPhone SE: no insets, size S', () => {
    const l = computeLayout({ width: 375, height: 667, dpr: 2, insets: { ...NO_INSETS, top: 20 }, controlSize: 'S' });
    expect(l).toEqual({ width: 375, height: 667, dpr: 2, clearTop: 20 + TOUCH.hudRow, controlZone: 150 });
  });

  it('iPhone 15: the bottom inset adds to the control zone', () => {
    const l = computeLayout({ width: 393, height: 852, dpr: 3, insets: { ...NO_INSETS, top: 59, bottom: 34 }, controlSize: 'M' });
    expect(l.clearTop).toBe(59 + 44);
    expect(l.controlZone).toBe(166 + 34);
  });

  it('a floating Safari toolbar pushes the control zone up when it exceeds the inset', () => {
    const l = computeLayout({ width: 393, height: 852, dpr: 3, insets: { ...NO_INSETS, bottom: 34 }, controlSize: 'M', visualBottom: 852 - 80 });
    expect(l.controlZone).toBe(166 + 80);
  });

  it('ignores keyboard-sized visual viewport shrinks', () => {
    expect(toolbarOverlap(852, 852 - 300)).toBe(0);
    expect(toolbarOverlap(852, 852)).toBe(0);
    expect(toolbarOverlap(852, undefined)).toBe(0);
    expect(toolbarOverlap(852, 800)).toBe(52);
  });

  it('guards degenerate sizes and DPR', () => {
    const l = computeLayout({ width: 0, height: 0, dpr: 0, insets: NO_INSETS, controlSize: 'L' });
    expect(l.width).toBe(1);
    expect(l.height).toBe(1);
    expect(l.dpr).toBe(1);
    expect(l.controlZone).toBe(182);
  });
});

describe('layout helpers', () => {
  it('defaults to S on 667-pt phones, else M (03 §12)', () => {
    expect(defaultControlSize(375, 667)).toBe('S');
    expect(defaultControlSize(667, 375)).toBe('S');
    expect(defaultControlSize(393, 852)).toBe('M');
    expect(defaultControlSize(360, 800)).toBe('M');
  });

  it('detects landscape phones: W > H and min side < 600', () => {
    expect(isLandscapePhone(852, 393)).toBe(true);
    expect(isLandscapePhone(393, 852)).toBe(false);
    expect(isLandscapePhone(1180, 820)).toBe(false); // iPad landscape is a tablet
    expect(isLandscapePhone(600, 599)).toBe(true);
  });

  it('compares layouts and detects orientation flips', () => {
    const a = computeLayout({ width: 393, height: 852, dpr: 3, insets: NO_INSETS, controlSize: 'M' });
    const b = computeLayout({ width: 852, height: 393, dpr: 3, insets: NO_INSETS, controlSize: 'M' });
    expect(sameLayout(a, { ...a })).toBe(true);
    expect(sameLayout(a, b)).toBe(false);
    expect(orientationFlipped(a, b)).toBe(true);
    expect(orientationFlipped(a, { ...a, height: 700 })).toBe(false);
  });
});
