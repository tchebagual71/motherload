// window.__hf — the e2e test API (04 §11.3), installed only with ?test=1 and loaded by dynamic import so it
// never ships in the main chunk's code path.
import type { GameApp } from '../app/controller';
import type { GameLoop } from '../app/loop';
import type { Overlay, SheetId } from '../app/types';
import type { PodIntent } from '../pod/types';
import type { RenderInfo, Renderer } from '../render/api';
import type { Look } from '../shared/types';
import type { WorldApi } from '../world/api';

export interface PodSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  fuel: number;
  hull: number;
  row: number;
  cargo: number;
  destroyed: boolean;
}

export interface HfTestApi {
  readonly ready: true;
  readonly app: GameApp;
  readonly world: WorldApi;
  overlay(): Overlay;
  sheet(): SheetId;
  look(): Look;
  pod(): PodSnapshot;
  cash(): number;
  stepNo(): number;
  /** Override player input (merged over a neutral intent); null returns control to touch/keyboard. */
  setIntent(intent: Partial<PodIntent> | null): void;
  /** Run sim steps synchronously (pause reasons still apply). */
  step(n: number): void;
  teleport(row: number): void;
  giveCash(amount: number): void;
  start(): void;
  setLook(look: Look): void;
  renderInfo(): RenderInfo;
  contextLost(): boolean;
  perfReport(): Promise<string>;
  /** AudioContext state ('none' before the first unlock gesture). */
  audioState(): string;
  /** Critical save now; resolves true when the write committed. */
  saveNow(): Promise<boolean>;
}

declare global {
  interface Window {
    __hf?: HfTestApi;
  }
}

export interface TestHookDeps {
  app: GameApp;
  loop: GameLoop;
  renderer: Renderer;
  perfReport(): Promise<string>;
  audioState(): string;
  saveNow(): Promise<boolean>;
}

export function installTestHook(d: TestHookDeps): HfTestApi {
  const { app, loop, renderer } = d;
  const api: HfTestApi = {
    ready: true,
    app,
    get world() {
      return app.world;
    },
    overlay: () => app.state.overlay.peek(),
    sheet: () => app.state.sheet.peek(),
    look: () => app.state.look.peek(),
    pod: () => {
      const p = app.world.pod;
      return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: p.grounded, fuel: p.fuel, hull: p.hull, row: p.row, cargo: p.cargo.length, destroyed: p.destroyed };
    },
    cash: () => app.world.wallet.cash,
    stepNo: () => app.world.stepNo,
    setIntent: (i) => {
      loop.intentOverride = i ? { sx: 0, sy: 0, thrust: false, fireSlot: -1, ...i } : null;
    },
    step: (n) => loop.stepNow(n),
    teleport: (row) => app.world.debugTeleport(row),
    giveCash: (amount) => app.world.debugGiveCash(amount),
    start: () => app.start(),
    setLook: (look) => app.setLook(look),
    renderInfo: () => ({ ...renderer.info }),
    contextLost: () => renderer.contextLost,
    perfReport: d.perfReport,
    audioState: d.audioState,
    saveNow: d.saveNow,
  };
  window.__hf = api;
  return api;
}
