// Ghost completion from the pod (02 §2.6; canon §4.8): a job completes when the pod, carrying its Kit, has stayed
// within 2 tiles (Chebyshev, any job cell) for 60 consecutive pod steps. Jobs complete oldest first; on any error
// nothing is consumed (the factory validates inside `completeGhost`). A refused job yields to the next oldest in
// reach, so one job that cannot complete never holds up the rest. With only refused jobs in reach the build ring
// HOLDS on the oldest (progress 0, `blocked` = its code) instead of looping through 60-step retries; refusals are
// re-checked without side effects (`canCompleteGhost`) when the structure changes, when the pod's cell changes and
// every GHOST_RECHECK_STEPS, and a job whose cause cleared (Pip stepped out of the footprint) resumes at once.
// PURE MODULE.
import { POD_H, POD_W } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import type { Err, ErrCode, FactoryApi, GhostView, KitSource, PodBox } from '../factory/api';
import type { PodState } from '../pod/types';
import { ghostRefusalText } from './factoryText';

/** 1.0 s at 60 Hz (02 §2.6). */
export const GHOST_HOLD_STEPS = 60;
/** Chebyshev reach from the pod's cell to any job cell (canon §4.8). */
export const GHOST_REACH = 2;
/** A held refusal is re-checked at least this often (0.5 s) even when nothing seems to change. */
export const GHOST_RECHECK_STEPS = 30;

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
  /** Job the pod is completing or holding on (0 = none) and the consecutive steps it has held. */
  id: number;
  steps: number;
  /** While every job in reach stands refused: the code of the one the ring holds on (job `id`), else null. */
  blocked: ErrCode | null = null;
  /** Ghost list cached per topologyVersion (factory.ghosts() allocates; this runs every pod step). */
  private list: readonly GhostView[] = [];
  private version = -1;
  /** Refused jobs (by `order`, unique per job) and their latest codes: skipped until a re-check passes. */
  private readonly refused: number[] = [];
  private readonly codes: ErrCode[] = [];
  /** `${order}:${code}` of refusals toasted while the pod stays in reach, so a held refusal toasts once. */
  private readonly toasted: string[] = [];
  private readonly box: PodBox = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  /** Re-check triggers: the pod's cell last step, steps since the last re-check, the structure changed. */
  private cellX = -1;
  private cellR = -1;
  private wait = 0;
  private stale = false;
  /** `pick` results (reused, no per-step allocation): the oldest job that may go, the oldest refused one. */
  private go: GhostView | null = null;
  private held: GhostView | null = null;

  constructor(saved?: GhostTimer) {
    this.id = saved?.id ?? 0;
    this.steps = saved?.steps ?? 0;
  }

  timer(): GhostTimer {
    return { id: this.id, steps: this.steps };
  }

  progress(): { id: number; progress: number; blocked: ErrCode | null } | null {
    return this.id > 0 ? { id: this.id, progress: Math.min(1, this.steps / GHOST_HOLD_STEPS), blocked: this.blocked } : null;
  }

  /** One live pod step. Completes the job after GHOST_HOLD_STEPS; a refusal toasts once and the ring holds. */
  step(f: FactoryApi, pod: Readonly<PodState>, cargo: KitSource, emit: (e: GameEvent) => void): GhostStepResult {
    if (this.version !== f.topologyVersion) {
      this.list = f.ghosts();
      this.version = f.topologyVersion;
      this.stale = true;
    }
    const x = Math.floor(pod.x);
    const r = Math.floor(-pod.y);
    const moved = x !== this.cellX || r !== this.cellR;
    this.cellX = x;
    this.cellR = r;
    this.podBox(pod);
    if (this.refused.length === 0) this.stale = false;
    else if (this.stale || moved || ++this.wait >= GHOST_RECHECK_STEPS) this.recheck(f, cargo, emit, x, r);
    this.pick(x, r, cargo);
    const g = this.go;
    if (!g) {
      if (this.held) this.hold(this.held);
      else this.reset();
      return NOT_DONE;
    }
    this.blocked = null;
    if (g.id !== this.id) {
      this.id = g.id;
      this.steps = 0;
    }
    if (++this.steps < GHOST_HOLD_STEPS) return NOT_DONE;
    const res = f.completeGhost(g.id, this.box, cargo);
    if (res.ok) {
      this.id = 0;
      this.steps = 0;
      return { done: true, id: res.id, job: g };
    }
    this.steps = 0;
    this.refused.push(g.order);
    this.codes.push(res.code);
    this.wait = 0;
    this.stale = false;
    this.toastOnce(g, res, emit);
    // Nothing else in reach may go: the ring holds now rather than restarting the count.
    this.pick(x, r, cargo);
    if (!this.go && this.held) this.hold(this.held);
    return { done: false, err: res };
  }

  /** Nothing in reach: the timer stops and refusals may toast again next time. */
  reset(): void {
    this.id = 0;
    this.steps = 0;
    this.blocked = null;
    this.toasted.length = 0;
  }

  /** In reach of the pod's cell (x, r) with its Kit aboard. */
  private reachable(g: GhostView, x: number, r: number, cargo: KitSource): boolean {
    return jobDistance(g, x, r) <= GHOST_REACH && cargo.count(g.kit) >= g.kitUnits;
  }

  /** `go`: the oldest reachable job not refused; `held`: the oldest reachable refused one. */
  private pick(x: number, r: number, cargo: KitSource): void {
    this.go = null;
    this.held = null;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!this.reachable(g, x, r, cargo)) continue;
      if (!this.refused.includes(g.order)) {
        this.go = g;
        return;
      }
      this.held ??= g;
    }
  }

  /** The ring holds on refused job `g`: no count, its code shown (the goal chip names the fix). */
  private hold(g: GhostView): void {
    this.id = g.id;
    this.steps = 0;
    this.blocked = this.codes[this.refused.indexOf(g.order)];
  }

  /**
   * Re-check the refused jobs in reach without side effects: a job whose cause cleared may go again (oldest
   * first, so it takes over from a newer job); one refused for a new reason toasts that reason once. Refusals of
   * jobs that are gone are dropped.
   */
  private recheck(f: FactoryApi, cargo: KitSource, emit: (e: GameEvent) => void, x: number, r: number): void {
    this.stale = false;
    this.wait = 0;
    const list = this.list;
    for (let k = this.refused.length - 1; k >= 0; k--) {
      const order = this.refused[k];
      let g: GhostView | null = null;
      for (let i = 0; i < list.length && !g; i++) if (list[i].order === order) g = list[i];
      if (g && !this.reachable(g, x, r, cargo)) continue;
      const err = g ? f.canCompleteGhost(g.id, this.box, cargo) : null;
      if (g && err) {
        this.codes[k] = err.code;
        this.toastOnce(g, err, emit);
        continue;
      }
      this.refused.splice(k, 1);
      this.codes.splice(k, 1);
    }
  }

  private toastOnce(g: GhostView, e: Err, emit: (e: GameEvent) => void): void {
    const key = `${g.order}:${e.code}`;
    if (this.toasted.includes(key)) return;
    this.toasted.push(key);
    emit({ t: 'toast', text: ghostRefusalText(g, e), tone: 'warn' });
  }

  /** The pod's collision box, as completeGhost checks it (E_POD). */
  private podBox(pod: Readonly<PodState>): void {
    const b = this.box;
    b.minX = pod.x - POD_W / 2;
    b.maxX = pod.x + POD_W / 2;
    b.minY = pod.y - POD_H / 2;
    b.maxY = pod.y + POD_H / 2;
  }
}
