// Synthetic TerrainGrid fixtures and step drivers for the pod suites.
import { MINE_H, MINE_W, POD_H, SEAL_ROW } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import { Rng, STREAM } from '../../src/shared/rng';
import { T, type Lode, type TerrainCode } from '../../src/shared/types';
import { TerrainGrid } from '../../src/terrain/grid';
import { createPod, stepPod, type PodStepCtx } from '../../src/pod';
import { NO_INTENT, type PodIntent, type PodState } from '../../src/pod/types';

/** Row 0 turf, every other row dirt. */
export function solidGrid(seed = 1): TerrainGrid {
  const g = new TerrainGrid(seed);
  g.terrain.fill(T.DIRT);
  g.terrain.fill(T.TURF, 0, MINE_W);
  return g;
}

/** Set every cell of the inclusive rect to `code`. */
export function fill(g: TerrainGrid, x0: number, r0: number, x1: number, r1: number, code: TerrainCode): void {
  for (let r = r0; r <= r1; r++) for (let x = x0; x <= x1; x++) g.set(x, r, code);
}

export function carve(g: TerrainGrid, x0: number, r0: number, x1: number, r1: number): void {
  fill(g, x0, r0, x1, r1, T.AIR);
}

export function addLode(g: TerrainGrid, x0: number, top: number, scope: Lode['scope'] = 'mvp'): Lode {
  const lode: Lode = { id: g.lodes.length, metal: 'copper', purity: 'normal', x0, top, scripted: false, scope, discovered: false };
  g.lodes.push(lode);
  for (let r = top; r < top + 2; r++) {
    for (let x = x0; x < x0 + 3; x++) {
      g.set(x, r, T.LODE_ROCK);
      g.lodeIndex[r * MINE_W + x] = lode.id + 1;
    }
  }
  return lode;
}

export function makeCtx(over: Partial<PodStepCtx> = {}): PodStepCtx {
  return { floorRow: SEAL_ROW, deepHeat: false, rng: new Rng(1, STREAM.HOP_BEACON), stepNo: 0, scope: 'v1', ...over };
}

export const intent = (p: Partial<PodIntent> = {}): PodIntent => ({ ...NO_INTENT, ...p });
export const DOWN = intent({ sy: -1 });
export const LEFT = intent({ sx: -1 });
export const RIGHT = intent({ sx: 1 });
export const UP = intent({ sy: 1 });

/** A pod standing in cell (cx, r), i.e. resting on the top of row r + 1 (row −1 = on the Rim). */
export function podAt(cx: number, r: number, init?: (p: PodState) => void): PodState {
  const p = createPod();
  p.x = p.prevX = cx + 0.5;
  p.y = p.prevY = -(r + 1) + POD_H / 2;
  p.fuel = 1_000; // physics/dig tests should not run dry unless they mean to
  init?.(p);
  return p;
}

/** Step `n` times with a fixed or per-step intent; returns all events. */
export function run(
  pod: PodState,
  grid: TerrainGrid,
  n: number,
  input: PodIntent | ((i: number) => PodIntent) = NO_INTENT,
  ctx: PodStepCtx = makeCtx(),
): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    ctx.stepNo++;
    stepPod(pod, grid, typeof input === 'function' ? input(i) : input, ctx, out);
  }
  return out;
}

export const ofType = <K extends GameEvent['t']>(events: GameEvent[], t: K) =>
  events.filter((e): e is Extract<GameEvent, { t: K }> => e.t === t);

/** A grid that is open air from row 0 down to `bottom` in column x (a 1-wide shaft). */
export function shaftGrid(x: number, bottom: number): TerrainGrid {
  const g = solidGrid();
  carve(g, x, 0, x, bottom);
  return g;
}

export const MINE_BOTTOM = MINE_H - 1;
