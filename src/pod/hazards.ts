// Terrain edits caused by the pod: dug-cell contents, Magma and Methane breaches, explosives
// (canon §2.7, §3.3, §3.7; 01 §3.4, §3.8, §3.9). PURE MODULE.
import { MAGMA_HIT, MAGMA_HIT_GAP_STEPS, MINE_W, methaneDamage } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import { F, T, mineralTierOf, relicIdOf, type CargoItem, type TerrainCode } from '../shared/types';
import type { TerrainGrid } from '../terrain/grid';
import { bayHasRoom, radiatorOf } from './stats';
import type { PodState } from './types';
import { applyDamage } from './vitals';

/** Cargo a cell yields when dug (specimens, gems, relics), or null. */
export function cellContent(code: TerrainCode): CargoItem | null {
  const tier = mineralTierOf(code);
  if (tier) return { kind: 'mineral', tier };
  const relic = relicIdOf(code);
  if (relic >= 0) return { kind: 'relic', id: relic };
  return null;
}

/** Codes the pod can drill: dirt, turf, specimens, relics and the two breachable hazards (01 §3.4). */
export function isDrillableCode(code: TerrainCode): boolean {
  return (
    code === T.DIRT ||
    code === T.TURF ||
    code === T.MAGMA ||
    code === T.METHANE ||
    mineralTierOf(code) > 0 ||
    relicIdOf(code) >= 0
  );
}

function clearCell(grid: TerrainGrid, x: number, r: number): void {
  grid.set(x, r, T.AIR);
  grid.markDug(x, r);
}

/** Collect a dug cell's content into cargo, or destroy it with 'bay-full' (canon §3.7). */
function collect(pod: PodState, item: CargoItem, out: GameEvent[]): void {
  if (bayHasRoom(pod, item)) {
    pod.cargo.push(item);
    out.push({ t: 'collect', item });
  } else {
    out.push({ t: 'bay-full', item });
  }
}

/**
 * The drill breaks through cell (x, r) (at 37.5% of the dig): the cell becomes dug air and its
 * content goes to cargo, or a hazard breaches (Magma: first of two hits; Methane: one depth-scaled hit
 * plus a 3×3 clear).
 */
export function breakThrough(pod: PodState, grid: TerrainGrid, x: number, r: number, floor: number, out: GameEvent[]): void {
  const code = grid.get(x, r);
  clearCell(grid, x, r);
  out.push({ t: 'dug', x, r, code });
  if (code === T.MAGMA) {
    magmaHit(pod, out);
    pod.magmaPending = MAGMA_HIT_GAP_STEPS;
  } else if (code === T.METHANE) {
    applyDamage(pod, methaneDamage(r, radiatorOf(pod.tiers.radiator)), 'methane', out);
    clearArea(grid, x, r, 1, floor, false);
    out.push({ t: 'explosion', x, r, radius: 1 });
  } else {
    const item = cellContent(code);
    if (item) collect(pod, item, out);
  }
}

export function magmaHit(pod: PodState, out: GameEvent[]): void {
  applyDamage(pod, MAGMA_HIT * radiatorOf(pod.tiers.radiator), 'magma', out);
}

/**
 * Can a blast clear cell (x, r)? Explosives clear terrain, Magma and Methane and destroy ore and relics,
 * but never touch lode rock, the Seal, Heartstone, anchored cells, occupants, the paved Rim or the scope
 * floor (canon §3.3). A Methane breach additionally spares Hardrock.
 */
function isClearable(grid: TerrainGrid, x: number, r: number, floor: number, hardrock: boolean): boolean {
  if (!grid.inBounds(x, r) || r >= floor) return false;
  const i = r * MINE_W + x;
  if (grid.occupant[i] !== 0 || (grid.flags[i] & F.ANCHORED) !== 0) return false;
  const code = grid.terrain[i];
  if (code === T.HARDROCK) return hardrock;
  return isDrillableCode(code);
}

/** Clear the (2·radius+1)² square centred on (cx, cr); contents are destroyed. */
export function clearArea(grid: TerrainGrid, cx: number, cr: number, radius: number, floor: number, hardrock: boolean): void {
  for (let r = cr - radius; r <= cr + radius; r++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (isClearable(grid, x, r, floor, hardrock)) clearCell(grid, x, r);
    }
  }
}

/** Pop Charge / Mega Pop centred on the pod's cell; the pod never takes damage (canon §2.7, §3.3). */
export function blast(grid: TerrainGrid, cx: number, cr: number, radius: number, floor: number, out: GameEvent[]): void {
  clearArea(grid, cx, cr, radius, floor, true);
  out.push({ t: 'explosion', x: cx, r: cr, radius });
}
