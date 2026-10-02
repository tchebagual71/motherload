// Quick-slot consumables in use (canon §2.7; 01 §3.9). PURE MODULE.
import {
  CONSUMABLES,
  ITEM_COOLDOWN_STEPS,
  JERRYCAN_LITERS,
  MEGA_POP_RADIUS,
  MINE_W,
  PATCH_KIT_HP,
  POP_RADIUS,
  RIM_BUILDINGS,
} from '../shared/canon';
import type { GameEvent } from '../shared/events';
import type { Rng } from '../shared/rng';
import type { ConsumableId } from '../shared/types';
import type { TerrainGrid } from '../terrain/grid';
import { HALF_H, blocksPod } from './collision';
import { cancelDig, centreRow } from './dig';
import { blast } from './hazards';
import { maxFuelOf, maxHullOf } from './stats';
import type { PodState } from './types';

const GROUNDED_ONLY = Object.fromEntries(CONSUMABLES.map((c) => [c.id, c.grounded])) as Record<ConsumableId, boolean>;

/** Pump House pad centre x (canon §2.4: Rim x 1–4 → [1, 5)). */
const PUMP = RIM_BUILDINGS[0];
export const PUMP_PAD_X = (PUMP.x0 + PUMP.x1 + 1) / 2;
/** Hop Beacon drop height above the Rim, rows (canon §2.7). */
export const HOP_MIN_ROWS = 6;
export const HOP_SPAN_ROWS = 8;

/**
 * Fire the consumable in quick slot `slot` (edge-triggered by input). Refusals: 'empty', 'airborne'
 * (grounded-only items), 'cooldown' (7 steps after any use).
 */
export function fireQuickSlot(pod: PodState, grid: TerrainGrid, slot: number, rng: Rng, floor: number, out: GameEvent[]): void {
  if (slot < 0 || slot >= pod.quickSlots.length) return;
  const id = pod.quickSlots[slot];
  const reason = (pod.consumables[id] ?? 0) <= 0 ? 'empty' : GROUNDED_ONLY[id] && !pod.grounded ? 'airborne' : pod.cooldown > 0 ? 'cooldown' : null;
  if (reason) {
    out.push({ t: 'consumable-refused', id, reason });
    return;
  }
  pod.consumables[id]--;
  pod.cooldown = ITEM_COOLDOWN_STEPS;
  out.push({ t: 'consumable-used', id });
  applyConsumable(pod, grid, id, rng, floor, out);
}

function applyConsumable(pod: PodState, grid: TerrainGrid, id: ConsumableId, rng: Rng, floor: number, out: GameEvent[]): void {
  switch (id) {
    case 'jerrycan':
      pod.fuel = Math.min(maxFuelOf(pod.tiers.tank), pod.fuel + JERRYCAN_LITERS);
      return;
    case 'patchKit':
      pod.hull = Math.min(maxHullOf(pod.tiers.hull), pod.hull + PATCH_KIT_HP);
      return;
    case 'pop':
    case 'megaPop':
      cancelDig(pod);
      blast(grid, Math.floor(pod.x), centreRow(pod), id === 'pop' ? POP_RADIUS : MEGA_POP_RADIUS, floor, out);
      return;
    case 'hopBeacon': {
      // Draw order (x, then height) is part of the replay contract.
      const x = hopColumn(grid, rng, floor) + 0.5;
      const height = HOP_MIN_ROWS + rng.next() * HOP_SPAN_ROWS;
      teleport(pod, id, x, height + HALF_H, false, out);
      return;
    }
    case 'homingBeacon':
      teleport(pod, id, PUMP_PAD_X, HALF_H, true, out);
      return;
  }
}

/**
 * Hop Beacon target column: a random Rim column whose row-0 cell holds the pod up, so a hop never drops it
 * into a surface hole or the survey shaft (canon §2.7: lands on the Rim, 5–6 HP). Exactly one RNG draw.
 */
function hopColumn(grid: TerrainGrid, rng: Rng, floor: number): number {
  let n = 0;
  for (let c = 0; c < MINE_W; c++) if (blocksPod(grid, c, 0, floor)) n++;
  if (n === 0) return rng.int(MINE_W); // unreachable: paved pads cannot be dug
  let k = rng.int(n);
  for (let c = 0; c < MINE_W; c++) if (blocksPod(grid, c, 0, floor) && k-- === 0) return c;
  return 0;
}

/** Move the pod instantly (no render interpolation across the jump). */
function teleport(pod: PodState, id: ConsumableId, x: number, y: number, grounded: boolean, out: GameEvent[]): void {
  cancelDig(pod);
  pod.x = pod.prevX = x;
  pod.y = pod.prevY = y;
  pod.vx = 0;
  pod.vy = 0;
  pod.grounded = grounded;
  out.push({ t: 'teleport', id, x, y });
}
