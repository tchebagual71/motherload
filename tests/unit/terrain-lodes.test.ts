import { describe, expect, it } from 'vitest';
import { MINE_W, SCRIPTED_LODE_TOP } from '../../src/shared/canon';
import { Rng } from '../../src/shared/rng';
import { T, type Lode, type LodeMetal } from '../../src/shared/types';
import { generateWorld } from '../../src/terrain/generate';
import { LODE_TABLE, lodesTooClose, placeLodes, type LodeSpec } from '../../src/terrain/lodes';

const SEEDS = Array.from({ length: 200 }, (_, i) => Math.imul(i + 11, 0x85ebca6b) >>> 0);
const WORLDS = SEEDS.map((s) => generateWorld(s));

/** Canon §3.2 lode table: row range → metals. */
const CANON_TABLE: { rows: [number, number]; metals: LodeMetal[] }[] = [
  { rows: [0, 64], metals: ['copper', 'hematite', 'hematite'] },
  { rows: [65, 129], metals: ['cobalt', 'copper', 'copper', 'kerogen'] },
  { rows: [130, 194], metals: ['cobalt', 'gold', 'kerogen'] },
  { rows: [195, 259], metals: ['gold', 'iridium', 'kerogen'] },
  { rows: [260, 324], metals: ['gold', 'iridium'] },
  { rows: [325, 389], metals: ['iridium', 'thorium'] },
  { rows: [390, 454], metals: ['iridium', 'thorium'] },
  { rows: [455, 519], metals: ['thorium', 'thorium'] },
  { rows: [520, 583], metals: ['thorium', 'thorium'] },
];

describe('terrain lodes: table', () => {
  it('has 23 lodes: 20 metal + 3 Kerogen in the canon §3.2 row ranges', () => {
    for (const { grid } of WORLDS) {
      expect(grid.lodes).toHaveLength(23);
      expect(grid.lodes.filter((l) => l.metal === 'kerogen')).toHaveLength(3);
      for (const row of CANON_TABLE) {
        const inRange = grid.lodes.filter((l) => l.top >= row.rows[0] && l.top + 1 <= row.rows[1]);
        expect(inRange.map((l) => l.metal).sort()).toEqual(row.metals);
      }
      grid.lodes.forEach((l, i) => expect(l.id).toBe(i));
    }
  });

  it('places the scripted Copper (Normal, top r46, x0 14–28) as GenMeta.scriptedLodeId', () => {
    for (const { grid, meta } of WORLDS) {
      const l = grid.lodes[meta.scriptedLodeId];
      expect(l).toMatchObject({ metal: 'copper', purity: 'normal', top: SCRIPTED_LODE_TOP, scripted: true, scope: 'mvp' });
      expect(l.x0).toBeGreaterThanOrEqual(14);
      expect(l.x0).toBeLessThanOrEqual(28);
      expect(grid.lodes.filter((x) => x.scripted)).toHaveLength(1);
    }
  });

  it('keeps Hematite tops in 50–63 and r260–324 tops ≤ 315', () => {
    for (const { grid } of WORLDS) {
      for (const l of grid.lodes.filter((x) => x.metal === 'hematite')) {
        expect(l.top).toBeGreaterThanOrEqual(50);
        expect(l.top).toBeLessThanOrEqual(63);
      }
      for (const l of grid.lodes.filter((x) => x.top >= 260 && x.top <= 324)) expect(l.top).toBeLessThanOrEqual(315);
    }
  });

  it('fixes the R12 Poor Iridium (rows 195–259) and Poor Thorium (rows 325–389)', () => {
    for (const { grid } of WORLDS) {
      const ir = grid.lodes.find((l) => l.metal === 'iridium' && l.top >= 195 && l.top <= 258);
      const th = grid.lodes.find((l) => l.metal === 'thorium' && l.top >= 325 && l.top <= 388);
      expect(ir?.purity).toBe('poor');
      expect(th?.purity).toBe('poor');
    }
  });

  it('marks Kerogen and every Thorium lode as v1 scope, the rest MVP', () => {
    for (const { grid } of WORLDS) {
      for (const l of grid.lodes) expect(l.scope).toBe(l.metal === 'kerogen' || l.metal === 'thorium' ? 'v1' : 'mvp');
      for (const l of grid.lodes) expect(l.discovered).toBe(false);
    }
  });

  it('rolls purity Poor 40 / Normal 45 / Rich 15, Thorium Poor 60 / Normal 40 (within 3σ)', () => {
    const std = { poor: 0, normal: 0, rich: 0 };
    const tho = { poor: 0, normal: 0, rich: 0 };
    let nStd = 0;
    let nTho = 0;
    for (const { grid } of WORLDS) {
      for (const l of grid.lodes) {
        const fixed = l.scripted || (l.metal === 'iridium' && l.top < 260) || (l.metal === 'thorium' && l.top < 390);
        if (fixed) continue;
        if (l.metal === 'thorium') {
          tho[l.purity]++;
          nTho++;
        } else {
          std[l.purity]++;
          nStd++;
        }
      }
    }
    const within = (k: number, n: number, p: number) => expect(Math.abs(k - n * p)).toBeLessThanOrEqual(3 * Math.sqrt(n * p * (1 - p)));
    within(std.poor, nStd, 0.4);
    within(std.normal, nStd, 0.45);
    within(std.rich, nStd, 0.15);
    within(tho.poor, nTho, 0.6);
    expect(tho.rich).toBe(0);
  });
});

describe('terrain lodes: geometry', () => {
  it('keeps every lode cell in x 2–43 and rows ≤ 583', () => {
    for (const { grid } of WORLDS) {
      for (const l of grid.lodes) {
        expect(l.x0).toBeGreaterThanOrEqual(2);
        expect(l.x0 + 2).toBeLessThanOrEqual(43);
        expect(l.top + 1).toBeLessThanOrEqual(583);
      }
    }
  });

  it('never puts two lodes both < 8 rows and < 6 columns apart', () => {
    for (const { grid } of WORLDS) {
      const ls = grid.lodes;
      for (let i = 0; i < ls.length; i++) {
        for (let j = i + 1; j < ls.length; j++) {
          const close = Math.abs(ls[i].top - ls[j].top) < 8 && Math.abs(ls[i].x0 - ls[j].x0) < 6;
          expect(close, `lodes ${i} and ${j}`).toBe(false);
        }
      }
    }
  });

  it('writes LODE_ROCK and the lode index on exactly the 3×2 cells', () => {
    for (const { grid } of WORLDS.slice(0, 40)) {
      let rock = 0;
      let strayIndex = 0;
      let misplaced = 0;
      for (let i = 0; i < grid.terrain.length; i++) {
        if (grid.terrain[i] !== T.LODE_ROCK) {
          if (grid.lodeIndex[i] !== 0) strayIndex++;
          continue;
        }
        rock++;
        const x = i % MINE_W;
        const r = Math.floor(i / MINE_W);
        const l = grid.lodeAt(x, r);
        if (!l || x < l.x0 || x > l.x0 + 2 || r < l.top || r > l.top + 1) misplaced++;
      }
      expect(rock).toBe(23 * 6);
      expect(strayIndex).toBe(0);
      expect(misplaced).toBe(0);
    }
  });

  it('forces the 3×2 above each lode hazard-free', () => {
    const hazards: number[] = [T.HARDROCK, T.MAGMA, T.METHANE];
    for (const { grid } of WORLDS) {
      for (const l of grid.lodes) {
        for (let r = l.top - 2; r < l.top; r++) {
          for (let x = l.x0; x <= l.x0 + 2; x++) expect(hazards).not.toContain(grid.get(x, r));
        }
      }
    }
  });
});

describe('terrain lodes: placement', () => {
  it('lodesTooClose is the "both < 8 rows and < 6 columns" rule', () => {
    expect(lodesTooClose(10, 100, 15, 107)).toBe(true);
    expect(lodesTooClose(10, 100, 16, 100)).toBe(false);
    expect(lodesTooClose(10, 100, 10, 108)).toBe(false);
  });

  it('finds the only free anchor even when random tries miss it, and throws when none is left', () => {
    const fixed = (top: number): LodeSpec => ({ metal: 'gold', topMin: top, topMax: top, x0Min: 2, x0Max: 2, purity: 'normal', scripted: false });
    // Between lodes at r100 and r116 in the same columns, r108 is the one legal top in 93–123.
    const tight: LodeSpec = { ...fixed(0), topMin: 93, topMax: 123 };
    for (let seed = 0; seed < 100; seed++) {
      const lodes: Lode[] = placeLodes(new Rng(seed), [fixed(100), fixed(116), tight]);
      expect(lodes[2]).toMatchObject({ x0: 2, top: 108, id: 2 });
    }
    expect(() => placeLodes(new Rng(1), [fixed(100), fixed(116), tight, tight])).toThrow(/no room/);
  });

  it('LODE_TABLE lists the scripted lode first', () => {
    expect(LODE_TABLE[0].scripted).toBe(true);
    expect(LODE_TABLE.filter((s) => s.scripted)).toHaveLength(1);
  });
});
