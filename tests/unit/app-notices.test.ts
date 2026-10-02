import { describe, expect, it } from 'vitest';
import { ageText, damagedFallbackNotice, NOTICE, previousCopyNotice } from '../../src/app/notices';
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
