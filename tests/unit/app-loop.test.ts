import { signal } from '@preact/signals';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from '../../src/audio/engine';
import type { GameApp } from '../../src/app/controller';
import { armingRadius, FixedStepper, GameLoop, SHEET_RENDER_MS, STEP_MS } from '../../src/app/loop';
import { defaultSettings } from '../../src/app/settings';
import { clipToast, holdToast, MAX_TOASTS, pruneToasts, pushToast, TOAST_MS, toastsCovered } from '../../src/app/toasts';
import type { InputController, Mode, Overlay, SheetId } from '../../src/app/types';
import { PerfMonitor } from '../../src/debug/perf';
import { NO_INTENT } from '../../src/pod/types';
import type { Renderer, ViewportLayout } from '../../src/render/api';
import { MEGA_POP_RADIUS, POP_RADIUS } from '../../src/shared/canon';

describe('FixedStepper (canon §3.5)', () => {
  it('runs one step per 60 Hz frame and accumulates remainders', () => {
    const s = new FixedStepper();
    expect(s.advance(STEP_MS)).toBe(1);
    expect(s.advance(STEP_MS / 2)).toBe(0);
    expect(s.alpha).toBeCloseTo(0.5, 6);
    expect(s.advance(STEP_MS / 2)).toBe(1);
  });

  it('runs two steps per 30 Hz frame (counters are in steps)', () => {
    const s = new FixedStepper();
    let steps = 0;
    for (let i = 0; i < 30; i++) steps += s.advance(1000 / 30);
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(60);
  });

  it('caps at 5 steps per frame and drops the excess wall time', () => {
    const s = new FixedStepper();
    expect(s.advance(10_000)).toBe(5); // clamped to 250 ms = 15 steps, capped at 5
    expect(s.alpha).toBeLessThan(1);
    expect(s.advance(0)).toBeLessThanOrEqual(1);
  });

  it('ignores negative dt and keeps alpha in [0, 1)', () => {
    const s = new FixedStepper();
    expect(s.advance(-50)).toBe(0);
    expect(s.alpha).toBe(0);
    s.advance(STEP_MS * 0.999);
    expect(s.alpha).toBeLessThan(1);
  });
});

describe('arming footprint', () => {
  it('shows the blast radius for explosives only', () => {
    expect(armingRadius('pop')).toBe(POP_RADIUS);
    expect(armingRadius('megaPop')).toBe(MEGA_POP_RADIUS);
    expect(armingRadius('hopBeacon')).toBe(0);
    expect(armingRadius(undefined)).toBe(0);
  });
});

describe('toasts (03 §6.2)', () => {
  it('keeps at most two, newest last, for 2.5 s', () => {
    let l = pushToast([], 1, 'a', 'info', 0);
    l = pushToast(l, 2, 'b', 'warn', 10);
    l = pushToast(l, 3, 'c', 'good', 20);
    expect(l.map((t) => t.text)).toEqual(['b', 'c']);
    expect(l).toHaveLength(MAX_TOASTS);
    expect(l[1].until).toBe(20 + TOAST_MS);
  });

  it('refreshes a repeated text instead of stacking it', () => {
    let l = pushToast([], 1, 'Bay full', 'warn', 0);
    l = pushToast(l, 2, 'Bay full', 'warn', 1_000);
    expect(l).toHaveLength(1);
    expect(l[0].id).toBe(2);
  });

  it('prunes expired toasts and returns the same list when nothing expired', () => {
    const l = pushToast([], 1, 'a', 'info', 0);
    expect(pruneToasts(l, 100)).toBe(l);
    expect(pruneToasts(l, TOAST_MS)).toEqual([]);
  });

  it('clips to 40 characters', () => {
    expect(clipToast('x'.repeat(60))).toHaveLength(40);
    expect(clipToast('short')).toBe('short');
  });
});

describe('toasts behind covering overlays', () => {
  it('title, upright card and Safe Mode cover the toast layer; play, cards and countdown do not', () => {
    expect((['title', 'upright', 'safemode'] as Overlay[]).every(toastsCovered)).toBe(true);
    expect(([null, 'interrupt', 'countdown', 'death'] as Overlay[]).some(toastsCovered)).toBe(false);
  });

  it('holds at most two, a repeat moving to the end', () => {
    let h = holdToast([], { text: 'a' });
    h = holdToast(h, { text: 'b' });
    h = holdToast(h, { text: 'a' });
    expect(h.map((t) => t.text)).toEqual(['b', 'a']);
    h = holdToast(h, { text: 'x'.repeat(60) });
    expect(h.map((t) => t.text.length)).toEqual([1, 40]);
  });
});

/** A GameLoop over stand-ins, driven frame by frame (rAF stubbed). */
function loopHarness() {
  let raf: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    raf = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    raf = null;
  });
  const pod = { thrust: 1, digging: true, tiers: { drill: 2, engine: 3 }, quickSlots: [], y: -10.5, vy: -9 };
  const world = { pod, step: vi.fn(), drainEvents: () => [] };
  let running = true;
  const state = {
    overlay: signal<Overlay>(null),
    sheet: signal<SheetId>(null),
    settings: signal(defaultSettings(393, 852)),
    arming: signal(null),
    perf: signal(null),
    mode: signal<Mode>('play'),
  };
  const app = { world, state, podRunning: () => running, setContextLost: vi.fn(), tick: vi.fn(), handleEvents: vi.fn() } as unknown as GameApp;
  const audio = { handleEvents: vi.fn(), update: vi.fn() };
  const renderer = { contextLost: false, render: vi.fn(), info: { drawCalls: 0, triangles: 0 } };
  const input = { sampleIntent: () => NO_INTENT, touching: false } as unknown as InputController;
  const loop = new GameLoop({
    app,
    input,
    renderer: renderer as unknown as Renderer,
    audio: audio as unknown as AudioEngine,
    saves: null,
    perf: new PerfMonitor(60),
    layout: () => ({}) as ViewportLayout,
    osReducedMotion: false,
  });
  loop.start();
  return {
    loop,
    audio,
    renderer,
    state,
    pod,
    frame: (t: number) => raf?.(t),
    hold: (held: boolean) => {
      running = !held;
    },
  };
}

describe('GameLoop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a held pod is silent (thrust bed to 0, no dig ticks) but keeps its thrust and dig state', () => {
    const h = loopHarness();
    h.frame(0);
    expect(h.audio.update).toHaveBeenLastCalledWith(expect.objectContaining({ thrust: 1, digging: true, drillTier: 2 }), 0);
    h.hold(true); // blur → "Tap to resume", menu, upright card, ctxlost, countdown…
    h.frame(16);
    expect(h.audio.update).toHaveBeenLastCalledWith(expect.objectContaining({ thrust: 0, digging: false }), 16);
    expect(h.pod).toMatchObject({ thrust: 1, digging: true });
    h.hold(false);
    h.frame(32);
    expect(h.audio.update).toHaveBeenLastCalledWith(expect.objectContaining({ thrust: 1, digging: true }), 32);
  });

  it('passes depth, fall speed, engine tier and the sheet/build duck to audio', () => {
    const h = loopHarness();
    h.frame(0);
    expect(h.audio.update).toHaveBeenLastCalledWith(expect.objectContaining({ depth: 10.5, vy: -9, engineTier: 3, ducked: false }), 0);
    h.state.mode.value = 'build';
    h.frame(16);
    expect(h.audio.update).toHaveBeenLastCalledWith(expect.objectContaining({ ducked: true }), 16);
    h.hold(true);
    h.frame(32);
    expect(h.audio.update).toHaveBeenLastCalledWith(expect.objectContaining({ vy: 0, depth: 10.5 }), 32);
  });

  it('draws a held scene under "Tap to resume" at the sheet rate, and every frame in play', () => {
    const h = loopHarness();
    const run = (from: number, ms: number): number => {
      h.renderer.render.mockClear();
      for (let t = from; t < from + ms; t += 16) h.frame(t);
      return h.renderer.render.mock.calls.length;
    };
    expect(run(0, 320)).toBe(20);
    h.hold(true);
    h.state.overlay.value = 'interrupt';
    expect(run(400, 320)).toBeLessThanOrEqual(Math.ceil(320 / SHEET_RENDER_MS) + 1);
    h.state.overlay.value = 'title';
    expect(run(800, 320)).toBe(20);
  });

  it('freeze stops the loop on a frame at t = 0; stepFrozen advances fixed 60-Hz frames only', () => {
    const h = loopHarness();
    const times: number[] = [];
    h.renderer.render.mockImplementation((f: { timeMs: number }) => void times.push(f.timeMs));
    h.frame(0);
    times.length = 0;
    h.loop.freeze();
    expect(h.loop.running).toBe(false);
    expect(times).toEqual([0]);
    h.frame(5_000); // no rAF while frozen
    h.loop.stepFrozen(3);
    expect(times).toEqual([0, STEP_MS, 2 * STEP_MS, 3 * STEP_MS]);
    expect(h.renderer.render.mock.lastCall?.[0]).toMatchObject({ alpha: 0 });
    h.loop.start();
    expect(h.loop.running).toBe(true);
    h.loop.stepFrozen(1); // not frozen any more: ignored
    expect(times).toHaveLength(4);
  });
});
