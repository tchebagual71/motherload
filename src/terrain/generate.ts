// World generator public API. Implementation: worldgen agent. PURE MODULE.
import type { TerrainGrid } from './grid';

export interface GenMeta {
  /** Column of Dot's survey shaft (canon §3.2 pass 5). */
  surveyColumn: number;
  /** Id of the scripted Copper lode. */
  scriptedLodeId: number;
}

/** Generate the full v1 world (48 × 608, all lodes, Seal, Hollow Heart). Deterministic in `seed`. */
export function generateWorld(_seed: number): { grid: TerrainGrid; meta: GenMeta } {
  throw new Error('generateWorld: not implemented');
}
