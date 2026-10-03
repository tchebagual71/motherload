// Automatic quality (canon §3.14 "Tiers"; 04 §5.8, §10.5): the auto tier (device default, a background title-screen
// benchmark applied at the next Rim arrival, crash-loop / context-loss / sustained-overload drops), dynamic
// resolution for production Toon, and battery mode (Low Power Mode suspected, or the setting). No DOM: storage and
// the wall clock are injected; boot.ts wires the page lifecycle (createQuality).
import type { QualityTier } from '../render/api';
import { QUALITY } from '../render/quality';
import { readJson, writeJson, type KeyValue } from '../platform/storage';
import type { Look } from '../shared/types';
import { defaultTier, isQualityTier, type TierProbe } from './tier';

const LADDER: readonly QualityTier[] = ['low', 'mid', 'high'];

/** Canon §3.14 main-thread p95 budget per tier (ms): "under 70%" for dynamic resolution is measured against it. */
export const MAIN_THREAD_BUDGET_MS: Readonly<Record<QualityTier, number>> = { low: 10, mid: 8, high: 6 };
export const FRAME_60_MS = 1000 / 60;
export const FRAME_30_MS = 1000 / 30;
/** Canon §3.14: a dropped frame is a rAF interval over 1.25 × the display interval. */
export const DROP_FACTOR = 1.25;

// ---------------------------------------------------------------------------------------------
// Title-screen benchmark (04 §5.8: 600 frames; up at p50 submit ≤ 2.0 ms and drops ≤ 1%, down at > 4.5 ms or > 5%)
// ---------------------------------------------------------------------------------------------

/** `warmup` title frames (shader compiles, first uploads) are not measured. */
export const BENCH = { frames: 600, warmup: 60, upSubmitMs: 2.0, upDrops: 0.01, downSubmitMs: 4.5, downDrops: 0.05 } as const;

export function benchmarkVerdict(p50SubmitMs: number, dropRate: number): -1 | 0 | 1 {
  if (p50SubmitMs > BENCH.downSubmitMs || dropRate > BENCH.downDrops) return -1;
  if (p50SubmitMs <= BENCH.upSubmitMs && dropRate <= BENCH.upDrops) return 1;
  return 0;
}

export class TitleBenchmark {
  private readonly submit = new Float32Array(BENCH.frames);
  private n = 0;
  private drops = 0;
  private skipped = 0;

  get done(): boolean {
    return this.n >= BENCH.frames;
  }

  /** One title frame: its rAF interval and the time render() took to submit. */
  sample(intervalMs: number, submitMs: number): void {
    if (this.done) return;
    if (this.skipped < BENCH.warmup) {
      this.skipped++;
      return;
    }
    this.submit[this.n++] = submitMs;
    if (intervalMs > DROP_FACTOR * FRAME_60_MS) this.drops++;
  }

  verdict(): -1 | 0 | 1 {
    const sorted = Array.from(this.submit.subarray(0, this.n)).sort((a, b) => a - b);
    return benchmarkVerdict(sorted[Math.floor(this.n / 2)] ?? 0, this.n > 0 ? this.drops / this.n : 0);
  }
}

// ---------------------------------------------------------------------------------------------
// Dynamic resolution (04 §5.8: 0.125 steps; down when ≥ 30 of 60 frames are over budget; up after 5 s under 70%;
// resizes ≥ 2 s apart) and the overload drop (04 §10.5: 20 s at the floor and still over budget)
// ---------------------------------------------------------------------------------------------

export const DR = { step: 0.125, window: 60, downAt: 30, upAfterMs: 5_000, minGapMs: 2_000, overloadMs: 20_000, bounceMs: 10_000, maxUpDelayMs: 60_000 } as const;

export class DynamicResolution {
  dpr: number;
  private cap: number;
  private floor: number;
  private readonly ring = new Uint8Array(DR.window);
  private at = 0;
  private overCount = 0;
  private underSince = -1;
  private lastResize = Number.NEGATIVE_INFINITY;
  private lastUp = Number.NEGATIVE_INFINITY;
  private upDelay: number = DR.upAfterMs;
  private floorBusySince = -1;

  constructor(cap: number, floor: number) {
    this.cap = cap;
    this.floor = Math.min(floor, cap);
    this.dpr = cap;
  }

  /** New tier or device DPR: start again from the cap. */
  reset(cap: number, floor: number): void {
    this.cap = cap;
    this.floor = Math.min(floor, cap);
    this.dpr = cap;
    this.clearWindow();
    this.underSince = -1;
    this.floorBusySince = -1;
    this.upDelay = DR.upAfterMs;
  }

  get atFloor(): boolean {
    return this.dpr <= this.floor + 1e-6;
  }

  /** Over budget for ≥ 20 s while already at the floor. */
  overloaded(now: number): boolean {
    return this.floorBusySince >= 0 && now - this.floorBusySince >= DR.overloadMs;
  }

  /** One rendered frame; returns true when `dpr` changed. */
  frame(now: number, over: boolean, under: boolean): boolean {
    this.push(over);
    this.underSince = under ? (this.underSince < 0 ? now : this.underSince) : -1;
    const busy = this.overCount >= DR.downAt;
    this.floorBusySince = busy && this.atFloor ? (this.floorBusySince < 0 ? now : this.floorBusySince) : -1;
    if (now - this.lastResize < DR.minGapMs) return false;
    if (busy && !this.atFloor) return this.stepDown(now);
    if (this.underSince >= 0 && now - this.underSince >= this.upDelay && this.dpr < this.cap - 1e-6) return this.stepUp(now);
    return false;
  }

  private stepDown(now: number): boolean {
    // Straight back down after a step up: wait longer before the next try (no 5-s oscillation when GPU-bound).
    if (now - this.lastUp < DR.bounceMs) this.upDelay = Math.min(DR.maxUpDelayMs, this.upDelay * 2);
    this.dpr = Math.max(this.floor, this.dpr - DR.step);
    this.lastResize = now;
    this.clearWindow();
    return true;
  }

  private stepUp(now: number): boolean {
    this.dpr = Math.min(this.cap, this.dpr + DR.step);
    this.lastResize = this.lastUp = now;
    this.underSince = now;
    return true;
  }

  private push(over: boolean): void {
    const v = over ? 1 : 0;
    this.overCount += v - this.ring[this.at];
    this.ring[this.at] = v;
    this.at = (this.at + 1) % DR.window;
  }

  private clearWindow(): void {
    this.ring.fill(0);
    this.overCount = 0;
    this.at = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Low Power Mode (04 §5.8: a 33-ms cadence for 3 s → battery mode). iOS caps rAF at 30 Hz in LPM; a light frame
// arriving every 33 ms is that cap, not overload. Back to a 60-Hz cadence for 3 s leaves it.
// ---------------------------------------------------------------------------------------------

export const LPM = { holdMs: 3_000, min30: 27, max30: 40, max60: 22, lightWorkMs: 8 } as const;

export class LowPowerDetector {
  active = false;
  private since = -1;

  /** Raw rAF interval (before any battery throttling) and the last frame's main-thread work. */
  frame(now: number, intervalMs: number, workMs: number): boolean {
    const toward = this.active ? intervalMs < LPM.max60 : intervalMs >= LPM.min30 && intervalMs <= LPM.max30 && workMs < LPM.lightWorkMs;
    if (!toward) this.since = -1;
    else if (this.since < 0) this.since = now;
    else if (now - this.since >= LPM.holdMs) {
      this.active = !this.active;
      this.since = -1;
    }
    return this.active;
  }
}

// ---------------------------------------------------------------------------------------------
// Crash loops (04 §10.5): `run` holds `running` from boot with a 10-s heartbeat while visible and `clean` on hide.
// Booting from `running` within 30 s of a beat means the page died in view.
// ---------------------------------------------------------------------------------------------

export const RUN = { beatMs: 10_000, deathWindowMs: 30_000 } as const;

interface RunRecord {
  s: 'running' | 'clean';
  at: number;
}

export class RunTracker {
  private lastBeat = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly kv: KeyValue,
    private readonly key: string,
    private readonly clock: () => number,
  ) {}

  /** Call once at boot: true when the previous run died in view. Starts this run. */
  boot(): boolean {
    const prev = readJson<RunRecord>(this.kv, this.key);
    const now = this.clock();
    const died = !!prev && prev.s === 'running' && typeof prev.at === 'number' && now - prev.at >= 0 && now - prev.at <= RUN.deathWindowMs;
    this.beat(true);
    return died;
  }

  /** Visible and running: refresh the heartbeat at most every 10 s (`force` writes now). */
  beat(force = false): void {
    const now = this.clock();
    if (!force && now - this.lastBeat < RUN.beatMs) return;
    this.lastBeat = now;
    writeJson(this.kv, this.key, { s: 'running', at: now } satisfies RunRecord);
  }

  /** Hidden or leaving: a kill from here is not a crash. */
  clean(): void {
    this.lastBeat = Number.NEGATIVE_INFINITY;
    writeJson(this.kv, this.key, { s: 'clean', at: this.clock() } satisfies RunRecord);
  }
}

// ---------------------------------------------------------------------------------------------
// The governor
// ---------------------------------------------------------------------------------------------

/** Persisted auto-tier state (`hf-<ch>.quality`). */
export interface QualityRecord {
  tier: QualityTier;
  /** A crash loop or overload dropped the tier: it is never raised automatically again (04 §10.5 ladder). */
  noRaise: boolean;
  /** Bottom of the ladder: low + 30 fps. */
  fps30: boolean;
}

export type TierChangeReason = 'benchmark' | 'crash' | 'overload' | 'context';

/** Toasts for automatic drops (≤ 40 characters, 03 §6.2); a benchmark move is silent. */
export const QUALITY_NOTICE: Readonly<Record<TierChangeReason, string | null>> = {
  benchmark: null,
  crash: 'Graphics lowered after a crash',
  overload: 'Graphics lowered to keep play smooth',
  context: 'Graphics lowered after display resets',
};

export interface GovernorOptions {
  kv: KeyValue;
  key: string;
  device: TierProbe;
  /** Tier fixed by the URL, the test hook or the M0 style test: nothing automatic runs (canon §5.1). */
  pinned: boolean;
  /** Called when the auto tier (or the 30-fps floor) changes. */
  onChange?(tier: QualityTier, reason: TierChangeReason): void;
}

/** What the loop reports for every frame whose body ran. */
export interface FrameSample {
  now: number;
  /** ms since the previous frame body. */
  intervalMs: number;
  /** Main-thread ms of the frame body. */
  workMs: number;
  /** ms spent in renderer.render() (0 when nothing was drawn). */
  submitMs: number;
  phase: 'title' | 'play' | 'held';
  look: Look;
  /** Effective tier and device DPR of this frame. */
  tier: QualityTier;
  deviceDpr: number;
  /** The player picked a tier (Settings → Quality ≠ Auto): the auto tier is not benchmarked. */
  manualTier: boolean;
  contextLost: boolean;
  /** A trip ended this frame (Rim arrival): a pending benchmark move applies. */
  rimArrival: boolean;
  /** Battery mode ran this frame at 30 fps (LoopQuality fills it in). */
  battery: boolean;
}

const CONTEXT_LOSSES = { count: 3, windowMs: 60_000 } as const;

export function stepTier(t: QualityTier, d: -1 | 1): QualityTier {
  const i = Math.max(0, Math.min(LADDER.length - 1, LADDER.indexOf(t) + d));
  return LADDER[i];
}

export function readQualityRecord(kv: KeyValue, key: string, device: TierProbe): QualityRecord {
  const raw = readJson<Partial<QualityRecord>>(kv, key);
  return {
    tier: isQualityTier(raw?.tier) ? raw.tier : defaultTier(device),
    noRaise: raw?.noRaise === true,
    fps30: raw?.fps30 === true,
  };
}

export class QualityGovernor {
  private readonly record: QualityRecord;
  private readonly bench = new TitleBenchmark();
  /** The benchmark's move, waiting for a Rim arrival; taken once per session. */
  private pending: -1 | 0 | 1 = 0;
  private benchTaken = false;
  private readonly dr: DynamicResolution;
  private drTier: QualityTier | null = null;
  private drDevice = 0;
  private drActive = false;
  private readonly lpm = new LowPowerDetector();
  private wasLost = false;
  private readonly losses: number[] = [];
  private lastWork = 0;

  constructor(private readonly opts: GovernorOptions) {
    this.record = readQualityRecord(opts.kv, opts.key, opts.device);
    this.dr = new DynamicResolution(1, 1);
  }

  setOnChange(fn: GovernorOptions['onChange']): void {
    this.opts.onChange = fn;
  }

  /** The automatic tier ("Auto" in Settings). */
  get tier(): QualityTier {
    return this.record.tier;
  }

  /** Bottom of the ladder reached: run at 30 fps whatever the battery says. */
  get forced30(): boolean {
    return this.record.fps30;
  }

  /** Low Power Mode suspected from the rAF cadence. */
  get lowPower(): boolean {
    return this.lpm.active;
  }

  /** Production Toon render DPR, or undefined (Pixel Lab, pinned, or the tier cap). */
  get renderDpr(): number | undefined {
    return this.drActive ? this.dr.dpr : undefined;
  }

  /** The previous run died in view (RunTracker.boot): drop one rung (04 §10.5). */
  crashed(): void {
    this.drop('crash');
  }

  /** Every rAF, before the body runs: the raw cadence feeds the Low Power Mode detector. */
  cadence(now: number, rawIntervalMs: number): void {
    if (this.opts.pinned || rawIntervalMs <= 0 || rawIntervalMs > 250) return;
    this.lpm.frame(now, rawIntervalMs, this.lastWork);
  }

  /** After every frame body. */
  frame(f: FrameSample): void {
    this.lastWork = f.workMs;
    if (this.opts.pinned) return;
    this.trackContext(f);
    if (f.rimArrival) this.applyPending(f.manualTier);
    // A stall (page hidden, debugger) says nothing about frame cost.
    if (f.intervalMs <= 0 || f.intervalMs > 250) return;
    this.benchmark(f);
    if (f.phase === 'play') this.resolution(f);
  }

  /**
   * Title frames that drew at the full 60-Hz cadence feed the benchmark (a 30-fps battery cadence would read as
   * drops); its verdict is taken once and waits for the next Rim arrival.
   */
  private benchmark(f: FrameSample): void {
    if (this.benchTaken) return;
    if (f.phase === 'title' && !f.manualTier && !f.battery && f.submitMs > 0) this.bench.sample(f.intervalMs, f.submitMs);
    if (!this.bench.done) return;
    this.benchTaken = true;
    this.pending = this.bench.verdict();
  }

  private resolution(f: FrameSample): void {
    this.syncDr(f);
    const target = f.battery ? FRAME_30_MS : FRAME_60_MS;
    const over = f.intervalMs > DROP_FACTOR * target;
    const under = this.drActive && !over && f.workMs < 0.7 * MAIN_THREAD_BUDGET_MS[f.tier];
    this.dr.frame(f.now, over, under);
    // A tier the player picked is theirs (04 §5.8 "player overrides win"): no overload drop under it.
    if (!f.manualTier && this.dr.overloaded(f.now)) {
      // The next frame re-derives the resolution range for the lowered tier (or the 30-fps rung).
      this.drTier = null;
      this.dr.reset(1, 1);
      this.drop('overload');
    }
  }

  /** Dynamic resolution runs on production Toon only; Pixel Lab sits "at the floor" for the overload rule. */
  private syncDr(f: FrameSample): void {
    const active = f.look === 'toon';
    const spec = QUALITY[f.tier];
    const cap = Math.min(f.deviceDpr, spec.dprCap);
    if (active !== this.drActive || f.tier !== this.drTier || f.deviceDpr !== this.drDevice) {
      this.drActive = active;
      this.drTier = f.tier;
      this.drDevice = f.deviceDpr;
      if (active) this.dr.reset(cap, spec.dprFloor);
      else this.dr.reset(1, 1);
    }
  }

  private trackContext(f: FrameSample): void {
    if (f.contextLost && !this.wasLost) {
      this.losses.push(f.now);
      while (this.losses.length > 0 && f.now - this.losses[0] > CONTEXT_LOSSES.windowMs) this.losses.shift();
      if (this.losses.length >= CONTEXT_LOSSES.count) {
        this.losses.length = 0;
        this.drop('context');
      }
    }
    this.wasLost = f.contextLost;
  }

  private applyPending(manual: boolean): void {
    const move = this.pending;
    if (move === 0 || manual) return;
    this.pending = 0;
    if (move > 0 && this.record.noRaise) return;
    const next = stepTier(this.record.tier, move);
    if (next === this.record.tier) return;
    this.record.tier = next;
    this.save();
    this.opts.onChange?.(next, 'benchmark');
  }

  /** One rung down the 04 §10.5 ladder: high → mid → low → low + 30 fps. Never raised automatically after. */
  private drop(reason: TierChangeReason): void {
    const r = this.record;
    r.noRaise = true;
    if (r.tier === 'low') r.fps30 = true;
    else r.tier = stepTier(r.tier, -1);
    this.pending = 0;
    this.save();
    this.opts.onChange?.(r.tier, reason);
  }

  private save(): void {
    writeJson(this.opts.kv, this.opts.key, this.record);
  }
}

// ---------------------------------------------------------------------------------------------
// The loop's view (src/app/loop.ts)
// ---------------------------------------------------------------------------------------------

/** Battery-mode frame admission: a 60-Hz (or 120-Hz) rAF runs every other (fourth) body. */
const ADMIT_SLACK_MS = 4;

export interface LoopQuality {
  /** Every rAF with its timestamp; false skips this frame's body (30 fps in battery mode). */
  admit(t: number): boolean;
  /** After a frame body ran. */
  report(sample: FrameSample): void;
  /** Toon render DPR for RenderFrame.renderDpr (undefined = the tier cap). */
  readonly renderDpr: number | undefined;
  /** Battery mode: 30 fps, half the particles, no idle animation (04 §5.8). */
  readonly battery: boolean;
}

export interface LoopQualitySettings {
  /** Settings → Battery mode. */
  batterySetting(): boolean;
  /** Settings → Quality is Auto: the 30-fps ladder rung applies (a picked tier reverts it, 04 §10.5). */
  autoTier(): boolean;
}

/** Glue between the loop, the governor and crash-loop tracking. */
export function createLoopQuality(gov: QualityGovernor, run: RunTracker | null, settings: LoopQualitySettings): LoopQuality {
  let lastRaf = -1;
  let lastBody = Number.NEGATIVE_INFINITY;
  const battery = (): boolean => settings.batterySetting() || gov.lowPower || (gov.forced30 && settings.autoTier());
  return {
    admit(t) {
      if (lastRaf >= 0) gov.cadence(t, t - lastRaf);
      lastRaf = t;
      if (battery() && t - lastBody < FRAME_30_MS - ADMIT_SLACK_MS) return false;
      lastBody = t;
      return true;
    },
    report(sample) {
      sample.battery = battery();
      gov.frame(sample);
      run?.beat();
    },
    get renderDpr() {
      return gov.renderDpr;
    },
    get battery() {
      return battery();
    },
  };
}
