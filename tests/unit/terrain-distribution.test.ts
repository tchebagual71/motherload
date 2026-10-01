// Per-band distribution of the cell pass against 01 §4.3 (04 §11.1): 200 seeds, 3σ, excluding cells
// governed by post-passes 1–5 (and Recorders that pass 6 added on non-relic cells).
import { beforeAll, describe, expect, it } from 'vitest';
import { BANDS, MINE_W } from '../../src/shared/canon';
import { T, mineralTierOf, relicIdOf } from '../../src/shared/types';
import { GEN_PASS, GEN_PASS_1_TO_5, generateCellPass, generateWorldTraced } from '../../src/terrain/generate';

const SEED_COUNT = 200;
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => Math.imul(i + 1, 0x9e3779b1) >>> 0);

// ---------- Categories ----------
const AIR = 0;
const DIRT = 1;
const mineralCat = (tier: number) => 1 + tier; // tiers 1..10 → 2..11
const RELIC = 12;
const HARDROCK = 13;
const MAGMA = 14;
const METHANE = 15;
const NCAT = 16;
const CAT_NAMES = ['air', 'dirt', 'Hem', 'Cu', 'Co', 'Au', 'Ir', 'Th', 'Per', 'FOp', 'Dia', 'EQ', 'relic', 'Hardrock', 'Magma', 'Methane'];

function categoryOf(code: number): number {
  if (code === T.AIR) return AIR;
  if (code === T.DIRT) return DIRT;
  if (code === T.HARDROCK) return HARDROCK;
  if (code === T.MAGMA) return MAGMA;
  if (code === T.METHANE) return METHANE;
  if (relicIdOf(code) >= 0) return RELIC;
  const tier = mineralTierOf(code);
  return tier > 0 ? mineralCat(tier) : -1;
}

/** Per-cell category probabilities for row r, re-derived from the 01 §4.2 rule text (not from the generator). */
function cellProbs(row: number): Float64Array {
  const p = new Float64Array(NCAT);
  const o = row + 5;
  const k = Math.floor(o / 65) + 2;
  const solid = 2 / 3; // ⅓ cavern override
  p[AIR] = 1 / 3;
  const spread = (base: number, w: number) => {
    for (let j = 0; j < k; j++) p[mineralCat(Math.min(base + j, 10))] += (0.2 * w * solid) / k;
  };
  spread(1, 0.8);
  spread(2, 0.16);
  if (o > 80) {
    p[RELIC] += 0.2 * 0.04 * 0.25 * solid;
    spread(3, 0.04 * 0.75);
  } else {
    spread(3, 0.04);
  }
  const dirt = 0.8 * solid;
  let hz = 0;
  if (row >= 129) {
    const v = Math.floor(((600 - o) / 600) * 15 + 1e-9);
    hz = v <= 1 ? 1 : 1 / v;
  }
  p[DIRT] = dirt * (1 - hz);
  const h = dirt * hz;
  if (row >= 396) {
    p[HARDROCK] = h / 2;
    p[MAGMA] = h / 4;
    p[METHANE] = h / 4;
  } else if (row >= 262) {
    p[HARDROCK] = h / 2;
    p[MAGMA] = h / 2;
  } else {
    p[HARDROCK] = h;
  }
  return p;
}

/** Stats bands B0–B6 over the cell-pass rows (B0 starts at row 1: row 0 is the Rim row). */
const STAT_BANDS = BANDS.slice(0, 7).map((b) => ({ id: b.id, top: Math.max(1, b.top), bottom: b.bottom }));
const ROW_PROBS = Array.from({ length: 584 }, (_, r) => cellProbs(r));

// ---------- 01 §4.3 table: Hem Cu Co Au Ir Th Per FOp Dia EQ | Relics | Hardrock Magma Methane ----------
const TABLE: Record<string, number[]> = {
  B0: [49, 58, 12, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  B1: [109, 131, 34, 7, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  B2: [109, 131, 135, 31, 5, 0.2, 0, 0, 0, 0, 3.3, 0, 0, 0],
  B3: [151, 181, 186, 186, 108, 26, 4, 0.2, 0, 0, 8.4, 362, 0, 0],
  B4: [104, 125, 129, 129, 129, 129, 79, 22, 3.5, 0.3, 8.4, 283, 283, 0],
  B5: [52, 62, 64, 64, 64, 64, 64, 64, 29, 6, 5.2, 324, 162, 162],
  B6: [55, 66, 68, 68, 68, 68, 68, 68, 68, 61, 6.8, 1101, 550, 550],
};
const TABLE_CATS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, RELIC, HARDROCK, MAGMA, METHANE];

interface Tally {
  observed: Float64Array;
  expected: Float64Array;
  variance: Float64Array;
}
const newTally = (): Tally => ({ observed: new Float64Array(NCAT), expected: new Float64Array(NCAT), variance: new Float64Array(NCAT) });

function expectWithin3Sigma(band: string, t: Tally): void {
  for (let c = 0; c < NCAT; c++) {
    const sigma = Math.sqrt(t.variance[c]);
    const dev = Math.abs(t.observed[c] - t.expected[c]);
    const label = `${band} ${CAT_NAMES[c]}: observed ${t.observed[c]}, expected ${t.expected[c].toFixed(1)} ± ${sigma.toFixed(1)}`;
    if (t.expected[c] === 0) expect(t.observed[c], label).toBe(0);
    else expect(dev, label).toBeLessThanOrEqual(3 * sigma);
  }
}

describe('terrain distribution: rule vs 01 §4.3', () => {
  it('the rule’s per-band expectation reproduces the 01 §4.3 table', () => {
    for (const band of STAT_BANDS) {
      const e = new Float64Array(NCAT);
      for (let r = band.top; r <= band.bottom; r++) for (let c = 0; c < NCAT; c++) e[c] += MINE_W * ROW_PROBS[r][c];
      const cells = (band.bottom - band.top + 1) * MINE_W;
      TABLE_CATS.forEach((c, j) => expect(e[c], `${band.id} ${CAT_NAMES[c]}`).toBeCloseTo(TABLE[band.id][j], 0));
      expect(e[AIR] / cells).toBeCloseTo(1 / 3, 9);
      let minerals = 0;
      for (let tier = 1; tier <= 10; tier++) minerals += e[mineralCat(tier)];
      expect((minerals + e[RELIC]) / cells).toBeCloseTo(0.2 * (2 / 3), 9); // 13.33% (01 §4.3)
    }
  });
});

describe('terrain distribution: generated worlds (200 seeds, 3σ)', () => {
  const tallies = new Map<string, Tally>();
  const bandOfRow = new Int8Array(584).fill(-1);
  STAT_BANDS.forEach((b, i) => bandOfRow.fill(i, b.top, b.bottom + 1));

  let unexpectedCodes = 0;

  beforeAll(() => {
    const included = new Float64Array(584); // included cells per row, summed over seeds
    const observed = STAT_BANDS.map(() => new Float64Array(NCAT));
    const excluded = GEN_PASS_1_TO_5 | GEN_PASS.RECORDER_FROM_DIRT;
    for (const seed of SEEDS) {
      const { grid, trace } = generateWorldTraced(seed);
      for (let r = 1; r < 584; r++) {
        const obs = observed[bandOfRow[r]];
        for (let x = 0; x < MINE_W; x++) {
          const i = r * MINE_W + x;
          if (trace.passMask[i] & excluded) continue;
          const cat = categoryOf(grid.terrain[i]);
          if (cat < 0) unexpectedCodes++;
          else obs[cat]++;
          included[r]++;
        }
      }
    }
    STAT_BANDS.forEach((band, b) => {
      const tally = newTally();
      tally.observed.set(observed[b]);
      for (let r = band.top; r <= band.bottom; r++) {
        for (let c = 0; c < NCAT; c++) {
          const p = ROW_PROBS[r][c];
          tally.expected[c] += included[r] * p;
          tally.variance[c] += included[r] * p * (1 - p);
        }
      }
      tallies.set(band.id, tally);
    });
  });

  it('cell-pass rows hold only cell-pass codes outside the excluded cells', () => {
    expect(unexpectedCodes).toBe(0);
  });

  for (const band of STAT_BANDS) {
    it(`${band.id} rows ${band.top}–${band.bottom} matches within 3σ`, () => {
      expectWithin3Sigma(band.id, tallies.get(band.id)!);
    });
  }
});

describe('terrain distribution: cell pass relic kinds', () => {
  it('each relic kind is uniform (¼ of relics) within 3σ before pass 6', () => {
    const counts = [0, 0, 0, 0];
    let expected = 0;
    let variance = 0;
    for (let r = 76; r < 584; r++) {
      const p = ROW_PROBS[r][RELIC] / 4;
      expected += MINE_W * p;
      variance += MINE_W * p * (1 - p);
    }
    for (const seed of SEEDS) {
      const t = generateCellPass(seed).terrain;
      for (let i = 0; i < 584 * MINE_W; i++) {
        const id = relicIdOf(t[i]);
        if (id < 0) continue;
        expect(Math.floor(i / MINE_W)).toBeGreaterThanOrEqual(76); // relics from r76 (canon §2.3)
        counts[id]++;
      }
    }
    const sigma = Math.sqrt(variance * SEED_COUNT);
    for (const n of counts) expect(Math.abs(n - expected * SEED_COUNT)).toBeLessThanOrEqual(3 * sigma);
  });
});
