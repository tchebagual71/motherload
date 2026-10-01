// App-layer contracts shared by ui/, input/ and app/ (not pure: may use signals and DOM types).
import type { Signal } from '@preact/signals';
import type { PodIntent } from '../pod/types';
import type { Look, RimBuildingId } from '../shared/types';
import type { Result, WorldApi } from '../world/api';
import type { QualityTier } from '../render/api';

export type Overlay = 'title' | 'interrupt' | 'countdown' | 'upright' | 'death' | 'safemode' | null;
export type SheetId = RimBuildingId | 'menu' | 'settings' | 'debug' | 'cargo' | 'saves' | null;

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'good';
  /** performance.now() when it expires. */
  until: number;
}

export interface Settings {
  controlSize: 'S' | 'M' | 'L';
  leftHanded: boolean;
  thrustButton: boolean;
  reducedMotion: boolean;
  brightMines: boolean;
  sound: boolean;
  /** Respect the iPhone silent switch (default true). */
  respectSilent: boolean;
  quality: QualityTier | 'auto';
  showPerf: boolean;
}

export interface DeathInfo {
  cause: 'hull' | 'fuel';
  fee: number;
  debt: number;
  lostCount: number;
  lostValue: number;
}

/** Reactive app state. HUD-facing numbers are refreshed ≤ 10 Hz via `hudTick`. */
export interface AppState {
  overlay: Signal<Overlay>;
  /** Remaining resume countdown in ms (overlay 'countdown'). */
  countdownMs: Signal<number>;
  sheet: Signal<SheetId>;
  look: Signal<Look>;
  /** Incremented ≤ 10 Hz; UI components read world state when it changes. */
  hudTick: Signal<number>;
  toasts: Signal<Toast[]>;
  death: Signal<DeathInfo | null>;
  settings: Signal<Settings>;
  /** Explosive arming in progress (for the slot UI). */
  arming: Signal<{ slot: number; progress: number } | null>;
  /** Install hint (non-standalone iOS/Android). */
  canInstall: Signal<boolean>;
  standalone: Signal<boolean>;
  /** M0 style-test chip visible. */
  styleTest: Signal<boolean>;
  perf: Signal<{ fps: number; frameMs: number; drawCalls: number; tris: number } | null>;
}

/** Everything the UI may do. Implemented by app/ (controller.ts). */
export interface AppController {
  readonly state: AppState;
  readonly world: WorldApi;
  openSheet(id: SheetId): void;
  closeSheet(): void;
  /** "Tap to resume" after an interrupt (runs the 1.5 s countdown if airborne/fast). */
  resume(): void;
  /** Title screen → play. */
  start(): void;
  newGame(): void;
  setLook(look: Look): void;
  updateSettings(patch: Partial<Settings>): void;
  toast(text: string, tone?: Toast['tone']): void;
  exportSave(): Promise<string>;
  importSave(code: string): Promise<Result>;
  /** Apply a world action result: toasts on failure, save soon on success. */
  afterAction(r: Result): void;
  /** Unlock audio on the first user gesture. */
  unlockAudio(): void;
}

/** Input → app. The input module owns pointer/keyboard handling and produces one intent per sim step. */
export interface InputController {
  /** Intent for the next sim step (fireSlot is edge-triggered and consumed by this call). */
  sampleIntent(): PodIntent;
  /** Any pointer currently down (camera freeze). */
  readonly touching: boolean;
  /** True if any pointer/key is currently driving the pod (for the pad neutral rule). */
  readonly active: boolean;
  /** Called by app when the pod must drop all held controls (pointercancel, interrupt). */
  releaseAll(): void;
  dispose(): void;
}
