// Scope over the full generated world (canon §3.2, §5.5; 04 §4.1). Scope hides content; it never
// changes generation. The only writer here is the M0 debug strip, an M0-only debug overlay. PURE MODULE.
import { BANDS, LODE_H, LODE_W, M0_FLOOR_ROW, MINE_H, MINE_W, MVP_SEAL_ROW, SEAL_ROW } from '../shared/canon';
import { hash32, hashString } from '../shared/rng';
import { T, type Lode, type Scope, type TerrainCode } from '../shared/types';
import type { TerrainGrid } from './grid';
import type { Rect } from './passes';

/** First unplayable row: the M0 floor (r128), the MVP temporary Seal (r320) or the real Seal (r584). */
export function scopeFloorRow(scope: Scope): number {
  switch (scope) {
    case 'm0':
      return M0_FLOOR_ROW;
    case 'mvp':
      return MVP_SEAL_ROW;
    case 'v1':
      return SEAL_ROW;
  }
}

/**
 * Terrain as collision, drilling, rendering and the map see it (04 §4.1 `scopeView`; never writes):
 * rows at or below a temporary floor read as Seal. In v1 the real Seal and its Notch apply.
 */
export function scopeView(grid: TerrainGrid, scope: Scope, x: number, r: number): TerrainCode {
  const floor = scopeFloorRow(scope);
  if (r >= floor && floor < SEAL_ROW) return T.SEAL;
  return grid.get(x, r);
}

/**
 * Unknown-seam rule (canon §2.1, §3.2): a v1 lode (Kerogen, Thorium) is an undrillable, undiscoverable
 * seam before v1; MVP lodes show in every scope (M0 has no factory, but the lodes render).
 */
export function isLodeVisible(lode: Lode, scope: Scope): boolean {
  return lode.scope !== 'v1' || scope === 'v1';
}

const BAND_BY_ROW = buildBandLookup();

function buildBandLookup(): Uint8Array {
  const out = new Uint8Array(MINE_H);
  BANDS.forEach((b, i) => out.fill(i, b.top, b.bottom + 1));
  return out;
}

/** Strata band index 0–7 (B0 Rust Flats … B7 the Hollow Heart, canon §2.5) for mine row r; clamped. */
export function bandOf(row: number): number {
  const r = row < 0 ? 0 : row >= MINE_H ? MINE_H - 1 : Math.floor(row);
  return BAND_BY_ROW[r];
}

/** M0 debug Hardrock/Magma strip (canon §5.1): dirt here becomes ~70% Hardrock / 30% Magma. */
export const M0_DEBUG_STRIP: Rect = { top: 96, bottom: 104, x0: 16, x1: 36 };
const STRIP_HARDROCK_P = 0.7;
const STRIP_SALT = hashString('m0-debug-strip');

/**
 * Apply the scope's debug overlay to a generated or loaded grid. Only 'm0' writes anything: the
 * debug strip, keyed per cell on the seed, so re-applying it is idempotent and dug cells stay dug.
 * The 3×2 above each lode stays hazard-free (canon §3.2 pass 4).
 */
export function applyScopeOverlay(grid: TerrainGrid, scope: Scope): void {
  if (scope !== 'm0') return;
  const s = M0_DEBUG_STRIP;
  for (let r = s.top; r <= s.bottom; r++) {
    for (let x = s.x0; x <= s.x1; x++) {
      if (grid.terrain[r * MINE_W + x] !== T.DIRT || isAboveLode(grid.lodes, x, r)) continue;
      const u = hash32(grid.seed, STRIP_SALT, x, r) / 4294967296;
      grid.set(x, r, u < STRIP_HARDROCK_P ? T.HARDROCK : T.MAGMA);
    }
  }
}

function isAboveLode(lodes: readonly Lode[], x: number, r: number): boolean {
  for (const l of lodes) {
    if (x >= l.x0 && x < l.x0 + LODE_W && r >= l.top - LODE_H && r < l.top) return true;
  }
  return false;
}
