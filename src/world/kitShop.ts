// Factory-facing Rim services (canon §2.4, §4.8–§4.9; 02 §3.7, §4.3; 03 §6.3): Supply Shed Kits (to cargo or to
// the Stockpile, loading from it), the Starter Kit, and the Assay "Stockpile" toggle. Trade refusals (on the
// Rim, alive) are the World's; these functions assume the pod may trade. PURE MODULE.
import { BUILDINGS, LIFT_RAIL_KIT, type FactoryApi, type Rung } from '../factory/api';
import { hasItem, item, kitItemId, specimenId } from '../factory/items';
import { MINERALS } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import { scopeAtLeast } from '../shared/scope';
import type { CargoItem, Scope } from '../shared/types';
import { kitSpec } from '../pod/stats';
import { STARTER_KIT_PURCHASE } from '../story';
import type { PodState } from '../pod/types';
import { counted, dollars } from '../economy/format';
import { fail, ok } from '../economy/types';
import type { KitShopItem, Result, Wallet } from './api';
import { takeCargo } from './discard';
import { rungTrigger, kitName } from './factoryText';
import { cargoKitCount, freeSlots, newKit } from './kits';

/** Supply Shed Kits in shelf order (02 §3.1; canon §2.8). v1 adds Mk II/III, Depot, Chute, Shoring, Lamp, Taps. */
export const SHED_KITS: readonly string[] = ['belt', 'router', 'autoDrill', 'liftFoot', LIFT_RAIL_KIT];

/** Canon §2.1: Auto-Drill Kit Mk I, Lift Foot Kit Mk I, Lift Rail, 2 Belt Kits (5 slots, 14 mu). */
export const STARTER_KIT: readonly string[] = ['autoDrill', 'liftFoot', LIFT_RAIL_KIT, 'belt', 'belt'];

/** story.flags keys (STRY section): the Starter Kit became available / was collected. */
export const STARTER_READY_FLAG = 'starterKit:ready';
export const STARTER_CLAIMED_FLAG = 'starterKit:claimed';

/** Assay "Stockpile" takes bulk specimens (tiers 1–6, canon §4.9). Gems stay Assay-only in the MVP. */
export const MAX_BULK_TIER = 6;

export interface ShopCtx {
  readonly pod: PodState;
  readonly wallet: Wallet;
  readonly scope: Scope;
  readonly factory: FactoryApi;
  readonly flags: Record<string, boolean>;
  emit(e: GameEvent): void;
}

/** The rung that unlocks a Kit: the one of the building Mk it builds (Lift Rail: Bucket Lift Mk I). */
export function kitRung(kitId: string): Rung | null {
  if (kitId === LIFT_RAIL_KIT) return BUILDINGS.lift.mks[0].rung;
  for (const def of Object.values(BUILDINGS)) for (const mk of def.mks) if (mk.kit === kitId) return mk.rung;
  return null;
}

/** Why `kitId` cannot be bought in this build right now (scope, rung), or null. */
function kitBlocker(ctx: ShopCtx, kitId: string): string | null {
  const id = kitItemId(kitId);
  if (!SHED_KITS.includes(kitId) || !hasItem(id)) return 'Not sold here';
  if (item(id).scope === 'v1' && !scopeAtLeast(ctx.scope, 'v1')) return 'Coming in the next update';
  const rung = kitRung(kitId);
  if (rung && !ctx.factory.isUnlocked(rung)) return `Unlocks: ${rungTrigger(rung)}`;
  return null;
}

export function kitShop(ctx: ShopCtx): KitShopItem[] {
  return SHED_KITS.map((id) => {
    const spec = kitSpec(id);
    const blocker = kitBlocker(ctx, id);
    return {
      id,
      name: kitName(id),
      price: item(kitItemId(id)).value,
      inCargo: cargoKitCount(ctx.pod.cargo, id),
      inStockpile: ctx.factory.stockpileCount(kitItemId(id)),
      slots: spec.slots,
      mass: spec.mass,
      available: blocker === null,
      blocker,
    };
  });
}

function wholeCount(n: number): number {
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

/** Buy `n` Kits to the bay (slots checked) or to the Stockpile (Bin room checked); all or nothing. */
export function buyKit(ctx: ShopCtx, kitId: string, n: number, to: 'cargo' | 'stockpile'): Result {
  const blocker = kitBlocker(ctx, kitId);
  if (blocker) return fail(blocker);
  const count = wholeCount(n);
  if (count < 1) return fail('Choose how many to buy');
  const name = kitName(kitId);
  const cost = item(kitItemId(kitId)).value * count;
  const short = cost - ctx.wallet.cash;
  if (short > 0) return fail(`Need ${dollars(short)} more`);
  if (to === 'cargo') {
    const need = kitSpec(kitId).slots * count;
    const free = freeSlots(ctx.pod);
    if (need > free) return fail(free <= 0 ? 'Bay full: no free slots' : `Bay has room for ${free} slot${free === 1 ? '' : 's'}`);
    ctx.wallet.cash -= cost;
    for (let i = 0; i < count; i++) ctx.pod.cargo.push(newKit(kitId));
  } else {
    const r = ctx.factory.stockpilePut([{ item: kitItemId(kitId), n: count }]);
    if (!r.ok) return fail(r.code === 'E_STOCKPILE_FULL' ? 'Stockpile full: build a Bin' : 'The Stockpile refused that');
    ctx.wallet.cash -= cost;
  }
  ctx.emit({ t: 'purchase', kind: 'kit', amount: cost, kit: kitId });
  return ok(`${counted(count, name)} to ${to === 'cargo' ? 'the bay' : 'the Stockpile'}`, count);
}

/** Load `n` Kits from the Stockpile into the bay at the Supply Shed (02 §3.7). */
export function loadKit(ctx: ShopCtx, kitId: string, n: number): Result {
  const id = kitItemId(kitId);
  if (!SHED_KITS.includes(kitId) || !hasItem(id)) return fail('Not stocked here');
  const count = wholeCount(n);
  if (count < 1) return fail('Choose how many to load');
  const have = ctx.factory.stockpileCount(id);
  if (have < count) return fail(have === 0 ? `No ${kitName(kitId)} in the Stockpile` : `Only ${have} in the Stockpile`);
  const need = kitSpec(kitId).slots * count;
  const free = freeSlots(ctx.pod);
  if (need > free) return fail(free <= 0 ? 'Bay full: no free slots' : `Bay has room for ${free} slot${free === 1 ? '' : 's'}`);
  const r = ctx.factory.stockpileTake([{ item: id, n: count }]);
  if (!r.ok) return fail('The Stockpile refused that');
  for (let i = 0; i < count; i++) ctx.pod.cargo.push(newKit(kitId));
  return ok(`Loaded ${counted(count, kitName(kitId))}`, count);
}

// ------------------------------------------------------------------ Starter Kit (canon §2.1; 02 §3.7)

export function starterKitReady(flags: Readonly<Record<string, boolean>>): boolean {
  return flags[STARTER_READY_FLAG] === true && flags[STARTER_CLAIMED_FLAG] !== true;
}

/** The scripted lode was discovered: the Starter Kit waits at the Shed. Returns true the first time. */
export function offerStarterKit(flags: Record<string, boolean>): boolean {
  if (flags[STARTER_READY_FLAG]) return false;
  flags[STARTER_READY_FLAG] = true;
  return true;
}

function starterSlots(): number {
  let n = 0;
  for (const id of STARTER_KIT) n += kitSpec(id).slots;
  return n;
}

/** Hand over the Starter Kit once; refused whole (with the slot count) if the bay lacks room. */
export function claimStarterKit(ctx: ShopCtx): Result {
  if (ctx.flags[STARTER_CLAIMED_FLAG]) return fail('Starter Kit already collected');
  if (!ctx.flags[STARTER_READY_FLAG]) return fail("Find the lode by Dot's shaft first");
  const need = starterSlots();
  const free = freeSlots(ctx.pod);
  if (need > free) return fail(`Need ${need} free bay slots (have ${Math.max(0, free)})`);
  for (const id of STARTER_KIT) ctx.pod.cargo.push(newKit(id));
  ctx.flags[STARTER_CLAIMED_FLAG] = true;
  ctx.emit({ t: 'purchase', kind: 'kit', amount: 0, kit: STARTER_KIT_PURCHASE }); // the story marks it collected
  return ok(`Starter Kit aboard: ${STARTER_KIT.length} Kits`, STARTER_KIT.length);
}

// ------------------------------------------------------------------ Assay "Stockpile" (canon §4.9; 02 §4.3)

/** Can the Assay Stockpile this cargo kind at all (bulk specimens only)? Null = yes, else why not. */
export function stockpileRefusal(item0: CargoItem): string | null {
  if (item0.kind === 'relic') return 'Relics go to the Assay only';
  if (item0.kind === 'kit') return 'Stockpile Kits at the Supply Shed';
  if (item0.tier > MAX_BULK_TIER) return 'Gems sell here; they are pod-only';
  return null;
}

/** Put up to `n` specimens like `item0` into the Bins (as many as fit), instead of selling them. */
export function stockpileCargo(ctx: ShopCtx, item0: CargoItem, n: number | 'all'): Result {
  const refusal = stockpileRefusal(item0);
  if (refusal || item0.kind !== 'mineral') return fail(refusal ?? 'Not a specimen');
  if (!ctx.factory.isUnlocked('U2')) return fail(`Unlocks: ${rungTrigger('U2')}`);
  let aboard = 0;
  for (const c of ctx.pod.cargo) if (c.kind === 'mineral' && c.tier === item0.tier) aboard++;
  const want = n === 'all' ? aboard : Math.min(aboard, wholeCount(n));
  if (want < 1) return fail('Nothing like that aboard');
  const fit = Math.min(want, ctx.factory.stockpileFree());
  if (fit < 1) return fail('Stockpile full: build a Bin');
  const r = ctx.factory.stockpilePut([{ item: specimenId(item0.tier), n: fit }]);
  if (!r.ok) return fail('Stockpile full: build a Bin');
  takeCargo(ctx.pod.cargo, item0, fit);
  const name = MINERALS[item0.tier - 1]?.name ?? 'specimen';
  return ok(fit < want ? `${fit} to the Stockpile · Bins full` : `${fit} ${name} to the Stockpile`, fit);
}
