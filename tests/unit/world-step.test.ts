// World integration: scripted intents through the real generator, pod and economy (canon §2.4, §3.8, §4.2;
// 01 §2.2, §3.10).
import { describe, expect, it } from 'vitest';
import { NO_INTENT, type PodIntent } from '../../src/pod/types';
import { COOP_CREDIT_COOLDOWN_STEPS, MINE_W, PAD_NEUTRAL_STEPS, POD_H, START_CASH, STEP_HZ } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import { F, T, mineralCode, type Scope } from '../../src/shared/types';
import { World } from '../../src/world/world';

const intent = (p: Partial<PodIntent>): PodIntent => ({ ...NO_INTENT, ...p });
const DOWN = intent({ sy: -1 });
const UP = intent({ sy: 1 });
const LEFT = intent({ sx: -1 });
const RIGHT = intent({ sx: 1 });
const COPPER = mineralCode(2);
const SHAFT_X = 7;

function newWorld(scope: Scope = 'm0', seed = 7): World {
  return new World({ seed, scope });
}

/** Step with `input` until `done` (checked after each step); collects events. Fails after `max` steps. */
function stepUntil(w: World, input: PodIntent, done: (w: World) => boolean, max = 3_000): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < max; i++) {
    w.step(input, true);
    out.push(...w.drainEvents());
    if (done(w)) return out;
  }
  throw new Error(`stepUntil: condition not met in ${max} steps (pod ${w.pod.x.toFixed(2)}, ${w.pod.y.toFixed(2)})`);
}

function run(w: World, input: PodIntent, n: number, podRunning = true): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    w.step(input, podRunning);
    out.push(...w.drainEvents());
  }
  return out;
}

const ofType = <K extends GameEvent['t']>(events: GameEvent[], t: K) => events.filter((e): e is Extract<GameEvent, { t: K }> => e.t === t);
const onRim = (w: World) => w.pod.grounded && w.pod.y > 0;

/** Column x: rows 1..ores.length hold `ores`, solid dirt walls either side and a dirt floor below. */
function prepareColumn(w: World, x: number, ores: number[]): void {
  const g = w.terrain;
  for (let r = 1; r <= ores.length + 2; r++) {
    g.set(x - 1, r, T.DIRT);
    g.set(x + 1, r, T.DIRT);
    g.set(x, r, r <= ores.length ? ores[r - 1] : T.DIRT);
  }
}

/** Dig straight down from the Rim until the pod stands in row `row`. */
function digTo(w: World, row: number): GameEvent[] {
  return stepUntil(w, DOWN, (w) => w.pod.row >= row && w.pod.dig === null && w.pod.grounded);
}

/** Thrust out of the shaft, drift right, brake and settle on the Rim short of the Assay pad. */
function flyHome(w: World): GameEvent[] {
  const startX = w.pod.x;
  return [
    ...stepUntil(w, UP, (w) => w.pod.y > 1.2),
    ...stepUntil(w, intent({ sx: 1, sy: 0.6 }), (w) => w.pod.x > startX + 1.1),
    ...stepUntil(w, intent({ sx: -1, sy: 0.6 }), (w) => w.pod.vx <= 0),
    ...stepUntil(w, NO_INTENT, onRim),
  ];
}

/** Drive along the Rim toward `x`, then let go and wait for the pad to fire. */
function driveToPad(w: World, x: number): GameEvent[] {
  const dir = x > w.pod.x ? RIGHT : LEFT;
  const reached = (w: World) => (dir === RIGHT ? w.pod.x >= x : w.pod.x <= x);
  return [...stepUntil(w, dir, reached), ...run(w, NO_INTENT, 120)];
}

describe('World basics', () => {
  it('starts with canon values and a generated world', () => {
    const w = newWorld();
    expect(w.wallet).toEqual({ cash: START_CASH, debt: 0, lifetimeEarned: 0 });
    expect(w.pod.x).toBe(SHAFT_X + 0.5);
    expect(w.terrain.lodes).toHaveLength(23);
    expect(w.stepNo).toBe(0);
    expect(w.stats()).toMatchObject({ maxFuel: 10, maxHull: 10, baySlots: 7, digSteps: 29 });
    expect(w.drainEvents()).toEqual([]);
  });

  it('counts steps whether or not the pod runs; a paused pod does not move', () => {
    const w = newWorld();
    run(w, RIGHT, 10);
    const x = w.pod.x;
    run(w, RIGHT, 50, false);
    expect(w.pod.x).toBe(x);
    expect(w.pod.prevX).toBe(x);
    expect(w.stepNo).toBe(60);
  });

  it('drainEvents returns and clears', () => {
    const w = newWorld();
    run(w, LEFT, 1);
    w.step(LEFT, true);
    w.buyFuel(1);
    const first = w.drainEvents();
    expect(first.some((e) => e.t === 'purchase')).toBe(true);
    expect(w.drainEvents()).toEqual([]);
  });
});

describe('a trip: dig, return, sell, upgrade', () => {
  it('digs a column of Copper, ends one trip, sells at the Assay and buys a Drill', () => {
    const w = newWorld();
    prepareColumn(w, SHAFT_X, [COPPER, COPPER, COPPER, COPPER]);

    const down = digTo(w, 4);
    expect(w.pod.cargo).toEqual(Array.from({ length: 4 }, () => ({ kind: 'mineral', tier: 2 })));
    expect(ofType(down, 'collect')).toHaveLength(4);
    expect(ofType(down, 'left-rim')).toHaveLength(1);
    expect(ofType(down, 'depth-record').map((e) => e.row)).toEqual([1, 2, 3, 4]);
    expect(w.story).toMatchObject({ deepestRow: 4, tripDeepestRow: 4, underground: true, trips: 0 });
    expect(w.terrain.get(SHAFT_X, 3)).toBe(T.AIR);
    expect(w.terrain.hasFlag(SHAFT_X, 3, F.DUG)).toBe(true);

    const home = flyHome(w);
    expect(w.padUnderPod()).toBeNull();
    expect(ofType(home, 'trip-end')).toEqual([{ t: 'trip-end', trip: 1, deepestRow: 4 }]);
    expect(w.story).toMatchObject({ trips: 1, tripDeepestRow: 0, underground: false, deepestRow: 4 });
    expect(ofType(run(w, NO_INTENT, 300), 'trip-end')).toHaveLength(0);

    const arrive = driveToPad(w, 10.3);
    expect(ofType(arrive, 'pad-arrive')).toEqual([{ t: 'pad-arrive', id: 'assay' }]);
    expect(w.padUnderPod()).toBe('assay');
    expect(w.cargoValue()).toBe(240);
    expect(w.sellAll()).toMatchObject({ ok: true, amount: 240 });
    expect(w.wallet.cash).toBe(START_CASH + 240);
    expect(w.pod.cargo).toEqual([]);

    expect(w.buyUpgrade('drill', 2)).toEqual({ ok: false, reason: 'Need $490 more' });
    w.debugGiveCash(1_000);
    expect(w.buyUpgrade('drill', 2)).toMatchObject({ ok: true });
    expect(w.stats().digSteps).toBe(20);
    expect(w.garageCards()[0]).toMatchObject({ installedTier: 2, tier: 3 });
  });
});

describe('incentives (canon §3.8)', () => {
  it('pays r40 and r80 once each on first reach', () => {
    const w = newWorld();
    w.debugTeleport(45);
    const a = run(w, NO_INTENT, 1);
    expect(ofType(a, 'incentive')).toEqual([{ t: 'incentive', row: 40, ft: 500, cash: 1_000 }]);
    expect(w.wallet.cash).toBe(START_CASH + 1_000);
    expect(w.wallet.lifetimeEarned).toBe(1_000);

    w.debugTeleport(45);
    expect(ofType(run(w, NO_INTENT, 1), 'incentive')).toEqual([]);
    w.debugTeleport(85);
    expect(ofType(run(w, NO_INTENT, 1), 'incentive')).toEqual([{ t: 'incentive', row: 80, ft: 1_000, cash: 3_000 }]);
    w.debugTeleport(100);
    expect(ofType(run(w, NO_INTENT, 60), 'incentive')).toEqual([]);
    expect(w.story.incentivesPaid).toEqual([40, 80]);
  });

  it('the r280 incentive needs a scope that reaches it', () => {
    const m0 = newWorld('m0');
    m0.debugTeleport(300);
    expect(m0.pod.row).toBe(127);
    expect(ofType(run(m0, NO_INTENT, 1), 'incentive').map((e) => e.row)).toEqual([40, 80]);

    const mvp = newWorld('mvp');
    mvp.debugTeleport(290);
    expect(ofType(run(mvp, NO_INTENT, 1), 'incentive').map((e) => e.row)).toEqual([40, 80, 280]);
    expect(mvp.wallet.cash).toBe(START_CASH + 29_000);
  });
});

describe('trades need a live pod grounded on the Rim (canon §2.4; 01 §3.10)', () => {
  it('refuses buys and sales in the sky, in a surface hole and for a wreck; quotes still answer', () => {
    const w = newWorld();
    w.debugGiveCash(10_000);
    w.pod.cargo.push({ kind: 'mineral', tier: 2 });
    w.pod.hull = 6;
    const tryAll = () => [w.buyFuel('fill'), w.sellAll(), w.repairAll(), w.buyUpgrade('drill', 2), w.buyConsumable('jerrycan', 1)];
    const refusedAll = (reason: string) => Array.from({ length: 5 }, () => ({ ok: false, reason }));

    stepUntil(w, intent({ thrust: true }), (w) => w.pod.y > 2);
    const cash = w.wallet.cash;
    const fuel = w.pod.fuel;
    w.drainEvents();
    expect(tryAll()).toEqual(refusedAll('Land on the Rim first'));
    expect(w.wallet.cash).toBe(cash);
    expect(w.pod).toMatchObject({ fuel, hull: 6, cargo: [{ kind: 'mineral', tier: 2 }] });
    expect(w.drainEvents()).toEqual([]);
    expect(w.fuelQuote('fill').amount).toBeGreaterThan(0);
    expect(w.repairQuote().amount).toBeGreaterThan(0);

    stepUntil(w, NO_INTENT, onRim, 600);
    stepUntil(w, DOWN, (w) => w.pod.y < 0 && w.pod.grounded && w.pod.dig === null); // into a row-0 hole
    expect(tryAll()).toEqual(refusedAll('Land on the Rim first'));

    w.pod.hull = 0;
    run(w, NO_INTENT, 1);
    expect(w.pod.destroyed).toBe(true);
    expect(tryAll()).toEqual(refusedAll('Salvage first'));

    w.respawn();
    expect(w.buyFuel(1)).toEqual({ ok: false, reason: 'Tank is already full' });
    expect(w.buyConsumable('jerrycan', 1)).toMatchObject({ ok: true });
    expect(w.buyUpgrade('drill', 2)).toMatchObject({ ok: true });
  });
});

describe('Rim pads (canon §2.4)', () => {
  it('arrive, stay shut after the sheet closes, re-arm after leaving the footprint', () => {
    const w = newWorld();
    const first = driveToPad(w, 4.6);
    expect(ofType(first, 'pad-arrive')).toEqual([{ t: 'pad-arrive', id: 'pump' }]);
    expect(w.isPadArmed('pump')).toBe(false);

    run(w, NO_INTENT, 90, false); // the sheet is open: pod paused
    w.sheetClosed('pump');
    expect(ofType(run(w, NO_INTENT, 300), 'pad-arrive')).toEqual([]);

    stepUntil(w, RIGHT, (w) => w.pod.x > 5.6);
    const again = driveToPad(w, 4.6);
    expect(ofType(again, 'pad-arrive')).toEqual([{ t: 'pad-arrive', id: 'pump' }]);
  });

  it('driving across a pad without letting go never opens it', () => {
    const w = newWorld();
    const ev = stepUntil(w, RIGHT, (w) => w.pod.x > 15);
    expect(ofType(ev, 'pad-arrive')).toEqual([]);
  });

  it('a sheet opened by sign tap then closed keeps the pad disarmed', () => {
    const w = newWorld();
    stepUntil(w, LEFT, (w) => w.pod.x <= 4.6);
    run(w, NO_INTENT, 3);
    w.sheetClosed('pump');
    expect(ofType(run(w, NO_INTENT, 300), 'pad-arrive')).toEqual([]);
  });

  it('flying ≥ 0.2 s re-arms the pad under the pod', () => {
    const w = newWorld();
    driveToPad(w, 4.6);
    const x = w.pod.x;
    stepUntil(w, UP, (w) => w.pod.y > 2);
    const ev = stepUntil(w, NO_INTENT, onRim, 600);
    expect(Math.abs(w.pod.x - x)).toBeLessThan(0.5);
    ev.push(...run(w, NO_INTENT, PAD_NEUTRAL_STEPS + 2));
    expect(ofType(ev, 'pad-arrive')).toEqual([{ t: 'pad-arrive', id: 'pump' }]);
  });
});

describe('Co-op Credit (canon §2.1, §3.8; MVP, canon §5.5)', () => {
  it('free 5 L on arrival when broke and dry, once per 10 min', () => {
    const w = newWorld('mvp');
    w.wallet.cash = 3;
    w.pod.fuel = 1.5;
    const ev = driveToPad(w, 4.6);
    const credit = ofType(ev, 'coop-credit');
    expect(credit).toEqual([{ t: 'coop-credit', liters: 5 }]);
    expect(w.pod.fuel).toBeGreaterThan(6);
    expect(ev.findIndex((e) => e.t === 'pad-arrive')).toBeLessThan(ev.findIndex((e) => e.t === 'coop-credit'));

    const leaveAndReturn = () => {
      stepUntil(w, RIGHT, (w) => w.pod.x > 6);
      return driveToPad(w, 4.6);
    };
    w.pod.fuel = 1.5;
    const again = leaveAndReturn();
    expect(ofType(again, 'pad-arrive')).toHaveLength(1);
    expect(ofType(again, 'coop-credit')).toEqual([]);

    run(w, NO_INTENT, COOP_CREDIT_COOLDOWN_STEPS, false);
    w.pod.fuel = 1.5;
    expect(ofType(leaveAndReturn(), 'coop-credit')).toHaveLength(1);
  });

  it('not when the player can pay', () => {
    const w = newWorld('mvp');
    w.pod.fuel = 1.5;
    expect(ofType(driveToPad(w, 4.6), 'coop-credit')).toEqual([]);
  });

  it('not in the M0 build (INT-10)', () => {
    const w = newWorld('m0');
    w.wallet.cash = 3;
    w.pod.fuel = 1.5;
    const ev = driveToPad(w, 4.6);
    expect(ofType(ev, 'pad-arrive')).toHaveLength(1);
    expect(ofType(ev, 'coop-credit')).toEqual([]);
  });
});

describe('destruction and respawn (canon §4.2)', () => {
  it('fuel 0 destroys; respawn charges the fee, books the shortfall as debt and lands disarmed', () => {
    const w = newWorld();
    prepareColumn(w, SHAFT_X, [COPPER, COPPER, COPPER]);
    digTo(w, 3);
    w.pod.fuel = 0.02;
    const ev = stepUntil(w, UP, (w) => w.pod.destroyed, 600);
    expect(ofType(ev, 'destroyed')).toEqual([{ t: 'destroyed', cause: 'fuel' }]);
    expect(w.story.destructions).toBe(1);
    const y = w.pod.y;
    expect(run(w, UP, 60)).toEqual([]);
    expect(w.pod.y).toBe(y);

    const r = w.respawn();
    expect(r).toEqual({ fee: 25, debt: 5, lost: [{ kind: 'mineral', tier: 2 }, { kind: 'mineral', tier: 2 }, { kind: 'mineral', tier: 2 }] });
    expect(w.wallet).toMatchObject({ cash: 0, debt: 5 });
    expect(w.pod).toMatchObject({ destroyed: false, fuel: 10, hull: 10, cargo: [], grounded: true, vx: 0, vy: 0, dig: null });
    expect(w.padUnderPod()).toBe('pump');
    expect(w.drainEvents()).toEqual([{ t: 'respawned', fee: 25, debt: 5, lost: r.lost }]);

    const after = run(w, NO_INTENT, 300);
    expect(ofType(after, 'pad-arrive')).toEqual([]);
    expect(ofType(after, 'trip-end')).toEqual([]);
    expect(w.story.underground).toBe(false);

    w.pod.cargo.push({ kind: 'mineral', tier: 1 });
    w.sellAll();
    expect(w.wallet).toMatchObject({ cash: 25, debt: 0 });
  });

  it('a save made during the death card restores a wreck that reports itself once, on the first running step', () => {
    const w = newWorld();
    prepareColumn(w, SHAFT_X, [COPPER, COPPER, COPPER]);
    digTo(w, 3);
    w.pod.fuel = 0.02;
    stepUntil(w, UP, (w) => w.pod.destroyed, 600);
    const cash = w.wallet.cash;

    const r = World.deserialize(w.serialize());
    expect(r.pod.destroyed).toBe(true);
    const y = r.pod.y;
    expect(run(r, UP, 120, false)).toEqual([]); // behind the title / resume gate: nothing yet
    expect(run(r, UP, 1)).toEqual([{ t: 'destroyed', cause: 'fuel' }]);
    expect(run(r, UP, 600)).toEqual([]); // reported once; the wreck stays put until salvage
    expect(r.pod.y).toBe(y);
    expect(r.story.destructions).toBe(1);

    const fee = r.respawn();
    expect(fee).toMatchObject({ fee: 25, debt: 25 - cash });
    expect(r.pod).toMatchObject({ destroyed: false, fuel: 10, cargo: [] });
    expect(r.padUnderPod()).toBe('pump');
    r.drainEvents();
    expect(ofType(run(r, NO_INTENT, 300), 'destroyed')).toEqual([]);
  });

  it('a restored hull wreck reports cause hull; a live save never reports a death', () => {
    const w = newWorld();
    w.pod.hull = 0;
    expect(ofType(run(w, NO_INTENT, 1), 'destroyed')).toEqual([{ t: 'destroyed', cause: 'hull' }]);
    expect(run(World.deserialize(w.serialize()), NO_INTENT, 1)).toEqual([{ t: 'destroyed', cause: 'hull' }]);
    expect(ofType(run(World.deserialize(newWorld().serialize()), NO_INTENT, 60), 'destroyed')).toEqual([]);
  });

  it('the fee scales with installed tiers', () => {
    const w = newWorld('mvp');
    for (const line of ['drill', 'hull', 'engine', 'tank', 'bay'] as const) w.debugSetTier(line, 2);
    w.debugGiveCash(1_000);
    expect(w.respawn()).toMatchObject({ fee: 300, debt: 0 });
    expect(w.wallet.cash).toBe(START_CASH + 1_000 - 300);
  });
});

describe('Homing Beacon (01 §3.9)', () => {
  it('lands on the Pump House pad disarmed and ends the trip', () => {
    const w = newWorld();
    w.debugGiveCash(10_000);
    expect(w.buyConsumable('homingBeacon', 1)).toMatchObject({ ok: true });
    w.setQuickSlot(0, 'homingBeacon');
    w.debugTeleport(20);
    stepUntil(w, NO_INTENT, (w) => w.pod.grounded);
    const ev = run(w, intent({ fireSlot: 0 }), 1);
    expect(ofType(ev, 'teleport')).toHaveLength(1);
    expect(ofType(ev, 'trip-end')).toHaveLength(1);
    expect(w.padUnderPod()).toBe('pump');
    expect(ofType(run(w, NO_INTENT, 120), 'pad-arrive')).toEqual([]);
  });
});

describe('debug commands', () => {
  it('debugTeleport carves a 1×1 cell near x 7, never in the open survey shaft, and lands grounded (INT-12)', () => {
    const w = newWorld();
    w.debugTeleport(10);
    expect(Math.floor(w.pod.x)).not.toBe(w.meta.surveyColumn);
    expect(w.pod.row).toBe(10);
    expect(w.pod.y).toBe(-(10 + 1) + POD_H / 2);
    expect(w.pod.grounded).toBe(true);
    expect(w.terrain.get(Math.floor(w.pod.x), 11)).not.toBe(T.AIR);
    const hull = w.pod.hull;
    const ev = run(w, NO_INTENT, 120);
    expect(ofType(ev, 'damage')).toEqual([]);
    expect(w.pod.row).toBe(10);
    expect(w.pod.hull).toBe(hull);

    w.debugTeleport(90);
    const x = Math.floor(w.pod.x);
    expect(w.terrain.get(x, 90)).toBe(T.AIR);
    expect(w.terrain.lodeAt(x, 90)).toBeNull();
    expect(Math.abs(x - SHAFT_X)).toBeLessThan(MINE_W);
    expect(w.pod.dig).toBeNull();
  });

  it('debugSetTier ignores tiers that do not exist', () => {
    const w = newWorld();
    w.debugSetTier('radiator', 2);
    expect(w.pod.tiers.radiator).toBe(1);
    w.debugSetTier('tank', 3);
    expect(w.stats().maxFuel).toBe(25);
  });

  it('debugGiveCash never goes negative', () => {
    const w = newWorld();
    w.debugGiveCash(-1_000);
    expect(w.wallet.cash).toBe(0);
  });
});

describe('factory phase', () => {
  it('steps at 60 Hz regardless of frame rate (stepNo is the clock)', () => {
    const w = newWorld();
    run(w, NO_INTENT, STEP_HZ);
    expect(w.stepNo).toBe(STEP_HZ);
  });
});
