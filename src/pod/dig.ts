// Digging (canon §3.6; 01 §3.4; 03 §3.2). PURE MODULE.
// Grounded; stick m′ ≥ 0.45 pushing into a drillable neighbour (down/left/right, never up) for 7 steps
// (chained digs skip the wait); the cell clears at 37.5% and the pod slides into it over the dig.
import { DIG_CLEAR_FRAC, DIG_ENGAGE_STEPS, DIG_STICK_MIN, FUEL_DIG_K, MINE_H, MINE_W, STEP } from '../shared/canon';
import type { DigRefusal, GameEvent } from '../shared/events';
import { F, T, type Scope } from '../shared/types';
import type { TerrainGrid } from '../terrain/grid';
import { isLodeVisible } from '../terrain/scope';
import { HALF_H, HALF_W, SIDE_REACH, isSupported } from './collision';
import { breakThrough, isDrillableCode } from './hazards';
import { digDirOf } from './sector';
import { drillStepsOf, engineOf } from './stats';
import type { DigDir, DigState, PodIntent, PodState } from './types';
import { burnFuel } from './vitals';

/** What pushing into a cell does: drill it, nothing (open air: the pod moves), blocked silently, or a refusal. */
export type DigTarget = 'drill' | 'open' | 'blocked' | DigRefusal;

/** Classify cell (x, r) as a dig target (01 §3.4 table). `floor` is the forced scope floor row (collision.forcedFloorRow). */
export function classifyDigTarget(grid: TerrainGrid, x: number, r: number, floor: number, scope: Scope): DigTarget {
  if (r < 0) return x < 0 || x >= MINE_W ? 'blocked' : 'open';
  if (x < 0 || x >= MINE_W || r >= MINE_H) return 'heartstone';
  if (r >= floor) return 'floor';
  const i = r * MINE_W + x;
  if (grid.occupant[i] !== 0) return 'blocked';
  const code = grid.terrain[i];
  switch (code) {
    case T.AIR:
      return 'open';
    case T.HARDROCK:
      return 'hardrock';
    case T.LODE_ROCK: {
      const lode = grid.lodeAt(x, r);
      return lode && !isLodeVisible(lode, scope) ? 'seam' : 'lode';
    }
    case T.PAVED:
      return 'paved';
    case T.SEAL:
      return 'seal';
  }
  if (!isDrillableCode(code)) return 'heartstone';
  return (grid.flags[i] & F.ANCHORED) !== 0 ? 'anchored' : 'drill';
}

function resetEngage(pod: PodState): void {
  pod.engageSteps = 0;
  pod.engageDir = null;
}

/** Row of the pod centre (may be −1 on the Rim surface). */
export const centreRow = (pod: Readonly<PodState>): number => Math.floor(-pod.y);

/**
 * Engage counter for the current push; starts a dig when it reaches DIG_ENGAGE_STEPS, or emits a
 * refusal once per push. Returns true when the grounded pod pushes Down over open air, so physics
 * can ease it into the hole (column snap, 03 §3.2).
 */
export function updateDigEngage(
  pod: PodState,
  grid: TerrainGrid,
  intent: PodIntent,
  floor: number,
  scope: Scope,
  out: GameEvent[],
): boolean {
  const dir = pod.grounded ? digDirOf(pod.sector) : null;
  if (!dir || intent.sx * intent.sx + intent.sy * intent.sy < DIG_STICK_MIN * DIG_STICK_MIN) {
    resetEngage(pod);
    return false;
  }
  let tx: number;
  let tr: number;
  if (dir === 'down') {
    tx = Math.floor(pod.x);
    tr = centreRow(pod) + 1;
  } else {
    tx = Math.floor(pod.x) + (dir === 'right' ? 1 : -1);
    tr = centreRow(pod);
    const gap = dir === 'right' ? tx - (pod.x + HALF_W) : pod.x - HALF_W - (tx + 1);
    if (gap > SIDE_REACH) {
      resetEngage(pod); // not at the wall yet: the stick just drives
      return false;
    }
  }
  const target = classifyDigTarget(grid, tx, tr, floor, scope);
  if (target === 'open' || target === 'blocked') {
    resetEngage(pod);
    return target === 'open' && dir === 'down';
  }
  if (pod.engageDir !== dir) {
    pod.engageDir = dir;
    pod.engageSteps = 0;
  }
  if (pod.engageSteps <= DIG_ENGAGE_STEPS) pod.engageSteps++; // saturates one past the gate
  if (pod.engageSteps < DIG_ENGAGE_STEPS) return false;
  if (target === 'drill') startDig(pod, grid, tx, tr, dir, out);
  else if (pod.engageSteps === DIG_ENGAGE_STEPS) out.push({ t: 'dig-refused', x: tx, r: tr, reason: target });
  return false;
}

function startDig(pod: PodState, grid: TerrainGrid, x: number, r: number, dir: DigDir, out: GameEvent[]): void {
  const dig: DigState = { x, r, dir, progress: 0, total: drillStepsOf(pod.tiers.drill), cleared: false, fromX: pod.x, fromY: pod.y };
  pod.dig = dig;
  pod.vx = 0;
  pod.vy = 0;
  pod.engageSteps = 0;
  if (dir !== 'down') pod.facing = dir === 'right' ? 1 : -1;
  out.push({ t: 'dig-start', x, r, code: grid.get(x, r) });
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Advance the current dig one step: dig-rate burn, break-through at 37.5%, and the slide into the
 * cell. A down-dig first eases the pod onto the column centre (≤ 0.5 tile), then drops after the
 * break-through; side digs move only after it, so the pod never overlaps uncleared rock.
 */
export function advanceDig(pod: PodState, grid: TerrainGrid, floor: number, heat: number, out: GameEvent[]): void {
  const d = pod.dig;
  if (!d) return;
  d.progress++;
  pod.digging = true;
  pod.grounded = true;
  pod.airSteps = 0;
  burnFuel(pod, FUEL_DIG_K * engineOf(pod.tiers.engine).hp * STEP * heat);

  const f = d.progress / d.total;
  if (!d.cleared && f >= DIG_CLEAR_FRAC) {
    breakThrough(pod, grid, d.x, d.r, floor, out);
    d.cleared = true;
  }
  const tx = d.x + 0.5;
  const ty = -(d.r + 1) + HALF_H; // resting on the cell's floor
  if (!d.cleared) {
    if (d.dir === 'down') pod.x = d.fromX + (tx - d.fromX) * clamp01(f / DIG_CLEAR_FRAC);
  } else {
    const s = smooth(clamp01((f - DIG_CLEAR_FRAC) / (1 - DIG_CLEAR_FRAC)));
    const x0 = d.dir === 'down' ? tx : d.fromX;
    pod.x = x0 + (tx - x0) * s;
    pod.y = d.fromY + (ty - d.fromY) * s;
  }
  if (d.progress >= d.total) finishDig(pod, grid, d, tx, ty, floor);
}

function finishDig(pod: PodState, grid: TerrainGrid, d: DigState, tx: number, ty: number, floor: number): void {
  pod.x = tx;
  pod.y = ty;
  pod.dig = null;
  pod.grounded = isSupported(pod, grid, floor, false);
  // Chained digs skip the engage wait: holding the same push digs the next cell on the next step.
  pod.engageDir = d.dir;
  pod.engageSteps = DIG_ENGAGE_STEPS - 1;
}

/** Abort a dig (explosion, teleport); the pod resumes normal physics where it is. */
export function cancelDig(pod: PodState): void {
  pod.dig = null;
  resetEngage(pod);
}
