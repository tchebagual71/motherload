// Ghost completion from the pod (02 §2.6; canon §4.8): a job completes when the pod, carrying its Kit, has stayed
// within 2 tiles (Chebyshev, any job cell) for 60 consecutive pod steps. Jobs complete oldest first; on any error
// nothing is consumed and the timer restarts (the factory validates inside `completeGhost`). A refused job yields
// to the next oldest in reach until the structure changes, so one job that cannot complete never holds up the
// rest; with nothing else in reach it is retried. PURE MODULE.
import { POD_H, POD_W } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import type { Err, FactoryApi, GhostView, KitSource, PodBox } from '../factory/api';
import type { PodState } from '../pod/types';
import { ghostRefusalText } from './factoryText';

/** 1.0 s at 60 Hz (02 §2.6). */
export const GHOST_HOLD_STEPS = 60;
/** Chebyshev reach from the pod's cell to any job cell (canon §4.8). */
export const GHOST_REACH = 2;

/** The saved part of the timer (04 §4.9 PODS "ghost timer"). */
export interface GhostTimer {
  id: number;
  steps: number;
}

/** Chebyshev distance from cell (x, r) to a job's footprint (0 inside it). */
export function jobDistance(g: Pick<GhostView, 'x' | 'y' | 'w' | 'h'>, x: number, r: number): number {
  const dx = Math.max(0, g.x - x, x - (g.x + g.w - 1));
  const dr = Math.max(0, g.y - r, r - (g.y + g.h - 1));
  return dx > dr ? dx : dr;
}

export type GhostStepResult = { done: true; id: number; job: GhostView } | { done: false; err: Err | null };

const NOT_DONE: GhostStepResult = { done: false, err: null };

export class GhostBuilder {
  /** Job the pod is completing (0 = none) and the consecutive steps it has held. */
  id: number;
  steps: number;
  /** Ghost list cached per topologyVersion (factory.ghosts() allocates; this runs every pod step). */
  private list: readonly GhostView[] = [];
  private version = -1;
  /** Jobs (by `order`, unique per job) refused since the structure last changed: tried after the others. */
  private readonly refused: number[] = [];
  /** `${order}:${code}` of refusals toasted while the pod stays in reach, so a held refusal toasts once. */
  private readonly toasted: string[] = [];
  private readonly box: PodBox = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  constructor(saved?: GhostTimer) {
    this.id = saved?.id ?? 0;
    this.steps = saved?.steps ?? 0;
  }

  timer(): GhostTimer {
    return { id: this.id, steps: this.steps };
  }

  progress(): { id: number; progress: number } | null {
    return this.id > 0 ? { id: this.id, progress: Math.min(1, this.steps / GHOST_HOLD_STEPS) } : null;
  }

  /**
   * Oldest job within reach of the pod's cell whose Kit the bay holds, skipping jobs refused since the structure
   * last changed; when every job in reach has been refused, they are all tried again (oldest first). Null if none.
   */
  candidate(f: FactoryApi, pod: Readonly<PodState>, cargo: KitSource): GhostView | null {
    if (this.version !== f.topologyVersion) {
      this.list = f.ghosts();
      this.version = f.topologyVersion;
      this.refused.length = 0;
    }
    const list = this.list;
    if (list.length === 0) return null;
    const x = Math.floor(pod.x);
    const r = Math.floor(-pod.y);
    let first: GhostView | null = null;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (jobDistance(g, x, r) > GHOST_REACH || cargo.count(g.kit) < g.kitUnits) continue;
      if (!this.refused.includes(g.order)) return g;
      first ??= g;
    }
    if (first) this.refused.length = 0; // every job in reach was refused: start the round again
    return first;
  }

  /** One live pod step. Completes the job after GHOST_HOLD_STEPS; refusals restart the timer and toast once. */
  step(f: FactoryApi, pod: Readonly<PodState>, cargo: KitSource, emit: (e: GameEvent) => void): GhostStepResult {
    const g = this.candidate(f, pod, cargo);
    if (!g) {
      this.reset();
      return NOT_DONE;
    }
    if (g.id !== this.id) {
      this.id = g.id;
      this.steps = 0;
    }
    if (++this.steps < GHOST_HOLD_STEPS) return NOT_DONE;
    const b = this.box;
    b.minX = pod.x - POD_W / 2;
    b.maxX = pod.x + POD_W / 2;
    b.minY = pod.y - POD_H / 2;
    b.maxY = pod.y + POD_H / 2;
    const r = f.completeGhost(g.id, b, cargo);
    if (r.ok) {
      this.id = 0;
      this.steps = 0;
      return { done: true, id: r.id, job: g };
    }
    this.steps = 0;
    this.refused.push(g.order);
    const key = `${g.order}:${r.code}`;
    if (!this.toasted.includes(key)) {
      this.toasted.push(key);
      emit({ t: 'toast', text: ghostRefusalText(g, r), tone: 'warn' });
    }
    return { done: false, err: r };
  }

  /** Nothing in reach: the timer stops and refusals may toast again next time. */
  reset(): void {
    this.id = 0;
    this.steps = 0;
    this.toasted.length = 0;
  }
}
