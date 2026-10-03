// Pump House: fuel at $1/L and Co-op Credit (canon §2.4, §3.8; 01 §3.10, §6.5). PURE MODULE.
import {
  COOP_CREDIT_CASH_BELOW,
  COOP_CREDIT_COOLDOWN_STEPS,
  COOP_CREDIT_FUEL_BELOW,
  COOP_CREDIT_LITERS,
  FUEL_PRICE_PER_L,
} from '../shared/canon';
import { maxFuelOf } from '../pod/stats';
import type { Quote, Result, StoryState } from '../world/api';
import { dollars, litres } from './format';
import { fail, ok, type EconomyCtx } from './types';

/** Below this the tank counts as full (float residue from burn). */
const MIN_LITERS = 0.01;
/** Absorbs float error so an exact 4 L × $1 never rounds up to $5. */
const PRICE_EPS = 1e-9;

function roomLiters(ctx: EconomyCtx): number {
  const room = maxFuelOf(ctx.pod.tiers.tank) - ctx.pod.fuel;
  return room > 0 ? room : 0;
}

/** Whole dollars for a fractional amount: per litre or part thereof. */
function fuelCost(liters: number): number {
  return Math.ceil(liters * FUEL_PRICE_PER_L - PRICE_EPS);
}

/** Litres a purchase would add ('fill' = up to the tank, limited by cash) and their cost. */
export function fuelQuote(ctx: EconomyCtx, liters: number | 'fill'): Quote {
  const room = roomLiters(ctx);
  const want = liters === 'fill' ? room : Math.min(Math.max(0, liters), room);
  if (want < MIN_LITERS) return { amount: 0, cost: 0, limitedByCash: false };
  const affordable = Math.floor(ctx.wallet.cash) / FUEL_PRICE_PER_L;
  if (fuelCost(want) <= ctx.wallet.cash) return { amount: want, cost: fuelCost(want), limitedByCash: false };
  return { amount: affordable, cost: fuelCost(affordable), limitedByCash: true };
}

export function buyFuel(ctx: EconomyCtx, liters: number | 'fill'): Result {
  const q = fuelQuote(ctx, liters);
  if (q.amount < MIN_LITERS) {
    return fail(roomLiters(ctx) < MIN_LITERS ? 'Tank is already full' : `Not enough cash: fuel is ${dollars(FUEL_PRICE_PER_L)}/L`);
  }
  const pod = ctx.pod;
  const max = maxFuelOf(pod.tiers.tank);
  const room = roomLiters(ctx);
  pod.fuel = q.amount >= room - MIN_LITERS ? max : pod.fuel + q.amount;
  ctx.wallet.cash -= q.cost;
  ctx.emit({ t: 'purchase', kind: 'fuel', amount: q.cost });
  // The quote's own litres, rounded down like the sheet's tiles and the gauge (every reader sees one number).
  const what = pod.fuel >= max ? `Filled up: ${litres(q.amount)}` : `Bought ${litres(q.amount)}`;
  return ok(`${what} for ${dollars(q.cost)}`, q.amount);
}

/**
 * Co-op Credit (canon §2.1, §3.8): free 5 L at the Pump House when cash < $5 and fuel < 2 L, once per
 * 10 min of steps. Returns the litres granted (0 when not eligible).
 */
export function grantCoopCredit(ctx: EconomyCtx, story: StoryState, stepNo: number): number {
  const pod = ctx.pod;
  if (ctx.wallet.cash >= COOP_CREDIT_CASH_BELOW || pod.fuel >= COOP_CREDIT_FUEL_BELOW || stepNo < story.coopCreditReadyStep) return 0;
  const liters = Math.min(COOP_CREDIT_LITERS, maxFuelOf(pod.tiers.tank) - pod.fuel);
  if (liters <= 0) return 0;
  pod.fuel += liters;
  story.coopCreditReadyStep = stepNo + COOP_CREDIT_COOLDOWN_STEPS;
  ctx.emit({ t: 'coop-credit', liters });
  return liters;
}
