import { describe, expect, it } from 'vitest';
import { F, T } from '../../src/shared/types';
import { generateWorld } from '../../src/terrain/generate';
import { Factory } from '../../src/factory/factory';
import { item } from '../../src/factory/items';
import { ONBOARD, Wallet, binOf, buildOnboarding, rig, ticks } from './factory.helpers';

describe('factory: onboarding chain (01 §2.5; 02 §2.2, §3.4)', () => {
  it('places the rusted survey set over the survey column at a new game (U0)', () => {
    const { f } = rig();
    const set = f.entities().map((e) => [e.kind, e.x, e.y, e.rusted]);
    expect(set).toEqual([
      ['headframe', ONBOARD.column, 1, true],
      ['smelter', ONBOARD.column, 4, true],
      ['bin', ONBOARD.column, 7, true],
    ]);
    expect(f.isUnlocked('U0')).toBe(true);
    expect(f.isUnlocked('U2')).toBe(false);
  });

  it('lifts scripted-lode ore to the rusted Headframe and smelts Copper Ingots into the Bin', () => {
    const r = rig();
    buildOnboarding(r);
    const { f, events } = r;
    expect(f.entities().map((e) => e.kind).sort()).toEqual(['autoDrill', 'bin', 'headframe', 'lift', 'smelter']);
    const lift = f.entities().find((e) => e.kind === 'lift');
    expect(lift).toMatchObject({ x: ONBOARD.column, y: 0, h: ONBOARD.top });

    ticks(f, 1_200 * 3);
    const order = events.filter((e) => e.t === 'first-lift-delivery' || e.t === 'first-ingot' || e.t === 'unlock').map((e) => ('rung' in e ? `unlock:${e.rung}` : e.t));
    expect(order).toEqual(['unlock:U2', 'first-lift-delivery', 'first-ingot', 'unlock:U3']);
    expect(events.find((e) => e.t === 'first-ingot')).toEqual({ t: 'first-ingot', item: 'copperIngot' });
    expect(f.stockpileCount('copperIngot')).toBeGreaterThan(0);
    expect(f.inspect(binOf(f))?.contents).toEqual([{ item: 'copperIngot', n: f.stockpileCount('copperIngot') }]);
    expect(f.debug.conservationOk()).toBe(true);
  });

  it('delivers at the Normal Mk I rate: 8 ore/min → 4 ingots/min in steady state', () => {
    const r = rig();
    buildOnboarding(r);
    ticks(r.f, 1_200 * 2);
    const before = r.f.stockpileCount('copperIngot');
    ticks(r.f, 1_200 * 10);
    expect(r.f.stockpileCount('copperIngot') - before).toBeGreaterThanOrEqual(39);
    expect(r.f.stockpileCount('copperIngot') - before).toBeLessThanOrEqual(41);
  });

  it('anchors the lode rock under the drill and not the lift cells', () => {
    const r = rig();
    buildOnboarding(r);
    const { grid } = r;
    const plan = r.f.surveyPlan();
    for (const dx of [0, 1]) expect(grid.hasFlag(plan.drill.x + dx, ONBOARD.top, F.ANCHORED)).toBe(true);
    for (let row = 1; row <= ONBOARD.top - 1; row++) expect(grid.hasFlag(ONBOARD.column, row, F.ANCHORED)).toBe(false);
    expect(grid.occupant[grid.idx(plan.drill.x, ONBOARD.top - 1)]).toBeGreaterThan(0);
    expect(grid.mount[grid.idx(ONBOARD.column, 10)]).toBeGreaterThan(0);
    expect(item('copperOre').underground).toBe(true);
  });
});

describe('factory: on generated worlds (canon §3.2 pass 5)', () => {
  it('places the survey set and accepts the survey plan once the pod has dug and seen it (40 seeds)', () => {
    for (let k = 0; k < 40; k++) {
      const { grid, meta } = generateWorld(Math.imul(k + 3, 0x9e3779b1) >>> 0);
      const f = Factory.create({ grid, wallet: new Wallet(), emit: () => {} }, { scope: 'mvp', surveyColumn: meta.surveyColumn, scriptedLodeId: meta.scriptedLodeId });
      expect(f.entities().map((e) => e.kind)).toEqual(['headframe', 'smelter', 'bin']);
      const plan = f.surveyPlan();
      for (let r = 0; r <= plan.lift.foot; r++) grid.flags[grid.idx(plan.lift.x, r)] |= F.SEEN;
      for (let r = plan.drill.y; r < plan.drill.y + 2; r++) {
        for (let x = plan.drill.x; x < plan.drill.x + 2; x++) {
          grid.terrain[grid.idx(x, r)] = T.AIR;
          grid.flags[grid.idx(x, r)] |= F.SEEN;
        }
      }
      f.discoverLode(meta.scriptedLodeId, true);
      expect(f.canPlaceGhost({ kind: 'lift', ...plan.lift })).toBeNull();
      expect(f.canPlaceGhost({ kind: 'autoDrill', ...plan.drill })).toBeNull();
    }
  });
});
