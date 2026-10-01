import { describe, expect, it } from 'vitest';
import { BANDS, MINE_W, SEAL_ROW } from '../../src/shared/canon';
import { T, type Lode } from '../../src/shared/types';
import { generateWorld } from '../../src/terrain/generate';
import { M0_DEBUG_STRIP, applyScopeOverlay, bandOf, isLodeVisible, scopeFloorRow, scopeView } from '../../src/terrain/scope';

const inStrip = (x: number, r: number) =>
  r >= M0_DEBUG_STRIP.top && r <= M0_DEBUG_STRIP.bottom && x >= M0_DEBUG_STRIP.x0 && x <= M0_DEBUG_STRIP.x1;

describe('terrain scope: floors and views', () => {
  it('scopeFloorRow: m0 → 128, mvp → 320, v1 → 584', () => {
    expect(scopeFloorRow('m0')).toBe(128);
    expect(scopeFloorRow('mvp')).toBe(320);
    expect(scopeFloorRow('v1')).toBe(584);
  });

  it('scopeView reads Seal at and below a temporary floor, real terrain otherwise', () => {
    const { grid } = generateWorld(3);
    expect(scopeView(grid, 'm0', 10, 127)).toBe(grid.get(10, 127));
    expect(scopeView(grid, 'm0', 10, 128)).toBe(T.SEAL);
    expect(scopeView(grid, 'mvp', 10, 319)).toBe(grid.get(10, 319));
    expect(scopeView(grid, 'mvp', 47, 400)).toBe(T.SEAL);
    expect(scopeView(grid, 'v1', 46, SEAL_ROW)).toBe(T.AIR); // the Notch
    expect(scopeView(grid, 'v1', 10, 400)).toBe(grid.get(10, 400));
  });

  it('isLodeVisible: v1 lodes are Unknown seams before v1', () => {
    const lode = (scope: Lode['scope']): Lode => ({ id: 0, metal: 'gold', purity: 'normal', x0: 2, top: 70, scripted: false, scope, discovered: false });
    expect(isLodeVisible(lode('mvp'), 'm0')).toBe(true);
    expect(isLodeVisible(lode('mvp'), 'mvp')).toBe(true);
    expect(isLodeVisible(lode('v1'), 'm0')).toBe(false);
    expect(isLodeVisible(lode('v1'), 'mvp')).toBe(false);
    expect(isLodeVisible(lode('v1'), 'v1')).toBe(true);
  });

  it('bandOf maps rows to strata B0–B7 (canon §2.5), clamped', () => {
    BANDS.forEach((b, i) => {
      expect(bandOf(b.top)).toBe(i);
      expect(bandOf(b.bottom)).toBe(i);
    });
    expect(bandOf(-5)).toBe(0);
    expect(bandOf(10_000)).toBe(7);
  });
});

describe('terrain scope: M0 debug strip', () => {
  it('only m0 writes anything', () => {
    for (const scope of ['mvp', 'v1'] as const) {
      const { grid } = generateWorld(11);
      const before = grid.terrain.slice();
      applyScopeOverlay(grid, scope);
      expect(Buffer.from(grid.terrain).equals(Buffer.from(before))).toBe(true);
      expect(grid.version).toBe(0);
    }
  });

  it('m0 turns strip dirt into ~70% Hardrock / 30% Magma and touches nothing else', () => {
    let hardrock = 0;
    let magma = 0;
    for (let seed = 0; seed < 40; seed++) {
      const { grid } = generateWorld(seed);
      const before = grid.terrain.slice();
      applyScopeOverlay(grid, 'm0');
      expect(grid.version).toBeGreaterThan(0); // written through grid.set: chunks dirtied
      for (let i = 0; i < before.length; i++) {
        const x = i % MINE_W;
        const r = Math.floor(i / MINE_W);
        if (grid.terrain[i] === before[i]) continue;
        expect(inStrip(x, r)).toBe(true);
        expect(before[i]).toBe(T.DIRT);
        if (grid.terrain[i] === T.HARDROCK) hardrock++;
        else if (grid.terrain[i] === T.MAGMA) magma++;
        else throw new Error(`unexpected strip code ${grid.terrain[i]}`);
      }
    }
    const n = hardrock + magma;
    expect(n).toBeGreaterThan(1000);
    expect(Math.abs(hardrock / n - 0.7)).toBeLessThan(3 * Math.sqrt((0.7 * 0.3) / n));
  });

  it('is deterministic per seed, idempotent, and keeps the 3×2 above lodes hazard-free', () => {
    for (let seed = 0; seed < 40; seed++) {
      const a = generateWorld(seed).grid;
      const b = generateWorld(seed).grid;
      applyScopeOverlay(a, 'm0');
      applyScopeOverlay(b, 'm0');
      expect(Buffer.from(a.terrain).equals(Buffer.from(b.terrain))).toBe(true);
      const once = a.terrain.slice();
      applyScopeOverlay(a, 'm0');
      expect(Buffer.from(a.terrain).equals(Buffer.from(once))).toBe(true);
      for (const l of a.lodes) {
        for (let r = l.top - 2; r < l.top; r++) {
          for (let x = l.x0; x <= l.x0 + 2; x++) expect([T.HARDROCK, T.MAGMA]).not.toContain(a.get(x, r));
        }
      }
    }
  });

  it('generation itself never depends on scope (identical bytes before any overlay)', () => {
    const a = generateWorld(77).grid;
    const b = generateWorld(77).grid;
    applyScopeOverlay(b, 'mvp');
    applyScopeOverlay(b, 'v1');
    expect(Buffer.from(a.terrain).equals(Buffer.from(b.terrain))).toBe(true);
    expect(Buffer.from(a.lodeIndex).equals(Buffer.from(b.lodeIndex))).toBe(true);
  });
});
