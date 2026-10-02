// AppController (src/app/types.ts): the only object the UI talks to. Owns the reactive AppState, the
// TimeController (pause reasons, resume gate), toasts, death → salvage → respawn, saves on the 04 §4.12 triggers,
// export/import with the 04 §4.13 dry run and the waiting service-worker update (04 §9.2). Renderer, input, audio
// and saves are attached by boot.ts.
import { effect, signal } from '@preact/signals';
import type { QualityTier, Renderer } from '../render/api';
import { NO_INTENT } from '../pod/types';
import { LINES, MINE_H, MINE_W, RIM_BUILDINGS, SALVAGE_MIN, SALVAGE_RATE, SKY_ROWS, TIER_PRICE } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import type { Look, RimBuildingId } from '../shared/types';
import type { DecodedCode } from '../save/exportCode';
import type { WriteOutcome } from '../save/store';
import type { Result, WorldApi } from '../world/api';
import type { SettingsStore } from './settings';
import { NOTICE } from './notices';
import { TimeController, type PodMotion, type SheetReason } from './time';
import { holdToast, pruneToasts, pushToast, toastsCovered } from './toasts';
import { StoryFeed } from './storyFeed';
import type {
  AppController,
  AppState,
  DeathInfo,
  GoalChip,
  InputController,
  Mode,
  Overlay,
  RadioMessage,
  SheetId,
  Settings,
  Toast,
  TripSummary,
} from './types';

export const DEATH_CARD_MS = 3_000;
export const HUD_TICK_MS = 100;
/** 04 §4.13: an import runs this many headless steps on a scratch World before anything is written. */
export const IMPORT_DRY_RUN_STEPS = 1_200;
const DRY_RUN_SLICE = 200;

const RIM_IDS: ReadonlySet<string> = new Set(RIM_BUILDINGS.map((b) => b.id));

export function isRimBuilding(id: string | null): id is RimBuildingId {
  return id !== null && RIM_IDS.has(id);
}

function sheetReason(id: SheetId): SheetReason | null {
  if (id === null) return null;
  if (id === 'menu') return 'menu';
  if (id === 'settings' || id === 'saves' || id === 'debug') return 'settings';
  return 'sheet';
}

/** Canon §4.2: fee = max($25, round(0.08 × IPV)), IPV = price of every installed tier. Preview for the card. */
export function salvageFee(tiers: Readonly<Record<(typeof LINES)[number], number>>): number {
  let ipv = 0;
  for (const line of LINES) ipv += TIER_PRICE[Math.max(1, Math.min(TIER_PRICE.length, tiers[line])) - 1];
  return Math.max(SALVAGE_MIN, Math.round(SALVAGE_RATE * ipv));
}

/** Import invariants that need only the public API: the pod is finite and inside the world. */
export function worldLooksSane(w: WorldApi): boolean {
  const p = w.pod;
  const finite = [p.x, p.y, p.vx, p.vy, p.fuel, p.hull, w.wallet.cash, w.wallet.debt].every(Number.isFinite);
  return finite && p.x >= 0 && p.x <= MINE_W && p.y <= SKY_ROWS && p.y >= -MINE_H && w.wallet.cash >= 0;
}

export interface WorldFactory {
  create(seed: number): WorldApi;
  /** Throws on any bad save (codec bounds, invariants, too-new version). */
  deserialize(bytes: Uint8Array): WorldApi;
}

export interface SaveCodes {
  encode(bytes: Uint8Array): string;
  decode(code: string): DecodedCode;
}

export interface AudioPort {
  unlock(): void;
  play(id: 'error' | 'sheetOpen' | 'sheetClose' | 'uiTap'): void;
  setEnabled(on: boolean): void;
  setRespectSilent(on: boolean): void;
}

export interface SavePort {
  markDirty(): void;
  requestSoon(now: number): void;
  critical(now: number): Promise<WriteOutcome> | null;
  setEnabled(on: boolean): void;
}

export interface SafeModeHooks {
  /** Export code of the copy that keeps failing, or null to export the live world. */
  exportCode(): Promise<string | null>;
  /**
   * "Load previous copy (n min older)"; with no older copy, the failing copy itself once more. `message` says
   * which one loaded.
   */
  loadPrevious(): Promise<{ ok: true; world: WorldApi; message: string } | { ok: false; reason: string }>;
}

export interface AppHooks {
  /** Look changed (perf segments, persistence beyond settings). */
  onLook?(look: Look): void;
  onSettings?(next: Settings, prev: Settings): void;
  /** Title / Safe Mode left: the player is now playing. */
  onPlay?(): void;
  /** Safe Mode resolved: boot starts the renderer, input and loop it had held back. */
  onSafeModeResolved?(): void;
}

export interface ControllerOptions {
  world: WorldApi;
  worlds: WorldFactory;
  codes: SaveCodes;
  settings: Settings;
  look: Look;
  settingsStore: SettingsStore;
  styleTest: boolean;
  standalone: boolean;
  canInstall: boolean;
  /** The world came from a stored save (cold load: Play goes through the resume gate). */
  coldLoad: boolean;
  /** Effective quality for a settings value (applies the URL override and device default). */
  resolveQuality(setting: Settings['quality']): QualityTier;
  /** Monotonic ms (performance.now()). */
  now(): number;
  randomSeed(): number;
  /** Yield between dry-run slices so "Checking save…" can paint. */
  yieldSlice?(): Promise<void>;
  safeMode?: SafeModeHooks | null;
  hooks?: AppHooks;
}

/** A toast raised while the toast layer was covered; `world` set = about that world (dropped if it is replaced). */
interface HeldToast {
  text: string;
  tone: Toast['tone'];
  world: WorldApi | null;
}

export class GameApp implements AppController {
  readonly state: AppState;
  readonly time: TimeController;
  private worldRef: WorldApi;
  private renderer: Renderer | null = null;
  private input: InputController | null = null;
  private audio: AudioPort | null = null;
  private saves: SavePort | null = null;
  private toastId = 0;
  private lastHudAt = Number.NEGATIVE_INFINITY;
  private deathLeftMs = 0;
  private coldLoad: boolean;
  private countdownShown = -1;
  private safeModeActive: boolean;
  private prevSheet: SheetId = null;
  private updateApply: (() => Promise<void>) | null = null;
  private perfReporter: (() => Promise<string>) | null = null;
  private held: HeldToast[] = [];
  private readonly disposeSheetEffect: () => void;
  private readonly storyFeed: StoryFeed;

  constructor(private readonly opts: ControllerOptions) {
    this.worldRef = opts.world;
    this.coldLoad = opts.coldLoad;
    this.safeModeActive = !!opts.safeMode;
    this.state = {
      overlay: signal<Overlay>(null),
      countdownMs: signal(0),
      sheet: signal<SheetId>(null),
      look: signal<Look>(opts.look),
      hudTick: signal(0),
      toasts: signal<Toast[]>([]),
      death: signal<DeathInfo | null>(null),
      settings: signal<Settings>({ ...opts.settings }),
      arming: signal<{ slot: number; progress: number } | null>(null),
      canInstall: signal(opts.canInstall),
      standalone: signal(opts.standalone),
      styleTest: signal(opts.styleTest),
      perf: signal<{ fps: number; frameMs: number; drawCalls: number; tris: number } | null>(null),
      mode: signal<Mode>('play'),
      radio: signal<RadioMessage[]>([]),
      goal: signal<GoalChip | null>(null),
      tripSummary: signal<TripSummary | null>(null),
      updateReady: signal(false),
    };
    this.storyFeed = new StoryFeed({ state: this.state, world: () => this.worldRef, toast: (text, tone) => this.toast(text, tone) });
    this.time = new TimeController(() => this.syncOverlay());
    this.time.raise('title');
    if (this.safeModeActive) this.time.raise('safemode');
    // Sheets may be opened by the UI directly (menu → settings): the pause reason follows the signal.
    this.disposeSheetEffect = effect(() => this.onSheetChanged(this.state.sheet.value));
  }

  get world(): WorldApi {
    return this.worldRef;
  }

  // ---------------------------------------------------------------- wiring (boot)

  attachRenderer(r: Renderer): void {
    this.renderer = r;
  }
  attachInput(i: InputController): void {
    this.input = i;
  }
  attachAudio(a: AudioPort): void {
    this.audio = a;
    const s = this.state.settings.peek();
    a.setEnabled(s.sound);
    a.setRespectSilent(s.respectSilent);
  }
  attachSaves(s: SavePort): void {
    this.saves = s;
    s.setEnabled(!this.safeModeActive);
  }

  /** The pod may run this step (no pause reason, no countdown, no externally forced overlay). */
  podRunning(): boolean {
    return this.time.podRunning && this.state.overlay.peek() === null;
  }

  // ---------------------------------------------------------------- AppController

  openSheet(id: SheetId): void {
    if (id === null) this.closeSheet();
    else this.state.sheet.value = id;
  }

  closeSheet(): void {
    const id = this.state.sheet.peek();
    if (id === null) return;
    // Disarm the pad until the pod leaves it, so the sheet never re-opens by itself (canon §2.4).
    if (isRimBuilding(id)) this.worldRef.sheetClosed(id);
    this.state.sheet.value = null;
  }

  resume(): void {
    this.time.resume(this.motion());
    this.syncOverlay();
    this.audio?.unlock();
  }

  start(): void {
    if (this.safeModeActive) {
      void this.loadPreviousCopy();
      return;
    }
    this.time.leaveTitle(this.motion(), this.coldLoad);
    this.coldLoad = false;
    this.syncOverlay();
    this.opts.hooks?.onPlay?.();
  }

  newGame(): void {
    const wasSafe = this.safeModeActive;
    this.setWorld(this.opts.worlds.create(this.opts.randomSeed()), false);
    this.leaveSafeMode();
    this.state.death.value = null;
    this.deathLeftMs = 0;
    for (const r of ['title', 'death', 'interrupt'] as const) this.time.clear(r);
    this.saves?.critical(this.opts.now());
    this.toast('New claim staked', 'good');
    if (wasSafe) this.opts.hooks?.onSafeModeResolved?.();
    this.opts.hooks?.onPlay?.();
  }

  setLook(look: Look): void {
    if (look === this.state.look.peek()) return;
    this.renderer?.setLook(look);
    this.state.look.value = look;
    this.opts.settingsStore.saveLook(look);
    this.opts.hooks?.onLook?.(look);
  }

  updateSettings(patch: Partial<Settings>): void {
    const prev = this.state.settings.peek();
    const next: Settings = { ...prev, ...patch };
    this.state.settings.value = next;
    this.opts.settingsStore.saveSettings(next);
    if (next.quality !== prev.quality) this.renderer?.setQuality(this.opts.resolveQuality(next.quality));
    if (next.sound !== prev.sound) this.audio?.setEnabled(next.sound);
    if (next.respectSilent !== prev.respectSilent) this.audio?.setRespectSilent(next.respectSilent);
    if (!next.showPerf) this.state.perf.value = null;
    this.opts.hooks?.onSettings?.(next, prev);
  }

  toast(text: string, tone: Toast['tone'] = 'info'): void {
    this.show({ text, tone, world: null });
  }

  /**
   * A notice about the live world (which copy loaded, and why): a toast, but one that is dropped if this world
   * is replaced (New game, import) while it still waits behind the title or Safe Mode.
   */
  worldNotice(text: string, tone: Toast['tone'] = 'info'): void {
    this.show({ text, tone, world: this.worldRef });
  }

  async exportSave(): Promise<string> {
    if (this.safeModeActive && this.opts.safeMode) {
      const code = await this.opts.safeMode.exportCode();
      if (code) return code;
    }
    return this.opts.codes.encode(this.worldRef.serialize());
  }

  async importSave(code: string): Promise<Result> {
    const decoded = this.opts.codes.decode(code);
    if (!decoded.ok) return { ok: false, reason: decoded.reason };
    const check = await this.dryRun(decoded.bytes);
    if (!check.ok) return check;
    let live: WorldApi;
    try {
      live = this.opts.worlds.deserialize(decoded.bytes);
    } catch {
      return { ok: false, reason: 'That save could not be loaded' };
    }
    this.setWorld(live, true);
    this.leaveSafeMode();
    this.saves?.critical(this.opts.now());
    // A cold-loaded world always asks for the resume tap (canon §4.5), even under the closing sheet.
    this.time.interrupt(true);
    return { ok: true, message: 'Save imported' };
  }

  afterAction(r: Result): void {
    if (!r.ok) {
      this.toast(r.reason, 'warn');
      this.audio?.play('error');
      return;
    }
    if (r.message) this.toast(r.message, 'good');
    this.saves?.requestSoon(this.opts.now());
  }

  unlockAudio(): void {
    this.audio?.unlock();
  }

  // ---------------------------------------------------------------- loop-facing

  /** Per frame, wall-clock driven: countdown, death card, ≤ 10 Hz HUD tick, toast expiry. */
  tick(dtMs: number, now: number): void {
    this.time.tick(dtMs);
    this.publishCountdown();
    if (this.deathLeftMs > 0) {
      this.deathLeftMs -= dtMs;
      if (this.deathLeftMs <= 0) this.finishDeath();
    }
    if (now - this.lastHudAt >= HUD_TICK_MS) {
      this.lastHudAt = now;
      this.state.hudTick.value++;
      const toasts = this.state.toasts.peek();
      const live = pruneToasts(toasts, now);
      if (live !== toasts) this.state.toasts.value = live;
    }
    this.storyFeed.tick(now);
  }

  /** Sim events drained this frame → toasts, death, pad sheets, save triggers. */
  handleEvents(events: readonly GameEvent[]): void {
    if (events.length === 0) return;
    const now = this.opts.now();
    this.saves?.markDirty();
    this.storyFeed.onEvents(events, now);
    for (const e of events) {
      switch (e.t) {
        case 'destroyed':
          this.beginDeath(e.cause);
          break;
        case 'pad-arrive':
          if (this.state.sheet.peek() === null && this.state.overlay.peek() === null) this.openSheet(e.id);
          this.saves?.requestSoon(now);
          break;
        case 'trip-end':
        case 'damage':
        case 'sale':
        case 'purchase':
          this.saves?.requestSoon(now);
          break;
        case 'toast':
          this.toast(e.text, e.tone ?? 'info');
          break;
        case 'incentive':
          this.toast(`${e.ft.toLocaleString('en-US')} ft bonus: +$${e.cash.toLocaleString('en-US')}`, 'good');
          break;
        case 'coop-credit':
          this.toast(`Co-op Credit: ${e.liters} L on the house`, 'good');
          break;
        default:
          break;
      }
    }
  }

  /** `interrupt` from an outside source (blur, visibility, audio, orientation, pointercancel). */
  interrupt(): void {
    if (this.time.interrupt()) this.input?.releaseAll();
  }

  /** Landscape phone (canon §3.12): upright card; back in portrait → "Tap to resume". */
  setUpright(landscape: boolean): void {
    if (landscape) {
      if (this.time.raise('upright')) this.input?.releaseAll();
    } else if (this.time.clear('upright')) {
      this.interrupt();
    }
  }

  /** WebGL context state, polled per frame: lost pauses the pod; restored asks for the resume tap. */
  setContextLost(lost: boolean): void {
    if (lost) this.time.raise('ctxlost');
    else if (this.time.clear('ctxlost')) this.interrupt();
  }

  /**
   * A new service worker is waiting (04 §9.2). It is never applied by itself (a reload under the player's thumb):
   * the "Update ready" chip calls applyUpdate(), and otherwise it installs at the next launch.
   */
  notifyUpdateReady(apply: () => Promise<void>): void {
    this.updateApply = apply;
    this.state.updateReady.value = true;
    this.toast(NOTICE.updateReady, 'info');
  }

  /** The chip's tap (04 §9.2): critical save, then skipWaiting and reload. */
  async applyUpdate(): Promise<void> {
    const apply = this.updateApply;
    if (!apply) return;
    this.updateApply = null;
    this.state.updateReady.value = false;
    this.saves?.critical(this.opts.now());
    await apply();
  }

  /** Perf Report export code; boot wires the recorder via setPerfReporter(). */
  async perfReport(): Promise<string> {
    return this.perfReporter ? this.perfReporter() : '';
  }
  setPerfReporter(fn: () => Promise<string> | string): void {
    this.perfReporter = async () => fn();
  }

  /** Build mode (canon §4.11): the pod freezes while building; the factory keeps running. Filled in by the MVP build UX. */
  enterBuild(): void {
    if (this.state.mode.value === 'build') return;
    this.state.mode.value = 'build';
  }
  exitBuild(): void {
    if (this.state.mode.value === 'play') return;
    this.state.mode.value = 'play';
  }

  dismissRadio(id: number): void {
    const q = this.state.radio.value;
    if (q.some((m) => m.id === id)) this.state.radio.value = q.filter((m) => m.id !== id);
  }

  /** Replace the live world (new game, import, Safe Mode recovery). */
  setWorld(w: WorldApi, coldLoad: boolean): void {
    this.worldRef = w;
    this.coldLoad = coldLoad;
    this.input?.releaseAll();
    this.storyFeed.reset();
    this.state.hudTick.value++;
  }

  dispose(): void {
    this.disposeSheetEffect();
  }

  // ---------------------------------------------------------------- internals

  private motion(): PodMotion {
    const p = this.worldRef.pod;
    return { grounded: p.grounded, vx: p.vx, vy: p.vy };
  }

  private syncOverlay(): void {
    const o = this.time.overlay();
    if (this.state.overlay.peek() !== o) this.state.overlay.value = o;
    this.publishCountdown();
    if (this.held.length > 0 && !toastsCovered(o)) this.releaseHeld();
  }

  /** Title, upright card and Safe Mode cover the toast layer: hold the toast, and start its 2.5 s once it shows. */
  private show(t: HeldToast): void {
    if (toastsCovered(this.state.overlay.peek())) {
      this.held = holdToast(this.held, t);
      return;
    }
    this.state.toasts.value = pushToast(this.state.toasts.peek(), ++this.toastId, t.text, t.tone, this.opts.now());
  }

  private releaseHeld(): void {
    const held = this.held;
    this.held = [];
    for (const t of held) if (t.world === null || t.world === this.worldRef) this.show({ ...t, world: null });
  }

  /** countdownMs is UI-facing: publish in 100-ms steps, not every frame. */
  private publishCountdown(): void {
    const ms = this.time.countdownMs;
    const step = Math.ceil(ms / 100);
    if (step === this.countdownShown) return;
    this.countdownShown = step;
    this.state.countdownMs.value = step * 100;
  }

  private onSheetChanged(id: SheetId): void {
    const prev = this.prevSheet;
    this.prevSheet = id;
    this.time.setSheet(sheetReason(id), this.motion());
    if (prev === null && id !== null) {
      this.input?.releaseAll();
      this.audio?.play('sheetOpen');
    } else if (prev !== null && id === null) {
      this.audio?.play('sheetClose');
    }
  }

  private beginDeath(cause: DeathInfo['cause']): void {
    if (this.time.has('death')) return;
    const w = this.worldRef;
    const fee = salvageFee(w.pod.tiers);
    this.state.death.value = {
      cause,
      fee,
      debt: w.wallet.debt + Math.max(0, fee - w.wallet.cash),
      lostCount: w.pod.cargo.length,
      lostValue: w.cargoValue(),
    };
    if (this.state.sheet.peek() !== null) this.closeSheet();
    this.time.raise('death');
    this.input?.releaseAll();
    this.deathLeftMs = DEATH_CARD_MS;
    this.saves?.critical(this.opts.now());
  }

  private finishDeath(): void {
    this.deathLeftMs = 0;
    const r = this.worldRef.respawn();
    const prev = this.state.death.peek();
    this.state.death.value = {
      cause: prev?.cause ?? 'hull',
      fee: r.fee,
      debt: r.debt,
      lostCount: r.lost.length,
      lostValue: prev?.lostValue ?? 0,
    };
    this.time.clear('death');
    this.saves?.critical(this.opts.now());
  }

  private async dryRun(bytes: Uint8Array): Promise<Result> {
    let scratch: WorldApi;
    try {
      scratch = this.opts.worlds.deserialize(bytes);
    } catch {
      return { ok: false, reason: 'That code is not a valid save' };
    }
    try {
      for (let i = 1; i <= IMPORT_DRY_RUN_STEPS; i++) {
        scratch.step(NO_INTENT, true);
        if (i % DRY_RUN_SLICE === 0) {
          scratch.drainEvents();
          await this.opts.yieldSlice?.();
        }
      }
    } catch {
      return { ok: false, reason: 'That save failed its check' };
    }
    return worldLooksSane(scratch) ? { ok: true } : { ok: false, reason: 'That save failed its check' };
  }

  private async loadPreviousCopy(): Promise<void> {
    const hooks = this.opts.safeMode;
    if (!hooks) return;
    const r = await hooks.loadPrevious();
    if (!r.ok) {
      this.worldNotice(r.reason, 'warn');
      return;
    }
    this.setWorld(r.world, true);
    this.leaveSafeMode();
    this.worldNotice(r.message, 'good');
    this.opts.hooks?.onSafeModeResolved?.();
  }

  private leaveSafeMode(): void {
    if (!this.safeModeActive) return;
    this.safeModeActive = false;
    this.saves?.setEnabled(true);
    this.time.clear('safemode');
  }
}
