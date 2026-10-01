// Digging (canon §3.6, 01 §3.4), hazards (canon §3.3) and cargo (canon §3.7).
import { describe, expect, it } from 'vitest';
import { classifyDigTarget, forcedFloorRow, stepPod } from '../../src/pod';
import { DIG_ENGAGE_STEPS, MAGMA_HIT, MAGMA_HIT_GAP_STEPS, MINE_W, POD_H, SEAL_ROW, methaneDamage } from '../../src/shared/canon';
import { F, T, mineralCode, relicCode } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/events';
import { addLode, carve, DOWN, fill, intent, LEFT, makeCtx, ofType, podAt, RIGHT, run, solidGrid, UP } from './pod.helpers';

describe('dig engage (canon §3.6)', () => {
  it('no dig in < 7 steps of pushing; the 7th step starts it', () => {
    const g = solidGrid();
    const p = podAt(10, 5);
    expect(ofType(run(p, g, DIG_ENGAGE_STEPS - 1, DOWN), 'dig-start')).toHaveLength(0);
    run(p, g, 3); // release resets the engage counter
    expect(ofType(run(p, g, DIG_ENGAGE_STEPS - 1, DOWN), 'dig-start')).toHaveLength(0);
    const ev = run(p, g, 1, DOWN);
    expect(ofType(ev, 'dig-start')).toEqual([{ t: 'dig-start', x: 10, r: 6, code: T.DIRT }]);
  });

  it('a weak push (m′ < 0.45) never digs', () => {
    const g = solidGrid();
    const p = podAt(10, 5);
    expect(ofType(run(p, g, 60, intent({ sy: -0.44 })), 'dig-start')).toHaveLength(0);
  });

  it('never digs upward, even pushing up under a ceiling', () => {
    const g = solidGrid();
    carve(g, 10, 5, 10, 5); // a one-cell pocket
    const p = podAt(10, 5);
    const ev = [
      ...run(p, g, 120, UP),
      ...run(p, g, 120, intent({ sx: 0.5, sy: 0.9 })),
      ...run(p, g, 120, intent({ sx: -0.5, sy: 0.9 })),
    ];
    expect(ofType(ev, 'dig-start')).toHaveLength(0);
    expect(g.get(10, 4)).toBe(T.DIRT);
  });

  it('digs left and right only when touching the wall, and faces the dig', () => {
    const g = solidGrid();
    carve(g, 10, 5, 12, 5);
    const p = podAt(11, 5);
    const right = run(p, g, 80, RIGHT);
    expect(ofType(right, 'dig-start')[0]).toMatchObject({ x: 13, r: 5 });
    expect(p.facing).toBe(1);
    const left = run(p, g, 200, LEFT);
    expect(ofType(left, 'dig-start')[0]).toMatchObject({ x: 9, r: 5 });
    expect(p.facing).toBe(-1);
  });

  it('chained side digs skip the engage wait too (the pod ends each dig centred, 0.07 from the next wall)', () => {
    const g = solidGrid();
    carve(g, 10, 5, 10, 5);
    const p = podAt(10, 5);
    const starts: number[] = [];
    const ctx = makeCtx();
    const out: GameEvent[] = [];
    for (let i = 0; i < 80; i++) {
      out.length = 0;
      stepPod(p, g, RIGHT, ctx, out);
      for (const e of ofType(out, 'dig-start')) starts.push(e.x);
      if (out.some((e) => e.t === 'dig-start') && starts.length === 2) expect(p.x).toBe(11.5);
    }
    expect(starts.slice(0, 2)).toEqual([11, 12]);
  });

  it('a side push from mid-cell drives to the wall before engaging', () => {
    const g = solidGrid();
    carve(g, 10, 5, 12, 5);
    const p = podAt(10, 5, (q) => (q.x = q.prevX = 11.2));
    expect(ofType(run(p, g, DIG_ENGAGE_STEPS, RIGHT), 'dig-start')).toHaveLength(0);
    expect(p.x).toBeLessThan(12);
    expect(ofType(run(p, g, 60, RIGHT), 'dig-start')[0]).toMatchObject({ x: 13, r: 5 });
  });

  it('chained digs skip the engage wait', () => {
    const g = solidGrid();
    const p = podAt(10, 5);
    const starts: number[] = [];
    const out: GameEvent[] = [];
    const ctx = makeCtx();
    for (let i = 0; i < 7 + 29 + 29; i++) {
      out.length = 0;
      stepPod(p, g, DOWN, ctx, out);
      if (out.some((e) => e.t === 'dig-start')) starts.push(i);
    }
    expect(starts).toEqual([6, 6 + 29, 6 + 58]);
  });

  it('hysteresis: a push that drifts to 50° below horizontal keeps digging sideways', () => {
    const g = solidGrid();
    carve(g, 10, 5, 11, 5);
    const p = podAt(11, 5);
    run(p, g, 30, RIGHT); // first side dig under way
    const ev = run(p, g, 40, intent({ sx: Math.cos((50 * Math.PI) / 180), sy: -Math.sin((50 * Math.PI) / 180) }));
    expect(p.sector).toBe('right');
    expect(ofType(ev, 'dig-start').every((e) => e.r === 5)).toBe(true);
  });
});

describe('dig progress', () => {
  it('t1 dig takes 29 steps, clears the cell at 37.5% and ends resting in it', () => {
    const g = solidGrid();
    fill(g, 10, 7, 10, 7, T.HARDROCK); // so the pod stops after one cell
    const p = podAt(10, 5);
    run(p, g, DIG_ENGAGE_STEPS - 1, DOWN);
    let digging = 0;
    let clearedAt = -1;
    for (let i = 0; i < 40; i++) {
      run(p, g, 1, DOWN);
      if (p.digging) digging++;
      if (clearedAt < 0 && g.get(10, 6) === T.AIR) clearedAt = digging;
    }
    expect(digging).toBe(29);
    expect(clearedAt).toBe(11); // ⌈0.375 × 29⌉
    expect(g.hasFlag(10, 6, F.DUG)).toBe(true);
    expect(p.dig).toBeNull();
    expect(p.x).toBe(10.5);
    expect(p.y).toBe(-7 + POD_H / 2);
    expect(p.grounded).toBe(true);
  });

  it('t1/t1 litres per tile = 0.1218 ± 0.001 (dig burn only; a Down push burns nothing)', () => {
    const g = solidGrid();
    fill(g, 10, 7, 10, 7, T.HARDROCK);
    const p = podAt(10, 5);
    const f0 = p.fuel;
    run(p, g, DIG_ENGAGE_STEPS + 28, DOWN);
    expect(p.dig).toBeNull();
    expect(Math.abs(f0 - p.fuel - 0.1218)).toBeLessThan(0.001);
  });

  it('a down-dig eases the pod onto the column centre before dropping', () => {
    const g = solidGrid();
    carve(g, 10, 5, 11, 5);
    const p = podAt(10, 5, (q) => (q.x = q.prevX = 10.9));
    const xs: number[] = [];
    run(p, g, DIG_ENGAGE_STEPS + 28, () => {
      if (p.dig && !p.dig.cleared) expect(p.y).toBe(-6 + POD_H / 2);
      xs.push(p.x);
      return DOWN;
    });
    expect(p.x).toBe(10.5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(0.5);
  });

  it('dig speed follows the drill tier (t7: 5 steps)', () => {
    const g = solidGrid();
    fill(g, 10, 7, 10, 7, T.HARDROCK);
    const p = podAt(10, 5, (q) => (q.tiers.drill = 7));
    run(p, g, DIG_ENGAGE_STEPS + 4, DOWN);
    expect(p.dig).toBeNull();
    expect(g.get(10, 6)).toBe(T.AIR);
  });
});

describe('cargo (canon §3.7)', () => {
  it('collects specimens and relics into the bay', () => {
    const g = solidGrid();
    g.set(10, 6, mineralCode(4));
    g.set(10, 7, relicCode(2));
    fill(g, 10, 8, 10, 8, T.HARDROCK);
    const p = podAt(10, 5);
    const ev = run(p, g, 80, DOWN);
    expect(ofType(ev, 'collect').map((e) => e.item)).toEqual([
      { kind: 'mineral', tier: 4 },
      { kind: 'relic', id: 2 },
    ]);
    expect(p.cargo).toHaveLength(2);
  });

  it('digging into a full bay destroys the specimen ("Bay full")', () => {
    const g = solidGrid();
    g.set(10, 6, mineralCode(9));
    const p = podAt(10, 5, (q) => (q.cargo = Array.from({ length: 7 }, () => ({ kind: 'mineral' as const, tier: 1 }))));
    const ev = run(p, g, DIG_ENGAGE_STEPS + 28, DOWN);
    expect(ofType(ev, 'bay-full')).toEqual([{ t: 'bay-full', item: { kind: 'mineral', tier: 9 } }]);
    expect(ofType(ev, 'collect')).toHaveLength(0);
    expect(p.cargo).toHaveLength(7);
    expect(g.get(10, 6)).toBe(T.AIR);
  });

  it('a Depot Kit takes 2 slots', () => {
    const g = solidGrid();
    g.set(10, 6, mineralCode(1));
    const p = podAt(10, 5, (q) => {
      q.cargo = [{ kind: 'kit', id: 'depot' }, ...Array.from({ length: 5 }, () => ({ kind: 'mineral' as const, tier: 1 }))];
    });
    expect(ofType(run(p, g, DIG_ENGAGE_STEPS + 28, DOWN), 'bay-full')).toHaveLength(1);
  });
});

describe('dig refusals (01 §3.4)', () => {
  /** Push Down for 60 steps onto `code` below the pod; returns the refusal events. */
  function pushOnto(setup: (g: ReturnType<typeof solidGrid>) => void, ctx = makeCtx()) {
    const g = solidGrid();
    setup(g);
    const p = podAt(20, 9);
    const ev = run(p, g, 60, DOWN, ctx);
    expect(ofType(ev, 'dig-start')).toHaveLength(0);
    return ofType(ev, 'dig-refused');
  }

  it.each([
    ['hardrock', T.HARDROCK],
    ['seal', T.SEAL],
    ['heartstone', T.HEARTSTONE],
  ] as const)('%s: refused once per push', (reason, code) => {
    expect(pushOnto((g) => g.set(20, 10, code))).toEqual([{ t: 'dig-refused', x: 20, r: 10, reason }]);
  });

  it('lode rock is refused; an out-of-scope (v1) lode is an Unknown seam', () => {
    expect(pushOnto((g) => addLode(g, 19, 10, 'mvp'), makeCtx({ scope: 'mvp' }))[0].reason).toBe('lode');
    expect(pushOnto((g) => addLode(g, 19, 10, 'v1'), makeCtx({ scope: 'mvp' }))[0].reason).toBe('seam');
    expect(pushOnto((g) => addLode(g, 19, 10, 'v1'), makeCtx({ scope: 'v1' }))[0].reason).toBe('lode');
  });

  it('anchored cells are refused', () => {
    expect(pushOnto((g) => g.setFlag(20, 10, F.ANCHORED))[0].reason).toBe('anchored');
  });

  it('rows at or below the scope floor are refused as "floor"', () => {
    expect(pushOnto(() => {}, makeCtx({ floorRow: 10, scope: 'm0' }))[0].reason).toBe('floor');
  });

  it('paved Rim cells under the pads are refused; turf beside them digs', () => {
    const g = solidGrid();
    fill(g, 1, 0, 4, 0, T.PAVED);
    const p = podAt(2, -1);
    expect(ofType(run(p, g, 30, DOWN), 'dig-refused')).toEqual([{ t: 'dig-refused', x: 2, r: 0, reason: 'paved' }]);
    const q = podAt(7, -1);
    expect(ofType(run(q, g, 10, DOWN), 'dig-start')[0]).toMatchObject({ x: 7, r: 0, code: T.TURF });
  });

  it('re-pushing emits the refusal again', () => {
    const g = solidGrid();
    g.set(20, 10, T.HARDROCK);
    const p = podAt(20, 9);
    run(p, g, 20, DOWN);
    run(p, g, 5);
    expect(ofType(run(p, g, 20, DOWN), 'dig-refused')).toHaveLength(1);
  });

  it('a refused push that slides onto diggable ground digs without a fresh engage', () => {
    const g = solidGrid();
    carve(g, 19, 9, 20, 9);
    g.set(20, 10, T.HARDROCK);
    const p = podAt(20, 9, (q) => (q.x = q.prevX = 20.02));
    run(p, g, 20, DOWN);
    p.x = p.prevX = 19.5;
    expect(ofType(run(p, g, 1, DOWN), 'dig-start')).toHaveLength(1);
  });

  it('classifyDigTarget treats occupants as silent blockers and sky as open', () => {
    const g = solidGrid();
    g.set(5, 5, T.AIR);
    g.occupant[5 * MINE_W + 5] = 3;
    const floor = forcedFloorRow(SEAL_ROW);
    expect(classifyDigTarget(g, 5, 5, floor, 'v1')).toBe('blocked');
    expect(classifyDigTarget(g, 5, -1, floor, 'v1')).toBe('open');
    expect(classifyDigTarget(g, 6, 5, floor, 'v1')).toBe('drill');
  });
});

describe('hazard breaches (canon §3.3)', () => {
  it('Magma: two hits of 29 × R, 6 steps apart; the cell becomes air', () => {
    const g = solidGrid();
    g.set(10, 6, T.MAGMA);
    const p = podAt(10, 5, (q) => {
      q.tiers.hull = 7;
      q.hull = 180;
      q.tiers.radiator = 4; // Coil Sink ×0.75
    });
    const hits: number[] = [];
    const ctx = makeCtx();
    for (let i = 0; i < 60; i++) {
      const out: GameEvent[] = [];
      stepPod(p, g, DOWN, ctx, out);
      for (const e of ofType(out, 'damage')) {
        expect(e).toEqual({ t: 'damage', amount: MAGMA_HIT * 0.75, cause: 'magma' });
        hits.push(i);
      }
    }
    expect(hits).toHaveLength(2);
    expect(hits[1] - hits[0]).toBe(MAGMA_HIT_GAP_STEPS);
    expect(p.hull).toBeCloseTo(180 - 58 * 0.75, 9);
    expect(g.get(10, 6)).toBe(T.AIR);
  });

  it('Magma kills a stock pod (58 > 10 HP): destroyed once', () => {
    const g = solidGrid();
    g.set(10, 6, T.MAGMA);
    const p = podAt(10, 5);
    const ev = run(p, g, 80, DOWN);
    expect(ofType(ev, 'destroyed')).toEqual([{ t: 'destroyed', cause: 'hull' }]);
    expect(ofType(ev, 'damage')).toHaveLength(1); // the second hit never lands on a wreck
  });

  it('Methane: one depth-scaled hit and a 3×3 clear that spares protected cells', () => {
    const g = solidGrid();
    const r = 400;
    carve(g, 20, r - 1, 20, r - 1);
    g.set(20, r, T.METHANE);
    g.set(19, r, mineralCode(8));
    g.set(21, r, T.HARDROCK);
    g.setFlag(19, r + 1, F.ANCHORED);
    g.set(21, r + 1, T.MAGMA);
    const p = podAt(20, r - 1, (q) => {
      q.tiers.hull = 7;
      q.hull = 180;
      q.tiers.radiator = 6; // Frost Loop ×0.4
    });
    const ev = run(p, g, DIG_ENGAGE_STEPS + 28, DOWN);
    expect(ofType(ev, 'damage')).toEqual([{ t: 'damage', amount: methaneDamage(r, 0.4), cause: 'methane' }]);
    expect(methaneDamage(396, 1)).toBe(130);
    expect(g.get(19, r)).toBe(T.AIR); // ore destroyed
    expect(g.get(21, r)).toBe(T.HARDROCK);
    expect(g.get(19, r + 1)).toBe(T.DIRT); // anchored
    expect(g.get(21, r + 1)).toBe(T.AIR);
    expect(g.get(20, r + 1)).toBe(T.AIR);
    expect(ofType(ev, 'collect')).toHaveLength(0);
    expect(ofType(ev, 'explosion')).toEqual([{ t: 'explosion', x: 20, r, radius: 1 }]);
  });
});
