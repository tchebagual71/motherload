import { describe, expect, it } from 'vitest';
import { ageText, damagedFallbackNotice, NOTICE, previousCopyNotice, unlockNotice } from '../../src/app/notices';
import { RUNGS } from '../../src/factory';
import { TOAST_MAX_CHARS } from '../../src/app/toasts';

const MIN = 60_000;

describe('save and boot notices fit a toast (03 §6.2: ≤ 40 characters, never clipped)', () => {
  it('every fixed notice', () => {
    for (const text of Object.values(NOTICE)) expect(text.length, text).toBeLessThanOrEqual(TOAST_MAX_CHARS);
  });

  it('the "n older" notices at any age', () => {
    for (const ms of [0, 30_000, 5 * MIN, 59 * MIN, 90 * MIN, 47 * 60 * MIN, 400 * 24 * 60 * MIN]) {
      expect(damagedFallbackNotice(ms).length, damagedFallbackNotice(ms)).toBeLessThanOrEqual(TOAST_MAX_CHARS);
      expect(previousCopyNotice(ms).length, previousCopyNotice(ms)).toBeLessThanOrEqual(TOAST_MAX_CHARS);
    }
  });

  it('says how much older, and where to export', () => {
    expect(damagedFallbackNotice(5 * MIN)).toBe('Damaged save: loaded copy 5 min older');
    expect(previousCopyNotice(3 * 60 * MIN)).toBe('Loaded previous copy (3 h older)');
    expect(ageText(10_000)).toBe('1 min');
    expect(ageText(3 * 24 * 60 * MIN)).toBe('3 days');
    expect(NOTICE.storageFull).toContain('Menu → Saves');
  });
});

describe('unlock toasts (INT-9)', () => {
  it('names the rung unlocks with the event label, within the toast cap', () => {
    expect(unlockNotice('U1', "Dot's survey ping")).toBe("Unlocked: Dot's survey ping");
    expect(unlockNotice('U3', 'Assembler, Router, Export Terminal')).toBe('New: Assembler, Router, Export Terminal');
    expect(unlockNotice('U2', 'Auto-Drill, Bucket Lift, Lift Rail, Headframe, Belt, Bin, Smelter, Expansion I')).toBe('Unlocked: Auto-Drill +7 more');
    for (const r of RUNGS) expect(unlockNotice(r.id, r.unlocks).length, r.id).toBeLessThanOrEqual(TOAST_MAX_CHARS);
  });

  it('a possession recipe (any id but a rung) is a new recipe', () => {
    expect(unlockNotice('A5', 'Circuit')).toBe('New recipe: Circuit');
    expect(unlockNotice('U3x', 'Motor')).toBe('New recipe: Motor');
  });
});
