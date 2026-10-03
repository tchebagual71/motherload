import { describe, expect, it } from 'vitest';
import {
  checkExportCode,
  countdownDigit,
  depthFt,
  exportFileName,
  formatCash,
  formatCashHud,
  formatDepth,
  formatHp,
  formatInt,
  formatLitres,
  formatLitresAmount,
  formatMass,
  formatSteps,
} from '../../src/ui/format';
import { hudColumns, hudDigitPt, HUD_GAP, HUD_MARGIN } from '../../src/ui/layout';
import { buyFuelReceipt } from '../../src/ui/sheets/PumpSheet';
import { World } from '../../src/world/world';

describe('number formats', () => {
  it('groups thousands', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(1000)).toBe('1,000');
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatInt(-12345)).toBe('-12,345');
    expect(formatCash(3887750)).toBe('$3,887,750');
    expect(formatCash(-300)).toBe('-$300');
  });

  it('compacts HUD cash at $10k / $100k / $1M (03 §6.1, UX review M3), rounding down', () => {
    expect(formatCashHud(20)).toBe('$20');
    expect(formatCashHud(9_999)).toBe('$9,999');
    expect(formatCashHud(10_000)).toBe('$10.0k');
    expect(formatCashHud(12_345)).toBe('$12.3k');
    expect(formatCashHud(99_999)).toBe('$99.9k');
    expect(formatCashHud(100_000)).toBe('$100k');
    expect(formatCashHud(999_999)).toBe('$999k');
    expect(formatCashHud(1_000_000)).toBe('$1.00M');
    expect(formatCashHud(1_234_567)).toBe('$1.23M');
    expect(formatCashHud(12_345_678)).toBe('$12.3M');
    expect(formatCashHud(99_900_000)).toBe('$99.9M');
    expect(formatCashHud(123_456_789)).toBe('$123M');
    expect(formatCashHud(-5)).toBe('$0');
    expect(formatCashHud(19.99)).toBe('$19');
  });

  it('formats depth from the pod row (12.5 ft per row; 0 above the Rim)', () => {
    expect(depthFt(-1)).toBe(0);
    expect(depthFt(40)).toBe(500);
    expect(formatDepth(465)).toBe('5,813ft');
    expect(formatDepth(584)).toBe('7,300ft');
  });

  it('formats litres: one decimal below 100 L, integer above, rounded down', () => {
    expect(formatLitres(6)).toBe('6.0 L');
    expect(formatLitres(0.45)).toBe('0.4 L');
    expect(formatLitres(99.99)).toBe('99.9 L');
    expect(formatLitres(150)).toBe('150 L');
    expect(formatLitres(-1)).toBe('0.0 L');
  });

  it('formats quote and receipt litres: rounded down like the gauge, whole amounts without ".0"', () => {
    expect(formatLitresAmount(4.684)).toBe('4.6 L');
    expect(formatLitresAmount(5)).toBe('5 L');
    expect(formatLitresAmount(4.99999999)).toBe('5 L');
    expect(formatLitresAmount(0.04)).toBe('0 L');
    expect(formatLitresAmount(1_250)).toBe('1,250 L');
  });

  it('the Pump receipt names the quoted litres (PLAYER-11: "Fill 4.6 L · $5" then "Filled up: 4.6 L for $5")', () => {
    const w = new World({ seed: 7, scope: 'mvp' });
    w.pod.fuel = 10 - 4.684;
    w.wallet.cash = 20;
    const q = w.fuelQuote('fill');
    expect(`Fill ${formatLitresAmount(q.amount)} · $${q.cost}`).toBe('Fill 4.6 L · $5');
    const r = buyFuelReceipt(w, 'fill');
    expect(r).toMatchObject({ ok: true, message: 'Filled up: 4.6 L for $5' });
    w.pod.fuel = 2;
    expect(buyFuelReceipt(w, 5)).toMatchObject({ ok: true, message: 'Bought 5 L for $5' });
    expect(buyFuelReceipt(w, 'fill')).toMatchObject({ ok: true, message: 'Filled up: 3 L for $3' });
    expect(buyFuelReceipt(w, 'fill').ok).toBe(false); // already full: the world's own reason
  });

  it('shows the ceiling of the 0.1-HP hull', () => {
    expect(formatHp(10)).toBe('10');
    expect(formatHp(9.1)).toBe('10');
    expect(formatHp(0.1)).toBe('1');
    expect(formatHp(0)).toBe('0');
    expect(formatHp(7 + 1e-9)).toBe('7');
  });

  it('formats mass, countdown digits and step durations', () => {
    expect(formatMass(24)).toBe('24 mu');
    expect(countdownDigit(1500)).toBe(3);
    expect(countdownDigit(1001)).toBe(3);
    expect(countdownDigit(1000)).toBe(2);
    expect(countdownDigit(400)).toBe(1);
    expect(countdownDigit(0)).toBe(1);
    expect(formatSteps(36_000)).toBe('10:00');
    expect(formatSteps(61)).toBe('0:02');
  });
});

describe('export codes (canon §3.15)', () => {
  it('pre-checks pasted codes', () => {
    expect(checkExportCode('')).toEqual({ ok: false, reason: 'Paste a save code first' });
    expect(checkExportCode('XX1:abcdefghij').ok).toBe(false);
    expect(checkExportCode('HF1:abc').ok).toBe(false);
    expect(checkExportCode('HF1:abc$%^&*()def').ok).toBe(false);
    expect(checkExportCode('  HF1:abcd\nefgh_ij-k  ')).toEqual({ ok: true, code: 'HF1:abcdefgh_ij-k' });
  });
  it('names export files', () => {
    expect(exportFileName(1, 2026, 10, 1)).toBe('holefactory-slot1-20261001.hfsave');
  });
});

describe('HUD row widths (03 §6.1)', () => {
  const total = (w: number) => {
    const c = hudColumns(w);
    return c.reduce((s, x) => s + x, 0) + 2 * HUD_MARGIN + 4 * HUD_GAP;
  };

  it('matches the spec table at the anchor widths', () => {
    expect(hudColumns(360)).toEqual([78, 64, 62, 80, 44]);
    expect(hudColumns(375)).toEqual([84, 68, 64, 83, 44]);
    expect(hudColumns(393)).toEqual([88, 72, 68, 89, 44]);
    expect(hudColumns(430)).toEqual([96, 80, 74, 104, 44]);
  });

  it('fills the row exactly at in-between and small widths', () => {
    for (const w of [320, 344, 360, 371, 384, 390, 402, 412, 430]) expect(total(w)).toBe(w);
  });

  it('caps pill growth on wide rows', () => {
    const wide = hudColumns(1024);
    expect(wide).toEqual(hudColumns(516));
    expect(wide[4]).toBe(44);
  });

  it('sizes HUD digits per 03 §1.5', () => {
    expect(hudDigitPt(375)).toBe(15);
    expect(hudDigitPt(393)).toBe(15);
    expect(hudDigitPt(393, 1.15)).toBeCloseTo(17, 6);
    expect(hudDigitPt(375, 1.15)).toBe(15);
  });
});
