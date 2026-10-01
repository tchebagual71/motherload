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
import type { InputController } from './types';

export const STEP_MS = 1000 / STEP_HZ;
/** Under an open sheet the scene barely changes: draw at most this often (04 §3.2 render on demand). */
export const SHEET_RENDER_MS = 66;
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
  /** OS reduced-motion preference (OR-ed with the setting). */
  osReducedMotion: boolean;
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
  private readonly frameData: RenderFrame;
  private readonly armingData = { radius: 0, progress: 0 };
  private readonly podAudio: PodAudioState = { thrust: 0, digging: false, drillTier: 1 };

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
    this.deps.perf.skipGap();
  }

  /** Run `n` sim steps synchronously (test hook; respects pause reasons). */
  stepNow(n: number): void {
    for (let i = 0; i < n; i++) this.stepOnce(this.deps.app.world);
  }

  private readonly frame = (t: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const t0 = performance.now();
    try {
      this.runFrame(t);
    } catch (e) {
      this.deps.onError?.(e);
    }
    this.deps.perf.recordWork(performance.now() - t0);
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
    if (audio) {
      const pod = world.pod;
      this.podAudio.thrust = pod.thrust;
      this.podAudio.digging = pod.digging;
      this.podAudio.drillTier = pod.tiers.drill;
      audio.handleEvents(events, pod.tiers.drill);
      audio.update(this.podAudio, t);
    }
    saves?.tick(t);
    this.publishPerf(t);

    if (this.shouldRender(t, events.length > 0)) {
      this.lastRenderAt = t;
      renderer.render(this.buildFrame(app.world, t, events));
      if (!this.firstFrameDone) {
        this.firstFrameDone = true;
        this.deps.onFirstFrame?.();
      }
    }
  }

  private stepOnce(world: WorldApi): void {
    const running = this.deps.app.podRunning();
    const intent = running ? (this.intentOverride ?? this.deps.input.sampleIntent()) : NO_INTENT;
    world.step(intent, running);
  }

  private shouldRender(t: number, hadEvents: boolean): boolean {
    if (this.deps.renderer.contextLost) return false;
    const st = this.deps.app.state;
    if (st.sheet.peek() === null || hadEvents || this.deps.app.podRunning()) return true;
    return t - this.lastRenderAt >= SHEET_RENDER_MS;
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
    f.reducedMotion = settings.reducedMotion || this.deps.osReducedMotion;
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

  private publishPerf(t: number): void {
    const st = this.deps.app.state;
    if (!st.settings.peek().showPerf || t - this.lastPerfAt < PERF_PUBLISH_MS) return;
    this.lastPerfAt = t;
    const { perf, renderer } = this.deps;
    st.perf.value = { fps: perf.fps, frameMs: perf.frameMs, drawCalls: renderer.info.drawCalls, tris: renderer.info.triangles };
  }
}
