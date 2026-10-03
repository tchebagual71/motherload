// Automatic quality (canon §3.14; 04 §5.8, §10.5): the title benchmark, dynamic resolution, Low Power Mode,
// crash-loop tracking, the drop ladder and the loop's battery-mode frame admission.
import { describe, expect, it } from 'vitest';
import {
  BENCH,
  DR,
  DynamicResolution,
  FRAME_30_MS,
  FRAME_60_MS,
  LowPowerDetector,
  QualityGovernor,
  RUN,
  RunTracker,
  TitleBenchmark,
  benchmarkVerdict,
  createLoopQuality,
  readQualityRecord,
  stepTier,
  type FrameSample,
  type TierChangeReason,
} from '../../src/app/qualityGovernor';
import { resolveTier, type TierProbe } from '../../src/app/tier';
import { memoryKeyValue, type KeyValue } from '../../src/platform/storage';
import type { QualityTier } from '../../src/render/api';
import { QUALITY, toonDpr } from '../../src/render/quality';

const IOS: TierProbe = { ios: true, android: false, deviceMemory: null };
const ANDROID_LOW: TierProbe = { ios: false, android: true, deviceMemory: 3 };
const KEY = 'hf-test.quality';

function sample(patch: Partial<FrameSample> = {}): FrameSample {
  return {
    now: 0,
    intervalMs: FRAME_60_MS,
    workMs: 3,
    submitMs: 1,
    phase: 'play',
    look: 'toon',
    tier: 'mid',
    deviceDpr: 3,
    manualTier: false,
    contextLost: false,
    rimArrival: false,
    battery: false,
    ...patch,
  };
}

interface Rig {
  kv: KeyValue;
  gov: QualityGovernor;
  changes: [QualityTier, TierChangeReason][];
}

function rig(opts: { kv?: KeyValue; pinned?: boolean; device?: TierProbe } = {}): Rig {
  const kv = opts.kv ?? memoryKeyValue();
  const changes: [QualityTier, TierChangeReason][] = [];
  const gov = new QualityGovernor({ kv, key: KEY, device: opts.device ?? IOS, pinned: opts.pinned ?? false });
  gov.setOnChange((t, r) => changes.push([t, r]));
  return { kv, gov, changes };
}

/** Feed `n` frames from `t0`, `dt` apart, returning the time after the last. */
function run(gov: QualityGovernor, n: number, t0: number, patch: Partial<FrameSample>, dt = patch.intervalMs ?? FRAME_60_MS): number {
  let t = t0;
  for (let i = 0; i < n; i++) {
    t += dt;
    gov.frame(sample({ ...patch, now: t }));
  }
  return t;
}

describe('title benchmark (04 §5.8)', () => {
  it('moves up at p50 submit ≤ 2.0 ms with ≤ 1% drops, down above 4.5 ms or 5% drops', () => {
    expect(benchmarkVerdict(1.5, 0)).toBe(1);
    expect(benchmarkVerdict(2.0, 0.01)).toBe(1);
    expect(benchmarkVerdict(2.5, 0)).toBe(0);
    expect(benchmarkVerdict(1.5, 0.03)).toBe(0);
    expect(benchmarkVerdict(4.6, 0)).toBe(-1);
    expect(benchmarkVerdict(1.0, 0.06)).toBe(-1);
  });

  it('skips the warm-up frames, then measures 600 and counts drops past 1.25 × 16.7 ms', () => {
    const b = new TitleBenchmark();
    for (let i = 0; i < BENCH.warmup; i++) b.sample(100, 50);
    for (let i = 0; i < BENCH.frames - 1; i++) b.sample(FRAME_60_MS, 1.2);
    expect(b.done).toBe(false);
    b.sample(FRAME_60_MS, 1.2);
    expect(b.done).toBe(true);
    expect(b.verdict()).toBe(1);
    const slow = new TitleBenchmark();
    for (let i = 0; i < BENCH.warmup + BENCH.frames; i++) slow.sample(i % 10 === 0 ? 30 : FRAME_60_MS, 1.2);
    expect(slow.verdict()).toBe(-1);
  });
});

describe('dynamic resolution (04 §5.8)', () => {
  it('steps down 0.125 once 30 of 60 frames are over budget, at most every 2 s, never below the floor', () => {
    const dr = new DynamicResolution(1.5, 0.9);
    let t = 0;
    let changed = 0;
    for (let i = 0; i < 29; i++) changed += dr.frame((t += 16), true, false) ? 1 : 0;
    expect(changed).toBe(0);
    expect(dr.frame((t += 16), true, false)).toBe(true);
    expect(dr.dpr).toBeCloseTo(1.5 - DR.step, 6);
    // The window restarts and the 2-s gap holds the next step back.
    for (let i = 0; i < 60; i++) dr.frame((t += 16), true, false);
    expect(dr.dpr).toBeCloseTo(1.5 - DR.step, 6);
    for (let i = 0; i < 2000; i++) dr.frame((t += 16), true, false);
    expect(dr.dpr).toBeCloseTo(0.9, 6);
    expect(dr.atFloor).toBe(true);
  });

  it('steps up after 5 s under 70% of budget, back to the cap and no further', () => {
    const dr = new DynamicResolution(1.5, 0.9);
    dr.dpr = 1.25;
    let t = 0;
    t += 4_900;
    dr.frame(0, false, true);
    expect(dr.frame(t, false, true)).toBe(false);
    expect(dr.frame((t += 200), false, true)).toBe(true);
    expect(dr.dpr).toBeCloseTo(1.375, 6);
    for (let i = 0; i < 1000; i++) dr.frame((t += 50), false, true);
    expect(dr.dpr).toBeCloseTo(1.5, 6);
  });

  it('waits longer before trying again after a step up bounces straight back down', () => {
    const dr = new DynamicResolution(1.5, 0.9);
    dr.dpr = 1.25;
    let t = 0;
    dr.frame(t, false, true);
    dr.frame((t += DR.upAfterMs), false, true);
    expect(dr.dpr).toBeCloseTo(1.375, 6);
    t += DR.minGapMs;
    for (let i = 0; i < DR.downAt; i++) dr.frame((t += 16), true, false);
    expect(dr.dpr).toBeCloseTo(1.25, 6);
    // Under budget again: 5 s is no longer enough.
    const start = (t += DR.minGapMs);
    dr.frame(start, false, true);
    dr.frame(start + DR.upAfterMs + 10, false, true);
    expect(dr.dpr).toBeCloseTo(1.25, 6);
    dr.frame(start + 2 * DR.upAfterMs + 10, false, true);
    expect(dr.dpr).toBeCloseTo(1.375, 6);
  });

  it('reports overload after 20 s at the floor and still over budget', () => {
    const dr = new DynamicResolution(0.9, 0.9);
    let t = 0;
    for (let i = 0; i < DR.downAt; i++) dr.frame((t += 16), true, false);
    const busySince = t;
    while (t - busySince < DR.overloadMs - 100) dr.frame((t += 16), true, false);
    expect(dr.overloaded(t)).toBe(false);
    for (let i = 0; i < 20; i++) dr.frame((t += 16), true, false);
    expect(dr.overloaded(t)).toBe(true);
    // Half the window recovering clears it.
    for (let i = 0; i < 40; i++) dr.frame((t += 16), false, false);
    expect(dr.overloaded(t)).toBe(false);
  });

  it('feeds the Toon render DPR between the tier floor and cap; the style test pins it', () => {
    expect(toonDpr(3, 'mid', false)).toBe(QUALITY.mid.dprCap);
    expect(toonDpr(3, 'mid', false, 1.125)).toBe(1.125);
    expect(toonDpr(3, 'mid', false, 0.5)).toBe(QUALITY.mid.dprFloor);
    expect(toonDpr(3, 'mid', false, 4)).toBe(QUALITY.mid.dprCap);
    expect(toonDpr(1, 'high', false, 1.6)).toBe(1);
    expect(toonDpr(3, 'low', true, 0.8)).toBe(2);
  });
});

describe('Low Power Mode detection (04 §5.8)', () => {
  it('enters after 3 s of a light 33-ms cadence and leaves after 3 s back at 60 Hz', () => {
    const lpm = new LowPowerDetector();
    let t = 0;
    for (let i = 0; i < 80; i++) lpm.frame((t += FRAME_30_MS), FRAME_30_MS, 3);
    expect(lpm.active).toBe(false);
    for (let i = 0; i < 20; i++) lpm.frame((t += FRAME_30_MS), FRAME_30_MS, 3);
    expect(lpm.active).toBe(true);
    for (let i = 0; i < 170; i++) lpm.frame((t += FRAME_60_MS), FRAME_60_MS, 3);
    expect(lpm.active).toBe(true);
    for (let i = 0; i < 20; i++) lpm.frame((t += FRAME_60_MS), FRAME_60_MS, 3);
    expect(lpm.active).toBe(false);
  });

  it('never mistakes a heavy 30-fps frame (overload) or a stutter for Low Power Mode', () => {
    const lpm = new LowPowerDetector();
    let t = 0;
    for (let i = 0; i < 200; i++) lpm.frame((t += FRAME_30_MS), FRAME_30_MS, 14);
    expect(lpm.active).toBe(false);
    for (let i = 0; i < 200; i++) lpm.frame((t += FRAME_30_MS), i % 20 === 0 ? FRAME_60_MS : FRAME_30_MS, 3);
    expect(lpm.active).toBe(false);
  });
});

describe('crash loops (04 §10.5)', () => {
  it('flags a boot from `running` within 30 s of a beat; hidden kills and stale beats never count', () => {
    const kv = memoryKeyValue();
    let now = 1_000_000;
    const tracker = () => new RunTracker(kv, 'hf-test.run', () => now);
    expect(tracker().boot()).toBe(false);
    now += 12_000;
    expect(tracker().boot()).toBe(true);
    const a = tracker();
    a.boot();
    a.clean();
    now += 1_000;
    expect(tracker().boot()).toBe(false);
    now += RUN.deathWindowMs + 1;
    expect(tracker().boot()).toBe(false);
  });

  it('beats at most every 10 s while visible', () => {
    const kv = memoryKeyValue();
    let now = 0;
    const t = new RunTracker(kv, 'k', () => now);
    t.boot();
    const at = () => JSON.parse(kv.get('k') ?? '{}').at as number;
    now = 5_000;
    t.beat();
    expect(at()).toBe(0);
    now = RUN.beatMs;
    t.beat();
    expect(at()).toBe(RUN.beatMs);
  });
});

describe('quality governor', () => {
  it('starts at the device default and keeps the persisted auto tier', () => {
    expect(rig({ device: ANDROID_LOW }).gov.tier).toBe('low');
    const kv = memoryKeyValue({ [KEY]: JSON.stringify({ tier: 'high', noRaise: false, fps30: false }) });
    expect(rig({ kv }).gov.tier).toBe('high');
    expect(readQualityRecord(memoryKeyValue({ [KEY]: '{"tier":"ultra"}' }), KEY, IOS).tier).toBe('mid');
    expect(resolveTier('auto', null, IOS, 'low')).toBe('low');
    expect(resolveTier('high', null, IOS, 'low')).toBe('high');
  });

  it('walks the drop ladder high → mid → low → low + 30 fps and never raises after a drop', () => {
    const kv = memoryKeyValue({ [KEY]: JSON.stringify({ tier: 'high' }) });
    const { gov, changes } = rig({ kv });
    gov.crashed();
    expect(gov.tier).toBe('mid');
    gov.crashed();
    gov.crashed();
    expect(gov.tier).toBe('low');
    expect(gov.forced30).toBe(true);
    expect(changes.map((c) => c[1])).toEqual(['crash', 'crash', 'crash']);
    expect(JSON.parse(kv.get(KEY) ?? '{}')).toEqual({ tier: 'low', noRaise: true, fps30: true });
    // A fast benchmark after a drop is ignored.
    let t = run(gov, BENCH.warmup + BENCH.frames, 0, { phase: 'title', submitMs: 0.5 });
    gov.frame(sample({ now: (t += 16), rimArrival: true }));
    expect(gov.tier).toBe('low');
    expect(stepTier('low', -1)).toBe('low');
    expect(stepTier('high', 1)).toBe('high');
  });

  it('applies the benchmark move once, at the next Rim arrival, and not under a picked tier', () => {
    const { gov, changes } = rig();
    let t = run(gov, BENCH.warmup + BENCH.frames, 0, { phase: 'title', submitMs: 1 });
    expect(gov.tier).toBe('mid');
    t = run(gov, 100, t, { phase: 'play' });
    gov.frame(sample({ now: (t += 16), rimArrival: true, manualTier: true }));
    expect(gov.tier).toBe('mid');
    gov.frame(sample({ now: (t += 16), rimArrival: true }));
    expect(gov.tier).toBe('high');
    expect(changes).toEqual([['high', 'benchmark']]);
    gov.frame(sample({ now: (t += 16), rimArrival: true }));
    expect(gov.tier).toBe('high');
  });

  it('benchmarks only title frames that drew at the full cadence', () => {
    const { gov } = rig();
    let t = run(gov, BENCH.warmup + BENCH.frames, 0, { phase: 'title', battery: true, intervalMs: FRAME_30_MS });
    t = run(gov, BENCH.warmup + BENCH.frames, t, { phase: 'title', submitMs: 0 });
    gov.frame(sample({ now: (t += 16), rimArrival: true }));
    expect(gov.tier).toBe('mid');
  });

  it('drops a tier after 20 s at the resolution floor still over budget, never under a picked tier', () => {
    const { gov, changes } = rig();
    const slow = { intervalMs: 30, workMs: 14 };
    let t = run(gov, 60 * 40, 0, { ...slow, manualTier: true });
    expect(changes).toEqual([]);
    t = run(gov, 60 * 40, t, slow);
    expect(changes[0]).toEqual(['low', 'overload']);
    expect(gov.tier).toBe('low');
    expect(gov.renderDpr).toBeGreaterThan(0);
    // 30-fps battery frames are on budget.
    const after = changes.length;
    run(gov, 60 * 40, t, { tier: 'low', intervalMs: FRAME_30_MS, battery: true });
    expect(changes.length).toBe(after);
  });

  it('lowers the render DPR in production Toon only', () => {
    const { gov } = rig();
    run(gov, 60, 0, { look: 'pixel', intervalMs: 30 });
    expect(gov.renderDpr).toBeUndefined();
    run(gov, 60, 10_000, { intervalMs: 30 });
    expect(gov.renderDpr).toBeCloseTo(QUALITY.mid.dprCap - DR.step, 6);
  });

  it('drops a tier after 3 context losses within a minute', () => {
    const { gov, changes } = rig();
    let t = 0;
    for (let i = 0; i < 3; i++) {
      gov.frame(sample({ now: (t += 5_000), contextLost: true }));
      gov.frame(sample({ now: (t += 5_000) }));
    }
    expect(changes).toEqual([['low', 'context']]);
  });

  it('does nothing when the tier is pinned (URL, style test)', () => {
    const { gov, changes } = rig({ pinned: true });
    let t = run(gov, BENCH.warmup + BENCH.frames, 0, { phase: 'title', submitMs: 0.5 });
    t = run(gov, 60 * 40, t, { intervalMs: 30, workMs: 14 });
    gov.frame(sample({ now: t + 16, rimArrival: true }));
    expect(changes).toEqual([]);
    expect(gov.renderDpr).toBeUndefined();
    for (let i = 0; i < 300; i++) gov.cadence(i * FRAME_30_MS, FRAME_30_MS);
    expect(gov.lowPower).toBe(false);
  });
});

describe('battery mode in the loop (04 §5.8)', () => {
  function loopQuality(battery: boolean, auto = true, kv = memoryKeyValue()) {
    const gov = new QualityGovernor({ kv, key: KEY, device: IOS, pinned: false });
    return { gov, q: createLoopQuality(gov, null, { batterySetting: () => battery, autoTier: () => auto }) };
  }

  function admitted(q: ReturnType<typeof loopQuality>['q'], frames: number, dt: number): number {
    let n = 0;
    for (let i = 1; i <= frames; i++) n += q.admit(i * dt) ? 1 : 0;
    return n;
  }

  it('runs every frame normally and every other 60-Hz frame (every fourth at 120 Hz) with the setting on', () => {
    expect(admitted(loopQuality(false).q, 60, FRAME_60_MS)).toBe(60);
    expect(admitted(loopQuality(true).q, 60, FRAME_60_MS)).toBe(30);
    expect(admitted(loopQuality(true).q, 120, 1000 / 120)).toBe(30);
    expect(loopQuality(true).q.battery).toBe(true);
  });

  it('turns on by itself under Low Power Mode, and at the bottom rung only while Quality is Auto', () => {
    const { q } = loopQuality(false);
    let t = 0;
    for (let i = 0; i < 120; i++) {
      q.admit((t += FRAME_30_MS));
      q.report(sample({ now: t, intervalMs: FRAME_30_MS, workMs: 2 }));
    }
    expect(q.battery).toBe(true);
    const rung = memoryKeyValue({ [KEY]: JSON.stringify({ tier: 'low', noRaise: true, fps30: true }) });
    expect(loopQuality(false, true, rung).q.battery).toBe(true);
    expect(loopQuality(false, false, rung).q.battery).toBe(false);
  });

  it('tells the governor the frame ran in battery mode', () => {
    const { gov, q } = loopQuality(true);
    const s = sample({ intervalMs: FRAME_30_MS });
    q.report(s);
    expect(s.battery).toBe(true);
    expect(gov.renderDpr).toBe(QUALITY.mid.dprCap);
  });
});
