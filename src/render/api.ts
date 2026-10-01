// Contract between app/ and render/. render/ is the only three.js importer (04 §2.2).
import type { GameEvent } from '../shared/events';
import type { Look } from '../shared/types';
import type { WorldApi } from '../world/api';

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
}

export interface RenderInfo {
  drawCalls: number;
  triangles: number;
  look: Look;
  quality: QualityTier;
  pixelScale: number;
}

export interface Renderer {
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
