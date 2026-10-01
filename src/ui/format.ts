// Display formats (03 §6.1 HUD compact formats; UX review M3). Pure.
import { EXPORT_PREFIX, STEP_HZ, TILE_FT } from '../shared/canon';

/** "12,345" (en-US grouping, integer part only). */
export function formatInt(n: number): string {
  const v = Math.trunc(n);
  const s = String(Math.abs(v));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return v < 0 ? `-${out}` : out;
}

/** Full cash for sheets and prices: "$12,345". */
export function formatCash(n: number): string {
  return n < 0 ? `-$${formatInt(-n)}` : `$${formatInt(n)}`;
}

/**
 * HUD cash (03 §6.1): "$9,999" → "$12.3k" → "$999k" → "$1.23M" → "$12.3M" → "$123M"; steps at $10k, $100k,
 * $1M. Always rounded down so the HUD never shows more than the wallet holds.
 */
export function formatCashHud(n: number): string {
  const v = Math.max(0, Math.floor(n));
  if (v < 10_000) return `$${formatInt(v)}`;
  if (v < 100_000) return `$${(Math.floor(v / 100) / 10).toFixed(1)}k`;
  if (v < 1_000_000) return `$${Math.floor(v / 1_000)}k`;
  if (v < 10_000_000) return `$${(Math.floor(v / 10_000) / 100).toFixed(2)}M`;
  if (v < 100_000_000) return `$${(Math.floor(v / 100_000) / 10).toFixed(1)}M`;
  return `$${formatInt(Math.floor(v / 1_000_000))}M`;
}

/** Depth in feet for a pod row (canon conventions: row r starts at 12.5 r ft; above the Rim = 0). */
export function depthFt(row: number): number {
  return Math.round(TILE_FT * Math.max(0, row));
}

/** "5,813ft" (the HUD draws the 9-pt ▼ separately). */
export function formatDepth(row: number): string {
  return `${formatInt(depthFt(row))}ft`;
}

/** Fuel litres (03 §6.1): one decimal below 100 L, integer above; rounded down. */
export function formatLitres(l: number): string {
  const v = Math.max(0, l);
  if (v < 100) return `${(Math.floor(v * 10 + 1e-6) / 10).toFixed(1)} L`;
  return `${formatInt(Math.floor(v))} L`;
}

/** Hull points: the ceiling of the 0.1-HP value (01 §3.6). */
export function formatHp(hp: number): string {
  return String(Math.max(0, Math.ceil(hp - 1e-6)));
}

/** Mass units (Hematite = 1 mu). */
export function formatMass(mu: number): string {
  return `${formatInt(Math.round(mu))} mu`;
}

/** Resume countdown digit (03 §3.8: "3 · 2 · 1", 0.5 s each). */
export function countdownDigit(ms: number): number {
  return Math.max(1, Math.min(3, Math.ceil(ms / 500)));
}

/** Sim steps as "m:ss" (Co-op Credit cooldown etc.). */
export function formatSteps(steps: number): string {
  const s = Math.max(0, Math.ceil(steps / STEP_HZ));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

export type CodeCheck = { ok: true; code: string } | { ok: false; reason: string };

/** Light pre-check of a pasted export code before app.importSave() does the real validation and dry run. */
export function checkExportCode(raw: string): CodeCheck {
  const code = raw.replace(/\s+/g, '');
  if (code.length === 0) return { ok: false, reason: 'Paste a save code first' };
  if (!code.startsWith(EXPORT_PREFIX)) return { ok: false, reason: `Save codes start with ${EXPORT_PREFIX}` };
  const body = code.slice(EXPORT_PREFIX.length);
  if (body.length < 8) return { ok: false, reason: 'That code is too short' };
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(body)) return { ok: false, reason: 'That code has stray characters' };
  return { ok: true, code };
}

/** "holefactory-slot1-20261001.hfsave" (canon §3.15) from a Y/M/D triple. */
export function exportFileName(slot: number, year: number, month: number, day: number): string {
  const two = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `holefactory-slot${slot}-${year}${two(month)}${two(day)}.hfsave`;
}
