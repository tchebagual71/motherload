import { describe, expect, it } from 'vitest';
import type { Factory } from '../../src/factory/factory';
import { rig, ticks } from './factory.helpers';

/**
 * Yard layout (rows 4–13): source Bin A at (2, 8) unloads east along row 9 into a Router at (9, 9). Outs:
 * N up column 9 into Bin N at (9, 4); S down column 9 into Bin S at (9, 12); E along row 9 into Bin E at (12, 8).
 */
interface Layout {
  f: Factory;
  router: number;
  src: number;
  sinks: Record<'N' | 'S' | 'E', number>;
}

function count(f: Factory, bin: number, itemId?: string): number {
  return (f.inspect(bin)?.contents ?? []).filter((c) => !itemId || c.item === itemId).reduce((n, c) => n + c.n, 0);
}

function layout(outs: readonly ('N' | 'S' | 'E')[], fill: { item: string; n: number }[] = [{ item: 'copperOre', n: 200 }], sinkBins: readonly ('N' | 'S' | 'E')[] = outs): Layout {
  const { f } = rig({ yardRows: 16 });
  f.discoverLode(0, false);
  f.unlockRung('U3');
  f.stockpilePut([{ item: 'ironIngot', n: 200 }]); // fill the survey Bin
  const src = f.place('bin', 1, 2, 8, 0);
  if (!src.ok) throw new Error('src');
  f.stockpilePut(fill);
  f.setUnloadFilter(src.id, fill[0].item);
  must(f.paintBelts([4, 5, 6, 7, 8].map((x) => ({ x, y: 9 })), 1));
  const router = f.place('router', 1, 9, 9, 0);
  if (!router.ok) throw new Error(JSON.stringify(router));
  const sinks = { N: 0, S: 0, E: 0 };
  for (const o of outs) {
    if (o === 'N') must(f.paintBelts([8, 7, 6].map((y) => ({ x: 9, y })), 1));
    if (o === 'S') must(f.paintBelts([10, 11].map((y) => ({ x: 9, y })), 1));
    if (o === 'E') must(f.paintBelts([10, 11].map((x) => ({ x, y: 9 })), 1));
  }
  for (const o of sinkBins) {
    const at = { N: [9, 4], S: [9, 12], E: [12, 8] }[o];
    const b = f.place('bin', 1, at[0], at[1], 0);
    if (!b.ok) throw new Error(`sink ${o}: ${JSON.stringify(b)}`);
    sinks[o] = b.id;
  }
  return { f, router: router.id, src: src.id, sinks };
}

function must(r: { ok: boolean }): void {
  if (!r.ok) throw new Error(JSON.stringify(r));
}

describe('factory router (02 §10.4)', () => {
  it('Even alternates between its Outs', () => {
    const { f, sinks } = layout(['N', 'S']);
    for (let t = 0; t < 4_000; t++) {
      f.tick();
      expect(Math.abs(count(f, sinks.N) - count(f, sinks.S))).toBeLessThanOrEqual(1);
    }
    expect(count(f, sinks.N) + count(f, sinks.S)).toBeGreaterThan(150);
  });

  it('sends everything to the open Out when the other is blocked', () => {
    const { f, sinks } = layout(['N', 'S'], undefined, ['N']);
    ticks(f, 1_200);
    const n0 = count(f, sinks.N);
    ticks(f, 1_200);
    expect(count(f, sinks.N) - n0).toBe(60);
  });

  it('Overflow fills the primary Out first, then overflows clockwise', () => {
    const { f, router, sinks } = layout(['N', 'S', 'E'], [{ item: 'copperOre', n: 200 }], ['N', 'S', 'E']);
    must(f.setRouterMode(router, 'overflow'));
    ticks(f, 2_400);
    // Default primary = straight across from the first In (W) = E.
    expect(count(f, sinks.N) + count(f, sinks.S)).toBe(0);
    expect(count(f, sinks.E)).toBeGreaterThan(30);
    // Block E (remove its Bin): the belt fills, then S (clockwise from E) takes the rest.
    must(f.deconstruct(sinks.E));
    ticks(f, 1_200);
    expect(count(f, sinks.S)).toBeGreaterThan(40);
    expect(count(f, sinks.N)).toBe(0);
  });

  it('Filter(X) sends X only to the primary Out, others Even across the rest, and holds when that Out is blocked', () => {
    const { f, router, src, sinks } = layout(['N', 'S', 'E'], [
      { item: 'copperOre', n: 100 },
      { item: 'hematiteOre', n: 100 },
    ]);
    must(f.setRouterMode(router, 'filter', { primary: 0, filter: 'copperOre' }));
    for (let m = 0; m < 6; m++) {
      must(f.setUnloadFilter(src, m % 2 === 0 ? 'copperOre' : 'hematiteOre'));
      ticks(f, 600);
    }
    expect(count(f, sinks.E, 'hematiteOre')).toBe(0);
    expect(count(f, sinks.N, 'copperOre') + count(f, sinks.S, 'copperOre')).toBe(0);
    expect(count(f, sinks.E, 'copperOre')).toBeGreaterThan(20);
    expect(Math.abs(count(f, sinks.N) - count(f, sinks.S))).toBeLessThanOrEqual(1);
    // Block E and feed copper: the Router holds it, and nothing passes behind it.
    must(f.deconstruct(sinks.E));
    must(f.setUnloadFilter(src, 'copperOre'));
    ticks(f, 1_200);
    const n = count(f, sinks.N) + count(f, sinks.S);
    must(f.setUnloadFilter(src, 'hematiteOre'));
    ticks(f, 1_200);
    expect(count(f, sinks.N) + count(f, sinks.S)).toBe(n);
    expect(f.inspect(router)?.output).toEqual([{ item: 'copperOre', n: 1 }]);
  });

  it('merges two full inputs fairly: 30 ± 1 per minute each', () => {
    const { f } = rig({ yardRows: 16 });
    f.discoverLode(0, false);
    f.unlockRung('U3');
    f.stockpilePut([{ item: 'ironIngot', n: 200 }]);
    const a = f.place('bin', 1, 2, 8, 0);
    const b = f.place('bin', 1, 9, 4, 1);
    if (!a.ok || !b.ok) throw new Error('sources');
    f.stockpilePut([
      { item: 'copperOre', n: 200 },
      { item: 'hematiteOre', n: 200 },
    ]);
    f.setUnloadFilter(a.id, 'copperOre');
    f.setUnloadFilter(b.id, 'hematiteOre');
    must(f.paintBelts([4, 5, 6, 7, 8].map((x) => ({ x, y: 9 })), 1));
    must(f.paintBelts([6, 7, 8].map((y) => ({ x: 9, y })), 1));
    must(f.place('router', 1, 9, 9, 0));
    must(f.paintBelts([10, 11].map((x) => ({ x, y: 9 })), 1));
    must(f.place('export', 1, 12, 8, 0));
    ticks(f, 1_200);
    for (let m = 0; m < 3; m++) {
      const ca = count(f, a.id);
      const cb = count(f, b.id);
      ticks(f, 1_200);
      expect(Math.abs(ca - count(f, a.id) - 30)).toBeLessThanOrEqual(1);
      expect(Math.abs(cb - count(f, b.id) - 30)).toBeLessThanOrEqual(1);
    }
  });
});
