// Perf Report (04 §10.3): device evidence from the user's phones travels as a paste code,
// `HFP1:` + base64url(deflate-raw(JSON)). Segments split the capture per look/tier (A-B-A-B sessions).
import type { QualityTier } from '../render/api';
import type { Look, Scope } from '../shared/types';
import { deflateRaw, inflateRaw } from '../save/compress';
import { fromBase64Url, toBase64Url } from './base64url';
import { estimateDisplayHz, type PerfMonitor } from './perf';

export const PERF_REPORT_PREFIX = 'HFP1:';
/** Also accepted when decoding (an earlier task brief named the prefix HFPR). */
const ACCEPTED_PREFIXES = [PERF_REPORT_PREFIX, 'HFPR:'] as const;

export interface PerfSegment {
  look: Look;
  tier: QualityTier;
  frames: number;
  dropped: number;
  droppedRate: number;
  displayHz: number;
  /** rAF interval histogram, 2-ms buckets, last = overflow (≥ 100 ms). */
  hist: number[];
  cpuP50: number;
  cpuP95: number;
}

export interface JetsamSummary {
  /** Median kill point in MB per mode, from 3 runs (04 §10.4). */
  arraybufferMB: number | null;
  webglMB: number | null;
}

export interface PerfReport {
  v: 1;
  build: string;
  scope: Scope;
  createdAt: string;
  device: {
    ua: string;
    dpr: number;
    deviceMemory: number | null;
    standalone: boolean;
    viewport: [number, number];
  };
  look: Look;
  tier: QualityTier;
  segments: PerfSegment[];
  drawCalls: number;
  triangles: number;
  marks: { firstFrameMs: number | null; firstInputMs: number | null };
  heapMB: number | null;
  gpuEstimateMB: number;
  jetsam: JetsamSummary | null;
}

function round(v: number, digits = 2): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

/** One look/tier segment. Drops are judged at the display rate the capture actually ran at (canon §3.14). */
export function segmentFromMonitor(m: PerfMonitor, look: Look, tier: QualityTier): PerfSegment {
  const displayHz = estimateDisplayHz(m.hist);
  const dropped = m.droppedAt(displayHz);
  return {
    look,
    tier,
    frames: m.frames,
    dropped,
    droppedRate: round(m.frames > 0 ? dropped / m.frames : 0, 4),
    displayHz,
    hist: Array.from(m.hist),
    cpuP50: round(m.workPercentile(0.5)),
    cpuP95: round(m.workPercentile(0.95)),
  };
}

/**
 * Rough GPU memory for the frame targets: the default framebuffer (colour + depth) plus one full-size
 * offscreen target (Toon outline pass / Pixel Lab MRT). Textures and geometry come on top.
 */
export function estimateGpuMB(width: number, height: number, dpr: number): number {
  const px = width * height * dpr * dpr;
  return round((px * 8 * 2) / (1024 * 1024), 1);
}

/** JS heap in MB (Chromium's non-standard performance.memory), else null. */
export function heapMB(): number | null {
  const m = (typeof performance !== 'undefined' ? (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory : undefined)?.usedJSHeapSize;
  return typeof m === 'number' ? round(m / (1024 * 1024), 1) : null;
}

export async function encodePerfReport(r: PerfReport): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(r));
  return PERF_REPORT_PREFIX + toBase64Url(await deflateRaw(json));
}

export async function decodePerfReport(code: string): Promise<PerfReport> {
  const s = code.trim();
  const prefix = ACCEPTED_PREFIXES.find((p) => s.startsWith(p));
  if (!prefix) throw new Error('Not a Perf Report code');
  const json = new TextDecoder().decode(await inflateRaw(fromBase64Url(s.slice(prefix.length))));
  const r = JSON.parse(json) as PerfReport;
  if (r.v !== 1) throw new Error(`Unsupported Perf Report version ${String(r.v)}`);
  return r;
}

/** Collects segments as the look or tier changes during a session. */
export class PerfRecorder {
  readonly segments: PerfSegment[] = [];

  constructor(
    readonly monitor: PerfMonitor,
    private look: Look,
    private tier: QualityTier,
  ) {}

  /** Close the running segment and start a new one (A-B-A-B style test). */
  switchTo(look: Look, tier: QualityTier): void {
    if (look === this.look && tier === this.tier) return;
    this.closeSegment();
    this.look = look;
    this.tier = tier;
  }

  /** All closed segments plus a snapshot of the running one. */
  snapshot(): PerfSegment[] {
    const out = this.segments.slice();
    if (this.monitor.frames > 0) out.push(segmentFromMonitor(this.monitor, this.look, this.tier));
    return out;
  }

  private closeSegment(): void {
    if (this.monitor.frames > 0) this.segments.push(segmentFromMonitor(this.monitor, this.look, this.tier));
    this.monitor.reset();
  }
}
