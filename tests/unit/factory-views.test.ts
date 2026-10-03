import { describe, expect, it } from 'vitest';
import { item } from '../../src/factory/items';
import { newBeltItemsView, newLiftBucketsView } from '../../src/factory/views';
import { ONBOARD, buildOnboarding, rig, ticks } from './factory.helpers';

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

/** Source Bin at (2, 8) unloading east along row 9, turning south at x 8 down to row 14 (a dead end). */
function cornerLine() {
  const r = rig({ yardRows: 16 });
  const { f } = r;
  f.discoverLode(0, false);
  f.stockpilePut([{ item: 'ironIngot', n: 200 }]);
  const src = must(f.place('bin', 1, 2, 8, 0)).id;
  must(f.stockpilePut([{ item: 'copperOre', n: 50 }]));
  must(f.setUnloadFilter(src, 'copperOre'));
  must(f.paintBelts([...[4, 5, 6, 7, 8].map((x) => ({ x, y: 9 })), ...[10, 11, 12, 13, 14].map((y) => ({ x: 8, y }))], 1));
  return r;
}

describe('factory views (04 §3.3)', () => {
  it('reports belt items on the belt path with at most one tick of travel to extrapolate', () => {
    const { f } = cornerLine();
    const v = newBeltItemsView(4);
    for (let t = 0; t < 400; t++) {
      f.tick();
      f.fillBeltItems(v);
      for (let i = 0; i < v.count; i++) {
        const x = v.x[i];
        const y = v.y[i];
        // On the path: row 9 between x 4 and 8.5, or column 8.5 between rows 9.5 and 15.
        const onRow = Math.abs(y - 9.5) < 1e-4 && x >= 4 - 1e-4 && x <= 8.5 + 1e-4;
        const onCol = Math.abs(x - 8.5) < 1e-4 && y >= 9.5 - 1e-4 && y <= 15 + 1e-4;
        expect(onRow || onCol).toBe(true);
        expect(Math.hypot(v.dx[i], v.dy[i])).toBeLessThanOrEqual(0.05 + 1e-6);
        expect(v.item[i]).toBe(item('copperOre').num);
        expect(v.plane[i]).toBe(0);
      }
    }
    // Compressed at the dead end: items sit one tile apart, from the head edge to the tail edge (L / S + 1 = 11;
    // 04 §4.4 capacity), and do not extrapolate.
    ticks(f, 2_000);
    f.fillBeltItems(v);
    expect(v.count).toBe(11);
    const ys = Array.from(v.y.subarray(0, v.count));
    expect(ys[0]).toBeCloseTo(15, 5);
    for (let i = 0; i < v.count; i++) expect(v.dx[i] + v.dy[i]).toBe(0);
  });

  it('culls by plane and rectangle', () => {
    const { f } = cornerLine();
    ticks(f, 400);
    const v = newBeltItemsView();
    f.fillBeltItems(v, { plane: 'mine', x0: 0, y0: 0, x1: 47, y1: 600 });
    expect(v.count).toBe(0);
    f.fillBeltItems(v, { plane: 'yard', x0: 0, y0: 0, x1: 47, y1: 32 });
    expect(v.count).toBeGreaterThan(0);
    f.fillBeltItems(v, { plane: 'yard', x0: 20, y0: 0, x1: 47, y1: 32 });
    expect(v.count).toBe(0);
  });

  it('reports lift buckets rising from the foot to the top', () => {
    const r = rig();
    buildOnboarding(r);
    ticks(r.f, 700);
    const v = newLiftBucketsView(1);
    r.f.fillLiftBuckets(v);
    expect(v.count).toBeGreaterThan(1);
    for (let i = 0; i < v.count; i++) {
      expect(v.x[i]).toBe(ONBOARD.column + 0.5);
      expect(v.row[i]).toBeGreaterThanOrEqual(0.5);
      expect(v.row[i]).toBeLessThanOrEqual(ONBOARD.top - 0.5);
      expect(v.dRow[i]).toBeCloseTo(-45 / 600, 6);
    }
  });

  it('exposes entities, belt words and the topology version', () => {
    const { f } = cornerLine();
    const v0 = f.topologyVersion;
    expect(f.entities().map((e) => e.kind)).toEqual(['headframe', 'smelter', 'bin', 'bin']);
    expect(f.beltWords('yard')[9 * 48 + 4] & 0x8000).toBe(0x8000);
    must(f.removeBelts('yard', [{ x: 4, y: 9 }]));
    expect(f.topologyVersion).toBeGreaterThan(v0);
    expect(f.beltWords('yard')[9 * 48 + 4]).toBe(0);
  });
});
