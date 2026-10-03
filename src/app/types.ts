// App-layer contracts shared by ui/, input/ and app/ (not pure: may use signals and DOM types).
import type { Signal } from '@preact/signals';
import type { PodIntent } from '../pod/types';
import type { Look, RimBuildingId } from '../shared/types';
import type { Result, WorldApi } from '../world/api';
import type { QualityTier } from '../render/api';

export type Overlay = 'title' | 'interrupt' | 'countdown' | 'upright' | 'death' | 'safemode' | 'ctxlost' | null;
export type SheetId =
  | RimBuildingId
  | 'menu'
  | 'settings'
  | 'debug'
  | 'cargo'
  | 'saves'
  | 'map'
  | 'office'
  | 'styletest'
  | null;

/** Pod play vs build mode (03 §4; canon §4.11). */
export type Mode = 'play' | 'build';

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
  /** Text scale (canon §3.12: 100/115% MVP, 130% v1). */
  textScale: 1 | 1.15 | 1.3;
  /** One-handed pod controls (canon §3.12). */
  oneHanded: boolean;
  /** Thrust button hold vs toggle (03 §3.3). */
  thrustMode: 'hold' | 'toggle';
  /** Return Tick on the fuel bar (canon §4.4): Training = on until the first t3 Tank or 10 trips. */
  returnTick: 'training' | 'on' | 'off';
  /** Assist: auto-brake before hard landings (01 §6.4). */
  landingAssist: boolean;
  /** Assist: hold the dig direction steady (01 §6.4). */
  steadyDrill: boolean;
  /** Music ("Kettle On", 03 §11.2); SFX and ambience follow `sound` alone. */
  music: boolean;
}

/** One radio transmission card (canon §2.12 #5: ≤ 90 characters, ≤ 4 cards per beat). */
export interface RadioMessage {
  id: number;
  beat: string;
  sender: 'Dot' | 'Channel Zero' | 'Marlow' | 'the Surveyor' | 'Deepreach log';
  cards: string[];
  /** performance.now() when it was queued. */
  at: number;
}

/** Current goal chip (01 §2.3). */
export interface GoalChip {
  text: string;
  /** Optional progress text, e.g. "3/5". */
  progress?: string;
}

/** Shown on trip end (01 §3.10). */
export interface TripSummary {
  trip: number;
  deepestRow: number;
  collected: number;
  value: number;
  fuelUsed: number;
  hullLost: number;
  nextGoals: string[];
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
  /** Pod play vs build mode. */
  mode: Signal<Mode>;
  /** Queued radio transmissions (story/). The UI shows the head and removes it when done. */
  radio: Signal<RadioMessage[]>;
  goal: Signal<GoalChip | null>;
  tripSummary: Signal<TripSummary | null>;
  /** A new service worker is waiting (04 §9.2 "Update ready" chip). */
  updateReady: Signal<boolean>;
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
  /** Enter / leave build mode (pod paused while building; canon §4.11). */
  enterBuild(): void;
  exitBuild(): void;
  /** Apply a waiting service-worker update (critical save, then reload). */
  applyUpdate(): Promise<void>;
  /** Perf Report export code ('HFPR:…'). */
  perfReport(): Promise<string>;
  /** Remove the head radio message (the UI calls this when the player dismisses or it auto-advances). */
  dismissRadio(id: number): void;
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
