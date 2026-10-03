// Build mode in the app (canon §4.5, §4.11; 03 §3.5, §4.1; 04 §3.7): enterBuild / exitBuild, the 'build' pause
// reason, the build camera, and the BUILD / Place drill context actions.
import { signal } from '@preact/signals';
import { describe, expect, it, vi } from 'vitest';
import { GameApp, type BuildHost, type ControllerOptions } from '../../src/app/controller';
import { defaultSettings } from '../../src/app/settings';
import { TimeController } from '../../src/app/time';
import type { AppController, InputController, Mode } from '../../src/app/types';
import type { PodIntent } from '../../src/pod/types';
import type { Renderer } from '../../src/render/api';
import type { GameEvent } from '../../src/shared/events';
import type { CargoItem, Lode } from '../../src/shared/types';
import { BUILD_IDLE_MS, buildContext, lodeNextToPod, placeDrillContext } from '../../src/ui/build/contextActions';
import type { BuildSession } from '../../src/ui/build/session';
import type { WorldApi } from '../../src/world/api';

const TIERS = { drill: 1, hull: 1, engine: 1, tank: 1, radiator: 1, bay: 1, scanner: 1 };

class FakeWorld {
  pod = { x: 7.5, y: 0.4, vx: 0, vy: 0, fuel: 6, hull: 10, grounded: true, destroyed: false, tiers: { ...TIERS }, cargo: [] as CargoItem[], quickSlots: [] };
  wallet = { cash: 20, debt: 0, lifetimeEarned: 0 };
  story = { deepestRow: 0, trips: 0 };
  stepNo = 0;
  scope = 'mvp';
  meta = { surveyColumn: 26, scriptedLodeId: 0 };
  terrain = { lodes: [] as Lode[] };
  rungs = new Set(['U0']);
  factory: unknown = {
    entities: () => [{ kind: 'headframe', plane: 'yard', x: 26, y: 1, w: 2, h: 2 }],
    ghosts: () => [],
    isUnlocked: (r: string) => this.rungs.has(r),
  };
  sheetClosed = vi.fn();
  step(_i: PodIntent, _running: boolean): void {
    this.stepNo++;
  }
  drainEvents(): GameEvent[] {
    return [];
  }
  cargoValue(): number {
    return 0;
  }
  serialize(): Uint8Array {
    return new Uint8Array([1]);
  }
  stats() {
    return { cargoMass: 0, hoverCap: 100 };
  }
}

function makeApp(world = new FakeWorld()) {
  const input = { releaseAll: vi.fn(), sampleIntent: vi.fn(), touching: false, active: false, dispose: vi.fn() } as unknown as InputController;
  const renderer = { setBuildCamera: vi.fn() } as unknown as Renderer & { setBuildCamera: ReturnType<typeof vi.fn> };
  const opts: ControllerOptions = {
    world: world as unknown as WorldApi,
    worlds: { create: () => new FakeWorld() as unknown as WorldApi, deserialize: () => new FakeWorld() as unknown as WorldApi },
    codes: { encode: () => 'HF1:x', decode: () => ({ ok: false, reason: 'no' }) },
    settings: defaultSettings(393, 852),
    look: 'toon',
    settingsStore: { loadSettings: vi.fn(), saveSettings: vi.fn(), loadLook: vi.fn(), saveLook: vi.fn() },
    styleTest: false,
    standalone: true,
    canInstall: false,
    coldLoad: false,
    resolveQuality: () => 'mid',
    now: () => 0,
    randomSeed: () => 1,
  };
  const app = new GameApp(opts);
  app.attachInput(input);
  app.attachRenderer(renderer);
  app.attachSaves({ markDirty: vi.fn(), requestSoon: vi.fn(), critical: vi.fn(() => null), setEnabled: vi.fn() });
  app.start();
  return { app, world, input, renderer };
}

describe('enterBuild / exitBuild (canon §4.5, §4.11)', () => {
  it('holds the pod with the build reason while the factory keeps running, and resumes on exit', () => {
    const { app, input } = makeApp();
    const host: BuildHost = { begin: vi.fn(() => true), end: vi.fn() };
    app.attachBuild(host);
    expect(app.podRunning()).toBe(true);
    app.enterBuild();
    expect(app.state.mode.value).toBe('build');
    expect(app.time.has('build')).toBe(true);
    expect(app.podRunning()).toBe(false);
    expect(host.begin).toHaveBeenCalledTimes(1);
    expect(input.releaseAll).toHaveBeenCalled();
    app.enterBuild();
    expect(host.begin).toHaveBeenCalledTimes(1);
    app.state.buildFrame.value = { plane: 'yard', cursor: null, preview: null, bulldoze: false, selectedId: null };
    app.exitBuild();
    expect(host.end).toHaveBeenCalledTimes(1);
    expect(app.state.mode.value).toBe('play');
    expect(app.state.buildFrame.value).toBeNull();
    expect(app.podRunning()).toBe(true);
  });

  it('sets the build camera itself when no session is attached, and returns to play on exit', () => {
    const { app, renderer } = makeApp();
    app.enterBuild();
    expect(renderer.setBuildCamera).toHaveBeenLastCalledWith({ plane: 'yard', cx: 7.5, cy: 4, ppu: 39, yaw: 0 });
    app.exitBuild();
    expect(renderer.setBuildCamera).toHaveBeenLastCalledWith(null);
  });

  it('underground it opens on the mine, centred on the pod', () => {
    const w = new FakeWorld();
    w.pod.y = -45.6;
    w.pod.x = 26.5;
    const { app, renderer } = makeApp(w);
    app.enterBuild();
    expect(renderer.setBuildCamera).toHaveBeenLastCalledWith({ plane: 'mine', cx: 26.5, cy: 45.6, ppu: 47, yaw: 0 });
  });

  it('closes an open sheet (≡ → Build) and stays shut under the title or without a factory', () => {
    const { app } = makeApp();
    app.openSheet('menu');
    app.enterBuild();
    expect(app.state.sheet.value).toBeNull();
    expect(app.state.mode.value).toBe('build');
    app.exitBuild();

    const w = new FakeWorld();
    w.factory = null;
    const m0 = makeApp(w);
    m0.app.enterBuild();
    expect(m0.app.state.mode.value).toBe('play');

    const t = makeApp();
    t.app.previewOverlay('title');
    t.app.enterBuild();
    expect(t.app.state.mode.value).toBe('play');
  });

  it('interruptions wait for the exit; leaving airborne and falling fast runs the countdown (canon §4.5)', () => {
    const w = new FakeWorld();
    const { app } = makeApp(w);
    app.enterBuild();
    app.interrupt();
    expect(app.state.overlay.value).toBeNull();
    w.pod.grounded = false;
    w.pod.vy = -7;
    app.exitBuild();
    expect(app.state.overlay.value).toBe('countdown');
    expect(app.podRunning()).toBe(false);
  });

  it('pad arrivals do not open sheets over build mode; a new world leaves build mode', () => {
    const { app } = makeApp();
    app.enterBuild();
    app.handleEvents([{ t: 'pad-arrive', id: 'pump' }]);
    expect(app.state.sheet.value).toBeNull();
    app.newGame();
    expect(app.state.mode.value).toBe('play');
  });
});

describe('TimeController: the build reason', () => {
  it('is modal for interrupts and gates the exit like a sheet', () => {
    const t = new TimeController();
    expect(t.setBuild(true, { grounded: true, vx: 0, vy: 0 })).toBe(true);
    expect(t.podRunning).toBe(false);
    expect(t.interrupt()).toBe(false);
    expect(t.setBuild(false, { grounded: true, vx: 0, vy: 0 })).toBe(true);
    expect(t.podRunning).toBe(true);
    t.setBuild(true, { grounded: true, vx: 0, vy: 0 });
    t.setBuild(false, { grounded: false, vx: 0, vy: -6 });
    expect(t.overlay()).toBe('countdown');
    expect(t.setBuild(false, { grounded: true, vx: 0, vy: 0 })).toBe(false);
  });
});

describe('context actions (03 §3.5)', () => {
  function ctxApp(patch: { rungs?: string[]; pod?: Partial<FakeWorld['pod']>; mode?: Mode; lodes?: Lode[]; ghosts?: unknown[]; drills?: unknown[] } = {}) {
    const w = new FakeWorld();
    for (const r of patch.rungs ?? []) w.rungs.add(r);
    Object.assign(w.pod, patch.pod);
    w.terrain.lodes = patch.lodes ?? [];
    w.factory = {
      entities: () => patch.drills ?? [],
      ghosts: () => patch.ghosts ?? [],
      isUnlocked: (r: string) => w.rungs.has(r),
    };
    const app = { world: w, state: { mode: signal<Mode>(patch.mode ?? 'play') }, enterBuild: vi.fn() } as unknown as AppController;
    return { app, w };
  }

  it('BUILD needs something to build (U2), a grounded, still pod and 0.6 s without stick input', () => {
    const idle = { now: 0, idleMs: BUILD_IDLE_MS };
    expect(buildContext(ctxApp().app, idle)).toBeNull();
    const { app } = ctxApp({ rungs: ['U2'] });
    expect(buildContext(app, idle)).toMatchObject({ priority: 3, id: 'build', label: 'BUILD' });
    expect(buildContext(app, { now: 0, idleMs: BUILD_IDLE_MS - 1 })).toBeNull();
    expect(buildContext(ctxApp({ rungs: ['U2'], pod: { grounded: false } }).app, idle)).toBeNull();
    expect(buildContext(ctxApp({ rungs: ['U2'], pod: { vx: 0.3 } }).app, idle)).toBeNull();
    expect(buildContext(ctxApp({ rungs: ['U2'], mode: 'build' }).app, idle)).toBeNull();
    buildContext(app, idle)?.run(app);
    expect(app.enterBuild).toHaveBeenCalled();
  });

  it('Place drill shows next to a discovered, drill-less lode with an Auto-Drill Kit aboard', () => {
    const lode: Lode = { id: 0, metal: 'copper', purity: 'normal', x0: 27, top: 46, scripted: true, scope: 'mvp', discovered: true };
    const pod = { x: 26.5, y: -45.6, cargo: [{ kind: 'kit', id: 'autoDrill' }] as CargoItem[] };
    const session = { placeDrill: vi.fn() } as unknown as BuildSession;
    const provider = placeDrillContext(session);
    const near = ctxApp({ rungs: ['U2'], pod, lodes: [lode] });
    expect(lodeNextToPod(near.app)?.id).toBe(0);
    const a = provider(near.app, { now: 0, idleMs: 0 });
    expect(a).toMatchObject({ priority: 2, id: 'placeDrill', label: 'Place drill' });
    a?.run(near.app);
    expect(session.placeDrill).toHaveBeenCalledWith(0);
    expect(provider(ctxApp({ rungs: ['U2'], pod: { ...pod, cargo: [] }, lodes: [lode] }).app, { now: 0, idleMs: 0 })).toBeNull();
    expect(provider(ctxApp({ rungs: ['U2'], pod: { ...pod, x: 15.5 }, lodes: [lode] }).app, { now: 0, idleMs: 0 })).toBeNull();
    expect(provider(ctxApp({ rungs: ['U2'], pod, lodes: [{ ...lode, discovered: false }] }).app, { now: 0, idleMs: 0 })).toBeNull();
    const drilled = ctxApp({ rungs: ['U2'], pod, lodes: [lode], drills: [{ kind: 'autoDrill', x: 27, y: 44 }] });
    expect(provider(drilled.app, { now: 0, idleMs: 0 })).toBeNull();
    const ghosted = ctxApp({ rungs: ['U2'], pod, lodes: [lode], ghosts: [{ kind: 'autoDrill', x: 28, y: 44 }] });
    expect(provider(ghosted.app, { now: 0, idleMs: 0 })).toBeNull();
  });
});
