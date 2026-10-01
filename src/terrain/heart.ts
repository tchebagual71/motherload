// The Seal (row 584, Notch at x 46–47) and the Hollow Heart stamp, rows 585–607 (canon §3.2 pass 7; 01 §7.6).
// PURE MODULE.
import { MINE_W, SEAL_ROW } from '../shared/canon';
import { T, type TerrainCode } from '../shared/types';

/**
 * 01 §7.6 stamp, one string per row from SEAL_ROW (584) to the last mine row (607); the Heart starts at 585:
 * `=` Seal · `#` Heartstone · `*` hoard · `H` crust · `L` Locker · `C` Claimant · `<` `>` lenses ·
 * `F` Furnace · `v` jaw · `r` rubble · `.` open.
 */
const SEAL = '==============================================..';
const NOTCH_CHUTE = '##############################################..';
const OPEN = '#...............................................';
const ARENA = '#................CCCCCCCCCCCCCC................#';
const HEARTSTONE = '################################################';

export const HEART_STAMP: readonly string[] = [
  SEAL, // 584
  NOTCH_CHUTE, // 585
  NOTCH_CHUTE,
  NOTCH_CHUTE,
  NOTCH_CHUTE, // 588
  '#....H..........................................', // 589  Hoard Alcove x 1–4, crust x 5
  '#**..H..........................................', // 590
  '#****H..........................................', // 591
  '######..........................................', // 592  alcove floor
  OPEN, // 593
  OPEN, // 594
  '#.L..........................................L..', // 595  Lockers on both ledges
  '########.........CCCCCCCCCCCCCC.........########', // 596  West ledge x 0–7, East ledge x 40–47
  ARENA, // 597
  ARENA, // 598
  '#................<CCCCCCCCCCCC>................#', // 599  Lens L x 17, Lens R x 30
  '#..........######CCCCCCCCCCCCCC######..........#', // 600  mid ledges x 11–16, 31–36
  ARENA, // 601
  ARENA, // 602
  '#........r.......CCCCCFFFFCCCCC.......r........#', // 603  Furnace x 22–25
  '#.......Lr...r...vvvvvvvvvvvvvv...r...rL.......#', // 604  floor walk row; Lockers x 8, 39
  HEARTSTONE, // 605
  HEARTSTONE,
  HEARTSTONE, // 607
];

/**
 * Terrain for one stamp glyph. The stamp is built from SEAL, HEARTSTONE and AIR only: the crust is
 * Heartstone until the boss module crumbles it; Lockers, hoard, rubble and the Claimant are entities
 * placed by their owners at `heartFeatureCells()` positions.
 */
function glyphTerrain(ch: string): TerrainCode {
  if (ch === '=') return T.SEAL;
  if (ch === '#' || ch === 'H') return T.HEARTSTONE;
  return T.AIR;
}

/** Write the Seal row and the Hollow Heart into `terrain` (MINE_W-strided). */
export function stampSealAndHeart(terrain: Uint8Array): void {
  for (let j = 0; j < HEART_STAMP.length; j++) {
    const line = HEART_STAMP[j];
    const base = (SEAL_ROW + j) * MINE_W;
    for (let x = 0; x < MINE_W; x++) terrain[base + x] = glyphTerrain(line[x]);
  }
}

export type HeartFeature = 'hoard' | 'crust' | 'locker' | 'claimant' | 'lensL' | 'lensR' | 'furnace' | 'jaw' | 'rubble';

const FEATURE_GLYPH: Record<HeartFeature, string> = {
  hoard: '*',
  crust: 'H',
  locker: 'L',
  claimant: 'C',
  lensL: '<',
  lensR: '>',
  furnace: 'F',
  jaw: 'v',
  rubble: 'r',
};

/** Cells {x, r} of one stamp feature, top-to-bottom then left-to-right. */
export function heartFeatureCells(feature: HeartFeature): { x: number; r: number }[] {
  const glyph = FEATURE_GLYPH[feature];
  const out: { x: number; r: number }[] = [];
  for (let j = 0; j < HEART_STAMP.length; j++) {
    const line = HEART_STAMP[j];
    for (let x = 0; x < MINE_W; x++) if (line[x] === glyph) out.push({ x, r: SEAL_ROW + j });
  }
  return out;
}
