// Lode table and placement (canon §2.9, §3.2 pass 3; 01 §4.2, §4.7). PURE MODULE.
import { LODE_H, LODE_W, SCRIPTED_LODE_TOP, type Purity } from '../shared/canon';
import type { Rng } from '../shared/rng';
import type { Lode, LodeMetal } from '../shared/types';

/** All lode cells lie in x 2–43 (canon §3.2). */
export const LODE_X_MIN = 2;
export const LODE_X_MAX = 43;
/** Spacing: no two lodes are both < 8 rows and < 6 columns apart (canon §3.2, rev 2 reading). */
export const LODE_MIN_ROW_GAP = 8;
export const LODE_MIN_COL_GAP = 6;
/** Scripted Copper x0 range: keeps the access column x0 + 1 off the Garage pad (01 §4.2 pass 3). */
export const SCRIPTED_X0_MIN = 14;
export const SCRIPTED_X0_MAX = 28;

export interface LodeSpec {
  metal: LodeMetal;
  /** Inclusive range for the lode's top row. */
  topMin: number;
  topMax: number;
  /** Inclusive range for the lode's left column. */
  x0Min: number;
  x0Max: number;
  /** Fixed purity (scripted Copper, the R12 Iridium and Thorium lodes), or null to roll. */
  purity: Purity | null;
  scripted: boolean;
}

type Entry = LodeMetal | { metal: LodeMetal; purity: Purity };

/** Lodes of one table row: tops uniform so both rows lie in [rowA, rowB] (and ≤ maxTop when given). */
function tableRow(rowA: number, rowB: number, entries: readonly Entry[], maxTop = rowB - (LODE_H - 1)): LodeSpec[] {
  return entries.map((e) => ({
    metal: typeof e === 'string' ? e : e.metal,
    purity: typeof e === 'string' ? null : e.purity,
    topMin: rowA,
    topMax: Math.min(maxTop, rowB - (LODE_H - 1)),
    x0Min: LODE_X_MIN,
    x0Max: LODE_X_MAX - (LODE_W - 1),
    scripted: false,
  }));
}

/** Canon §3.2 lode table (R12, R17): 20 metal + 3 Kerogen, in id order (scripted Copper = id 0). */
export const LODE_TABLE: readonly LodeSpec[] = [
  {
    metal: 'copper',
    purity: 'normal',
    topMin: SCRIPTED_LODE_TOP,
    topMax: SCRIPTED_LODE_TOP,
    x0Min: SCRIPTED_X0_MIN,
    x0Max: SCRIPTED_X0_MAX,
    scripted: true,
  },
  ...tableRow(50, 64, ['hematite', 'hematite']),
  ...tableRow(65, 129, ['copper', 'copper', 'cobalt', 'kerogen']),
  ...tableRow(130, 194, ['cobalt', 'gold', 'kerogen']),
  ...tableRow(195, 259, ['gold', { metal: 'iridium', purity: 'poor' }, 'kerogen']),
  ...tableRow(260, 324, ['gold', 'iridium'], 315),
  ...tableRow(325, 389, ['iridium', { metal: 'thorium', purity: 'poor' }]),
  ...tableRow(390, 454, ['iridium', 'thorium']),
  ...tableRow(455, 519, ['thorium', 'thorium']),
  ...tableRow(520, 583, ['thorium', 'thorium']),
];

/** Kerogen and every Thorium lode are v1 content: Unknown seams before v1 (canon §3.2). */
export function lodeScopeOf(metal: LodeMetal): Lode['scope'] {
  return metal === 'kerogen' || metal === 'thorium' ? 'v1' : 'mvp';
}

/** True when two lode anchors break the spacing rule (both < 8 rows and < 6 columns apart). */
export function lodesTooClose(aX0: number, aTop: number, bX0: number, bTop: number): boolean {
  return Math.abs(aTop - bTop) < LODE_MIN_ROW_GAP && Math.abs(aX0 - bX0) < LODE_MIN_COL_GAP;
}

/** Purity roll: Poor 40 / Normal 45 / Rich 15; Thorium Poor 60 / Normal 40 (canon §2.9). */
export function rollPurity(rng: Rng, metal: LodeMetal): Purity {
  if (metal === 'thorium') return rng.int(5) < 3 ? 'poor' : 'normal';
  const p = rng.int(20);
  return p < 8 ? 'poor' : p < 17 ? 'normal' : 'rich';
}

const RANDOM_TRIES = 64;

/** Place every LODE_TABLE entry in order; deterministic in `rng`. Throws if a spec cannot fit (never for the canon table). */
export function placeLodes(rng: Rng, table: readonly LodeSpec[] = LODE_TABLE): Lode[] {
  const lodes: Lode[] = [];
  for (const spec of table) {
    const at = pickAnchor(rng, spec, lodes);
    const purity = spec.purity ?? rollPurity(rng, spec.metal);
    lodes.push({
      id: lodes.length,
      metal: spec.metal,
      purity,
      x0: at.x0,
      top: at.top,
      scripted: spec.scripted,
      scope: lodeScopeOf(spec.metal),
      discovered: false,
    });
  }
  return lodes;
}

interface Anchor {
  x0: number;
  top: number;
}

/** Uniform rejection sampling; if that keeps failing, a deterministic scan from a random start. */
function pickAnchor(rng: Rng, spec: LodeSpec, placed: readonly Lode[]): Anchor {
  const w = spec.x0Max - spec.x0Min + 1;
  const h = spec.topMax - spec.topMin + 1;
  const n = w * h;
  for (let t = 0; t < RANDOM_TRIES; t++) {
    const k = rng.int(n);
    const x0 = spec.x0Min + (k % w);
    const top = spec.topMin + Math.floor(k / w);
    if (fits(x0, top, placed)) return { x0, top };
  }
  const start = rng.int(n);
  for (let j = 0; j < n; j++) {
    const k = (start + j) % n;
    const x0 = spec.x0Min + (k % w);
    const top = spec.topMin + Math.floor(k / w);
    if (fits(x0, top, placed)) return { x0, top };
  }
  throw new Error(`placeLodes: no room for ${spec.metal} in rows ${spec.topMin}–${spec.topMax}`);
}

function fits(x0: number, top: number, placed: readonly Lode[]): boolean {
  for (const l of placed) if (lodesTooClose(x0, top, l.x0, l.top)) return false;
  return true;
}
