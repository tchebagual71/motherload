import { describe, expect, it } from 'vitest';
import { ONBOARD, binOf, buildOnboarding, rig } from './factory.helpers';

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

describe('factory: back-pressure and conservation (02 §10.7)', () => {
  it('remove Export → Bin fills → Smelter, Headframe, lift and drill stop; nothing is created or lost', () => {
    const r = rig();
    buildOnboarding(r);
    const { f } = r;
    f.unlockRung('U3');
    const col = ONBOARD.column;
    // Second Headframe output: east along Yard row 1 into an Export.
    must(f.paintBelts([col + 2, col + 3, col + 4].map((x) => ({ x, y: 1 })), 1));
    const exp = must(f.place('export', 1, col + 5, 1, 0)).id;
    for (let t = 0; t < 2_400; t++) {
      f.tick();
      expect(f.debug.conservationOk()).toBe(true);
    }
    expect(f.debug.counts.sold).toBeGreaterThan(0);

    must(f.deconstruct(exp));
    must(f.stockpilePut([{ item: 'ironIngot', n: 195 - f.stockpileCount('copperIngot') }]));
    const drill = f.entities().find((e) => e.kind === 'autoDrill')!;
    const lift = f.entities().find((e) => e.kind === 'lift')!;
    let produced = -1;
    let stableSince = -1;
    for (let t = 0; t < 12_000; t++) {
      f.tick();
      expect(f.debug.conservationOk()).toBe(true);
      const p = f.debug.counts.produced;
      if (p !== produced) {
        produced = p;
        stableSince = t;
      }
    }
    expect(f.inspect(binOf(f))?.contents.reduce((n, c) => n + c.n, 0)).toBe(200);
    expect(drill.status).toBe('blocked');
    expect(lift.status).toBe('blocked');
    expect(stableSince).toBeLessThan(9_000); // nothing produced for the last 3,000+ ticks
    const c = f.debug.counts;
    expect(c.imported + c.produced - c.sold - c.consumed - c.taken - c.scrapped).toBe(f.debug.itemsHeld());
    expect(c.scrapped).toBe(0);
  });

  it('wakes the whole chain when space returns', () => {
    const r = rig();
    buildOnboarding(r);
    const { f } = r;
    must(f.stockpilePut([{ item: 'ironIngot', n: 200 }]));
    for (let t = 0; t < 8_000; t++) f.tick();
    const drill = f.entities().find((e) => e.kind === 'autoDrill')!;
    expect(drill.status).toBe('blocked');
    must(f.stockpileTake([{ item: 'ironIngot', n: 100 }]));
    const p0 = f.debug.counts.produced;
    for (let t = 0; t < 2_400; t++) f.tick();
    expect(f.debug.counts.produced - p0).toBeGreaterThanOrEqual(15);
    expect(drill.status).toBe('working');
  });
});
