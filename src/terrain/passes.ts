// Row 0 and the worldgen post-passes 1–6 (canon §3.2; 01 §4.2 step 4). PURE MODULE.
import {
  DIG_LAST_ROW,
  LODE_H,
  LODE_W,
  METHANE_ROW,
  MIN_RECORDERS,
  MINE_W,
  MVP_SEAL_ROW,
  RELIC_MIN_ROW,
} from '../shared/canon';
import type { Rng } from '../shared/rng';
import { F, T, mineralCode, mineralTierOf, relicCode, relicIdOf, type Lode, type TerrainCode } from '../shared/types';
import type { TerrainGrid } from './grid';
import { isUnderRimPad, isValidHeadframeColumn } from './rules';

/** Per-cell trace bits: which post-pass governs (may have set) a cell. */
export const GEN_PASS = {
  PATCH: 1 << 0,
  GOLD: 1 << 1,
  LODE: 1 << 2,
  FORCED: 1 << 3,
  SHAFT: 1 << 4,
  RECORDER: 1 << 5,
  /** Pass 6 turned a non-relic cell into a Recorder (adds a relic; converting a relic does not). */
  RECORDER_FROM_DIRT: 1 << 6,
  SEAL_HEART: 1 << 7,
} as const;

/** Cells governed by passes 1–5, which distribution tests exclude (canon §3.2, 04 §11.1). */
export const GEN_PASS_1_TO_5 = GEN_PASS.PATCH | GEN_PASS.GOLD | GEN_PASS.LODE | GEN_PASS.FORCED | GEN_PASS.SHAFT;

/** Inclusive cell rectangle. */
export interface Rect {
  top: number;
  bottom: number;
  x0: number;
  x1: number;
}

export const TUTORIAL_PATCH: Rect = { top: 1, bottom: 8, x0: 5, x1: 11 };
export const TUTORIAL_PATCH_MIN_BULK = 5;
export const SEEDED_GOLD_AREA: Rect = { top: 12, bottom: 20, x0: 2, x1: 12 };
const DEEP_RECORDERS_MIN = 2;
/** Recorder minimums (01 §4.2 pass 6): all six MVP logs above the MVP Seal, and two in rows 396–583. */
export const RECORDER_ZONES: readonly { rect: Rect; min: number }[] = [
  { rect: { top: RELIC_MIN_ROW, bottom: MVP_SEAL_ROW - 1, x0: 0, x1: MINE_W - 1 }, min: MIN_RECORDERS },
  { rect: { top: METHANE_ROW, bottom: DIG_LAST_ROW, x0: 0, x1: MINE_W - 1 }, min: DEEP_RECORDERS_MIN },
];

const LOST_POD_RECORDER = relicCode(2);
const HEMATITE = mineralCode(1);
const COPPER = mineralCode(2);
const GOLD = mineralCode(4);
const MAX_BULK_TIER = 6;

type CellTest = (code: TerrainCode) => boolean;
const isDirt: CellTest = (c) => c === T.DIRT;
const isDirtOrMineral: CellTest = (c) => c === T.DIRT || mineralTierOf(c) > 0;
const isAnyCell: CellTest = () => true;
const isRecorder: CellTest = (c) => c === LOST_POD_RECORDER;
const isOtherRelic: CellTest = (c) => relicIdOf(c) >= 0 && c !== LOST_POD_RECORDER;
const isConvertible: CellTest = (c) => c !== T.LODE_ROCK && c !== LOST_POD_RECORDER;

export function isHazard(code: TerrainCode): boolean {
  return code === T.HARDROCK || code === T.MAGMA || code === T.METHANE;
}

function isBulkSpecimen(code: TerrainCode): boolean {
  const tier = mineralTierOf(code);
  return tier > 0 && tier <= MAX_BULK_TIER;
}

/** Row 0: turf, paved under the four Rim pads (canon §2.4, §3.1). */
export function writeRimRow(terrain: Uint8Array): void {
  for (let x = 0; x < MINE_W; x++) terrain[x] = isUnderRimPad(x) ? T.PAVED : T.TURF;
}

function markRect(mask: Uint8Array, rect: Rect, bit: number): void {
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let x = rect.x0; x <= rect.x1; x++) mask[r * MINE_W + x] |= bit;
  }
}

/** Uniformly pick a cell in `rect` passing `test`; −1 when none does. */
function pickInRect(terrain: Uint8Array, rect: Rect, test: CellTest, rng: Rng): number {
  let n = 0;
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let x = rect.x0; x <= rect.x1; x++) if (test(terrain[r * MINE_W + x])) n++;
  }
  if (n === 0) return -1;
  let k = rng.int(n);
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const i = r * MINE_W + x;
      if (test(terrain[i]) && k-- === 0) return i;
    }
  }
  return -1;
}

function countInRect(terrain: Uint8Array, rect: Rect, test: CellTest): number {
  let n = 0;
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let x = rect.x0; x <= rect.x1; x++) if (test(terrain[r * MINE_W + x])) n++;
  }
  return n;
}

/** Pass 1, Tutorial Patch: no air, then dirt → Hematite or Copper until ≥ 5 bulk specimens. */
export function tutorialPatchPass(terrain: Uint8Array, rng: Rng, mask: Uint8Array): void {
  const rect = TUTORIAL_PATCH;
  markRect(mask, rect, GEN_PASS.PATCH);
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const i = r * MINE_W + x;
      if (terrain[i] === T.AIR) terrain[i] = T.DIRT;
    }
  }
  let bulk = countInRect(terrain, rect, isBulkSpecimen);
  while (bulk < TUTORIAL_PATCH_MIN_BULK) {
    const i = pickInRect(terrain, rect, isDirt, rng);
    if (i < 0) break; // unreachable: < 5 bulk leaves ≥ 51 dirt cells in the 56-cell patch
    terrain[i] = rng.int(2) === 0 ? HEMATITE : COPPER;
    bulk++;
  }
}

/** Pass 2, Seeded Gold: one Gold replacing a dirt or mineral cell. Returns its cell index. */
export function seededGoldPass(terrain: Uint8Array, rng: Rng, mask: Uint8Array): number {
  const rect = SEEDED_GOLD_AREA;
  // The whole area is traced: the pick depends on cell contents, so only the area is an unbiased exclusion.
  markRect(mask, rect, GEN_PASS.GOLD);
  let i = pickInRect(terrain, rect, isDirtOrMineral, rng);
  if (i < 0) i = pickInRect(terrain, rect, isAnyCell, rng);
  terrain[i] = GOLD;
  return i;
}

/** Pass 3, lodes: write lode rock and the per-cell lode index. */
export function writeLodes(grid: TerrainGrid, lodes: Lode[], mask: Uint8Array): void {
  grid.lodes = lodes;
  for (const lode of lodes) {
    const rect = lodeRect(lode);
    markRect(mask, rect, GEN_PASS.LODE);
    for (let r = rect.top; r <= rect.bottom; r++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        const i = r * MINE_W + x;
        grid.terrain[i] = T.LODE_ROCK;
        grid.lodeIndex[i] = lode.id + 1;
      }
    }
  }
}

export function lodeRect(lode: Lode): Rect {
  return { top: lode.top, bottom: lode.top + LODE_H - 1, x0: lode.x0, x1: lode.x0 + LODE_W - 1 };
}

/** The 3×2 directly above a lode (where its Auto-Drill sits; 02 §2.4). */
export function aboveLodeRect(lode: Lode): Rect {
  return { top: lode.top - LODE_H, bottom: lode.top - 1, x0: lode.x0, x1: lode.x0 + LODE_W - 1 };
}

/** Pass 4, forced diggable: hazards in the 3×2 above each lode become dirt. */
export function forcedDiggablePass(terrain: Uint8Array, lodes: readonly Lode[], mask: Uint8Array): void {
  for (const lode of lodes) {
    const rect = aboveLodeRect(lode);
    markRect(mask, rect, GEN_PASS.FORCED);
    for (let r = rect.top; r <= rect.bottom; r++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        const i = r * MINE_W + x;
        if (isHazard(terrain[i])) terrain[i] = T.DIRT;
      }
    }
  }
}

/** Candidate survey columns beside the scripted lode (x0 − 1 or x0 + 3) that are valid Headframe columns. */
export function surveyColumnCandidates(x0: number): number[] {
  return [x0 - 1, x0 + 3].filter(isValidHeadframeColumn);
}

/** Pass 5, Dot's survey shaft: air in rows 0…top−1 of a valid column beside the scripted lode, seeded side. */
export function surveyShaftPass(grid: TerrainGrid, scripted: Lode, rng: Rng, mask: Uint8Array): number {
  const options = surveyColumnCandidates(scripted.x0);
  if (options.length === 0) throw new Error(`survey shaft: no valid column beside x0 = ${scripted.x0}`);
  const c = options.length === 1 ? options[0] : options[rng.int(options.length)];
  for (let r = 0; r < scripted.top; r++) {
    const i = r * MINE_W + c;
    grid.terrain[i] = T.AIR;
    grid.flags[i] |= F.SURVEY;
    mask[i] |= GEN_PASS.SHAFT;
  }
  return c;
}

/** Pass 6: top each zone up to its Recorder minimum, converting other relics first, then dirt. */
export function recorderPass(terrain: Uint8Array, rng: Rng, mask: Uint8Array): void {
  for (const zone of RECORDER_ZONES) {
    let have = countInRect(terrain, zone.rect, isRecorder);
    while (have < zone.min) {
      let i = pickInRect(terrain, zone.rect, isOtherRelic, rng);
      let bits: number = GEN_PASS.RECORDER;
      if (i < 0) {
        i = pickInRect(terrain, zone.rect, isDirt, rng);
        if (i < 0) i = pickInRect(terrain, zone.rect, isConvertible, rng);
        bits |= GEN_PASS.RECORDER_FROM_DIRT;
      }
      terrain[i] = LOST_POD_RECORDER;
      mask[i] |= bits;
      have++;
    }
  }
}
