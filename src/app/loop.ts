// Main loop (04 §3.2; canon §3.5): one rAF-driven fixed-step accumulator. STEP = 1/60 s, frame dt clamped to
// 250 ms, ≤ 5 steps per frame (excess wall time is dropped, never ticks), render interpolated with alpha.
// Each frame: time/overlays → sim steps → drain events (app, audio, render FX) → saves → ≤ 10 Hz HUD → render.
import type { RenderFrame, Renderer, ViewportLayout } from '../render/api';
import type { AudioEngine, PodAudioState } from '../audio/engine';
import type { PerfMonitor } from '../debug/perf';
import { NO_INTENT, type PodIntent } from '../pod/types';
import { FRAME_DT_CLAMP_MS, MAX_STEPS_PER_FRAME, MEGA_POP_RADIUS, POP_RADIUS, STEP_HZ } from '../shared/canon';
import type { ConsumableId } from '../shared/types';
import type { SaveScheduler } from '../save/scheduler';
import type { WorldApi } from '../world/api';
import type { GameApp } from './controller';
import type { FrameSample, LoopQuality } from './qualityGovernor';
import type { InputController, Overlay } from './types';

export const STEP_MS = 1000 / STEP_HZ;
/** Under an open sheet the scene barely changes: draw at most this often (04 §3.2 render on demand). */
export const SHEET_RENDER_MS = 66;
/** Cards over a held, still scene: drawn at the sheet rate too (battery while left on "Tap to resume"). */
const STILL_OVERLAYS: ReadonlySet<Overlay> = new Set<Overlay>(['interrupt', 'upright']);
const NO_EVENTS: RenderFrame['events'] = [];
const PERF_PUBLISH_MS = 500;
const ALPHA_MAX = 0.9999;

/** The canon §3.5 accumulator, separated from rAF for testing. */
export class FixedStepper {
  private acc = 0;

  /** Steps to run for a frame `dtMs` long. */
  advance(dtMs: number): number {
    this.acc += Math.min(Math.max(dtMs, 0), FRAME_DT_CLAMP_MS);
    let n = 0;
    while (this.acc >= STEP_MS && n < MAX_STEPS_PER_FRAME) {
      this.acc -= STEP_MS;
      n++;
    }
    if (n === MAX_STEPS_PER_FRAME) this.acc = Math.min(this.acc, STEP_MS);
    return n;
  }

  /** Interpolation factor between the previous and current step, [0, 1). */
  get alpha(): number {
    return Math.min(this.acc / STEP_MS, ALPHA_MAX);
  }

  reset(): void {
    this.acc = 0;
  }
}

/** Footprint radius shown while a quick slot is arming (explosives only; beacons show the ring alone). */
export function armingRadius(id: ConsumableId | undefined): number {
  if (id === 'pop') return POP_RADIUS;
  if (id === 'megaPop') return MEGA_POP_RADIUS;
  return 0;
}

export interface LoopDeps {
  app: GameApp;
  input: InputController;
  renderer: Renderer;
  audio: AudioEngine | null;
  saves: SaveScheduler | null;
  perf: PerfMonitor;
  layout(): ViewportLayout;
  /** OS reduced-motion preference (OR-ed with the setting); a getter follows live OS changes. */
  osReducedMotion: boolean | (() => boolean);
  /** Automatic quality: battery-mode frame admission, dynamic resolution, benchmark and overload sampling. */
  quality?: LoopQuality;
  onFirstTick?(): void;
  onFirstFrame?(): void;
  onError?(e: unknown): void;
}

export class GameLoop {
  /** Test hook (?test=1): replaces player input while set. */
  intentOverride: PodIntent | null = null;
  private readonly stepper = new FixedStepper();
  private raf = 0;
  private last = -1;
  private firstTickDone = false;
  private firstFrameDone = false;
  private lastPerfAt = Number.NEGATIVE_INFINITY;
  private lastRenderAt = Number.NEGATIVE_INFINITY;
  /** Test hook: the animation clock while frozen (null = running on rAF). */
  private frozenAt: number | null = null;
  private readonly frameData: RenderFrame;
  private readonly armingData = { radius: 0, progress: 0 };
  private readonly podAudio: PodAudioState = { thrust: 0, digging: false, drillTier: 1 };
  private readonly sample: FrameSample = {
    now: 0, intervalMs: 0, workMs: 0, submitMs: 0, phase: 'title', look: 'toon', tier: 'mid', deviceDpr: 1,
    manualTier: false, contextLost: false, rimArrival: false,
  };
  private lastBodyAt = -1;
  private submitMs = 0;
  private rimArrival = false;
  private batteryShown = false;

  constructor(private readonly deps: LoopDeps) {
    this.frameData = {
      world: deps.app.world,
      alpha: 0,
      timeMs: 0,
      mode: 'play',
      events: [],
      layout: deps.layout(),
      touching: false,
      arming: null,
      brightMines: false,
      reducedMotion: false,
    };
  }

  get running(): boolean {
    return this.raf !== 0;
  }

  start(): void {
    if (this.raf) return;
    this.frozenAt = null;
    this.resetClock();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** After the page was hidden: the next frame starts a fresh interval (no 250-ms catch-up burst). */
  resetClock(): void {
    this.last = -1;
    this.lastBodyAt = -1;
    this.deps.perf.skipGap();
  }

  /** Run `n` sim steps synchronously (test hook; respects pause reasons). */
  stepNow(n: number): void {
    for (let i = 0; i < n; i++) this.stepOnce(this.deps.app.world);
  }

  /**
   * Test hook (04 §11.4 frozen time): stop the loop and draw the scene at animation time 0. Until start(), frames
   * advance only through stepFrozen, so screenshots do not depend on the machine's frame timing.
   */
  freeze(): void {
    this.stop();
    this.frozenAt = 0;
    this.drawFrozen(NO_EVENTS);
  }

  /** Test hook: while frozen, `n` fixed 60-Hz frames (one sim step and one draw each) on the frozen clock. */
  stepFrozen(n: number): void {
    if (this.frozenAt === null) return;
    const { app } = this.deps;
    for (let i = 0; i < n; i++) {
      this.stepOnce(app.world);
      const events = app.world.drainEvents();
      app.handleEvents(events);
      this.frozenAt += STEP_MS;
      this.drawFrozen(events);
    }
  }

  private readonly frame = (t: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const q = this.deps.quality;
    if (q && !q.admit(t)) return;
    const t0 = performance.now();
    this.submitMs = 0;
    try {
      this.runFrame(t);
    } catch (e) {
      this.deps.onError?.(e);
    }
    const work = performance.now() - t0;
    this.deps.perf.recordWork(work);
    if (q) this.reportQuality(q, t, work);
  };

  private runFrame(t: number): void {
    const { app, renderer, audio, saves, perf } = this.deps;
    perf.frame(t);
    const dt = this.last < 0 ? 0 : t - this.last;
    this.last = t;

    app.setContextLost(renderer.contextLost);
    app.tick(dt, t);

    const world = app.world;
    const n = this.stepper.advance(dt);
    for (let i = 0; i < n; i++) this.stepOnce(world);
    if (n > 0 && !this.firstTickDone) {
      this.firstTickDone = true;
      this.deps.onFirstTick?.();
    }

    const events = world.drainEvents();
    app.handleEvents(events);
    for (let i = 0; i < events.length; i++) if (events[i].t === 'trip-end') this.rimArrival = true;
    if (audio) {
      const pod = world.pod;
      // A held pod keeps its thrust and dig state (and saves it), but is silent: the thrust bed fades out and the
      // dig ticks stop under every pause reason and the resume countdown.
      const live = app.podRunning();
      this.podAudio.thrust = live ? pod.thrust : 0;
      this.podAudio.digging = live && pod.digging;
      this.podAudio.drillTier = pod.tiers.drill;
      audio.handleEvents(events, pod.tiers.drill);
      audio.update(this.podAudio, t);
    }
    saves?.tick(t);
    this.publishPerf(t);

    if (this.shouldRender(t, events.length > 0)) {
      this.lastRenderAt = t;
      const s0 = performance.now();
      renderer.render(this.buildFrame(app.world, t, events));
      this.submitMs = performance.now() - s0;
      if (!this.firstFrameDone) {
        this.firstFrameDone = true;
        this.deps.onFirstFrame?.();
      }
    }
  }

  private drawFrozen(events: RenderFrame['events']): void {
    if (this.frozenAt === null || this.deps.renderer.contextLost) return;
    const f = this.buildFrame(this.deps.app.world, this.frozenAt, events);
    f.alpha = 0;
    this.deps.renderer.render(f);
  }

  private stepOnce(world: WorldApi): void {
    const running = this.deps.app.podRunning();
    const intent = running ? (this.intentOverride ?? this.deps.input.sampleIntent()) : NO_INTENT;
    world.step(intent, running);
  }

  private shouldRender(t: number, hadEvents: boolean): boolean {
    if (this.deps.renderer.contextLost) return false;
    if (hadEvents || this.deps.app.podRunning()) return true;
    const st = this.deps.app.state;
    const still = st.sheet.peek() !== null || STILL_OVERLAYS.has(st.overlay.peek());
    return !still || t - this.lastRenderAt >= SHEET_RENDER_MS;
  }

  private buildFrame(world: WorldApi, t: number, events: RenderFrame['events']): RenderFrame {
    const st = this.deps.app.state;
    const settings = st.settings.peek();
    const f = this.frameData;
    f.world = world;
    f.alpha = this.stepper.alpha;
    f.timeMs = t;
    f.events = events;
    f.layout = this.deps.layout();
    f.touching = this.deps.input.touching;
    f.brightMines = settings.brightMines;
    const os = this.deps.osReducedMotion;
    f.reducedMotion = settings.reducedMotion || (typeof os === 'function' ? os() : os);
    f.podRunning = this.deps.app.podRunning();
    f.battery = this.deps.quality?.battery ?? false;
    f.renderDpr = this.deps.quality?.renderDpr;
    const arming = st.arming.peek();
    if (arming) {
      this.armingData.radius = armingRadius(world.pod.quickSlots[arming.slot]);
      this.armingData.progress = arming.progress;
      f.arming = this.armingData;
    } else {
      f.arming = null;
    }
    return f;
  }

  /** Hand the governor this frame's timings (04 §5.8 dynamic resolution, benchmark; §10.5 overload). */
  private reportQuality(q: LoopQuality, t: number, work: number): void {
    const { app, renderer, perf } = this.deps;
    const s = this.sample;
    const st = app.state;
    s.now = t;
    s.intervalMs = this.lastBodyAt < 0 ? 0 : t - this.lastBodyAt;
    this.lastBodyAt = t;
    s.workMs = work;
    s.submitMs = this.submitMs;
    const overlay = st.overlay.peek();
    s.phase = overlay === 'title' ? 'title' : app.podRunning() ? 'play' : 'held';
    s.look = st.look.peek();
    s.tier = renderer.info.quality;
    s.deviceDpr = this.deps.layout().dpr;
    s.manualTier = st.settings.peek().quality !== 'auto';
    s.contextLost = renderer.contextLost;
    s.rimArrival = this.rimArrival;
    this.rimArrival = false;
    q.report(s);
    if (q.battery !== this.batteryShown) {
      this.batteryShown = q.battery;
      perf.setDisplayHz(q.battery ? 30 : 60);
    }
  }

  private publishPerf(t: number): void {
    const st = this.deps.app.state;
    if (!st.settings.peek().showPerf || t - this.lastPerfAt < PERF_PUBLISH_MS) return;
    this.lastPerfAt = t;
    const { perf, renderer } = this.deps;
    st.perf.value = { fps: perf.fps, frameMs: perf.frameMs, drawCalls: renderer.info.drawCalls, tris: renderer.info.triangles };
  }
}
