// Cell pass, rows 1–583 (canon §3.2; 01 §4.2 step 3): the original generateEarth rule verbatim.
// Each 64-row band draws from its own sfc32 stream, so bands generate independently. PURE MODULE.
import { BAND_ROWS, DIG_LAST_ROW, HARDROCK_ROW, MAGMA_ROW, METHANE_ROW, MINE_W } from '../shared/canon';
import { Rng, STREAM, hash32 } from '../shared/rng';
import { T, mineralCode, relicCode, type TerrainCode } from '../shared/types';

/** The original rule works in its own row space: o = r + 5 on a 600-row map (01 §4.2). */
export const ORIGINAL_ROW_OFFSET = 5;
export const ORIGINAL_DEPTH = 600;
/** A new mineral tier becomes possible every 65 original rows: k = ⌊o/65⌋ + 2. */
const TIER_STEP_ROWS = 65;
const MAX_TIER = 10;
/** Relics appear when o > 80, i.e. from r76 (canon §2.3). */
const RELIC_MIN_O = 80;
const RELIC_KINDS = 4;

/** Number of worldgen bands that hold diggable rows (rows 0–583 → bands 0–9). */
export const GEN_BANDS = Math.ceil((DIG_LAST_ROW + 1) / BAND_ROWS);

/** Stream for band b: `Rng(hash32(seed, b), GEN_BAND + b)` (04 §3.6). */
export function bandRng(seed: number, band: number): Rng {
  return new Rng(hash32(seed, band), STREAM.GEN_BAND + band);
}

/** Tier spread k = ⌊o/65⌋ + 2 for mine row r. */
export function tierSpread(row: number): number {
  return Math.floor((row + ORIGINAL_ROW_OFFSET) / TIER_STEP_ROWS) + 2;
}

/**
 * Hazard divisor v = ⌊(H − o)/H × 15⌋ for row r: a dirt cell becomes a hazard with p = 1/v,
 * p = 1 when v ≤ 1 (r ≥ 516, the Deep Floor). Returns 0 above r129 (no hazards).
 * Integer form avoids float rounding at the band edges.
 */
export function hazardDivisor(row: number): number {
  if (row < HARDROCK_ROW) return 0;
  const o = row + ORIGINAL_ROW_OFFSET;
  const v = Math.floor(((ORIGINAL_DEPTH - o) * 15) / ORIGINAL_DEPTH);
  return v < 1 ? 1 : v;
}

/** Fill rows of band `band` (clipped to 1–583) in `terrain` (MINE_W-strided). */
export function fillCellBand(terrain: Uint8Array, seed: number, band: number): void {
  const r0 = Math.max(1, band * BAND_ROWS);
  const r1 = Math.min(DIG_LAST_ROW, band * BAND_ROWS + BAND_ROWS - 1);
  if (r0 > r1) return;
  const rng = bandRng(seed, band);
  for (let r = r0; r <= r1; r++) {
    const k = tierSpread(r);
    const relics = r + ORIGINAL_ROW_OFFSET > RELIC_MIN_O;
    const v = hazardDivisor(r);
    const base = r * MINE_W;
    for (let x = 0; x < MINE_W; x++) terrain[base + x] = rollCell(rng, r, k, relics, v);
  }
}

/** One cell: (a) 1/5 mineral seed, else (b) dirt or hazard; then (c) 1/3 cavern override. */
function rollCell(rng: Rng, row: number, k: number, relics: boolean, v: number): TerrainCode {
  const code = rng.int(5) === 0 ? rollMineral(rng, k, relics) : rollDirt(rng, row, v);
  return rng.int(3) === 0 ? T.AIR : code;
}

/** 80%: tier min(1 + rand(k), 10); 16%: min(2 + rand(k), 10); 4%: ¼ relic when o > 80, else min(3 + rand(k), 10). */
function rollMineral(rng: Rng, k: number, relics: boolean): TerrainCode {
  const branch = rng.int(25);
  if (branch < 20) return mineralCode(Math.min(1 + rng.int(k), MAX_TIER));
  if (branch < 24) return mineralCode(Math.min(2 + rng.int(k), MAX_TIER));
  if (relics && rng.int(4) === 0) return relicCode(rng.int(RELIC_KINDS));
  return mineralCode(Math.min(3 + rng.int(k), MAX_TIER));
}

/** Dirt, or from r129 a hazard with p = 1/v: Hardrock; Hardrock/Magma 50/50 from r262; 50/25/25 with Methane from r396. */
function rollDirt(rng: Rng, row: number, v: number): TerrainCode {
  if (v === 0) return T.DIRT;
  if (v > 1 && rng.int(v) !== 0) return T.DIRT;
  if (row < MAGMA_ROW) return T.HARDROCK;
  if (row < METHANE_ROW) return rng.int(2) === 0 ? T.HARDROCK : T.MAGMA;
  const h = rng.int(4);
  return h < 2 ? T.HARDROCK : h === 2 ? T.MAGMA : T.METHANE;
}
