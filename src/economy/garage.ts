// Garage: line upgrades and hull repair (canon §2.4, §2.6, §4.3.5, §5.5; 01 §3.10, §5.1). PURE MODULE.
// Tiers are buyable out of order (each skipped tier's parts are not due, the bought tier's are); no trade-in.
import { LINES, REPAIR_PRICE_PER_HP, type Line } from '../shared/canon';
import { maxFuelOf, maxHullOf } from '../pod/stats';
import type { Quote, Result, UpgradeCard } from '../world/api';
import { lineInScope, nextTier, partsFor, tierExists, tierInScope, tierName, tierPrice, tierStat } from './catalogue';
import { amount1, dollars, grouped } from './format';
import { PART_NAMES, type PartReq } from './parts';
import { fail, ok, type EconomyCtx } from './types';

export const BLOCK_MAXED = 'Fully upgraded';
export const BLOCK_NEXT_UPDATE = 'Coming in the next update';
export const BLOCK_OUT_OF_SCOPE = 'Out of scope';

/** Below this the hull counts as intact (hull is tracked to 0.1 HP). */
const MIN_HP = 0.05;
const PRICE_EPS = 1e-9;

function partChecks(ctx: EconomyCtx, reqs: readonly PartReq[]): UpgradeCard['parts'] {
  return reqs.map((r) => ({ item: PART_NAMES[r.part], need: r.n, have: ctx.parts.count(r.part) }));
}

/** Why `tier` of `line` cannot be bought now, or null. */
function blockerFor(ctx: EconomyCtx, line: Line, tier: number, parts: UpgradeCard['parts']): string | null {
  if (!tierExists(line, tier)) return 'No such tier';
  if (!lineInScope(ctx.scope, line)) return BLOCK_NEXT_UPDATE;
  if (!tierInScope(ctx.scope, line, tier)) return BLOCK_OUT_OF_SCOPE;
  if (tier <= ctx.pod.tiers[line]) return 'Already installed';
  const short = tierPrice(tier) - ctx.wallet.cash;
  if (short > 0) return `Need ${dollars(short)} more`;
  const missing = parts.find((p) => p.have < p.need);
  if (missing) return `Needs ${grouped(missing.need)} ${missing.item} (have ${grouped(missing.have)})`;
  return null;
}

function card(ctx: EconomyCtx, line: Line): UpgradeCard {
  const installed = ctx.pod.tiers[line];
  const next = nextTier(line, installed);
  const tier = next ?? installed;
  const parts = next === null ? [] : partChecks(ctx, partsFor(ctx.scope, line, next));
  const price = next === null ? 0 : tierPrice(next);
  return {
    line,
    tier,
    name: tierName(line, tier),
    price,
    installedTier: installed,
    installedName: tierName(line, installed),
    stat: tierStat(line, tier),
    installedStat: tierStat(line, installed),
    available: next === null ? lineInScope(ctx.scope, line) : tierInScope(ctx.scope, line, next),
    affordable: ctx.wallet.cash >= price,
    parts,
    blocker: next === null ? BLOCK_MAXED : blockerFor(ctx, line, next, parts),
  };
}

/** One card per line (LINES order) offering the next tier above the installed one. */
export function garageCards(ctx: EconomyCtx): UpgradeCard[] {
  return LINES.map((line) => card(ctx, line));
}

export function buyUpgrade(ctx: EconomyCtx, line: Line, tier: number): Result {
  const reqs = tierExists(line, tier) ? partsFor(ctx.scope, line, tier) : [];
  const parts = partChecks(ctx, reqs);
  const blocker = blockerFor(ctx, line, tier, parts);
  if (blocker !== null) return fail(blocker);
  const price = tierPrice(tier);
  for (const r of reqs) ctx.parts.take(r.part, r.n);
  ctx.wallet.cash -= price;
  installTier(ctx, line, tier);
  ctx.emit({ t: 'purchase', kind: 'upgrade', amount: price, line, tier });
  return ok(`${tierName(line, tier)} installed`, price);
}

/**
 * Set a line's tier and keep fuel and hull consistent: a hull tier repairs free (canon §2.4); a Tank
 * keeps the litres already in it (no free refill); a smaller part clamps (debug only).
 */
export function installTier(ctx: EconomyCtx, line: Line, tier: number): void {
  const pod = ctx.pod;
  pod.tiers[line] = tier;
  const maxHull = maxHullOf(pod.tiers.hull);
  pod.hull = line === 'hull' ? maxHull : Math.min(pod.hull, maxHull);
  pod.fuel = Math.min(pod.fuel, maxFuelOf(pod.tiers.tank));
}

/** Full repair at $15/HP, or as many whole HP as cash allows. */
export function repairQuote(ctx: EconomyCtx): Quote {
  const missing = maxHullOf(ctx.pod.tiers.hull) - ctx.pod.hull;
  if (missing < MIN_HP) return { amount: 0, cost: 0, limitedByCash: false };
  const full = Math.ceil(missing * REPAIR_PRICE_PER_HP - PRICE_EPS);
  if (full <= ctx.wallet.cash) return { amount: missing, cost: full, limitedByCash: false };
  const hp = Math.floor(ctx.wallet.cash / REPAIR_PRICE_PER_HP);
  return { amount: hp, cost: hp * REPAIR_PRICE_PER_HP, limitedByCash: true };
}

export function repairAll(ctx: EconomyCtx): Result {
  const q = repairQuote(ctx);
  if (q.amount <= 0) {
    return fail(q.limitedByCash ? `Not enough cash: repairs are ${dollars(REPAIR_PRICE_PER_HP)}/HP` : 'Hull is already in good shape');
  }
  const pod = ctx.pod;
  pod.hull = q.limitedByCash ? pod.hull + q.amount : maxHullOf(pod.tiers.hull);
  ctx.wallet.cash -= q.cost;
  ctx.emit({ t: 'purchase', kind: 'repair', amount: q.cost });
  return ok(`${q.limitedByCash ? 'Patched' : 'Repaired'} ${amount1(q.amount)} HP for ${dollars(q.cost)}`, q.amount);
}
