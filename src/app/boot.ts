// Boot sequence (04 §3, §4.13, §9): settings → layout → tier → save store + boot tracking (Safe Mode) → world →
// AppController → UI → audio/saves/lifecycle → renderer + input + loop. Safe Mode holds the renderer, input and
// loop back until the player picks a way out (that screen is DOM-only).
import { effect } from '@preact/signals';
import { AudioEngine, MAX_VOICES, MAX_VOICES_LOW } from '../audio/engine';
import { inScope, SCOPE } from '../config/scope';
import { readJetsamSummary } from '../debug/jetsam';
import { PerfMonitor } from '../debug/perf';
import { encodePerfReport, estimateGpuMB, heapMB, PerfRecorder } from '../debug/perfReport';
import { createInput } from '../input';
import { lsKey } from '../platform/channel';
import { detectDevice, osTextScale, prefersReducedMotion, type DeviceInfo } from '../platform/device';
import { onLifecycle } from '../platform/lifecycle';
import { isLandscapePhone } from '../platform/orientation';
import { registerServiceWorker, type ServiceWorkerHandle } from '../platform/pwa';
import { local, requestPersistentStorage, session } from '../platform/storage';
import { createWakeLock } from '../platform/wakeLock';
import type { QualityTier, Renderer } from '../render/api';
import { createRenderer } from '../render/renderer';
import { BOOT_STABLE_MS, BootTracker } from '../save/bootTrack';
import { SaveScheduler, type SaveSink } from '../save/scheduler';
import type { WriteError } from '../save/store';
import type { Look } from '../shared/types';
import { mountUI } from '../ui';
import { debugEnabled } from '../ui/env';
import {
  adoptLateStore,
  codes,
  LateSink,
  loadInitialWorld,
  nullSink,
  openStore,
  previousCopyAge,
  randomSeed,
  safeModeHooks,
  seedOverride,
  worlds,
  type LoadedCopy,
} from './bootWorld';
import { GameApp, type AppHooks } from './controller';
import { orientationFlipped } from './layout';
import { GameLoop } from './loop';
import { NOTICE } from './notices';
import { createSettingsStore, defaultSettings, initialLook, type SettingsStore } from './settings';
import { createStyleViews } from './styleViews';
import { resolveTier } from './tier';
import type { Settings } from './types';
import { createViewportTracker, parseDprOverride, type ViewportTracker } from './viewport';
import { inPlay, WakePolicy } from './wakePolicy';

const SAVE_ERROR_TOAST_GAP_MS = 60_000;
const PRELOAD_RELOAD_KEY = 'preloadReload';

/** Plain-DOM message for failures before or outside the UI (the #boot splash is gone once the UI mounts). */
export function showBootMessage(text: string): void {
  let b = document.getElementById('boot');
  if (!b) {
    b = document.createElement('div');
    b.id = 'boot';
    b.setAttribute('role', 'alert');
    b.style.cssText =
      'position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;' +
      'background:#2b1e2f;color:#f6e7d2;font:600 18px system-ui,sans-serif;z-index:10';
    document.body.appendChild(b);
  }
  b.textContent = text;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing from index.html`);
  return e as T;
}

interface BootConfig {
  params: URLSearchParams;
  testMode: boolean;
  device: DeviceInfo;
  osReducedMotion: boolean;
  settingsStore: SettingsStore;
  settings: Settings;
  look: Look;
  resolveQuality(q: Settings['quality']): QualityTier;
  navStart: number;
}

function readConfig(): BootConfig {
  const params = new URLSearchParams(location.search);
  const device = detectDevice();
  const osReducedMotion = prefersReducedMotion();
  const settingsStore = createSettingsStore(local, (n) => lsKey(n));
  const urlTier = params.get('tier');
  return {
    params,
    testMode: params.get('test') === '1',
    device,
    osReducedMotion,
    settingsStore,
    // Text scale is an MVP row (canon §5.5): an M0 build keeps 100%.
    settings: settingsStore.loadSettings(defaultSettings(screen.width, screen.height, osReducedMotion, inScope('mvp') ? osTextScale() : 1)),
    look: initialLook(params.get('look'), settingsStore.loadLook()),
    resolveQuality: (q) => resolveTier(q, urlTier, device),
    navStart: performance.now(),
  };
}

/**
 * 04 §4.13: only boots that die in view count towards Safe Mode. A boot hidden or left (pagehide) before its
 * first frame was closed by the player, not killed by the save; visible again (or back from the bfcache), it
 * counts again. Returns a function removing the listeners.
 */
function trackLeftBoot(tracker: BootTracker): () => void {
  const sync = (): void => tracker.setLeft(document.visibilityState === 'hidden');
  const left = (): void => tracker.setLeft(true);
  sync();
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', left);
  window.addEventListener('pageshow', sync);
  return () => {
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('pagehide', left);
    window.removeEventListener('pageshow', sync);
  };
}

/** Autosave policy over the store. Disabled until this boot draws its first frame (see wireEngine). */
function createSaves(app: GameApp, sink: SaveSink): SaveScheduler {
  let lastErrorAt = Number.NEGATIVE_INFINITY;
  let persistAsked = false;
  const onError = (error: WriteError | 'serialize'): void => {
    const now = performance.now();
    if (error === 'closed' || now - lastErrorAt < SAVE_ERROR_TOAST_GAP_MS) return;
    lastErrorAt = now;
    app.toast(error === 'quota' ? NOTICE.storageFull : NOTICE.saveFailed, 'warn');
  };
  const saves = new SaveScheduler(
    {
      serialize: () => app.world.serialize(),
      summarize: () => ({ deepestRow: app.world.story.deepestRow, cash: app.world.wallet.cash, trips: app.world.story.trips }),
      sink,
      onError,
      onSaved: () => {
        // canon §3.15: persist() after the first save.
        if (persistAsked) return;
        persistAsked = true;
        void requestPersistentStorage();
      },
    },
    performance.now(),
  );
  app.attachSaves(saves);
  // A boot that dies while loading must not overwrite the older, possibly good copy through its pagehide save.
  saves.setEnabled(false);
  return saves;
}

/** Critical saves on hide, `interrupt` sources (canon §4.5), audio suspend/resume, and the preload-error reload. */
function wireLifecycle(app: GameApp, saves: SaveScheduler, audio: AudioEngine, loop: () => GameLoop | null): void {
  let lastCriticalStep = -1;
  const criticalSave = (): void => {
    // pagehide right after visibilitychange→hidden: nothing new to write.
    if (app.world.stepNo === lastCriticalStep && !saves.isDirty) return;
    lastCriticalStep = app.world.stepNo;
    saves.critical(performance.now());
  };
  onLifecycle({
    hidden: () => {
      criticalSave();
      audio.suspend();
    },
    pagehide: criticalSave,
    visible: () => {
      loop()?.resetClock();
      audio.resume();
      app.interrupt();
    },
    blur: () => app.interrupt(),
    orientation: () => app.interrupt(),
  });
  window.addEventListener('vite:preloadError', (ev) => {
    // 04 §4.12: a lazy chunk vanished after a deploy — save, then reload once (sessionStorage-guarded).
    const key = lsKey(PRELOAD_RELOAD_KEY);
    if (session.get(key)) return;
    ev.preventDefault();
    session.set(key, '1');
    const done = saves.critical(performance.now());
    const timeout = new Promise((r) => setTimeout(r, 1_000));
    void Promise.race([done ?? Promise.resolve(), timeout]).then(() => location.reload());
  });
}

interface PerfReporter {
  recorder: PerfRecorder;
  marks: { firstFrameMs: number | null; firstInputMs: number | null };
  report(renderer: Renderer | null): Promise<string>;
}

/** Perf Report source (04 §10.3): frame histogram per look/tier segment, TTI marks, memory, jetsam result. */
function createPerfReporter(cfg: BootConfig, app: GameApp, perf: PerfMonitor, viewport: ViewportTracker): PerfReporter {
  const recorder = new PerfRecorder(perf, cfg.look, cfg.resolveQuality(cfg.settings.quality));
  const marks: PerfReporter['marks'] = { firstFrameMs: null, firstInputMs: null };
  return {
    recorder,
    marks,
    report: (renderer) => {
      const l = viewport.layout;
      const d = cfg.device;
      return encodePerfReport({
        v: 1,
        build: __HF_VERSION__,
        scope: SCOPE,
        createdAt: new Date().toISOString(),
        device: { ua: d.ua, dpr: l.dpr, deviceMemory: d.deviceMemory, standalone: d.standalone, viewport: [l.width, l.height] },
        look: app.state.look.peek(),
        tier: cfg.resolveQuality(app.state.settings.peek().quality),
        segments: recorder.snapshot(),
        drawCalls: renderer?.info.drawCalls ?? 0,
        triangles: renderer?.info.triangles ?? 0,
        marks: { ...marks },
        heapMB: heapMB(),
        gpuEstimateMB: estimateGpuMB(l.width, l.height, l.dpr),
        jetsam: readJetsamSummary(local, lsKey('jetsam')),
      });
    },
  };
}

interface EngineDeps {
  cfg: BootConfig;
  app: GameApp;
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  viewport: ViewportTracker;
  audio: AudioEngine;
  saves: SaveScheduler;
  perf: PerfMonitor;
  reporter: PerfReporter;
  /** Called once this boot has drawn its first frame. */
  onFirstFrame(): void;
  onFirstTick(): void;
}

/** Renderer + input + loop (+ the ?test=1 hook). Returns null when WebGL2 is unavailable. */
function startEngine(d: EngineDeps): { loop: GameLoop; renderer: Renderer } | null {
  const { cfg, app, canvas, viewport } = d;
  let renderer: Renderer;
  try {
    renderer = createRenderer(canvas, viewport.layout, {
      look: app.state.look.peek(),
      quality: cfg.resolveQuality(app.state.settings.peek().quality),
      precompileBoth: SCOPE === 'm0',
      perspective: cfg.params.get('persp') === '1',
    });
  } catch (e) {
    console.error(e);
    showBootMessage('HoleFactory needs WebGL2. Update your browser or try another one.');
    return null;
  }
  app.attachRenderer(renderer);
  const input = createInput({
    canvas,
    uiRoot: d.uiRoot,
    app,
    getLayout: () => viewport.layout,
    onInterrupt: () => app.interrupt(),
    // Sign taps auto-drive to the pad (01 §3.10); one-handed taps on a neighbour dig once (03 §3.6).
    onWorldTap: (px, py) => app.worldTap(px, py),
    isTapTarget: (px, py) => app.tapTargetAt(px, py),
    podScreen: () => {
      const p = app.world.pod;
      return renderer.worldToScreen(p.x, p.y, 0);
    },
  });
  app.attachInput(input);
  let reported = false;
  const loop = new GameLoop({
    app,
    input,
    renderer,
    audio: d.audio,
    saves: d.saves,
    perf: d.perf,
    layout: () => viewport.layout,
    osReducedMotion: cfg.osReducedMotion,
    onFirstTick: d.onFirstTick,
    onFirstFrame: d.onFirstFrame,
    onError: (e) => {
      if (reported) return;
      reported = true;
      console.error('HoleFactory frame error', e);
    },
  });
  loop.start();
  if (cfg.testMode) {
    void import('../debug/testHook').then((m) =>
      m.installTestHook({
        app,
        loop,
        renderer,
        perfReport: () => d.reporter.report(renderer),
        audioState: () => d.audio.state,
        saveNow: async () => (await d.saves.critical(performance.now()))?.ok ?? false,
      }),
    );
  }
  return { loop, renderer };
}

/** Running inside another page's frame (e.g. a hosted preview): no install prompt and no service worker. */
function embedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** 04 §9.2: prompt-type service worker; a waiting update is applied only from the controller's update chip. */
function wireServiceWorker(app: GameApp): void {
  let sw: ServiceWorkerHandle | null = null;
  void registerServiceWorker({
    onNeedRefresh: () => app.notifyUpdateReady(async () => sw?.applyUpdate()),
  }).then((h) => {
    sw = h;
  });
}

export async function boot(): Promise<void> {
  const cfg = readConfig();
  const canvas = el<HTMLCanvasElement>('game');
  const uiRoot = el<HTMLElement>('ui');

  // ---- world (store, boot tracking, Safe Mode)
  const tracker = new BootTracker(local, lsKey('boot'));
  const untrackLeft = trackLeftBoot(tracker);
  const opened = await openStore();
  const store = opened.store;
  const initial = await loadInitialWorld(opened, tracker, seedOverride(cfg.params, cfg.testMode));
  let loadedCopy: LoadedCopy | null = initial.loaded;
  let recoveredCopy: LoadedCopy | null = null;
  const safeMode = store && initial.safeModeCopy ? safeModeHooks(store, tracker, initial.safeModeCopy, (c) => (recoveredCopy = c)) : null;

  // ---- controller
  const hooks: AppHooks = {};
  const app = new GameApp({
    world: initial.world,
    worlds,
    codes,
    settings: cfg.settings,
    look: cfg.look,
    settingsStore: cfg.settingsStore,
    styleTest: SCOPE === 'm0',
    standalone: cfg.device.standalone,
    canInstall: !embedded() && !cfg.device.standalone && !cfg.device.inAppBrowser && (cfg.device.ios || cfg.device.android),
    coldLoad: initial.coldLoad,
    resolveQuality: cfg.resolveQuality,
    now: () => performance.now(),
    randomSeed,
    yieldSlice: () => new Promise((r) => setTimeout(r, 0)),
    safeMode,
    hooks,
    importOffer: cfg.device.standalone && initial.noSave,
    styleView: createStyleViews(),
  });
  if (store && initial.safeModeCopy) {
    void previousCopyAge(store, initial.safeModeCopy).then((ms) => {
      app.state.safeMode.value = { ...app.state.safeMode.peek(), previousOlderByMs: ms };
    });
  }

  // ---- layout, audio, saves, lifecycle
  const viewport = createViewportTracker({
    canvas,
    controlSize: cfg.settings.controlSize,
    dprOverride: parseDprOverride(cfg.params.get('dpr')),
    onChange: (next, prev) => {
      app.setUpright(isLandscapePhone(next.width, next.height));
      if (orientationFlipped(prev, next)) app.interrupt();
    },
  });
  app.setUpright(isLandscapePhone(viewport.layout.width, viewport.layout.height));

  const audio = new AudioEngine({
    maxVoices: cfg.resolveQuality(cfg.settings.quality) === 'low' ? MAX_VOICES_LOW : MAX_VOICES,
    enabled: cfg.settings.sound,
    respectSilent: cfg.settings.respectSilent,
    onInterrupted: () => app.interrupt(),
  });
  audio.installUnlockListeners();
  app.attachAudio(audio);

  const lateSink = opened.late ? new LateSink() : null;
  const saves = createSaves(app, store ?? lateSink ?? nullSink);
  if (opened.late && lateSink) {
    void adoptLateStore(opened.late).then((s) => {
      if (!s) return;
      lateSink.attach(s);
      app.toast(NOTICE.savesBack, 'good');
    });
  }
  let engine: { loop: GameLoop; renderer: Renderer } | null = null;
  wireLifecycle(app, saves, audio, () => engine?.loop ?? null);

  const perf = new PerfMonitor(60, cfg.navStart);
  const reporter = createPerfReporter(cfg, app, perf, viewport);
  // Wake Lock while in play; released after 25 s held by the title, a card or a sheet (03 §3.8).
  const wake = new WakePolicy(createWakeLock());
  effect(() => wake.update(inPlay(app.state.overlay.value, app.state.sheet.value)));
  hooks.onLook = (l) => reporter.recorder.switchTo(l, cfg.resolveQuality(app.state.settings.peek().quality));
  hooks.onSettings = (next, prev) => {
    if (next.controlSize !== prev.controlSize) viewport.setControlSize(next.controlSize);
    if (next.quality !== prev.quality) reporter.recorder.switchTo(app.state.look.peek(), cfg.resolveQuality(next.quality));
  };
  uiRoot.addEventListener('pointerdown', (e) => {
    reporter.marks.firstInputMs ??= performance.now() - cfg.navStart;
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest('button') && !t.closest('[data-slot],[data-thrust]')) audio.play('uiTap');
  });

  // ---- UI
  mountUI(uiRoot, app);
  document.getElementById('boot')?.remove();
  // Held behind the title (or Safe Mode) until the toast layer shows; a notice about the loaded copy is dropped if
  // the player starts a new game instead.
  const notice = initial.notice;
  if (notice?.aboutWorld) app.worldNotice(notice.text, notice.tone);
  else if (notice) app.toast(notice.text, notice.tone);

  // ---- engine (held back while Safe Mode is up)
  const engineDeps: EngineDeps = {
    cfg,
    app,
    canvas,
    uiRoot,
    viewport,
    audio,
    saves,
    perf,
    reporter,
    onFirstTick: () => tracker.phase('firstTick'),
    onFirstFrame: () => {
      reporter.marks.firstFrameMs = performance.now() - cfg.navStart;
      tracker.phase('firstFrame');
      untrackLeft();
      saves.setEnabled(true);
      setTimeout(() => {
        // Ran cleanly for 10 s: forget the boot record and vouch for the save we loaded (last-known-good), if its
        // copy still holds those bytes.
        tracker.clear();
        if (store && loadedCopy) void store.promoteGood(loadedCopy.copy, loadedCopy.seq);
      }, BOOT_STABLE_MS);
    },
  };
  const start = (): void => {
    engine ??= startEngine(engineDeps);
  };
  hooks.onSafeModeResolved = () => {
    // "Load previous copy" tracks that copy's boot; "New game" has no stored copy to vouch for.
    loadedCopy = recoveredCopy;
    if (!recoveredCopy) tracker.clear();
    start();
  };
  if (!safeMode) start();

  app.setPerfReporter(() => reporter.report(engine?.renderer ?? null));
  if (debugEnabled()) (window as Window & { __hfDebug?: unknown }).__hfDebug = { app, perfReport: () => reporter.report(engine?.renderer ?? null) };
  if (import.meta.env.PROD && !cfg.testMode && !embedded()) wireServiceWorker(app);
}
