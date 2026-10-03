import { describe, expect, it } from 'vitest';
import type { Purity } from '../../src/shared/canon';
import type { Factory } from '../../src/factory/factory';
import { newLiftBucketsView } from '../../src/factory/views';
import { Cargo, POD_AWAY, addLode, carve, makeGrid, rig, ticks } from './factory.helpers';

/**
 * A lift in column 20 (under the survey Headframe at x 19–20) from foot row `foot` to row 0, fed by drills on
 * lodes either side of its foot. The Headframe pushes east along Yard row 2 into an Export at (24, 1).
 */
function liftRig(purities: Purity[], foot = 45, mk: 1 | 2 | 3 = 1, scope: 'mvp' | 'v1' = 'mvp', drillMk: 1 | 2 | 3 = 1) {
  const g = makeGrid();
  addLode(g, 'copper', 'normal', 30, 46); // scripted lode (id 0), unused here
  const drills: { x: number; lode: number }[] = [];
  if (purities[0]) drills.push({ x: 18, lode: addLode(g, 'copper', purities[0], 17, foot + 1).id });
  if (purities[1]) drills.push({ x: 21, lode: addLode(g, 'copper', purities[1], 21, foot + 1).id });
  carve(g, 20, 0, 20, foot);
  carve(g, 18, foot - 1, 22, foot);
  const r = rig({ scope, surveyColumn: 19 }, g);
  const { f } = r;
  for (const d of drills) f.discoverLode(d.lode, true);
  f.unlockRung('U3');
  if (scope === 'v1') {
    f.unlockRung('U8');
    f.unlockRung('U10');
  }
  const cargo = new Cargo({ autoDrill: 2, autoDrill3: 2, liftFoot: 1, liftFoot2: 1, liftFoot3: 1, liftRail: 9 });
  const ids: number[] = [];
  for (const d of drills) ids.push(...must(f.placeGhost({ kind: 'autoDrill', mk: drillMk, x: d.x, y: foot - 1 })).ids);
  ids.push(...must(f.placeGhost({ kind: 'lift', mk, x: 20, foot, top: 0 })).ids);
  for (const id of ids) must(f.completeGhost(id, POD_AWAY, cargo));
  const beltMk = mk === 1 ? 1 : 2;
  if (beltMk === 2) must(f.stockpilePut([{ item: 'gear', n: 3 }]));
  must(f.paintBelts([21, 22, 23].map((x) => ({ x, y: 2 })), beltMk));
  must(f.place('export', 1, 24, 1, 0));
  const lift = f.entities().find((e) => e.kind === 'lift')!.id;
  const hf = f.entities().find((e) => e.kind === 'headframe')!.id;
  return { ...r, lift, hf };
}

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

/**
 * Ticks from the first admission to that item's arrival in the Headframe. The Headframe (lower id) pushes in P5
 * before the lift delivers, so the item is still in its buffer when the tick ends.
 */
function measureTransit(f: Factory, lift: number, hf: number): number {
  let admitted = -1;
  for (let t = 0; t < 20_000; t++) {
    const tick = f.tickNo;
    f.tick();
    if (admitted < 0 && f.inspect(lift)!.inFlight === 1) admitted = tick;
    if (admitted >= 0 && f.inspect(hf)!.output.length > 0) return tick - admitted;
  }
  throw new Error('no delivery');
}

describe('factory: Bucket Lift (02 §3.4, §10.6)', () => {
  it('carries 30 items/min at Mk I when over-supplied', () => {
    const { f } = liftRig(['rich', 'rich']);
    ticks(f, 1_200);
    const sold0 = f.debug.counts.sold;
    ticks(f, 12_000);
    expect(Math.abs(f.debug.counts.sold - sold0 - 300)).toBeLessThanOrEqual(1);
  });

  it.each([
    [1, 45, Math.floor((40 * 45 + 2) / 3)],
    [1, 10, Math.floor((40 * 10 + 2) / 3)],
    [2, 45, 8 * 45],
    [3, 45, 5 * 45],
  ] as const)('Mk %i transit over H = %i is %i ticks', (mk, foot, expected) => {
    const { f, lift, hf } = liftRig(['normal'], foot, mk, mk === 1 ? 'mvp' : 'v1');
    expect(measureTransit(f, lift, hf)).toBe(expected);
  });

  it('carries 90/min at Mk II (v1) when over-supplied by two Rich Mk III drills (96/min)', () => {
    const { f } = liftRig(['rich', 'rich'], 45, 2, 'v1', 3);
    ticks(f, 1_200);
    const sold0 = f.debug.counts.sold;
    ticks(f, 12_000);
    expect(Math.abs(f.debug.counts.sold - sold0 - 900)).toBeLessThanOrEqual(1);
  });

  it('freezes when stalled: no clock, no admission; resumes when the top frees', () => {
    const { f, lift, hf } = liftRig(['rich', 'rich']);
    must(f.removeBelts('yard', [21, 22, 23].map((x) => ({ x, y: 2 }))));
    ticks(f, 3_000);
    expect(f.entity(lift)?.status).toBe('blocked');
    expect(f.inspect(hf)?.output.reduce((n, s) => n + s.n, 0)).toBe(4);
    const view = newLiftBucketsView();
    f.fillLiftBuckets(view);
    const rows = Array.from(view.row.subarray(0, view.count));
    const flying = f.inspect(lift)!.inFlight;
    ticks(f, 600);
    f.fillLiftBuckets(view);
    expect(Array.from(view.row.subarray(0, view.count))).toEqual(rows);
    expect(f.inspect(lift)!.inFlight).toBe(flying);
    expect(Array.from(view.dRow.subarray(0, view.count)).every((d) => d === 0)).toBe(true);
    must(f.paintBelts([21, 22, 23].map((x) => ({ x, y: 2 })), 1));
    const sold0 = f.debug.counts.sold;
    ticks(f, 2_400);
    expect(f.debug.counts.sold - sold0).toBeGreaterThan(50);
    expect(f.debug.conservationOk()).toBe(true);
  });

  it('halves throughput at s = 0.5 (v1 power hook)', () => {
    const { f } = liftRig(['rich', 'rich']);
    f.debug.setPowerQ16(32_768);
    ticks(f, 2_400);
    const sold0 = f.debug.counts.sold;
    ticks(f, 12_000);
    expect(Math.abs(f.debug.counts.sold - sold0 - 150)).toBeLessThanOrEqual(1);
  });

  it('a lift that stalled at its foot section resumes once a late rail extends it to the Headframe', () => {
    const g = makeGrid();
    addLode(g, 'copper', 'normal', 30, 46);
    const lode = addLode(g, 'copper', 'rich', 17, 46).id;
    carve(g, 20, 0, 20, 45);
    carve(g, 18, 44, 22, 45);
    const { f } = rig({ surveyColumn: 19 }, g);
    f.discoverLode(lode, true);
    const cargo = new Cargo({ autoDrill: 1, liftFoot: 1, liftRail: 1 });
    must(f.completeGhost(must(f.placeGhost({ kind: 'autoDrill', x: 18, y: 44 })).ids[0], POD_AWAY, cargo));
    const [foot, rail] = must(f.placeGhost({ kind: 'lift', x: 20, foot: 45, top: 0 })).ids;
    must(f.completeGhost(foot, POD_AWAY, cargo));
    const lift = f.entities().find((e) => e.kind === 'lift')!.id;
    const hf = f.entities().find((e) => e.kind === 'headframe')!.id;
    ticks(f, 3_000); // the head reaches the foot section's top (row 14) with nowhere to go
    expect(f.entity(lift)?.status).not.toBe('working');
    must(f.completeGhost(rail, POD_AWAY, cargo));
    let arrived = false;
    for (let t = 0; t < 3_000 && !arrived; t++) {
      f.tick();
      arrived = (f.inspect(hf)?.output.length ?? 0) > 0;
    }
    expect(arrived).toBe(true);
    expect(f.debug.conservationOk()).toBe(true);
  });

  it('a rail section only completes above a built lift (E_COLUMN), and extends it', () => {
    const g = makeGrid();
    addLode(g, 'copper', 'normal', 30, 46);
    carve(g, 20, 0, 20, 45);
    const { f } = rig({ surveyColumn: 19 }, g);
    f.discoverLode(0, false);
    const ids = must(f.placeGhost({ kind: 'lift', x: 20, foot: 45, top: 0 })).ids;
    expect(f.ghosts().map((x) => [x.part, x.y, x.h, x.kit])).toEqual([
      ['foot', 14, 32, 'liftFoot'],
      ['rail', 0, 14, 'liftRail'],
    ]);
    const cargo = new Cargo({ liftFoot: 1, liftRail: 1 });
    expect(f.completeGhost(ids[1], POD_AWAY, cargo)).toEqual({ ok: false, code: 'E_COLUMN', x: 20, y: 14 });
    expect(cargo.kits.liftRail).toBe(1);
    must(f.completeGhost(ids[0], POD_AWAY, cargo));
    const lift = f.entities().find((e) => e.kind === 'lift')!;
    expect([lift.y, lift.h]).toEqual([14, 32]);
    must(f.completeGhost(ids[1], POD_AWAY, cargo));
    expect([lift.y, lift.h]).toEqual([0, 46]);
    expect(cargo.kits).toEqual({ liftFoot: 0, liftRail: 0 });
  });
});
