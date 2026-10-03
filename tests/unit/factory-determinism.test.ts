import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/shared/events';
import { Factory } from '../../src/factory/factory';
import { FactoryLoadError } from '../../src/factory/bytes';
import { ONBOARD, Wallet, buildOnboarding, cloneGrid, rig, type Rig } from './factory.helpers';

/**
 * Every MVP node at once: the onboarding chain into the survey Bin, which unloads (alternating Iron Ingots and
 * Hematite Ore) south into a Router feeding an Assembler (→ Export), a second Smelter (→ Bin) and an Export.
 */
interface Rich {
  r: Rig;
  ids: { surveyBin: number; router: number; assembler: number; export2: number };
}

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

function richFactory(noSleep = false): Rich {
  const r = rig({ yardRows: 16, noSleep });
  buildOnboarding(r);
  const { f } = r;
  f.unlockRung('U3');
  const surveyBin = f.entities().find((e) => e.kind === 'bin')!.id;
  const col = ONBOARD.column + 1;
  must(f.paintBelts([9, 10, 11].map((y) => ({ x: col, y })), 1));
  const router = must(f.place('router', 1, col, 12, 0)).id;
  must(f.paintBelts([col - 1, col - 2, col - 3].map((x) => ({ x, y: 12 })), 1));
  const assembler = must(f.place('assembler', 1, col - 5, 11, 3)).id;
  must(f.setRecipe(assembler, 'A1'));
  must(f.paintBelts([10, 9].map((y) => ({ x: col - 4, y })), 1));
  must(f.place('export', 1, col - 4, 7, 0));
  must(f.paintBelts([col + 1, col + 2, col + 3].map((x) => ({ x, y: 12 })), 1));
  must(f.place('smelter', 1, col + 4, 11, 0));
  must(f.paintBelts([col + 6, col + 7].map((x) => ({ x, y: 12 })), 1));
  must(f.place('bin', 1, col + 8, 11, 0));
  must(f.paintBelts([13, 14].map((y) => ({ x: col, y })), 1));
  const export2 = must(f.place('export', 1, col, 15, 0)).id;
  must(f.stockpilePut([
    { item: 'ironIngot', n: 60 },
    { item: 'hematiteOre', n: 60 },
  ]));
  return { r, ids: { surveyBin, router, assembler, export2 } };
}

/** The scripted command log, applied before tick t runs. */
function commands(x: Rich, t: number): void {
  const { f } = x.r;
  const ids = x.ids;
  if (t % 600 === 0) f.setUnloadFilter(ids.surveyBin, (t / 600) % 2 === 0 ? 'ironIngot' : 'hematiteOre');
  if (t % 1_200 === 0) f.stockpilePut([{ item: 'ironIngot', n: 25 }, { item: 'hematiteOre', n: 25 }]);
  if (t === 3_000) f.setRouterMode(ids.router, 'filter', { primary: 2, filter: 'ironIngot' });
  if (t === 6_000) f.deconstruct(ids.export2);
  if (t === 9_000) ids.export2 = must(f.place('export', 1, ONBOARD.column + 1, 15, 0)).id;
  if (t === 12_000) f.setRouterMode(ids.router, 'overflow');
  if (t === 15_000) f.setRecipe(ids.assembler, null);
  if (t === 16_200) f.setRecipe(ids.assembler, 'A1');
  if (t === 24_000) f.setRouterMode(ids.router, 'even');
}

function run(x: Rich, from: number, to: number, each?: (t: number) => void): void {
  for (let t = from; t < to; t++) {
    commands(x, t);
    x.r.f.tick();
    each?.(t + 1);
  }
}

describe('factory determinism (02 §10.8–10.9, §10.11 #6–7)', () => {
  it('SIM_NO_SLEEP gives identical state hashes every 1,200 ticks over 36,000 ticks', () => {
    const a = richFactory(false);
    const b = richFactory(true);
    const hashes: [number, number][] = [];
    const tick = (t: number): void => {
      if (t % 1_200 === 0) hashes.push([a.r.f.stateHash(), b.r.f.stateHash()]);
    };
    for (let t = 0; t < 36_000; t++) {
      commands(a, t);
      commands(b, t);
      a.r.f.tick();
      b.r.f.tick();
      tick(t + 1);
    }
    expect(hashes).toHaveLength(30);
    for (const [h1, h2] of hashes) expect(h1).toBe(h2);
    expect(a.r.events).toEqual(b.r.events);
    expect(a.r.wallet.cashNow).toBe(b.r.wallet.cashNow);
    // The run did real work: sales, ingots, gears.
    expect(a.r.f.debug.counts.sold).toBeGreaterThan(300);
    expect(a.r.f.debug.conservationOk()).toBe(true);
  });

  it('save at 6,000 + load + 6,000 equals a straight 12,000-tick run', () => {
    const straight = richFactory();
    run(straight, 0, 6_000);
    const bytes = straight.r.f.serialize();
    const grid = cloneGrid(straight.r.grid);
    const cash = straight.r.wallet.cashNow;
    const mark = straight.r.events.length;
    run(straight, 6_000, 12_000);

    const wallet = new Wallet(cash);
    const events: GameEvent[] = [];
    const f2 = Factory.deserialize(bytes, { grid, wallet, emit: (e) => events.push(e) }, { scope: 'mvp', surveyColumn: ONBOARD.column, scriptedLodeId: 0, checkInvariants: true });
    const loaded: Rich = { r: { ...straight.r, f: f2, grid, wallet, events }, ids: { ...straight.ids } };
    run(loaded, 6_000, 12_000);
    expect(f2.stateHash()).toBe(straight.r.f.stateHash());
    expect(wallet.cashNow).toBe(straight.r.wallet.cashNow);
    expect(events).toEqual(straight.r.events.slice(mark));
    expect(f2.serialize()).toEqual(straight.r.f.serialize());
  });

  it('restores the derived grid layers: mount, occupant and ANCHORED match the saved world', () => {
    const x = richFactory();
    run(x, 0, 2_000);
    const grid = cloneGrid(x.r.grid);
    Factory.deserialize(x.r.f.serialize(), { grid, wallet: new Wallet(), emit: () => {} }, { scope: 'mvp', surveyColumn: ONBOARD.column, scriptedLodeId: 0 });
    expect(grid.mount).toEqual(x.r.grid.mount);
    expect(grid.occupant).toEqual(x.r.grid.occupant);
    expect(grid.flags).toEqual(x.r.grid.flags);
  });

  it('matches the golden hash: scripted command log, 36,000 ticks', () => {
    const x = richFactory();
    run(x, 0, 36_000);
    expect(x.r.f.tickNo).toBe(36_000);
    expect(x.r.f.stateHash()).toBe(GOLDEN_HASH);
    expect(x.r.f.debug.counts).toEqual({ imported: 1_470, produced: 358, sold: 1_283, consumed: 231, taken: 0, scrapped: 0 });
  });

  it('rejects corrupted saves with FactoryLoadError, never another exception', () => {
    const x = richFactory();
    run(x, 0, 1_500);
    const good = x.r.f.serialize();
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(good.length - 1), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 4 }), fc.nat(good.length), (flips, cut) => {
        const bad = good.slice(0, Math.max(2, cut));
        for (const [i, v] of flips) if (i < bad.length) bad[i] = v;
        try {
          Factory.deserialize(bad, { grid: cloneGrid(x.r.grid), wallet: new Wallet(), emit: () => {} }, { scope: 'mvp', surveyColumn: ONBOARD.column, scriptedLodeId: 0 });
        } catch (e) {
          if (!(e instanceof FactoryLoadError)) throw e;
        }
      }),
      { numRuns: 400 },
    );
  });
});

/** Recorded from this implementation; a change means the simulation's behaviour changed (02 §10.11 #7). */
const GOLDEN_HASH = 634_807_420;
