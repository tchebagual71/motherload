// ADR-0002 browser bench page (bench.html; 04 §3.4, §10.1): builds the MVP-17 fixture (2,000+ buildings, ≈ 10k
// items) through factory commands in a live World, runs it in the 04 §3.2 loop with the renderer drawing every
// frame, and times every factory tick plus every frame. Results show on the page and as a copyable HFB1 code.
//
// URL: ?ticks=6000&warmup=1200&prefill=8000&look=toon&quality=low&dense=0&fast=0&seed=7&view=yard
//   prefill  ticks run before the live loop (≈ 100 a frame, still rendered) so the deep lifts fill to ≈ 10k items;
//   warmup   live-loop ticks before timing (04 §3.4: 1,200); ticks: timed ticks (6,000);
//   fast=1   as many steps a frame as fit 12 ms instead of real time (quick checks; frame numbers then mean little);
//   view     yard (the build camera over the fixture's lanes and loop), mine (its lifts and drills) or pod (play camera).
import { FRAME_DT_CLAMP_MS, MAX_STEPS_PER_FRAME, STEP } from '../shared/canon';
import type { Look } from '../shared/types';
import { NO_INTENT } from '../pod/types';
import type { BuildCamera, QualityTier, RenderFrame, Renderer, ViewportLayout } from '../render/api';
import { createRenderer } from '../render/renderer';
import { TICK_GATE_MS, TickTimer, benchWorld, displayHz, dist, droppedRate, encodeBench, timerResolution, type BenchReport, type BenchWorld } from './bench';

type Phase = 'calibrate' | 'build' | 'prefill' | 'warmup' | 'timed' | 'batch' | 'done' | 'error';

interface BenchState {
  phase: Phase;
  /** 0..1 of the current phase. */
  progress: number;
  report: BenchReport | null;
  code: string | null;
  error: string | null;
}

declare global {
  interface Window {
    __hfBench?: BenchState;
  }
}

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = Number(params.get(k));
  return params.has(k) && Number.isFinite(v) && v >= 0 ? v : d;
};
const TICKS = Math.max(1, Math.floor(num('ticks', 6_000)));
const WARMUP = Math.floor(num('warmup', 1_200));
const PREFILL = Math.floor(num('prefill', 8_000));
const FAST = params.get('fast') === '1';
const DENSE = params.get('dense') === '1';
const SEED = Math.floor(num('seed', 7));
const LOOK: Look = params.get('look') === 'pixel' ? 'pixel' : 'toon';
const QUALITY: QualityTier = (['low', 'mid', 'high'] as const).find((q) => q === params.get('quality')) ?? 'low';
const VIEW = (['yard', 'mine', 'pod'] as const).find((v) => v === params.get('view')) ?? 'yard';
/** Build cameras (canon §3.4) framing the busiest part of the fixture. */
const CAMERAS: Record<'yard' | 'mine', BuildCamera> = {
  yard: { plane: 'yard', cx: 24, cy: 12, ppu: 39, yaw: 0 },
  mine: { plane: 'mine', cx: 24, cy: 60, ppu: 47, yaw: 0 },
};
const STEP_MS = STEP * 1000;
/** Fast mode: World steps a frame may take before rendering. */
const FAST_BUDGET_MS = 12;
/** Prefill: steps per frame (≈ 100 ticks), rendered every frame. */
const PREFILL_STEPS = 300;
/** Frames recorded in the timed window (live: ≈ 3 steps a tick at ≥ 1 step a frame). */
const FRAME_CAP = TICKS * 3 + 600;
/** After the live window: back-to-back batches of factory ticks, each timed once (precise on coarse clocks). */
const BATCHES = 30;
const BATCH_TICKS = 200;

const state: BenchState = { phase: 'calibrate', progress: 0, report: null, code: null, error: null };
window.__hfBench = state;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function layoutNow(): ViewportLayout {
  return { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1, clearTop: 0, controlZone: 0 };
}

function setStatus(text: string): void {
  $('status').textContent = text;
}

function gpuName(canvas: HTMLCanvasElement): string {
  try {
    const gl = canvas.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return (gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : gl ? String(gl.getParameter(gl.RENDERER)) : 'no WebGL2') || 'unknown';
  } catch {
    return 'unknown';
  }
}

function fmt(ms: number): string {
  return ms < 1 ? ms.toFixed(3) : ms < 10 ? ms.toFixed(2) : ms.toFixed(1);
}

function showResults(r: BenchReport, code: string): void {
  const rows: [string, string][] = [
    ['Fixture', `${r.entities.toLocaleString()} entities + ${r.beltTiles.toLocaleString()} belt tiles = ${r.buildings.toLocaleString()} buildings · ${r.items.toLocaleString()} items · built in ${Math.round(r.buildMs)} ms`],
    ['Factory tick', `p50 ${fmt(r.tick.p50)} · p95 ${fmt(r.tick.p95)} · p99 ${fmt(r.tick.p99)} · max ${fmt(r.tick.max)} ms over ${r.tick.n.toLocaleString()} live ticks (clock step ${fmt(r.timerResMs)} ms)`],
    ['Tick, batched', `mean ${fmt(r.tickBatch.mean)} · p95 ${fmt(r.tickBatch.p95)} · max ${fmt(r.tickBatch.max)} ms a tick over ${r.tickBatch.n} × ${BATCH_TICKS} back-to-back ticks`],
    ['ADR-0002 gate', `p95 ≤ ${TICK_GATE_MS} ms: ${r.gatePass ? 'PASS' : 'FAIL'} (decides on the low-tier device)`],
    ['Frame', `p50 ${fmt(r.frame.p50)} · p95 ${fmt(r.frame.p95)} ms · dropped ${(r.dropped * 100).toFixed(1)}% at ${r.displayHz} Hz${r.mode === 'fast' ? ' (fast mode)' : ''}`],
    ['Main-thread work', `p50 ${fmt(r.work.p50)} · p95 ${fmt(r.work.p95)} ms a frame (World steps + render submit)`],
    ['Render', `${r.drawCalls} draw calls · ${(r.triangles / 1000).toFixed(1)}k triangles · ${r.look} · ${r.quality} · DPR ${r.dpr} · ${r.view} view`],
    ['Device', `${r.gpu} · ${r.ua}`],
  ];
  $('results').innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`).join('');
  const box = $<HTMLTextAreaElement>('code');
  box.value = code;
  $('out').hidden = false;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

async function main(): Promise<void> {
  const canvas = $<HTMLCanvasElement>('game');
  let renderer: Renderer;
  try {
    renderer = createRenderer(canvas, layoutNow(), { look: LOOK, quality: QUALITY, precompileBoth: false });
  } catch (e) {
    throw new Error(`WebGL2 renderer unavailable: ${String(e)}`);
  }
  window.addEventListener('resize', () => renderer.resize(layoutNow()));
  // The display rate, from idle frames before any load (04 §10.1 counts drops against it), and the clock's step.
  setStatus('Measuring the display rate…');
  const idle = new Float64Array(40);
  let prev = await nextFrame();
  for (let i = 0; i < idle.length; i++) {
    const t = await nextFrame();
    idle[i] = t - prev;
    prev = t;
  }
  const hz = displayHz(dist(idle).p50);
  const resMs = timerResolution(() => performance.now());
  state.phase = 'build';
  setStatus('Building the fixture through factory commands…');
  await nextFrame();
  const bw: BenchWorld = benchWorld(SEED, () => performance.now(), DENSE);
  const { world } = bw;
  const timer = new TickTimer(world.factory!, TICKS, () => performance.now());
  const frameMs = new Float64Array(FRAME_CAP);
  const workMs = new Float64Array(FRAME_CAP);
  let frames = 0;
  if (VIEW !== 'pod') renderer.setBuildCamera(CAMERAS[VIEW]);
  const frame: RenderFrame = {
    world,
    alpha: 0,
    timeMs: 0,
    mode: VIEW === 'pod' ? 'play' : 'build',
    events: [],
    layout: layoutNow(),
    touching: false,
    arming: null,
    brightMines: false,
    reducedMotion: false,
    podRunning: true,
  };
  let acc = 0;
  let last = performance.now();
  state.phase = PREFILL > 0 ? 'prefill' : 'warmup';

  const step = (): void => {
    world.step(NO_INTENT, true);
  };

  await new Promise<void>((resolve) => {
    const loop = (t: number): void => {
      const t0 = performance.now();
      const dt = Math.min(t - last, FRAME_DT_CLAMP_MS);
      const interval = t - last;
      last = t;
      if (state.phase === 'prefill') {
        for (let i = 0; i < PREFILL_STEPS && timer.ticks < PREFILL; i++) step();
        state.progress = timer.ticks / Math.max(1, PREFILL);
        if (timer.ticks >= PREFILL) {
          state.phase = 'warmup';
          acc = 0;
        }
      } else if (FAST) {
        const until = t0 + FAST_BUDGET_MS;
        for (let n = 0; n < 120 && performance.now() < until; n++) step();
      } else {
        // 04 §3.2: fixed 60 Hz steps from the frame time, at most 5 a frame (≤ 2 factory ticks).
        acc += dt;
        let n = 0;
        while (acc >= STEP_MS && n < MAX_STEPS_PER_FRAME) {
          step();
          acc -= STEP_MS;
          n++;
        }
        if (n === MAX_STEPS_PER_FRAME) acc = Math.min(acc, STEP_MS);
      }
      if (state.phase === 'warmup') {
        const done = timer.ticks - PREFILL;
        state.progress = done / Math.max(1, WARMUP);
        if (done >= WARMUP) {
          state.phase = 'timed';
          timer.recording = true;
        }
      }
      frame.alpha = FAST ? 0 : acc / STEP_MS;
      frame.timeMs = t;
      frame.events = world.drainEvents();
      frame.layout = layoutNow();
      renderer.render(frame);
      const work = performance.now() - t0;
      if (state.phase === 'timed') {
        if (frames < FRAME_CAP) {
          frameMs[frames] = interval;
          workMs[frames] = work;
          frames++;
        }
        state.progress = timer.n / TICKS;
        if (timer.full) {
          state.phase = 'batch';
          resolve();
          return;
        }
      }
      const pct = Math.min(100, Math.round(state.progress * 100));
      setStatus(`${state.phase === 'prefill' ? 'Filling the lifts' : state.phase === 'warmup' ? 'Warming up' : 'Timing'}: ${pct}% · tick ${timer.ticks.toLocaleString()} · ${world.factory!.debug.itemsHeld().toLocaleString()} items`);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame((t) => {
      last = t;
      loop(t);
    });
  });

  // Batches: the same factory ticked back to back, a few batches a frame so the page stays responsive.
  const batch = new Float64Array(BATCHES);
  for (let b = 0; b < BATCHES; b++) {
    batch[b] = timer.batch(BATCH_TICKS);
    if (b % 3 === 2) {
      state.progress = (b + 1) / BATCHES;
      setStatus(`Batch timing: ${Math.round(state.progress * 100)}%`);
      frame.timeMs = await nextFrame();
      frame.events = world.drainEvents();
      renderer.render(frame);
    }
  }
  const f = world.factory!;
  const fd = dist(frameMs, frames);
  const tick = dist(timer.samples, timer.n);
  const tickBatch = dist(batch);
  const info = renderer.info;
  const report: BenchReport = {
    v: 1,
    build: __HF_VERSION__,
    scope: world.scope,
    mode: FAST ? 'fast' : 'live',
    view: VIEW,
    dense: DENSE,
    ua: navigator.userAgent,
    gpu: gpuName(canvas),
    dpr: window.devicePixelRatio || 1,
    look: info.look,
    quality: info.quality,
    entities: bw.counts.entities,
    beltTiles: bw.counts.beltTiles,
    buildings: bw.counts.entities + bw.counts.beltTiles,
    items: f.debug.itemsHeld(),
    kinds: bw.counts.kinds,
    buildMs: Math.round(bw.buildMs),
    prefillTicks: PREFILL,
    warmupTicks: WARMUP,
    tick,
    tickBatch,
    timerResMs: resMs,
    frame: fd,
    work: dist(workMs, frames),
    dropped: droppedRate(frameMs, frames, hz),
    displayHz: hz,
    drawCalls: info.drawCalls,
    triangles: info.triangles,
    gatePass: Math.max(tick.p95, tickBatch.p95) <= TICK_GATE_MS,
  };
  const code = await encodeBench(report);
  state.report = report;
  state.code = code;
  state.progress = 1;
  state.phase = 'done';
  document.body.classList.add('done');
  setStatus(`Done: factory tick p95 ${fmt(tick.p95)} ms over ${tick.n.toLocaleString()} ticks.`);
  showResults(report, code);
  console.log(`[bench] ${code}`);
}

function nextFrame(): Promise<number> {
  return new Promise((r) => requestAnimationFrame((t) => r(t)));
}

$('copy').addEventListener('click', () => {
  const box = $<HTMLTextAreaElement>('code');
  box.select();
  void navigator.clipboard?.writeText(box.value).then(
    () => ($('copy').textContent = 'Copied'),
    () => document.execCommand('copy'),
  );
});
$('again').addEventListener('click', () => location.reload());

main().catch((e: unknown) => {
  state.phase = 'error';
  state.error = e instanceof Error ? e.message : String(e);
  setStatus(`Bench failed: ${state.error}`);
  console.error(e);
});
