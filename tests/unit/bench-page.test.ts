// Browser bench core (ADR-0002; 04 §3.4; src/debug/bench.ts): the MVP-17 fixture built through commands inside a
// live World, the tick timer on the World's factory, the statistics and the HFB1 result code.
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { NO_INTENT } from '../../src/pod/types';
import { BENCH_PREFIX, TickTimer, benchWorld, decodeBench, displayHz, dist, droppedRate, encodeBench, timerResolution, type BenchReport } from '../../src/debug/bench';

const now = (): number => performance.now();

describe('browser bench core', () => {
  it('builds the MVP-17 fixture in a live v1 World through commands and ticks it from World.step', () => {
    const { world, counts, buildMs } = benchWorld(7, now);
    const f = world.factory!;
    expect(world.scope).toBe('v1');
    expect(counts.kinds).toMatchObject({ lift: 24, headframe: 12, router: 1, export: 12 });
    expect(counts.kinds.autoDrill).toBeGreaterThan(150);
    for (const k of ['belt', 'router', 'bin', 'smelter', 'assembler', 'export', 'headframe', 'autoDrill', 'lift']) {
      expect(k === 'belt' ? counts.beltTiles : counts.kinds[k]).toBeGreaterThan(0);
    }
    expect(counts.entities + counts.beltTiles).toBeGreaterThan(2_000);
    expect(f.entities().some((e) => e.rusted)).toBe(false);
    expect(buildMs).toBeGreaterThan(0);

    const timer = new TickTimer(f, 400, now);
    timer.recording = true;
    for (let i = 0; i < 1_500; i++) {
      world.step(NO_INTENT, true);
      world.drainEvents();
    }
    expect(timer.ticks).toBe(500);
    expect(timer.n).toBe(400);
    expect(timer.full).toBe(true);
    expect(f.tickNo).toBe(500);
    expect(f.debug.conservationOk()).toBe(true);
    expect(f.debug.itemsHeld()).toBeGreaterThan(1_000); // the lifts fill over ~8,000 ticks to ≈ 10k items
    // The pod stays parked on the Rim clear of the lift shafts.
    expect(world.pod.grounded && world.pod.y > 0).toBe(true);
    const d = dist(timer.samples, timer.n);
    expect(d.n).toBe(400);
    expect(d.p50).toBeLessThanOrEqual(d.p95);
    expect(d.p95).toBeLessThanOrEqual(d.max);
    // Batches tick the same factory back to back (no World step) and time each batch once.
    const mean = timer.batch(200);
    expect(mean).toBeGreaterThan(0);
    expect(f.tickNo).toBe(700);
    expect(timer.ticks).toBe(700);
    expect(f.debug.conservationOk()).toBe(true);
    expect(timerResolution(now, 5)).toBeGreaterThan(0);
  });

  it('computes distributions, dropped frames and the display rate', () => {
    const s = new Float64Array([4, 1, 3, 2, 100, 5, 6, 7, 8, 9]);
    expect(dist(s)).toMatchObject({ p50: 6, max: 100, n: 10 });
    expect(dist(s, 4)).toMatchObject({ p50: 3, max: 4, n: 4 });
    const frames = new Float64Array([16.7, 16.6, 16.8, 33.4, 16.7]);
    expect(displayHz(16.7)).toBe(60);
    expect(displayHz(8.4)).toBe(120);
    expect(droppedRate(frames, 5, 60)).toBeCloseTo(0.2);
  });

  it('round-trips the HFB1 code', async () => {
    const r: BenchReport = {
      v: 1,
      build: 'test',
      scope: 'v1',
      mode: 'live',
      view: 'yard',
      dense: false,
      ua: 'node',
      gpu: 'none',
      dpr: 2,
      look: 'toon',
      quality: 'low',
      entities: 254,
      beltTiles: 2213,
      buildings: 2467,
      items: 9691,
      kinds: { lift: 24 },
      buildMs: 300,
      prefillTicks: 8000,
      warmupTicks: 1200,
      tick: { p50: 0.01, p95: 0.02, p99: 0.03, mean: 0.012, max: 0.2, n: 6000 },
      tickBatch: { p50: 0.011, p95: 0.013, p99: 0.014, mean: 0.011, max: 0.015, n: 30 },
      timerResMs: 0.1,
      frame: { p50: 16.7, p95: 17, p99: 20, mean: 16.8, max: 40, n: 18000 },
      work: { p50: 2, p95: 3, p99: 4, mean: 2.1, max: 9, n: 18000 },
      dropped: 0.01,
      displayHz: 60,
      drawCalls: 60,
      triangles: 40_000,
      gatePass: true,
    };
    const code = await encodeBench(r);
    expect(code.startsWith(BENCH_PREFIX)).toBe(true);
    expect(code).toMatch(/^HFB1:[A-Za-z0-9_-]+$/);
    expect(await decodeBench(code)).toEqual(r);
    await expect(decodeBench('HFP1:abc')).rejects.toThrow(/bench code/);
  });
});
