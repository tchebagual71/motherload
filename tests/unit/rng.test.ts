import { describe, expect, it } from 'vitest';
import { Rng, hash32 } from '../../src/shared/rng';

describe('rng', () => {
  it('is deterministic per seed and stream', () => {
    const a = new Rng(42, 1), b = new Rng(42, 1), c = new Rng(42, 2);
    const xa = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(xa);
    expect(c.next()).not.toEqual(xa[0]);
  });
  it('round-trips state', () => {
    const a = new Rng(7);
    a.next();
    const b = Rng.fromState(a.s);
    expect(b.next()).toEqual(a.next());
  });
  it('hash32 mixes', () => {
    expect(hash32(1, 2)).not.toEqual(hash32(2, 1));
  });
  it('is roughly uniform', () => {
    const r = new Rng(123);
    let sum = 0;
    for (let i = 0; i < 10000; i++) sum += r.next();
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
  });
});
