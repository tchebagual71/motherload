// Shared plain-data types and codes. PURE MODULE.
import type { ConsumableId, Line, Purity, RimBuildingId } from './canon';

// ---------- Terrain codes (cell.terrain, u8) ----------
export const T = {
  AIR: 0,
  DIRT: 1,
  TURF: 2,
  PAVED: 3, // undiggable Rim cells under the four pads (row 0)
  HARDROCK: 4,
  MAGMA: 5,
  METHANE: 6, // renders exactly like DIRT unless revealed
  LODE_ROCK: 7, // 3×2 lode block; lode identity via TerrainGrid.lodeAt()
  SEAL: 8,
  HEARTSTONE: 9,
  /** Minerals: MINERAL_BASE + tier (tier 1..10) → 11..20 */
  MINERAL_BASE: 10,
  /** Relics: RELIC_BASE + relic id (0..3) → 24..27 */
  RELIC_BASE: 24,
} as const;
export type TerrainCode = number;

export function mineralCode(tier: number): TerrainCode {
  return T.MINERAL_BASE + tier;
}
export function relicCode(id: number): TerrainCode {
  return T.RELIC_BASE + id;
}
/** Mineral tier 1..10 for a terrain code, or 0. */
export function mineralTierOf(code: TerrainCode): number {
  return code > T.MINERAL_BASE && code <= T.MINERAL_BASE + 10 ? code - T.MINERAL_BASE : 0;
}
/** Relic id 0..3 for a terrain code, or -1. */
export function relicIdOf(code: TerrainCode): number {
  return code >= T.RELIC_BASE && code < T.RELIC_BASE + 4 ? code - T.RELIC_BASE : -1;
}
/** Solid = blocks the pod. */
export function isSolid(code: TerrainCode): boolean {
  return code !== T.AIR;
}

// ---------- Cell flags (cell.flags, u8) ----------
export const F = {
  SEEN: 1 << 0, // inside the pod's light bubble at some point
  CHARTED: 1 << 1, // within 8 tiles of any cell the pod occupied (map)
  ANCHORED: 1 << 2, // beneath an underground belt/router/occupant: undrillable
  DUG: 1 << 3, // excavated by the pod (vs. generated cavern air)
  REVEALED: 1 << 4, // methane revealed (Deep Eye etc.)
  SURVEY: 1 << 5, // part of Dot's survey shaft
} as const;

// ---------- Lodes (§2.9) ----------
export type LodeMetal = 'hematite' | 'copper' | 'cobalt' | 'gold' | 'iridium' | 'thorium' | 'kerogen';
export interface Lode {
  id: number;
  metal: LodeMetal;
  purity: Purity;
  /** Left column of the 3×2 block. */
  x0: number;
  /** Top row of the 3×2 block. */
  top: number;
  scripted: boolean;
  /** 'mvp' lodes are visible in MVP scope; 'v1' lodes render as Unknown seams before v1. */
  scope: 'mvp' | 'v1';
  discovered: boolean;
}

// ---------- Cargo (§3.7) ----------
export type CargoItem =
  | { kind: 'mineral'; tier: number }
  | { kind: 'relic'; id: number }
  /** A Kit; metered Kits (Belt 8, Lamp 4, Chute 16 units; factory KIT_METER) carry their remaining `units` (default full). */
  | { kind: 'kit'; id: string; units?: number };

// ---------- Re-exports for convenience ----------
export type { ConsumableId, Line, Purity, RimBuildingId };

export type Look = 'toon' | 'pixel';
export type Scope = 'm0' | 'mvp' | 'v1';
