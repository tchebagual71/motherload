// Quick-slot consumables (canon §2.7; 01 §3.9).
import { describe, expect, it } from 'vitest';
import { ITEM_COOLDOWN_STEPS, MINE_W, POD_H, SKY_ROWS } from '../../src/shared/canon';
import { F, T, mineralCode, relicCode } from '../../src/shared/types';
import { PUMP_PAD_X } from '../../src/pod';
import { Rng, STREAM } from '../../src/shared/rng';
import type { PodState } from '../../src/pod/types';
import { addLode, carve, fill, intent, makeCtx, ofType, podAt, run, solidGrid } from './pod.helpers';

const fire = (slot: number) => intent({ fireSlot: slot });
/** Default quick slots: 0 pop, 1 megaPop, 2 jerrycan, 3 patchKit. */
const SLOT = { pop: 0, megaPop: 1, jerrycan: 2, patchKit: 3 } as const;

function stocked(p: PodState): void {
  p.consumables.pop = 9;
  p.consumables.megaPop = 9;
  p.consumables.jerrycan = 9;
  p.consumables.patchKit = 9;
  p.consumables.hopBeacon = 9;
  p.consumables.homingBeacon = 9;
}

describe('consumables: use rules', () => {
  it('Jerrycan +25 L and Patch Kit +30 HP, capped at max; counts drop', () => {
    const g = solidGrid();
    const p = podAt(10, -1, (q) => {
      stocked(q);
      q.tiers.tank = 4; // 40 L
      q.fuel = 5;
      q.tiers.hull = 5; // 80 HP
      q.hull = 60;
    });
    const ev = run(p, g, 1, fire(SLOT.jerrycan));
    expect(p.fuel).toBe(30);
    expect(ofType(ev, 'consumable-used')).toEqual([{ t: 'consumable-used', id: 'jerrycan' }]);
    run(p, g, ITEM_COOLDOWN_STEPS);
    run(p, g, 1, fire(SLOT.jerrycan));
    expect(p.fuel).toBe(40);
    run(p, g, ITEM_COOLDOWN_STEPS);
    run(p, g, 1, fire(SLOT.patchKit));
    expect(p.hull).toBe(80);
    expect(p.consumables.jerrycan).toBe(7);
    expect(p.consumables.patchKit).toBe(8);
  });

  it('cooldown: 7 steps between uses', () => {
    const g = solidGrid();
    const p = podAt(10, -1, stocked);
    run(p, g, 1, fire(SLOT.jerrycan));
    run(p, g, ITEM_COOLDOWN_STEPS - 2);
    expect(ofType(run(p, g, 1, fire(SLOT.jerrycan)), 'consumable-refused')).toEqual([
      { t: 'consumable-refused', id: 'jerrycan', reason: 'cooldown' },
    ]);
    run(p, g, ITEM_COOLDOWN_STEPS - 1);
    expect(ofType(run(p, g, 1, fire(SLOT.jerrycan)), 'consumable-used')).toHaveLength(1);
  });

  it('empty and airborne refusals spend nothing', () => {
    const g = solidGrid();
    const p = podAt(10, -1);
    expect(ofType(run(p, g, 1, fire(SLOT.pop)), 'consumable-refused')[0].reason).toBe('empty');
    const air = podAt(10, -20, (q) => {
      stocked(q);
      q.grounded = false;
    });
    expect(ofType(run(air, g, 1, fire(SLOT.pop)), 'consumable-refused')[0].reason).toBe('airborne');
    expect(air.consumables.pop).toBe(9);
    // Jerrycan and Patch Kit work in the air.
    expect(ofType(run(air, g, 1, fire(SLOT.jerrycan)), 'consumable-used')).toHaveLength(1);
  });

  it('out-of-range slots are ignored', () => {
    const g = solidGrid();
    const p = podAt(10, -1, stocked);
    expect(run(p, g, 1, fire(7))).toEqual([]);
  });
});

describe('explosives', () => {
  it('Pop Charge clears the 3×3 around the pod, destroys ore and relics, never hurts the pod', () => {
    const g = solidGrid();
    carve(g, 20, 20, 20, 20);
    g.set(19, 20, mineralCode(9));
    g.set(21, 21, relicCode(3));
    g.set(19, 19, T.HARDROCK);
    g.set(21, 19, T.MAGMA);
    g.set(20, 19, T.METHANE);
    const p = podAt(20, 20, stocked);
    const hull = p.hull;
    const ev = run(p, g, 1, fire(SLOT.pop));
    expect(ofType(ev, 'explosion')).toEqual([{ t: 'explosion', x: 20, r: 20, radius: 1 }]);
    for (let r = 19; r <= 21; r++) for (let x = 19; x <= 21; x++) expect(g.get(x, r), `${x},${r}`).toBe(T.AIR);
    expect(g.hasFlag(19, 21, F.DUG)).toBe(true);
    expect(g.get(18, 20)).toBe(T.DIRT);
    expect(g.get(20, 22)).toBe(T.DIRT);
    expect(p.hull).toBe(hull);
    expect(ofType(ev, 'damage')).toHaveLength(0);
    expect(ofType(ev, 'collect')).toHaveLength(0);
    expect(p.cargo).toHaveLength(0);
    run(p, g, 60);
    expect(p.row).toBe(21); // the floor cleared: the pod fell
  });

  it('Mega Pop clears 5×5 but never touches lode rock, Seal, Heartstone, anchored cells or occupants', () => {
    const g = solidGrid();
    carve(g, 20, 20, 20, 20);
    const lode = addLode(g, 18, 21);
    g.set(22, 18, T.SEAL);
    g.set(18, 18, T.HEARTSTONE);
    g.setFlag(22, 22, F.ANCHORED);
    g.occupant[19 * MINE_W + 21] = 4;
    g.set(21, 19, T.AIR);
    const p = podAt(20, 20, stocked);
    run(p, g, 1, fire(SLOT.megaPop));
    for (let r = 21; r <= 22; r++) for (let x = 18; x <= 20; x++) expect(g.get(x, r)).toBe(T.LODE_ROCK);
    expect(lode.discovered).toBe(true); // adjacent with Tin Ear
    expect(g.get(22, 18)).toBe(T.SEAL);
    expect(g.get(18, 18)).toBe(T.HEARTSTONE);
    expect(g.get(22, 22)).toBe(T.DIRT);
    expect(g.occupant[19 * MINE_W + 21]).toBe(4);
    expect(g.get(22, 20)).toBe(T.AIR);
    expect(g.get(21, 22)).toBe(T.AIR);
    expect(g.get(17, 20)).toBe(T.DIRT);
  });

  it('blasts on the Rim spare the paved pad cells and the scope floor', () => {
    const g = solidGrid();
    fill(g, 1, 0, 4, 0, T.PAVED);
    const p = podAt(5, -1, stocked);
    run(p, g, 1, fire(SLOT.megaPop));
    expect(g.get(3, 0)).toBe(T.PAVED);
    expect(g.get(4, 0)).toBe(T.PAVED);
    expect(g.get(5, 0)).toBe(T.AIR);
    expect(g.get(7, 0)).toBe(T.AIR);
    expect(g.get(5, 1)).toBe(T.AIR); // 5×5 centred on row −1 reaches rows 0–1
    expect(g.get(5, 2)).toBe(T.DIRT);

    const deep = solidGrid();
    carve(deep, 10, 126, 10, 126);
    const q = podAt(10, 126, stocked);
    run(q, deep, 1, fire(SLOT.megaPop), makeCtx({ floorRow: 128, scope: 'm0' }));
    expect(deep.get(10, 127)).toBe(T.AIR);
    expect(deep.get(10, 128)).toBe(T.DIRT);
  });

  it('a blast mid-dig cancels the dig', () => {
    const g = solidGrid();
    const p = podAt(10, 5, stocked);
    run(p, g, 10, intent({ sy: -1 }));
    expect(p.dig).not.toBeNull();
    run(p, g, 1, intent({ sy: -1, fireSlot: SLOT.pop }));
    expect(p.dig).toBeNull();
  });
});

describe('beacons', () => {
  it('Hop Beacon: random Rim x, 6–14 rows above the Rim, then an unbraked 5–6 HP landing', () => {
    const g = solidGrid();
    const p = podAt(20, 50, (q) => {
      stocked(q);
      q.quickSlots[0] = 'hopBeacon';
      q.tiers.hull = 7;
      q.hull = 180;
    });
    carve(g, 20, 50, 20, 50);
    const ev = run(p, g, 1, fire(0));
    const tp = ofType(ev, 'teleport')[0];
    expect(tp.id).toBe('hopBeacon');
    const bottom = tp.y - POD_H / 2;
    expect(bottom).toBeGreaterThanOrEqual(6);
    expect(bottom).toBeLessThan(14);
    expect(tp.y).toBeLessThan(SKY_ROWS);
    expect(tp.x % 1).toBe(0.5);
    expect(p.dig).toBeNull();
    const fall = run(p, g, 300);
    expect(p.row).toBe(0);
    expect(p.grounded).toBe(true);
    const dmg = ofType(fall, 'damage').reduce((s, e) => s + e.amount, 0);
    expect(dmg).toBeGreaterThanOrEqual(5); // 01 §3.9: an unbraked hop landing is 5–6 HP
    expect(dmg).toBeLessThanOrEqual(6);
  });

  it('every Hop Beacon landing costs 5–6 HP, whatever the roll', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const g = solidGrid();
      const p = podAt(10, -1, (q) => {
        stocked(q);
        q.quickSlots[0] = 'hopBeacon';
        q.tiers.hull = 7;
        q.hull = 180;
      });
      const ev = run(p, g, 400, (i) => fire(i === 0 ? 0 : -1), makeCtx({ rng: new Rng(seed, STREAM.HOP_BEACON) }));
      const first = ofType(ev, 'damage')[0];
      expect(first.cause).toBe('landing');
      expect([5, 6]).toContain(first.amount);
    }
  });

  it('Hop Beacon lands only on Rim columns that hold the pod: never a surface hole or the survey shaft', () => {
    const g = solidGrid();
    carve(g, 26, 0, 26, 45); // the survey shaft
    for (const x of [0, 7, 11, 12, 13, 33, 47]) carve(g, x, 0, x, 30); // player-dug shafts, incl. a 3-wide one and both edges
    const rng = new Rng(7, STREAM.HOP_BEACON);
    const ctx = makeCtx({ rng });
    const seen = new Set<number>();
    for (let k = 0; k < 500; k++) {
      const p = podAt(20, -1, (q) => {
        stocked(q);
        q.quickSlots[0] = 'hopBeacon';
        q.tiers.hull = 7;
        q.hull = 180;
      });
      const before = Rng.fromState(rng.s);
      const ev = run(p, g, 1, fire(0), ctx);
      // Replay contract: one x draw, then one height draw.
      before.next();
      before.next();
      expect(rng.s).toEqual(before.s);
      const tp = ofType(ev, 'teleport')[0];
      seen.add(Math.floor(tp.x));
      expect(g.get(Math.floor(tp.x), 0)).not.toBe(T.AIR);
      for (let i = 0; i < 400 && !p.grounded; i++) ev.push(...run(p, g, 1, intent(), ctx));
      expect(p.grounded).toBe(true);
      expect(p.y).toBeGreaterThan(0);
      const dmg = ofType(ev, 'damage');
      expect(dmg).toHaveLength(1);
      expect([5, 6]).toContain(dmg[0].amount);
    }
    expect(seen.size).toBe(MINE_W - 8); // every solid Rim column is still a target
  });

  it('Hop Beacon targets are deterministic in the RNG stream', () => {
    const g = solidGrid();
    const xs = [1, 2].map(() => {
      const p = podAt(10, -1, (q) => {
        stocked(q);
        q.quickSlots[0] = 'hopBeacon';
      });
      return ofType(run(p, g, 1, fire(0), makeCtx()), 'teleport')[0];
    });
    expect(xs[1]).toEqual(xs[0]);
  });

  it('Homing Beacon: lands safely on the Pump House pad', () => {
    const g = solidGrid();
    const p = podAt(30, 60, (q) => {
      stocked(q);
      q.quickSlots[0] = 'homingBeacon';
    });
    carve(g, 30, 60, 30, 60);
    const ev = run(p, g, 1, fire(0));
    expect(PUMP_PAD_X).toBe(3);
    expect(ofType(ev, 'teleport')).toEqual([{ t: 'teleport', id: 'homingBeacon', x: 3, y: POD_H / 2 }]);
    expect(p.prevX).toBe(3);
    run(p, g, 30);
    expect(p.grounded).toBe(true);
    expect(p.x).toBe(3);
    expect(p.y).toBeCloseTo(POD_H / 2, 12);
  });
});
