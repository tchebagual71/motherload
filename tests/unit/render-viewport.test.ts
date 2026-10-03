// RENDER-8: a devicePixelRatio change alone (zoom, display switch) re-measures the layout. The `(resolution)`
// query only fires when it stops matching, so the watcher re-arms itself for the new ratio each time.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchDevicePixelRatio } from '../../src/app/viewport';

class FakeMql {
  readonly listeners = new Set<() => void>();
  constructor(readonly media: string) {}
  addEventListener(_t: string, fn: () => void): void {
    this.listeners.add(fn);
  }
  removeEventListener(_t: string, fn: () => void): void {
    this.listeners.delete(fn);
  }
}

const g = globalThis as unknown as { window?: { devicePixelRatio: number }; matchMedia?: (q: string) => FakeMql };
let queries: FakeMql[] = [];

beforeEach(() => {
  queries = [];
  g.window = { devicePixelRatio: 3 };
  g.matchMedia = (q) => {
    const m = new FakeMql(q);
    queries.push(m);
    return m;
  };
});

afterEach(() => {
  delete g.window;
  delete g.matchMedia;
});

/** The browser fires `change` on the live query once the ratio stops matching it. */
function changeDpr(dpr: number): void {
  g.window!.devicePixelRatio = dpr;
  for (const q of [...queries]) for (const fn of [...q.listeners]) fn();
}

describe('devicePixelRatio watcher (RENDER-8)', () => {
  it('re-measures on every ratio change and re-arms for the new ratio', () => {
    let n = 0;
    const w = watchDevicePixelRatio(() => n++);
    expect(queries.map((q) => q.media)).toEqual(['(resolution: 3dppx)']);
    changeDpr(2);
    expect(n).toBe(1);
    expect(queries[1].media).toBe('(resolution: 2dppx)');
    expect(queries[0].listeners.size).toBe(0);
    changeDpr(1.5);
    expect(n).toBe(2);
    expect(queries.filter((q) => q.listeners.size > 0).map((q) => q.media)).toEqual(['(resolution: 1.5dppx)']);
    w.dispose();
    expect(queries.every((q) => q.listeners.size === 0)).toBe(true);
    changeDpr(3);
    expect(n).toBe(2);
  });

  it('is inert without matchMedia', () => {
    delete g.matchMedia;
    expect(() => watchDevicePixelRatio(() => {}).dispose()).not.toThrow();
  });
});
