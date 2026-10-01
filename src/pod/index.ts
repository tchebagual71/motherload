// Pod module public API. Implementation: pod agent. PURE MODULE.
import type { GameEvent } from '../shared/events';
import type { Rng } from '../shared/rng';
import type { TerrainGrid } from '../terrain/grid';
import type { PodStats } from '../world/api';
import type { PodIntent, PodState } from './types';

export interface PodStepCtx {
  /** Rows ≥ this are treated as an undiggable, impassable scope floor (M0 r128 / MVP r320 overlay; 584 = Seal in v1). */
  floorRow: number;
  /** Deep Heat A/B flag (canon §4.4), off by default. */
  deepHeat: boolean;
  /** RNG stream for Hop Beacon targets. */
  rng: Rng;
  stepNo: number;
}

export function createPod(): PodState {
  throw new Error('createPod: not implemented');
}
export function podStats(_pod: Readonly<PodState>): PodStats {
  throw new Error('podStats: not implemented');
}
/** Advance the pod one 60 Hz step. Mutates pod and grid (digging, explosions); pushes events to `out`. */
export function stepPod(_pod: PodState, _grid: TerrainGrid, _intent: PodIntent, _ctx: PodStepCtx, _out: GameEvent[]): void {
  throw new Error('stepPod: not implemented');
}
