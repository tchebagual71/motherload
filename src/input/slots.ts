// Quick-slot press policy (canon §2.7, §3.12; 03 §3.4). Pure; shared by input (press handling) and
// the slot visuals (lock badge, greyed state).
import { CONSUMABLES, MEGA_POP_RADIUS, POP_RADIUS, type ConsumableId } from '../shared/canon';
import type { SlotKind } from './arming';

/** Jerrycan / Patch Kit grey out at ≥ 90% tank / hull (03 §3.4). */
export const TOP_UP_FULL_FRAC = 0.9;

export type SlotRefusal = 'empty' | 'airborne' | 'full';
export type SlotDecision = { ok: true; kind: SlotKind } | { ok: false; reason: SlotRefusal };

export interface SlotContext {
  count: number;
  grounded: boolean;
  fuelFrac: number;
  hullFrac: number;
}

export function isGroundedOnly(id: ConsumableId): boolean {
  return CONSUMABLES.find((c) => c.id === id)?.grounded ?? false;
}

/** Explosives and beacons arm (ring, fire on release); Jerrycan and Patch Kit fire on release. */
export function slotKind(id: ConsumableId): SlotKind {
  return isGroundedOnly(id) ? 'armed' : 'instant';
}

export function slotDecision(id: ConsumableId, ctx: SlotContext): SlotDecision {
  if (ctx.count <= 0) return { ok: false, reason: 'empty' };
  if (isGroundedOnly(id) && !ctx.grounded) return { ok: false, reason: 'airborne' };
  if (id === 'jerrycan' && ctx.fuelFrac >= TOP_UP_FULL_FRAC) return { ok: false, reason: 'full' };
  if (id === 'patchKit' && ctx.hullFrac >= TOP_UP_FULL_FRAC) return { ok: false, reason: 'full' };
  return { ok: true, kind: slotKind(id) };
}

/** Footprint radius in tiles for the arming preview (canon §2.7: Pop 3×3, Mega 5×5; beacons 0). */
export function footprintRadius(id: ConsumableId): number {
  if (id === 'pop') return POP_RADIUS;
  if (id === 'megaPop') return MEGA_POP_RADIUS;
  return 0;
}
