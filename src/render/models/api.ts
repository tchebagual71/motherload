// Contract between render-core and the procedural models/FX (render/models, render/fx).
// Models build geometry with VERTEX COLOURS from the shared palette and tag every Mesh with
// `mesh.userData.mat` ∈ MatRole. render-core replaces materials per look via applyLookMaterials().
import type { Object3D, Vector3 } from 'three';
import type { GameEvent } from '../../shared/events';
import type { Line } from '../../shared/canon';

export type MatRole = 'solid' | 'metal' | 'glass' | 'emissive' | 'flame' | 'decal';

export interface PodVisualState {
  x: number;
  y: number;
  facing: 1 | -1;
  thrust: number; // 0..1
  digging: boolean;
  digDir: 'down' | 'left' | 'right' | null;
  grounded: boolean;
  vx: number;
  vy: number;
  tiers: Record<Line, number>;
  timeMs: number;
  /** Amber tint at |vy| > 5.88 (canon §3.6). */
  fastFall: boolean;
}
export interface PodModel {
  root: Object3D;
  update(s: PodVisualState): void;
}

export interface RimBuildingsModel {
  root: Object3D;
  /** World-space anchor above each building's sign (for DOM labels / tap targets). */
  signAnchors: Record<string, Vector3>;
  update(timeMs: number): void;
}

export interface YardPropsModel {
  root: Object3D;
  update(timeMs: number): void;
}

export interface FxSystem {
  root: Object3D;
  /** Feed sim events (dig debris, sparks, explosions, landing dust, damage). */
  handle(e: GameEvent, podX: number, podY: number): void;
  /** Continuous emitters (thrust exhaust, drill debris while digging). */
  update(dtMs: number, pod: PodVisualState): void;
  setBudget(maxParticles: number): void;
}
