import { describe, expect, it } from 'vitest';
import { DIG_LAST_ROW, MINE_H, MINE_W, NOTCH_X0, NOTCH_X1, RIM_BUILDINGS, SCRIPTED_LODE_TOP, SEAL_ROW } from '../../src/shared/canon';
import { F, T, mineralCode, mineralTierOf, relicCode } from '../../src/shared/types';
import { GEN_BANDS, fillCellBand } from '../../src/terrain/cells';
import { GEN_PASS, generateCellPass, generateWorld, generateWorldTraced } from '../../src/terrain/generate';
import { HEART_STAMP, heartFeatureCells } from '../../src/terrain/heart';
import { isValidHeadframeColumn } from '../../src/terrain/rules';

const SEEDS = Array.from({ length: 60 }, (_, i) => (i * 2654435761 + 17) >>> 0);
const at = (x: number, r: number) => r * MINE_W + x;
const RECORDER = relicCode(2);

function countRecorders(t: Uint8Array, top: number, bottom: number): number {
  let n = 0;
  for (let i = top * MINE_W; i < (bottom + 1) * MINE_W; i++) if (t[i] === RECORDER) n++;
  return n;
}

describe('terrain: determinism', () => {
  it('two runs give identical terrain, flags, lode index and lodes', () => {
    for (const seed of [0, 1, 42, 0xdeadbeef]) {
      const a = generateWorld(seed);
      const b = generateWorld(seed);
      expect(Buffer.from(a.grid.terrain).equals(Buffer.from(b.grid.terrain))).toBe(true);
      expect(Buffer.from(a.grid.flags).equals(Buffer.from(b.grid.flags))).toBe(true);
      expect(Buffer.from(a.grid.lodeIndex).equals(Buffer.from(b.grid.lodeIndex))).toBe(true);
      expect(a.grid.lodes).toEqual(b.grid.lodes);
      expect(a.meta).toEqual(b.meta);
    }
  });

  it('different seeds give different worlds', () => {
    const a = generateWorld(1).grid;
    const b = generateWorld(2).grid;
    expect(Buffer.from(a.terrain).equals(Buffer.from(b.terrain))).toBe(false);
    expect(a.lodes.map((l) => [l.x0, l.top])).not.toEqual(b.lodes.map((l) => [l.x0, l.top]));
  });

  it('bands generate independently: any fill order gives the same cells', () => {
    const forward = generateCellPass(7).terrain;
    const reversed = new Uint8Array(MINE_W * MINE_H);
    for (let b = GEN_BANDS - 1; b >= 0; b--) fillCellBand(reversed, 7, b);
    for (let i = MINE_W; i <= at(MINE_W - 1, DIG_LAST_ROW); i++) expect(reversed[i]).toBe(forward[i]);
  });

  it('changing one band seed leaves every other band untouched', () => {
    const base = generateCellPass(7).terrain;
    const t = base.slice();
    // Re-fill band 3 from another seed: only rows 192–255 may change.
    fillCellBand(t, 8, 3);
    let changedOutside = 0;
    for (let i = MINE_W; i <= at(MINE_W - 1, DIG_LAST_ROW); i++) {
      const r = Math.floor(i / MINE_W);
      if ((r < 192 || r > 255) && t[i] !== base[i]) changedOutside++;
    }
    expect(changedOutside).toBe(0);
  });

  it('generates in well under 60 ms', () => {
    generateWorld(123); // warm-up (JIT)
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      generateWorld(1000 + i);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[3]).toBeLessThan(60);
  });
});

describe('terrain: row 0', () => {
  it('is paved under the four Rim pads and turf elsewhere (survey column excepted)', () => {
    for (const seed of SEEDS) {
      const { grid, meta } = generateWorld(seed);
      for (let x = 0; x < MINE_W; x++) {
        const underPad = RIM_BUILDINGS.some((b) => x >= b.x0 && x <= b.x1);
        const expected = x === meta.surveyColumn ? T.AIR : underPad ? T.PAVED : T.TURF;
        expect(grid.terrain[x]).toBe(expected);
      }
    }
  });
});

describe('terrain: Tutorial Patch and seeded Gold', () => {
  it('rows 1–8 × x 5–11 hold no air and at least 5 bulk specimens', () => {
    for (const seed of SEEDS) {
      const t = generateWorld(seed).grid.terrain;
      let bulk = 0;
      for (let r = 1; r <= 8; r++) {
        for (let x = 5; x <= 11; x++) {
          const c = t[at(x, r)];
          expect(c).not.toBe(T.AIR);
          const tier = mineralTierOf(c);
          if (tier >= 1 && tier <= 6) bulk++;
          else expect(c).toBe(T.DIRT);
        }
      }
      expect(bulk).toBeGreaterThanOrEqual(5);
    }
  });

  it('places one seeded Gold in rows 12–20, x 2–12', () => {
    for (const seed of SEEDS) {
      const { grid, trace } = generateWorldTraced(seed);
      const x = trace.seededGold % MINE_W;
      const r = Math.floor(trace.seededGold / MINE_W);
      expect(r).toBeGreaterThanOrEqual(12);
      expect(r).toBeLessThanOrEqual(20);
      expect(x).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThanOrEqual(12);
      expect(grid.terrain[trace.seededGold]).toBe(mineralCode(4));
    }
  });

  it('seeded Gold replaces a cell that was dirt or a mineral', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const before = generateCellPass(seed).terrain;
      const { trace } = generateWorldTraced(seed);
      const c = before[trace.seededGold];
      expect(c === T.DIRT || mineralTierOf(c) > 0).toBe(true);
    }
  });
});

describe("terrain: Dot's survey shaft", () => {
  it('is a valid Headframe column beside the scripted lode, open and flagged in rows 0–45', () => {
    const sides = new Set<number>();
    for (const seed of SEEDS) {
      const { grid, meta } = generateWorld(seed);
      const lode = grid.lodes[meta.scriptedLodeId];
      const c = meta.surveyColumn;
      expect([lode.x0 - 1, lode.x0 + 3]).toContain(c);
      expect(isValidHeadframeColumn(c)).toBe(true);
      expect(RIM_BUILDINGS.some((b) => c >= b.x0 && c <= b.x1)).toBe(false);
      for (let r = 0; r < SCRIPTED_LODE_TOP; r++) {
        expect(grid.terrain[at(c, r)]).toBe(T.AIR);
        expect(grid.hasFlag(c, r, F.SURVEY)).toBe(true);
      }
      expect(grid.hasFlag(c, SCRIPTED_LODE_TOP, F.SURVEY)).toBe(false);
      sides.add(c - lode.x0);
    }
    // Seeded side: both sides occur across seeds.
    expect([...sides].sort()).toEqual([-1, 3]);
  });

  it('valid Headframe columns are exactly 02 §2.2: 5–9, 14–29, 34–39, 44–47', () => {
    const valid: number[] = [];
    for (let c = -1; c <= MINE_W; c++) if (isValidHeadframeColumn(c)) valid.push(c);
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    expect(valid).toEqual([...range(5, 9), ...range(14, 29), ...range(34, 39), ...range(44, 47)]);
  });
});

describe('terrain: Lost Pod Recorders', () => {
  it('has ≥ 6 in rows 76–319 and ≥ 2 in rows 396–583', () => {
    for (const seed of SEEDS) {
      const t = generateWorld(seed).grid.terrain;
      expect(countRecorders(t, 76, 319)).toBeGreaterThanOrEqual(6);
      expect(countRecorders(t, 396, 583)).toBeGreaterThanOrEqual(2);
      expect(countRecorders(t, 0, DIG_LAST_ROW)).toBeGreaterThanOrEqual(6);
    }
  });

  it('converts other relics before dirt', () => {
    for (const seed of SEEDS) {
      const before = generateCellPass(seed).terrain;
      const { trace } = generateWorldTraced(seed);
      for (let i = 0; i < trace.passMask.length; i++) {
        if (!(trace.passMask[i] & GEN_PASS.RECORDER)) continue;
        const wasRelic = before[i] >= T.RELIC_BASE && before[i] < T.RELIC_BASE + 4;
        expect(wasRelic).toBe(!(trace.passMask[i] & GEN_PASS.RECORDER_FROM_DIRT));
      }
    }
  });
});

describe('terrain: the Seal, the Notch and the Hollow Heart', () => {
  it('stamp covers rows 584–607, 48 columns each', () => {
    expect(HEART_STAMP.length).toBe(MINE_H - SEAL_ROW);
    for (const line of HEART_STAMP) expect(line.length).toBe(MINE_W);
  });

  it('row 584 is Seal with the Notch open at x 46–47', () => {
    const t = generateWorld(5).grid.terrain;
    for (let x = 0; x < MINE_W; x++) {
      const notch = x >= NOTCH_X0 && x <= NOTCH_X1;
      expect(t[at(x, SEAL_ROW)]).toBe(notch ? T.AIR : T.SEAL);
    }
  });

  it('the Notch chute drops 11 rows onto the East ledge', () => {
    const t = generateWorld(5).grid.terrain;
    for (let r = SEAL_ROW; r <= 595; r++) {
      expect(t[at(46, r)]).toBe(T.AIR);
      expect(t[at(47, r)]).toBe(T.AIR);
    }
    for (let r = 585; r <= 588; r++) for (let x = 0; x < 46; x++) expect(t[at(x, r)]).toBe(T.HEARTSTONE);
    for (let x = 40; x <= 47; x++) expect(t[at(x, 596)]).toBe(T.HEARTSTONE); // East ledge
    for (let x = 0; x <= 7; x++) expect(t[at(x, 596)]).toBe(T.HEARTSTONE); // West ledge
  });

  it('has the sealed Hoard Alcove, mid ledges and a Heartstone floor', () => {
    const t = generateWorld(5).grid.terrain;
    for (const { x, r } of heartFeatureCells('hoard')) expect(t[at(x, r)]).toBe(T.AIR);
    expect(heartFeatureCells('hoard')).toHaveLength(6);
    for (let r = 589; r <= 591; r++) expect(t[at(5, r)]).toBe(T.HEARTSTONE); // crust
    for (let x = 0; x <= 5; x++) expect(t[at(x, 592)]).toBe(T.HEARTSTONE); // alcove floor
    for (let x = 11; x <= 16; x++) expect(t[at(x, 600)]).toBe(T.HEARTSTONE);
    for (let x = 31; x <= 36; x++) expect(t[at(x, 600)]).toBe(T.HEARTSTONE);
    for (let r = 605; r < MINE_H; r++) for (let x = 0; x < MINE_W; x++) expect(t[at(x, r)]).toBe(T.HEARTSTONE);
    expect(heartFeatureCells('locker')).toEqual([
      { x: 2, r: 595 },
      { x: 45, r: 595 },
      { x: 8, r: 604 },
      { x: 39, r: 604 },
    ]);
  });

  it('only Seal, Heartstone and air appear from row 584 down', () => {
    const t = generateWorld(9).grid.terrain;
    for (let i = at(0, SEAL_ROW); i < t.length; i++) expect([T.AIR, T.SEAL, T.HEARTSTONE]).toContain(t[i]);
  });
});
