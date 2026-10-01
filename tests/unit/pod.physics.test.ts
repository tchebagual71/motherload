// Pod movement goldens (01 §3.13) and collision behaviour.
import { describe, expect, it } from 'vitest';
import { climbSpeed, landingDamage, skyFade, thrustInput } from '../../src/pod';
import { GAP_SKIM_VX, GROUND_FRICTION, MINE_W, POD_H, POD_W, SKY_ROWS, VX_MAX } from '../../src/shared/canon';
import { T } from '../../src/shared/types';
import type { PodState } from '../../src/pod/types';
import { carve, fill, intent, makeCtx, ofType, podAt, run, shaftGrid, solidGrid, RIGHT } from './pod.helpers';

const HALF_H = POD_H / 2;
const hematites = (n: number) => Array.from({ length: n }, () => ({ kind: 'mineral' as const, tier: 1 }));

/** Steady full-thrust climb in a deep 1-wide shaft with cargo = 50% of the hover cap. */
function climbAtHalfCap(engineTier: number, cap: number): number {
  const g = shaftGrid(10, 400);
  const p = podAt(10, 400, (q) => {
    q.tiers.engine = engineTier;
    q.cargo = hematites(cap / 2);
  });
  run(p, g, 600, intent({ thrust: true }));
  return p.vy;
}

describe('pod physics: 01 §3.13 goldens', () => {
  it('terminal velocity emerges from drag: 13.50 ± 0.05 tiles/s', () => {
    const g = shaftGrid(10, 500);
    const p = podAt(10, -1); // on the Rim, above the open shaft
    run(p, g, 600);
    expect(p.grounded).toBe(false);
    expect(-p.vy).toBeGreaterThan(13.45);
    expect(-p.vy).toBeLessThan(13.55);
  });

  it.each([
    [1, 100, 2.7],
    [5, 320, 6.0],
    [7, 620, 8.21],
  ])('climb at 50%% cap, engine t%i: %f mu → %f tiles/s', (tier, cap, want) => {
    const v = climbAtHalfCap(tier, cap);
    expect(Math.abs(v - want)).toBeLessThan(0.05);
  });

  it('climbSpeed() matches the 01 §3.3 table, clamped to V_up', () => {
    const p = podAt(10, 5);
    expect(climbSpeed(p)).toBeCloseTo(6.75, 2); // t1 empty
    p.cargo = hematites(25);
    expect(climbSpeed(p)).toBeCloseTo(4.5, 2); // t1, 25% cap
    p.tiers.engine = 6;
    p.cargo = [];
    expect(climbSpeed(p)).toBe(13.5); // V_up clamp
    p.tiers.engine = 1;
    p.cargo = hematites(100);
    expect(climbSpeed(p)).toBe(0); // too heavy
  });

  it('hard landing: 5.88 tiles/s → 3 HP, terminal → 8 HP (canon §3.3)', () => {
    expect(landingDamage(5.87)).toBe(0);
    expect(landingDamage(5.88)).toBe(3);
    expect(landingDamage(13.5)).toBe(8);
  });

  /** Fall from rest with the pod's bottom `h` rows above the floor (top of row 300). */
  function fallFrom(h: number): { v: number; dmg: number; pod: PodState } {
    const g = shaftGrid(10, 299);
    const p = podAt(10, 299, (q) => {
      q.y = q.prevY = -300 + HALF_H + h;
      q.grounded = false;
      q.tiers.hull = 7;
      q.hull = 180;
    });
    const ev = run(p, g, 1500);
    return { v: ofType(ev, 'landed')[0].v, dmg: ofType(ev, 'damage').reduce((s, e) => s + e.amount, 0), pod: p };
  }

  it('unbraked falls land in the 01 §3.6 damage buckets', () => {
    for (const [h, dmg] of [[1.5, 0], [2.7, 3], [4.4, 4], [7.9, 5], [14.5, 6], [44, 7], [100, 8]]) {
      expect(fallFrom(h).dmg, `fall ${h} rows`).toBe(dmg);
    }
  });

  it('a terminal-speed landing emits landed (v ≈ 13.5) and 8 HP of landing damage, then bounces and settles', () => {
    const { v, dmg, pod } = fallFrom(150);
    expect(v).toBeCloseTo(13.5, 1);
    expect(dmg).toBe(8);
    expect(pod.grounded).toBe(true);
    expect(pod.y).toBeCloseTo(-300 + HALF_H, 9);
  });
});

describe('pod physics: thrust, drive and drag (canon §3.6)', () => {
  it('s_t = clamp((sy − 0.35)/0.65, 0, 1); THRUST button = 1', () => {
    expect(thrustInput(intent({ sy: 0.35 }))).toBe(0);
    expect(thrustInput(intent({ sy: 1 }))).toBe(1);
    expect(thrustInput(intent({ sy: 0.675 }))).toBeCloseTo(0.5, 12);
    expect(thrustInput(intent({ sy: -1, thrust: true }))).toBe(1);
  });

  it('stock horizontal accel ≈ 6.9 tiles/s², full speed 4.5 in ≈ 0.65 s, no friction while driving', () => {
    const g = solidGrid();
    const p = podAt(2, -1);
    run(p, g, 30, RIGHT);
    expect(p.vx).toBeCloseTo((0.4 * 11.537 * 300) / 200 / 2, 6); // a_x · 0.5 s
    run(p, g, 10, RIGHT);
    expect(p.vx).toBe(VX_MAX);
    expect(p.grounded).toBe(true);
  });

  it('grounded friction with no drive input; airborne drag on vx', () => {
    const g = solidGrid();
    const p = podAt(2, -1, (q) => (q.vx = 4));
    run(p, g, 1);
    expect(p.vx).toBeCloseTo(4 * GROUND_FRICTION, 12);
    run(p, g, 400);
    expect(p.vx).toBe(0);

    const air = podAt(10, -40, (q) => {
      q.grounded = false;
      q.vx = 3;
    });
    run(air, g, 1);
    expect(air.vx).toBeCloseTo(3 * 0.985958, 12);
  });

  it('stops flush at the side frame (x = 0 and x = 48)', () => {
    const g = solidGrid();
    const p = podAt(2, -1);
    run(p, g, 120, intent({ sx: -1 }));
    expect(p.x).toBe(POD_W / 2);
    run(p, g, 900, RIGHT);
    expect(p.x).toBe(MINE_W - POD_W / 2);
  });

  it('thrust fades to 0 over the top 8 sky rows: the pod never leaves the sky', () => {
    expect(skyFade(0)).toBe(1);
    expect(skyFade(SKY_ROWS - 4)).toBe(0.5);
    expect(skyFade(SKY_ROWS)).toBe(0);
    const g = solidGrid();
    const p = podAt(10, -1, (q) => (q.tiers.engine = 7));
    let top = 0;
    run(p, g, 1200, (i) => {
      top = Math.max(top, p.y + POD_H / 2);
      return intent({ thrust: i < 1000 });
    });
    expect(top).toBeLessThanOrEqual(SKY_ROWS);
    expect(top).toBeGreaterThan(SKY_ROWS - 8);
  });

  it('too heavy (m ≥ cap): full thrust cannot lift off, only slows a fall', () => {
    const g = shaftGrid(10, 300);
    const p = podAt(10, 300, (q) => (q.cargo = hematites(100)));
    run(p, g, 60, intent({ thrust: true }));
    expect(p.grounded).toBe(true);
    expect(p.vy).toBe(0);

    const free = podAt(10, 100, (q) => {
      q.cargo = hematites(150);
      q.y = q.prevY = -50;
      q.grounded = false;
    });
    const braked = podAt(10, 100, (q) => {
      q.cargo = hematites(150);
      q.y = q.prevY = -50;
      q.grounded = false;
    });
    run(free, g, 60);
    run(braked, g, 60, intent({ thrust: true }));
    expect(braked.vy).toBeLessThan(0);
    expect(braked.vy).toBeGreaterThan(free.vy);
  });

  it('the vertical speed is clamped to V_up', () => {
    const g = shaftGrid(10, 400);
    const p = podAt(10, 400, (q) => (q.tiers.engine = 6));
    run(p, g, 300, intent({ thrust: true }));
    expect(p.vy).toBe(13.5);
  });
});

describe('pod collision', () => {
  it('rests on solid cells and cannot pass through walls or ceilings', () => {
    const g = solidGrid();
    fill(g, 9, 9, 15, 13, T.HARDROCK); // undiggable shell, so pushing into it cannot dig
    carve(g, 10, 10, 14, 12); // a 5×3 room
    const p = podAt(12, 12);
    run(p, g, 120);
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(-13 + POD_H / 2, 9);
    run(p, g, 200, RIGHT);
    expect(p.x).toBeCloseTo(15 - POD_W / 2, 9);
    run(p, g, 120, intent({ thrust: true }));
    expect(p.y + POD_H / 2).toBeLessThanOrEqual(-10 + 1e-9);
  });

  it('bounces off a ceiling with v_y × −0.2', () => {
    const g = solidGrid();
    carve(g, 10, 10, 10, 12);
    const p = podAt(10, 12, (q) => {
      q.y = q.prevY = -10 - POD_H / 2 - 0.01;
      q.vy = 5;
      q.grounded = false;
    });
    run(p, g, 1);
    expect(p.vy).toBeLessThan(0);
    expect(p.vy).toBeGreaterThan(-1.2);
  });

  it('factory occupants block the pod; mounts never do', () => {
    const g = solidGrid();
    carve(g, 10, 10, 20, 10);
    g.mount[10 * MINE_W + 13] = 7;
    g.occupant[10 * MINE_W + 16] = 9;
    const p = podAt(10, 10);
    run(p, g, 240, RIGHT);
    expect(p.x).toBeCloseTo(16 - POD_W / 2, 9);
  });

  it('rows at or below the scope floor are solid', () => {
    const g = shaftGrid(10, 300);
    const p = podAt(10, 100);
    run(p, g, 600, intent(), makeCtx({ floorRow: 128, scope: 'm0' }));
    expect(p.grounded).toBe(true);
    expect(p.row).toBe(127);
  });
});

describe('gap skim (01 §3.2)', () => {
  /** Floor of row 11 with a 1-wide gap at x = 15 (a shaft below); the pod drives right along row 10. */
  function skimRun(vx: number) {
    const g = solidGrid();
    carve(g, 5, 10, 30, 10);
    carve(g, 15, 11, 15, 20);
    const p = podAt(11, 10, (q) => (q.vx = vx));
    run(p, g, 400, intent({ sx: 1e-3 })); // a whisper of drive: no ground friction, ~constant speed
    return p;
  }

  it('crosses a 1-wide gap at 1.5 tiles/s', () => {
    const p = skimRun(GAP_SKIM_VX);
    expect(p.row).toBe(10);
    expect(p.x).toBeGreaterThan(17);
  });

  it('drops in at 1.4 tiles/s', () => {
    const p = skimRun(1.4);
    expect(p.row).toBe(20);
    expect(Math.floor(p.x)).toBe(15);
  });

  it('drops in when pushing Down even at speed', () => {
    const g = solidGrid();
    carve(g, 5, 10, 30, 10);
    carve(g, 15, 11, 15, 20);
    const p = podAt(15, 10, (q) => (q.vx = 3));
    run(p, g, 120, intent({ sy: -1 }));
    expect(p.row).toBe(20);
  });

  it('a stopped pod pushing Down beside a hole is eased into it (column snap)', () => {
    const g = solidGrid();
    carve(g, 5, 10, 30, 10);
    carve(g, 15, 11, 15, 20);
    const p = podAt(15, 10, (q) => (q.x = q.prevX = 15.1)); // resting on the lip of x = 14
    const ev = run(p, g, 150, intent({ sy: -1 }));
    expect(Math.floor(p.x)).toBe(15);
    expect(p.row).toBeGreaterThanOrEqual(20);
    expect(ofType(ev, 'dig-start')[0]).toMatchObject({ x: 15, r: 21 }); // then keeps digging down
  });

  it('a stopped pod not pushing Down stays on the lip', () => {
    const g = solidGrid();
    carve(g, 5, 10, 30, 10);
    carve(g, 15, 11, 15, 20);
    const p = podAt(15, 10, (q) => (q.x = q.prevX = 15.1));
    run(p, g, 60);
    expect(p.row).toBe(10);
    expect(p.grounded).toBe(true);
  });
});

describe('determinism', () => {
  it('same inputs → bit-identical pod state and terrain', () => {
    const script = (i: number) =>
      intent({
        sx: ((i * 7919) % 200) / 100 - 1,
        sy: ((i * 104729) % 200) / 100 - 1,
        thrust: i % 97 < 20,
        fireSlot: i % 251 === 0 ? 0 : -1,
      });
    const once = () => {
      const g = solidGrid();
      fill(g, 0, 30, MINE_W - 1, 30, T.HARDROCK);
      fill(g, 3, 5, 9, 5, T.MAGMA);
      const p = podAt(7, -1, (q) => {
        q.consumables.pop = 9;
        q.tiers.hull = 7;
        q.hull = 180;
      });
      const ev = run(p, g, 3000, script);
      return { p: JSON.stringify(p), t: Buffer.from(g.terrain).toString('base64'), ev: JSON.stringify(ev) };
    };
    const a = once();
    const b = once();
    expect(b.p).toBe(a.p);
    expect(b.t).toBe(a.t);
    expect(b.ev).toBe(a.ev);
  });
});
