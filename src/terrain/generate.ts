// World generator public API (canon §3.2; 01 §4.2). PURE MODULE.
// Generates the full v1 world in every scope: scope hides content, it never changes generation.
import { MINE_H, MINE_W, SEAL_ROW } from '../shared/canon';
import { Rng, STREAM, hash32 } from '../shared/rng';
import { TerrainGrid } from './grid';
import { GEN_BANDS, fillCellBand } from './cells';
import { stampSealAndHeart } from './heart';
import { placeLodes } from './lodes';
import {
  GEN_PASS,
  forcedDiggablePass,
  recorderPass,
  seededGoldPass,
  surveyShaftPass,
  tutorialPatchPass,
  writeLodes,
  writeRimRow,
} from './passes';

export { GEN_PASS, GEN_PASS_1_TO_5 } from './passes';

export interface GenMeta {
  /** Column of Dot's survey shaft (canon §3.2 pass 5). */
  surveyColumn: number;
  /** Id of the scripted Copper lode. */
  scriptedLodeId: number;
}

/** Generator trace for tests and tools. */
export interface GenTrace {
  /** Per-cell GEN_PASS bits: the post-passes that govern (may have set) each cell. */
  passMask: Uint8Array;
  /** Cell index of the pass-2 seeded Gold. */
  seededGold: number;
}

/** Canon §3.2 pass numbers of the seeded post-passes; each draws from its own stream so passes stay independent. */
const POST = { PATCH: 1, GOLD: 2, LODES: 3, SHAFT: 5, RECORDERS: 6 } as const;

function postRng(seed: number, pass: number): Rng {
  return new Rng(hash32(seed, pass), STREAM.GEN_POST + pass);
}

/** Generate the full v1 world (48 × 608, all lodes, Seal, Hollow Heart). Deterministic in `seed`. */
export function generateWorld(seed: number): { grid: TerrainGrid; meta: GenMeta } {
  const { grid, meta } = generateWorldTraced(seed);
  return { grid, meta };
}

/** `generateWorld` plus the post-pass trace. */
export function generateWorldTraced(seed: number): { grid: TerrainGrid; meta: GenMeta; trace: GenTrace } {
  const grid = generateCellPass(seed);
  const s = grid.seed;
  const t = grid.terrain;
  const mask = new Uint8Array(MINE_W * MINE_H);

  tutorialPatchPass(t, postRng(s, POST.PATCH), mask);
  const seededGold = seededGoldPass(t, postRng(s, POST.GOLD), mask);
  const lodes = placeLodes(postRng(s, POST.LODES));
  writeLodes(grid, lodes, mask);
  forcedDiggablePass(t, lodes, mask);
  const scripted = lodes.find((l) => l.scripted);
  if (!scripted) throw new Error('generateWorld: lode table has no scripted lode');
  const surveyColumn = surveyShaftPass(grid, scripted, postRng(s, POST.SHAFT), mask);
  recorderPass(t, postRng(s, POST.RECORDERS), mask);
  stampSealAndHeart(t);
  mask.fill(GEN_PASS.SEAL_HEART, SEAL_ROW * MINE_W);

  return { grid, meta: { surveyColumn, scriptedLodeId: scripted.id }, trace: { passMask: mask, seededGold } };
}

/** Row 0 plus the cell pass for rows 1–583, before any post-pass (the 01 §4.3 expectation). */
export function generateCellPass(seed: number): TerrainGrid {
  const grid = new TerrainGrid(seed);
  writeRimRow(grid.terrain);
  for (let b = 0; b < GEN_BANDS; b++) fillCellBand(grid.terrain, grid.seed, b);
  return grid;
}
