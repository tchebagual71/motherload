import { describe, expect, it } from 'vitest';
import { bucketOf, droppedThresholdMs, estimateDisplayHz, HIST_BUCKETS, PerfMonitor } from '../../src/debug/perf';
import { decodePerfReport, encodePerfReport, estimateGpuMB, PERF_REPORT_PREFIX, PerfRecorder, type PerfReport } from '../../src/debug/perfReport';
import { emptyState, median, settleKilledRun, summarize } from '../../src/debug/jetsam';
import { fromBase64Url, toBase64Url } from '../../src/debug/base64url';

function feed(m: PerfMonitor, intervals: number[], t0 = 0): number {
  let t = t0;
  m.frame(t);
  for (const dt of intervals) m.frame((t += dt));
  return t;
}

describe('PerfMonitor (canon §3.14 dropped frames)', () => {
  it('uses 1.25 × the display interval as the drop threshold', () => {
    expect(droppedThresholdMs(60)).toBeCloseTo(20.83, 2);
    expect(droppedThresholdMs(30)).toBeCloseTo(41.67, 2);
  });

  it('counts dropped frames and fills the histogram', () => {
    const m = new PerfMonitor(60);
    feed(m, [16.7, 16.7, 16.7, 33.4, 16.7, 20, 21]);
    expect(m.frames).toBe(7);
    expect(m.dropped).toBe(2); // 33.4 and 21 exceed 20.83; 20 does not
    expect(m.droppedRate).toBeCloseTo(2 / 7, 6);
    expect(m.hist[bucketOf(16.7)]).toBe(4);
    expect(bucketOf(500)).toBe(HIST_BUCKETS);
  });

  it('measures fps over a window and skips hidden gaps', () => {
    const m = new PerfMonitor(60);
    const t = feed(m, new Array(60).fill(1000 / 60));
    expect(m.fps).toBeGreaterThan(55);
    m.skipGap();
    m.frame(t + 5_000);
    expect(m.dropped).toBe(0);
  });

  it('reports main-thread work percentiles', () => {
    const m = new PerfMonitor();
    for (let i = 1; i <= 100; i++) m.recordWork(i);
    expect(m.workPercentile(0.5)).toBe(51);
    expect(m.workPercentile(0.95)).toBe(96);
  });

  it('estimates the display rate from the histogram mode', () => {
    const m60 = new PerfMonitor();
    feed(m60, new Array(50).fill(16.7));
    expect(estimateDisplayHz(m60.hist)).toBe(60);
    const m120 = new PerfMonitor();
    feed(m120, new Array(50).fill(8.3));
    expect(estimateDisplayHz(m120.hist)).toBe(120);
  });
});

describe('Perf Report code (04 §10.3)', () => {
  function report(): PerfReport {
    const m = new PerfMonitor(60);
    feed(m, [16.7, 16.7, 40]);
    const rec = new PerfRecorder(m, 'toon', 'mid');
    rec.switchTo('pixel', 'mid');
    feed(m, [16.7, 16.7], 1_000);
    return {
      v: 1,
      build: '0.1.0',
      scope: 'm0',
      createdAt: '2026-10-01T00:00:00.000Z',
      device: { ua: 'test', dpr: 2, deviceMemory: null, standalone: true, viewport: [375, 667] },
      look: 'pixel',
      tier: 'mid',
      segments: rec.snapshot(),
      drawCalls: 42,
      triangles: 12_000,
      marks: { firstFrameMs: 900, firstInputMs: null },
      heapMB: null,
      gpuEstimateMB: estimateGpuMB(375, 667, 2),
      jetsam: { arraybufferMB: 800, webglMB: null },
    };
  }

  it('splits segments per look (A-B sessions)', () => {
    const r = report();
    expect(r.segments.map((s) => [s.look, s.frames, s.dropped])).toEqual([
      ['toon', 3, 1],
      ['pixel', 2, 0],
    ]);
  });

  it('round-trips through HFP1: + base64url(deflate-raw(JSON))', async () => {
    const r = report();
    const code = await encodePerfReport(r);
    expect(code.startsWith(PERF_REPORT_PREFIX)).toBe(true);
    expect(code).toMatch(/^HFP1:[A-Za-z0-9_-]+$/);
    expect(await decodePerfReport(code)).toEqual(r);
    expect(await decodePerfReport(code.replace('HFP1:', 'HFPR:'))).toEqual(r);
  });

  it('rejects foreign codes', async () => {
    await expect(decodePerfReport('HF1:abc')).rejects.toThrow();
  });

  it('base64url round-trips arbitrary bytes', () => {
    const b = new Uint8Array(70_000).map((_, i) => (i * 31) & 0xff);
    expect(fromBase64Url(toBase64Url(b))).toEqual(b);
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });
});

describe('jetsam probe bookkeeping (04 §10.4)', () => {
  it('a run still active at load was killed at its last logged total', () => {
    const s = settleKilledRun({ ...emptyState(), active: { mode: 'webgl', mb: 730 } });
    expect(s.runs.webgl).toEqual([730]);
    expect(s.active).toBeNull();
  });

  it('reports the median kill point per mode', () => {
    expect(median([900, 700, 800])).toBe(800);
    expect(median([])).toBeNull();
    const s = { ...emptyState(), runs: { arraybuffer: [700, 900, 800], webgl: [] } };
    expect(summarize(s)).toEqual({ arraybufferMB: 800, webglMB: null });
  });
});
