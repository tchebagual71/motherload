// Pod module public API (canon §2.6, §2.7, §3.3, §3.6, §3.7, §4.2; 01 §3). PURE MODULE.
// Units: tiles and seconds; one call of stepPod = one fixed 1/60 s step.
import { CONSUMABLES, DEFAULT_QUICK_SLOTS, LINES, MINE_H, SEAL_ROW, START_FUEL, START_HULL, START_X } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import type { Rng } from '../shared/rng';
import type { ConsumableId, Line, Scope } from '../shared/types';
import type { TerrainGrid } from '../terrain/grid';
import { HALF_H, forcedFloorRow } from './collision';
import { fireQuickSlot } from './consumables';
import { advanceDig, updateDigEngage } from './dig';
import { magmaHit } from './hazards';
import { physicsStep } from './physics';
import { nextSector } from './sector';
import { discoverLodes, updateVisibility } from './sense';
import { deepHeatFactor } from './stats';
import type { PodIntent, PodState } from './types';
import { checkVitals } from './vitals';

export { podStats, cargoMass, cargoSlotsUsed, itemMass, itemSlots, kitSpec, bayHasRoom, isTooHeavy, climbSpeed, returnTickLiters, deepHeatFactor, landingDamage, thrustAccel } from './stats';
export { classifyDigTarget, type DigTarget } from './dig';
export { nextSector, digDirOf } from './sector';
export { revealAround } from './sense';
export { thrustInput, skyFade } from './physics';
export { PUMP_PAD_X } from './consumables';
export { blocksPod, forcedFloorRow } from './collision';
export { destructionCause } from './vitals';

export interface PodStepCtx {
  /** Rows ≥ this are treated as an undiggable, impassable scope floor (M0 r128 / MVP r320 overlay; 584 = Seal in v1). */
  floorRow: number;
  /** Deep Heat A/B flag (canon §4.4), off by default. */
  deepHeat: boolean;
  /** RNG stream for Hop Beacon targets. */
  rng: Rng;
  stepNo: number;
  /** Build scope, for the Unknown-seam rule. Defaults to 'v1' when floorRow is the real Seal, else 'mvp'. */
  scope?: Scope;
}

export function createPod(): PodState {
  const x = START_X + 0.5;
  const y = HALF_H; // standing on the Rim surface (y = 0)
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    prevX: x,
    prevY: y,
    grounded: true,
    facing: 1,
    fuel: START_FUEL,
    hull: START_HULL,
    tiers: Object.fromEntries(LINES.map((l) => [l, 1])) as Record<Line, number>,
    cargo: [],
    consumables: Object.fromEntries(CONSUMABLES.map((c) => [c.id, 0])) as Record<ConsumableId, number>,
    quickSlots: [...DEFAULT_QUICK_SLOTS],
    dig: null,
    engageSteps: 0,
    engageDir: null,
    sector: 'none',
    cooldown: 0,
    magmaPending: 0,
    thrust: 0,
    digging: false,
    fuelWarn: -1,
    hullWarned: false,
    airSteps: 0,
    destroyed: false,
    row: 0,
  };
}

/** Advance the pod one 60 Hz step. Mutates pod and grid (digging, explosions); pushes events to `out`. */
export function stepPod(pod: PodState, grid: TerrainGrid, intent: PodIntent, ctx: PodStepCtx, out: GameEvent[]): void {
  if (pod.destroyed) return;
  pod.prevX = pod.x;
  pod.prevY = pod.y;
  pod.digging = false;
  const floor = forcedFloorRow(ctx.floorRow);
  const scope = ctx.scope ?? (ctx.floorRow >= SEAL_ROW ? 'v1' : 'mvp');
  const heat = ctx.deepHeat ? deepHeatFactor(pod.row) : 1;

  tickTimers(pod, out);
  pod.sector = nextSector(intent.sx, intent.sy, pod.sector);
  if (intent.fireSlot >= 0) fireQuickSlot(pod, grid, intent.fireSlot, ctx.rng, floor, out);

  const dropIn = pod.dig ? false : updateDigEngage(pod, grid, intent, floor, scope, out);
  if (pod.dig) {
    pod.thrust = 0;
    advanceDig(pod, grid, floor, heat, out);
  } else {
    physicsStep(pod, grid, intent, floor, heat, dropIn, out);
  }

  pod.row = clampRow(Math.floor(-pod.y));
  updateVisibility(pod, grid);
  discoverLodes(pod, grid, scope, out);
  checkVitals(pod, out);
}

/** Item cooldown and the pending second Magma hit (2 hits, MAGMA_HIT_GAP_STEPS apart; canon §3.3). */
function tickTimers(pod: PodState, out: GameEvent[]): void {
  if (pod.cooldown > 0) pod.cooldown--;
  if (pod.magmaPending > 0 && --pod.magmaPending === 0) magmaHit(pod, out);
}

function clampRow(r: number): number {
  return r < 0 ? 0 : r >= MINE_H ? MINE_H - 1 : r;
}
