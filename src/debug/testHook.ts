// window.__hf — the e2e test API (04 §11.3), installed only with ?test=1 and loaded by dynamic import so it
// never ships in the main chunk's code path.
import type { GameApp } from '../app/controller';
import type { GameLoop } from '../app/loop';
import type { Overlay, SheetId } from '../app/types';
import type { PodIntent } from '../pod/types';
import type { BuildFrame, RenderInfo, Renderer } from '../render/api';
import type { Plane } from '../factory/api';
import type { BuildSession } from '../ui/build/session';
import type { Mode } from '../app/types';
import { crc32, deserialize, serialize } from '../save/codec';
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
  /** The renderer (build cameras, picking: setBuildCamera, screenToYardCell, cellToScreen, pickEntity). */
  readonly renderer: Renderer;
  contextLost(): boolean;
  perfReport(): Promise<string>;
  /** AudioContext state ('none' before the first unlock gesture). */
  audioState(): string;
  /** Critical save now; resolves true when the write committed. */
  saveNow(): Promise<boolean>;
  /**
   * CRC-32 of the world's save bytes with the clock-like fields neutralised (step counter, interpolation origin),
   * so it is equal across a save → reload, a context loss, or any stretch the pod is held (04 §11.3 "hash").
   */
  stateHash(): number;
  /** WEBGL_lose_context on the game canvas (04 §11.3 "lose context"); false when the extension is missing. */
  loseContext(): boolean;
  restoreContext(): boolean;
  /**
   * 04 §11.4 frozen time: stop the loop and draw the scene at animation time 0; frames(n) then advances n fixed
   * 60-Hz frames (sim step + draw), so the camera moves the same way every run. unfreeze() resumes the loop.
   */
  freeze(): void;
  frames(n: number): void;
  unfreeze(): void;
  // ---- build mode (MVP) ----
  /** The build-mode session (tool, pending ghost, camera), or null in M0 builds. */
  readonly build: BuildSession | null;
  mode(): Mode;
  buildFrame(): BuildFrame | null;
  /** CSS px of a plane cell's centre (the renderer's BuildRendererApi.cellToScreen). */
  cellToScreen(plane: Plane, x: number, y: number): { x: number; y: number };
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
  build?: BuildSession | null;
}

/**
 * Hash of the world state a save carries, independent of how many (held) steps ran since. The factory (FACT)
 * is left out: it keeps ticking while the pod is held (canon §4.5), and has its own stateHash. The CRC covers
 * the payload only: a CRC-32 over a file including its own CRC trailer is a constant (0x2144DF1C).
 */
export function worldStateHash(world: WorldApi): number {
  const s = deserialize(world.serialize());
  const pod = { ...s.pod, prevX: s.pod.x, prevY: s.pod.y };
  const bytes = serialize({ ...s, stepNo: 0, pod, factory: undefined });
  return crc32(bytes, 0, bytes.length - 4);
}

/** The canvas context's WEBGL_lose_context, kept once found (it is unavailable while the context is lost). */
function contextLoser(): () => WEBGL_lose_context | null {
  let ext: WEBGL_lose_context | null = null;
  return () => {
    if (!ext) {
      const canvas = document.getElementById('game') as HTMLCanvasElement | null;
      ext = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null;
    }
    return ext;
  };
}

export function installTestHook(d: TestHookDeps): HfTestApi {
  const { app, loop, renderer } = d;
  const loser = contextLoser();
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
    renderer,
    contextLost: () => renderer.contextLost,
    perfReport: d.perfReport,
    audioState: d.audioState,
    saveNow: d.saveNow,
    stateHash: () => worldStateHash(app.world),
    loseContext: () => {
      const ext = loser();
      ext?.loseContext();
      return ext !== null;
    },
    restoreContext: () => {
      const ext = loser();
      ext?.restoreContext();
      return ext !== null;
    },
    freeze: () => loop.freeze(),
    frames: (n) => loop.stepFrozen(n),
    unfreeze: () => loop.start(),
    build: d.build ?? null,
    mode: () => app.state.mode.peek(),
    buildFrame: () => app.state.buildFrame.peek(),
    cellToScreen: (plane, x, y) => renderer.cellToScreen(plane, x, y),
  };
  window.__hf = api;
  return api;
}
