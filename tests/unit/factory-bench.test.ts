// ADR-0002 bench (02 §10.11 #12). Skipped by default; run with HF_BENCH=1 to print tick p50 / p95 in Node.
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildBenchFixture, runFactoryBench } from '../../tools/bench/factoryBench';

const BENCH = !!process.env.HF_BENCH;

describe('factory bench fixture', () => {
  it('builds through commands with every MVP node and 24 lifts', () => {
    const fx = buildBenchFixture();
    expect(fx.kinds).toMatchObject({ lift: 24, headframe: 13, router: 1, export: 12 });
    for (const k of ['belt', 'router', 'bin', 'smelter', 'assembler', 'export', 'headframe', 'autoDrill', 'lift']) {
      expect(k === 'belt' ? fx.beltTiles : fx.kinds[k]).toBeGreaterThan(0);
    }
    expect(fx.entities + fx.beltTiles).toBeGreaterThan(2_000);
    for (let i = 0; i < 50; i++) fx.f.tick();
    expect(fx.f.debug.conservationOk()).toBe(true);
  });

  it.skipIf(!BENCH)('reports tick p50 / p95 (normal, SIM_NO_SLEEP, dense)', () => {
    for (const [noSleep, dense] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      const r = runFactoryBench({ now: () => performance.now(), noSleep, dense });
      console.log(
        `factory bench${dense ? ' dense' : ''}${noSleep ? ' SIM_NO_SLEEP' : ''}: p50 ${r.p50.toFixed(3)} ms, p95 ${r.p95.toFixed(3)} ms, p99 ${r.p99.toFixed(3)} ms, ` +
          `mean ${r.mean.toFixed(3)} ms, max ${r.max.toFixed(2)} ms over ${r.ticks} ticks; ${r.entities} entities + ${r.beltTiles} belt tiles, ` +
          `${r.items} items; per min ${JSON.stringify(r.perMinute)}; build ${r.buildMs.toFixed(0)} ms; ${JSON.stringify(r.kinds)}`,
      );
      expect(r.perMinute.sold).toBeGreaterThan(100);
      expect(r.p95).toBeLessThan(10);
    }
  }, 600_000);
});
