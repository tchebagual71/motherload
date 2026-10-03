// Contract between app/ and render/. render/ is the only three.js importer (04 §2.2).
import type { GameEvent } from '../shared/events';
import type { Look } from '../shared/types';
import type { WorldApi } from '../world/api';
import type { BuildingKind, Cell, Dir, Plane } from '../factory/api';

export type QualityTier = 'low' | 'mid' | 'high';
export type CameraMode = 'play' | 'build';

/** Screen-space layout the camera must respect (all in CSS px). */
export interface ViewportLayout {
  width: number;
  height: number;
  dpr: number;
  /** Top safe-area inset + HUD row height: the clear rect starts here (canon §3.12). */
  clearTop: number;
  /** Height of the translucent control zone at the bottom (incl. bottom inset). */
  controlZone: number;
}

export interface RenderFrame {
  /** Read-only use. Never call mutating methods from render/. */
  world: WorldApi;
  /** Interpolation factor between the previous and current sim step, [0, 1). */
  alpha: number;
  /** Monotonic ms (performance.now()) for animation. */
  timeMs: number;
  mode: CameraMode;
  /** Events drained this frame (for FX: dust, sparks, explosions, landing puffs). */
  events: readonly GameEvent[];
  layout: ViewportLayout;
  /** A touch is down: freeze camera re-framing until it ends (canon §3.4). */
  touching: boolean;
  /** Explosive arming preview: footprint radius in tiles around the pod (0 = none) and ring progress 0..1. */
  arming: { radius: number; progress: number } | null;
  /** Accessibility: raise the underground ambient floor to 0.35 (canon §3.12). */
  brightMines: boolean;
  /** Accessibility: no camera shake, gentler animation. */
  reducedMotion: boolean;
  /** Build-mode overlay state (cursor, ghost preview, bulldoze, selection); null in play mode. */
  build?: BuildFrame | null;
  /**
   * The pod may run (no pause reason, canon §4.5). False: a held pod keeps its thrust/dig state for the save,
   * but its exhaust, drill FX and thruster lamp stop. Omitted = running.
   */
  podRunning?: boolean;
  /** Battery mode (04 §5.8): half the particles, no idle animation. */
  battery?: boolean;
  /** Dynamic resolution (04 §5.8): production Toon render DPR, clamped to the tier's floor and cap. */
  renderDpr?: number;
}

export interface RenderInfo {
  drawCalls: number;
  triangles: number;
  look: Look;
  quality: QualityTier;
  pixelScale: number;
  /** DPR the scene renders at (Toon: tier cap or the dynamic-resolution value; Pixel Lab: the device DPR). */
  renderDpr?: number;
}

export interface Renderer extends BuildRendererApi {
  render(frame: RenderFrame): void;
  resize(layout: ViewportLayout): void;
  /** Switch look. M0 builds keep both pipelines compiled so this costs ≤ 1 frame (canon §5.1). */
  setLook(look: Look): void;
  setQuality(q: QualityTier): void;
  /** Project a world point (world units) to CSS px, e.g. to anchor DOM bubbles. */
  worldToScreen(x: number, y: number, z?: number): { x: number; y: number };
  /** Inverse pick on the mine slab plane (z = 0): returns the cell under a CSS px point, or null. */
  screenToCell(px: number, py: number): { x: number; r: number } | null;
  /** Rim building under a CSS px point (for sign taps). */
  screenToRimBuilding(px: number, py: number): string | null;
  readonly info: RenderInfo;
  /** True while the WebGL context is lost. */
  readonly contextLost: boolean;
  dispose(): void;
}

export interface RendererOptions {
  look: Look;
  quality: QualityTier;
  /** Compile both looks up front (M0 style test). */
  precompileBoth: boolean;
  /** M0-only perspective A/B flag (canon §3.4). */
  perspective?: boolean;
}

export type CreateRenderer = (canvas: HTMLCanvasElement, layout: ViewportLayout, opts: RendererOptions) => Renderer;

/** What build mode wants drawn this frame (03 §4; written by the build UX, read by render). */
export interface BuildFrame {
  plane: Plane;
  /** Cell under the lifted placement point (44 pt above the finger), or null. */
  cursor: Cell | null;
  /** Ghost preview of the armed tool at the cursor, tinted by `valid` (red when invalid). Belts: the painted path. */
  preview: {
    kind: BuildingKind;
    mk: number;
    x: number;
    y: number;
    w: number;
    h: number;
    dir: Dir;
    valid: boolean;
    path?: readonly Cell[];
  } | null;
  /** Bulldoze tool armed: highlight what a tap would remove. */
  bulldoze: boolean;
  /** Selected entity id (inspect), or null. */
  selectedId: number | null;
}

/** Build camera (canon §3.4: surface build 45° + n·90° / 55°; underground build 8° / 12°). */
export interface BuildCamera {
  plane: Plane;
  /** View centre in plane cell units (Yard: x, Yard row; mine: x, row). */
  cx: number;
  cy: number;
  /** Points per world unit (Yard ≥ 39, ≥ 44 with a 1×1 tool; mine ≥ 47). */
  ppu: number;
  /** Yard yaw snap index (0..3 → 45° + n·90°); ignored underground. */
  yaw: 0 | 1 | 2 | 3;
}

/** Build-mode picking and camera control, implemented by the renderer (MVP build wave). */
export interface BuildRendererApi {
  /** Enter/update the build camera; null returns to the play camera. */
  setBuildCamera(cam: BuildCamera | null): void;
  /** Yard cell under a CSS px point (ray vs the y = 0 plateau plane), or null outside the Yard. */
  screenToYardCell(px: number, py: number): Cell | null;
  /** Mine cell under a CSS px point (ray vs the slab front plane), or null. */
  screenToMineCell(px: number, py: number): Cell | null;
  /** CSS px position of a plane cell's centre (loupe, ghost labels, status bubbles). */
  cellToScreen(plane: Plane, x: number, y: number): { x: number; y: number };
  /** Factory entity id under a CSS px point, or null. */
  pickEntity(px: number, py: number): number | null;
}
