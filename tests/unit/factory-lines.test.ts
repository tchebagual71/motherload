import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BELT_V, Line, SPACING_U, TILE_U, slotKey } from '../../src/factory/line';
import { item } from '../../src/factory/items';
import { rig, ticks } from './factory.helpers';

/** A straight line of `tiles` tiles heading east (head = slots[0]). */
function line(tiles: number, tier = 1): Line {
  const slots = Int32Array.from({ length: tiles }, (_, i) => slotKey(100 + tiles - 1 - i, 0));
  return new Line(1, 0, tier, slots, new Uint8Array(tiles));
}

function positions(l: Line): number[] {
  const out: number[] = [];
  let p = 0;
  for (let i = 0; i < l.n; i++) out.push((p += l.gapAt(i)));
  return out;
}

/** Naive per-item reference (02 §10.11 #1): each item moves v, stops at the head or S behind the item ahead. */
class Naive {
  pos: number[] = [];
  constructor(
    readonly L: number,
    readonly S: number,
  ) {}
  move(): void {
    for (let i = 0; i < this.pos.length; i++) {
      const floor = i === 0 ? 0 : this.pos[i - 1] + this.S;
      this.pos[i] = Math.max(floor, this.pos[i] - BELT_V);
    }
  }
  canExit(): boolean {
    return this.pos.length > 0 && this.pos[0] === 0;
  }
  insert(): boolean {
    const last = this.pos[this.pos.length - 1];
    if (this.pos.length > 0 && this.L - last < this.S) return false;
    this.pos.push(this.L);
    return true;
  }
}

describe('factory lines: gap encoding (02 §10.3)', () => {
  it.each([
    [1, 60],
    [2, 120],
    [3, 240],
  ])('a compressed Mk %i line delivers exactly %i items/min over 12,000 ticks', (tier, perMin) => {
    const l = line(16, tier);
    let out = 0;
    const run = (n: number, count: boolean): void => {
      for (let t = 0; t < n; t++) {
        l.move();
        if (l.headReady()) {
          l.popHead();
          if (count) out++;
        }
        l.insertTail(7);
      }
    };
    run(2_000, false);
    run(12_000, true);
    expect(out).toBe(perMin * 10);
    expect(SPACING_U[tier] / BELT_V).toBe(1_200 / perMin);
  });

  it('matches the naive per-item reference on random feeds and exits (10k cases)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 3 }),
        fc.array(fc.tuple(fc.boolean(), fc.boolean()), { minLength: 1, maxLength: 80 }),
        (tiles, tier, steps) => {
          const l = line(tiles, tier);
          const ref = new Naive(tiles * TILE_U, SPACING_U[tier]);
          for (const [feed, exit] of steps) {
            l.move();
            ref.move();
            expect(l.headReady()).toBe(ref.canExit());
            if (exit && ref.canExit()) {
              l.popHead();
              ref.pos.shift();
            }
            if (feed) expect(l.insertTail(3)).toBe(ref.insert());
            expect(positions(l)).toEqual(ref.pos);
            expect(l.tailPos).toBe(ref.pos.length ? ref.pos[ref.pos.length - 1] : 0);
          }
        },
      ),
      { numRuns: 10_000 },
    );
  });
});

describe('factory lines: in the factory', () => {
  it('moves exactly 60 items/min on a Mk I line into an Export (12,000 ticks)', () => {
    const r = rig({ yardRows: 16 });
    r.f.discoverLode(0, false);
    r.f.unlockRung('U3');
    const src = r.f.place('bin', 1, 2, 10, 0);
    if (!src.ok) throw new Error(JSON.stringify(src));
    // The survey Bin (lower id) fills first, so the source Bin holds the copper.
    expect(r.f.stockpilePut([{ item: 'ironIngot', n: 200 }, { item: 'copperIngot', n: 100 }]).ok).toBe(true);
    expect(r.f.setUnloadFilter(src.id, 'copperIngot').ok).toBe(true);
    expect(r.f.paintBelts(Array.from({ length: 20 }, (_, i) => ({ x: 4 + i, y: 10 })), 1).ok).toBe(true);
    expect(r.f.place('export', 1, 24, 10, 0).ok).toBe(true);
    const refill = (): void => void r.f.stockpilePut([{ item: 'copperIngot', n: 60 }]);
    for (let m = 0; m < 2; m++, refill()) ticks(r.f, 1_200);
    const sold0 = r.f.debug.counts.sold;
    for (let m = 0; m < 10; m++, refill()) ticks(r.f, 1_200);
    expect(r.f.debug.counts.sold - sold0).toBe(600);
    const price = Math.floor((item('copperIngot').value * 9) / 10);
    expect(r.wallet.log.filter((x) => x.reason === 'export').every((x) => x.n === price)).toBe(true);
  });

  it('keeps item positions when a line is extended, and sends items on removed tiles to the Stockpile', () => {
    const r = rig({ yardRows: 16 });
    r.f.discoverLode(0, false);
    const src = r.f.place('bin', 1, 2, 12, 0);
    if (!src.ok) throw new Error('bin');
    expect(r.f.stockpilePut([{ item: 'ironIngot', n: 200 }, { item: 'hematiteOre', n: 20 }]).ok).toBe(true);
    r.f.setUnloadFilter(src.id, 'hematiteOre');
    const path = Array.from({ length: 10 }, (_, i) => ({ x: 4 + i, y: 12 }));
    r.f.paintBelts(path, 1);
    ticks(r.f, 300);
    const lineId = r.f.debug.lineAt('yard', 8, 12);
    const before = r.f.debug.lineItems(lineId).length;
    expect(before).toBeGreaterThan(3);
    const view = { count: 0, plane: new Uint8Array(64), item: new Uint16Array(64), x: new Float32Array(64), y: new Float32Array(64), dx: new Float32Array(64), dy: new Float32Array(64) };
    r.f.fillBeltItems(view);
    const xs = Array.from(view.x.subarray(0, view.count)).sort();
    // Extend at the head: same items at the same places.
    r.f.paintBelts([{ x: 14, y: 12 }, { x: 15, y: 12 }], 1);
    r.f.fillBeltItems(view);
    expect(Array.from(view.x.subarray(0, view.count)).sort()).toEqual(xs);
    // Remove two middle tiles: their items go to the Stockpile, the rest stay on two lines.
    const ore0 = r.f.stockpileCount('hematiteOre');
    const removed = r.f.removeBelts('yard', [{ x: 8, y: 12 }, { x: 9, y: 12 }]);
    expect(removed).toEqual({ ok: true, refund: 10 });
    r.f.fillBeltItems(view);
    const lost = before - view.count;
    expect(r.f.stockpileCount('hematiteOre') - ore0).toBe(lost);
    expect(r.f.debug.conservationOk()).toBe(true);
  });
});
