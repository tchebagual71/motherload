// Supply Shed: consumables and quick slots (canon §2.7; 01 §3.9, §3.10, §5.2). PURE MODULE.
// M0 already sells all six consumables (the style test needs explosives for the debug Hardrock strip).
import { CONSUMABLE_CAP, CONSUMABLES, JERRYCAN_LITERS, MEGA_POP_RADIUS, PATCH_KIT_HP, POP_RADIUS } from '../shared/canon';
import type { ConsumableId } from '../shared/types';
import type { Result, ShopItem } from '../world/api';
import { counted, dollars } from './format';
import { fail, ok, type EconomyCtx } from './types';

const side = (radius: number): number => 2 * radius + 1;

const EFFECT: Readonly<Record<ConsumableId, string>> = {
  jerrycan: `+${JERRYCAN_LITERS} L fuel, any time`,
  patchKit: `+${PATCH_KIT_HP} HP, any time`,
  pop: `Clears the ${side(POP_RADIUS)}×${side(POP_RADIUS)} around Pip; use grounded`,
  megaPop: `Clears the ${side(MEGA_POP_RADIUS)}×${side(MEGA_POP_RADIUS)} around Pip; use grounded`,
  hopBeacon: 'Hops Pip 6–14 rows above a random spot on the Rim; brake to land; use grounded',
  homingBeacon: 'Brings Pip safely home to the Pump House; use grounded',
};

const SPEC = new Map(CONSUMABLES.map((c) => [c.id as ConsumableId, c]));

export function isConsumableId(id: string): id is ConsumableId {
  return SPEC.has(id as ConsumableId);
}

export function shedItems(ctx: EconomyCtx): ShopItem[] {
  return CONSUMABLES.map((c) => ({
    id: c.id,
    name: c.name,
    price: c.price,
    owned: ctx.pod.consumables[c.id],
    cap: CONSUMABLE_CAP,
    available: true,
    effect: EFFECT[c.id],
  }));
}

/** Buy up to `n` (clamped to the 9-per-item cap); refused whole if cash is short. */
export function buyConsumable(ctx: EconomyCtx, id: ConsumableId, n: number): Result {
  const spec = SPEC.get(id);
  if (!spec) return fail('Not sold here');
  const owned = ctx.pod.consumables[id];
  const count = Math.min(Math.floor(n), CONSUMABLE_CAP - owned);
  if (!(count > 0)) return fail(owned >= CONSUMABLE_CAP ? `You already carry ${counted(CONSUMABLE_CAP, spec.name)}` : 'Choose how many to buy');
  const cost = spec.price * count;
  const short = cost - ctx.wallet.cash;
  if (short > 0) return fail(`Need ${dollars(short)} more`);
  ctx.wallet.cash -= cost;
  ctx.pod.consumables[id] = owned + count;
  ctx.emit({ t: 'purchase', kind: 'consumable', amount: cost, id });
  return ok(`Bought ${counted(count, spec.name)} for ${dollars(cost)}`, count);
}

/** Put `id` in quick slot `slot`; if it already sits in another slot the two swap (no duplicates). */
export function setQuickSlot(ctx: EconomyCtx, slot: number, id: ConsumableId): void {
  const slots = ctx.pod.quickSlots;
  if (!Number.isInteger(slot) || slot < 0 || slot >= slots.length || !isConsumableId(id)) return;
  const other = slots.indexOf(id);
  if (other >= 0) slots[other] = slots[slot];
  slots[slot] = id;
}
