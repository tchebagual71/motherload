// Frame-time monitor (04 §10.1; canon §3.14): rAF interval histogram, dropped-frame rate (an interval longer
// than 1.25 × the display interval — never raw p95 vs 16.7 ms), live fps and main-thread work percentiles.
// No allocation per frame.

export const HIST_BUCKET_MS = 2;
export const HIST_BUCKETS = 50; // 0–100 ms in 2-ms buckets, plus one overflow bucket
const WORK_SAMPLES = 600;
const FPS_WINDOW_MS = 500;

/** Canon §3.14: dropped frame = interval > 1.25 × display interval (20.8 ms at 60 Hz, 41.7 ms at 30). */
export function droppedThresholdMs(displayHz: number): number {
  return (1.25 * 1000) / displayHz;
}

export function bucketOf(intervalMs: number): number {
  return Math.min(HIST_BUCKETS, Math.max(0, Math.floor(intervalMs / HIST_BUCKET_MS)));
}

/** Most common display rate implied by a histogram (60, 90, 120 or 30 Hz). */
export function estimateDisplayHz(hist: ArrayLike<number>): number {
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < HIST_BUCKETS; i++) {
    if (hist[i] > bestCount) {
      bestCount = hist[i];
      best = i;
    }
  }
  const ms = (best + 0.5) * HIST_BUCKET_MS;
  const rates = [120, 90, 60, 30];
  let hz = 60;
  let err = Infinity;
  for (const r of rates) {
    const e = Math.abs(1000 / r - ms);
    if (e < err) {
      err = e;
      hz = r;
    }
  }
  return hz;
}

export class PerfMonitor {
  readonly hist = new Uint32Array(HIST_BUCKETS + 1);
  frames = 0;
  dropped = 0;
  private last = -1;
  private threshold: number;
  private readonly work = new Float32Array(WORK_SAMPLES);
  private workN = 0;
  private windowStart = -1;
  private windowFrames = 0;
  private fpsValue = 0;
  private lastInterval = 0;
  readonly startedAt: number;

  constructor(
    private displayHz = 60,
    now = 0,
  ) {
    this.threshold = droppedThresholdMs(displayHz);
    this.startedAt = now;
  }

  setDisplayHz(hz: number): void {
    this.displayHz = hz;
    this.threshold = droppedThresholdMs(hz);
  }

  /** Call at the top of every rAF callback with its timestamp. */
  frame(t: number): void {
    if (this.windowStart < 0) this.windowStart = t;
    this.windowFrames++;
    if (t - this.windowStart >= FPS_WINDOW_MS) {
      this.fpsValue = (this.windowFrames * 1000) / (t - this.windowStart);
      this.windowStart = t;
      this.windowFrames = 0;
    }
    if (this.last >= 0) {
      const dt = t - this.last;
      this.lastInterval = dt;
      this.hist[bucketOf(dt)]++;
      this.frames++;
      if (dt > this.threshold) this.dropped++;
    }
    this.last = t;
  }

  /** Main-thread ms spent in the frame body. */
  recordWork(ms: number): void {
    this.work[this.workN % WORK_SAMPLES] = ms;
    this.workN++;
  }

  /** The rAF clock jumped (page was hidden): do not count the gap as a dropped frame. */
  skipGap(): void {
    this.last = -1;
    this.windowStart = -1;
    this.windowFrames = 0;
  }

  get fps(): number {
    return this.fpsValue;
  }

  get frameMs(): number {
    return this.lastInterval;
  }

  get droppedRate(): number {
    return this.frames > 0 ? this.dropped / this.frames : 0;
  }

  /** Percentile (0..1) of recent main-thread work samples. */
  workPercentile(p: number): number {
    const n = Math.min(this.workN, WORK_SAMPLES);
    if (n === 0) return 0;
    const sorted = Array.from(this.work.subarray(0, n)).sort((a, b) => a - b);
    return sorted[Math.min(n - 1, Math.floor(p * n))];
  }

  reset(): void {
    this.hist.fill(0);
    this.frames = 0;
    this.dropped = 0;
    this.workN = 0;
    this.skipGap();
  }
}
