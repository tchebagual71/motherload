// Pod creation, derived stats, fuel/hull rules, destruction and sensing.
import { describe, expect, it } from 'vitest';
import {
  cargoMass,
  cargoSlotsUsed,
  createPod,
  deepHeatFactor,
  isTooHeavy,
  podStats,
  returnTickLiters,
  stepPod,
} from '../../src/pod';
import { TAN_LEAVE, nextSector } from '../../src/pod/sector';
import {
  DEFAULT_QUICK_SLOTS,
  DIG_HYSTERESIS_DEG,
  FUEL_MOVE_K,
  MINE_W,
  POD_H,
  START_FUEL,
  START_HULL,
  START_X,
  STEP,
} from '../../src/shared/canon';
import { F, T } from '../../src/shared/types';
import { addLode, carve, intent, makeCtx, ofType, podAt, run, shaftGrid, solidGrid } from './pod.helpers';

describe('createPod', () => {
  it('starts on the Rim at x 7 with canon start values (canon §3.6)', () => {
    const p = createPod();
    expect(p.x).toBe(START_X + 0.5);
    expect(p.y).toBe(POD_H / 2);
    expect(p.grounded).toBe(true);
    expect(p.fuel).toBe(START_FUEL);
    expect(p.hull).toBe(START_HULL);
    expect(Object.values(p.tiers)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(Object.values(p.consumables).every((n) => n === 0)).toBe(true);
    expect(Object.keys(p.consumables)).toHaveLength(6);
    expect(p.quickSlots).toEqual(DEFAULT_QUICK_SLOTS);
    expect(p.quickSlots).not.toBe(DEFAULT_QUICK_SLOTS);
    expect(p.cargo).toEqual([]);
    expect(p.destroyed).toBe(false);
  });

  it('stands still on a generated-style Rim', () => {
    const g = solidGrid();
    const p = createPod();
    run(p, g, 120);
    expect(p.y).toBe(POD_H / 2);
    expect(p.x).toBe(START_X + 0.5);
    expect(p.fuel).toBe(START_FUEL); // idle burns nothing
    expect(p.row).toBe(0);
  });
});

describe('podStats (canon §2.6)', () => {
  it('reads tier tables; missing tiers fall back to the nearest lower one', () => {
    const p = createPod();
    expect(podStats(p)).toEqual({
      maxFuel: 10,
      maxHull: 10,
      engineHp: 150,
      hoverCap: 100,
      vUp: 7,
      digSteps: 29,
      radiator: 1,
      baySlots: 7,
      slotsUsed: 0,
      cargoMass: 0,
      scannerLodeRadius: 1,
    });
    p.tiers = { drill: 7, hull: 7, engine: 7, tank: 7, radiator: 2, bay: 7, scanner: 4 };
    const s = podStats(p);
    expect(s.digSteps).toBe(5);
    expect(s.maxHull).toBe(180);
    expect(s.radiator).toBe(1); // no t2 radiator → Desk Fan
    expect(s.baySlots).toBe(120); // no t7 bay → Freight Hold
    expect(s.scannerLodeRadius).toBe(6); // no t4 scanner → Dowser
    p.tiers.scanner = 2;
    expect(podStats(p).scannerLodeRadius).toBe(1);
  });

  it('cargo mass: minerals by tier, relics 1, Kits per canon §4.8; slots with Depot Kit = 2', () => {
    const cargo = [
      { kind: 'mineral' as const, tier: 10 },
      { kind: 'mineral' as const, tier: 4 },
      { kind: 'relic' as const, id: 2 },
      { kind: 'kit' as const, id: 'autoDrill' },
      { kind: 'kit' as const, id: 'liftFoot' },
      { kind: 'kit' as const, id: 'liftRail' },
      { kind: 'kit' as const, id: 'belt' },
      { kind: 'kit' as const, id: 'belt' },
      { kind: 'kit' as const, id: 'depot' },
    ];
    expect(cargoMass(cargo)).toBe(12 + 2 + 1 + 14 + 20); // Starter Kit = 14 mu (canon §2.1)
    expect(cargoSlotsUsed(cargo)).toBe(10);
  });

  it('TOO HEAVY at m ≥ hover cap', () => {
    const p = createPod();
    p.cargo = Array.from({ length: 50 }, () => ({ kind: 'mineral' as const, tier: 4 }));
    expect(isTooHeavy(p)).toBe(true);
    p.cargo.pop();
    expect(isTooHeavy(p)).toBe(false);
  });
});

describe('fuel (canon §3.6, §4.4; 01 §3.5)', () => {
  it('moving burn is 0.00084·P·max(s_t, |s_x|) L/s; idle burns 0', () => {
    const g = solidGrid();
    const p = podAt(10, -1);
    const f0 = p.fuel;
    run(p, g, 1, intent({ sx: 0.5 }));
    expect(f0 - p.fuel).toBeCloseTo(FUEL_MOVE_K * 150 * 0.5 * STEP, 12);
  });

  it('Deep Heat: ×1.0 at r129, ×1.25 at r209, ×1.5 from r289', () => {
    expect(deepHeatFactor(0)).toBe(1);
    expect(deepHeatFactor(129)).toBeCloseTo(1, 3);
    expect(deepHeatFactor(209)).toBeCloseTo(1.25, 3);
    expect(deepHeatFactor(289)).toBe(1.5);
    expect(deepHeatFactor(500)).toBe(1.5);
  });

  it('Deep Heat scales the burn by heat(row) when the flag is on', () => {
    const run1 = (deepHeat: boolean) => {
      const g = shaftGrid(10, 300);
      const p = podAt(10, 209, (q) => (q.row = 209));
      const f0 = p.fuel;
      run(p, g, 1, intent({ thrust: true }), makeCtx({ deepHeat }));
      return f0 - p.fuel;
    };
    expect(run1(true) / run1(false)).toBeCloseTo(1.25, 3);
  });

  it('Return Tick example: r200, t3 engine, 50% load → 7.40 ± 0.05 L', () => {
    const p = createPod();
    p.tiers.engine = 3;
    p.cargo = Array.from({ length: 80 }, () => ({ kind: 'mineral' as const, tier: 1 }));
    p.row = 200;
    expect(Math.abs(returnTickLiters(p, false) - 7.4)).toBeLessThan(0.05);
    expect(returnTickLiters(p, true)).toBeGreaterThan(7.4);
    p.cargo.push(...p.cargo);
    expect(returnTickLiters(p, false)).toBe(Infinity);
  });

  it('fuel warnings at 20/10/5% once each, re-armed by refuelling', () => {
    const g = solidGrid();
    const p = podAt(10, -1, (q) => (q.fuel = 2.05)); // 20.5% of the 10 L Thimble; full drive burns 0.126 L/s
    const ev = run(p, g, 800, intent({ sx: 1 }));
    expect(ofType(ev, 'fuel-warning').map((e) => e.level)).toEqual([0, 1, 2]);
    expect(p.destroyed).toBe(false);
    p.fuel = 1.9; // refuelled above 10% (Pump House or Jerrycan)
    const again = run(p, g, 700, intent({ sx: 1 }));
    expect(ofType(again, 'fuel-warning').map((e) => e.level)).toEqual([1, 2]);
  });

  it('fuel 0 destroys the pod once; stepPod is then a no-op', () => {
    const g = solidGrid();
    const p = podAt(10, -1, (q) => (q.fuel = 0.01));
    const ev = run(p, g, 600, intent({ thrust: true }));
    expect(ofType(ev, 'destroyed')).toEqual([{ t: 'destroyed', cause: 'fuel' }]);
    expect(p.destroyed).toBe(true);
    expect(p.fuel).toBe(0);
    const frozen = JSON.stringify(p);
    expect(run(p, g, 60, intent({ thrust: true }))).toEqual([]);
    expect(JSON.stringify(p)).toBe(frozen);
  });
});

describe('hull', () => {
  it('hull warning below 25%, once until repaired; hull ≤ 0 destroys', () => {
    const g = shaftGrid(10, 300);
    const p = podAt(10, 300, (q) => {
      q.y = q.prevY = -301 + POD_H / 2 + 100; // 100-row fall → 8 HP
      q.grounded = false;
    });
    const ev = run(p, g, 600);
    expect(p.hull).toBe(2);
    expect(ofType(ev, 'hull-warning')).toHaveLength(1);
    expect(ofType(ev, 'landed').length).toBeGreaterThanOrEqual(1);
    p.y = p.prevY = -301 + POD_H / 2 + 100;
    p.grounded = false;
    const fatal = run(p, g, 600);
    expect(ofType(fatal, 'hull-warning')).toHaveLength(0);
    expect(ofType(fatal, 'destroyed')).toEqual([{ t: 'destroyed', cause: 'hull' }]);
    expect(p.hull).toBe(0);
  });
});

describe('sectors (canon §3.6: 90° sectors, ±10° hysteresis)', () => {
  const at = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)] as const;

  it('TAN_LEAVE is tan(45° + hysteresis)', () => {
    expect(TAN_LEAVE).toBeCloseTo(Math.tan(((45 + DIG_HYSTERESIS_DEG) * Math.PI) / 180), 12);
  });

  it('enters by 90° sectors and holds a sector to ±55°', () => {
    expect(nextSector(0, 0, 'down')).toBe('none');
    expect(nextSector(...at(10), 'none')).toBe('right');
    expect(nextSector(...at(80), 'none')).toBe('up');
    expect(nextSector(...at(200), 'none')).toBe('left');
    expect(nextSector(...at(260), 'none')).toBe('down');
    expect(nextSector(...at(-40), 'none')).toBe('right');
    expect(nextSector(...at(-50), 'none')).toBe('down');
    expect(nextSector(...at(-50), 'right')).toBe('right');
    expect(nextSector(...at(-56), 'right')).toBe('down');
    expect(nextSector(...at(50), 'right')).toBe('right');
    expect(nextSector(...at(40), 'up')).toBe('up');
    expect(nextSector(...at(34), 'up')).toBe('right');
    expect(nextSector(...at(220), 'down')).toBe('down');
    expect(nextSector(...at(214), 'down')).toBe('left');
  });
});

describe('sensing', () => {
  it('marks SEEN in the 4.5-tile bubble and CHARTED within 8 tiles of the pod cell', () => {
    const g = solidGrid();
    carve(g, 20, 20, 20, 40);
    const p = podAt(20, 30);
    run(p, g, 1);
    expect(g.hasFlag(20, 30, F.SEEN)).toBe(true);
    expect(g.hasFlag(24, 30, F.SEEN)).toBe(true);
    expect(g.hasFlag(25, 30, F.SEEN)).toBe(false);
    expect(g.hasFlag(23, 33, F.SEEN)).toBe(true); // 3² + 3² ≤ 4.5²
    expect(g.hasFlag(24, 34, F.SEEN)).toBe(false);
    expect(g.hasFlag(28, 38, F.CHARTED)).toBe(true);
    expect(g.hasFlag(29, 30, F.CHARTED)).toBe(false);
    expect(g.hasFlag(20, 39, F.CHARTED)).toBe(false);
  });

  it('re-reveals only when the pod changes cell', () => {
    const g = solidGrid();
    carve(g, 20, 30, 20, 30);
    const p = podAt(20, 30);
    run(p, g, 1);
    const v = g.version;
    run(p, g, 30);
    expect(g.version).toBe(v);
  });

  it('discovers a lode within the Scanner radius (Tin Ear = 8 neighbours); seams never', () => {
    const g = solidGrid();
    carve(g, 5, 10, 30, 10);
    const near = addLode(g, 14, 11); // directly under x 14–16
    const seam = addLode(g, 20, 11, 'v1');
    const p = podAt(10, 10);
    const ctx = makeCtx({ scope: 'mvp' });
    const out: Parameters<typeof stepPod>[4] = [];
    let at = -1;
    for (let i = 0; i < 400 && p.x < 28; i++) {
      stepPod(p, g, intent({ sx: 0.3 }), ctx, out);
      if (at < 0 && near.discovered) at = Math.floor(p.x);
    }
    expect(at).toBe(13); // one column before the lode: Chebyshev 1
    expect(ofType(out, 'lode-discovered')).toEqual([{ t: 'lode-discovered', lodeId: near.id }]);
    expect(seam.discovered).toBe(false);
  });

  it('a Dowser (radius 6) discovers from further away', () => {
    const g = solidGrid();
    carve(g, 5, 10, 30, 10);
    const lode = addLode(g, 20, 16);
    const p = podAt(14, 10, (q) => (q.tiers.scanner = 3));
    run(p, g, 1);
    expect(lode.discovered).toBe(true);
    expect(g.lodeAt(21, 17)).toBe(lode);
    expect(g.get(21, 17)).toBe(T.LODE_ROCK);
    expect(MINE_W).toBe(48);
  });
});
