// Assay Office: cargo valuation and Sell all at 100%, collecting Co-op debt first (canon §2.4, §3.8, §4.2,
// §4.9; 01 §3.10, §6.2). Kits, Fuel Drums and Weld Packs are never sold here. PURE MODULE.
import { MINERALS, RELICS } from '../shared/canon';
import type { CargoItem } from '../shared/types';
import { itemMass } from '../pod/stats';
import type { CargoGroup, Result } from '../world/api';
import { counted, dollars } from './format';
import { fail, ok, type EconomyCtx } from './types';

/** Kit labels by id prefix (canon §2.8, §4.8); a trailing digit is the Mk ('autoDrill2' → Mk II). */
const KIT_LABELS: Readonly<Record<string, string>> = {
  belt: 'Belt Kit',
  router: 'Router Kit',
  shoring: 'Shoring Kit',
  lamp: 'Lamp Kit',
  chute: 'Chute Kit',
  liftRail: 'Lift Rail',
  autoDrill: 'Auto-Drill Kit',
  liftFoot: 'Lift Foot Kit',
  magmaTap: 'Magma Tap Kit',
  gasTap: 'Gas Tap Kit',
  depot: 'Depot Kit',
  fuelDrum: 'Fuel Drum',
  weldPack: 'Weld Pack',
};
const MK = ['', 'I', 'II', 'III'];

function kitLabel(id: string): string {
  const m = /^([a-zA-Z]+)(\d)?$/.exec(id);
  const base = m ? KIT_LABELS[m[1]] : undefined;
  if (!m || !base) return id;
  const mk = m[2] ? MK[Number(m[2])] : '';
  return mk ? `${base} Mk ${mk}` : base;
}

export function isSellable(item: CargoItem): boolean {
  return item.kind !== 'kit';
}

/** Assay value of one item ($0 for anything the Assay does not buy). */
export function itemValue(item: CargoItem): number {
  switch (item.kind) {
    case 'mineral':
      return MINERALS[item.tier - 1]?.value ?? 0;
    case 'relic':
      return RELICS[item.id]?.value ?? 0;
    case 'kit':
      return 0;
  }
}

export function itemLabel(item: CargoItem): string {
  switch (item.kind) {
    case 'mineral':
      return MINERALS[item.tier - 1]?.name ?? `Tier ${item.tier} mineral`;
    case 'relic':
      return RELICS[item.id]?.name ?? 'Relic';
    case 'kit':
      return kitLabel(item.id);
  }
}

function itemKey(item: CargoItem): string {
  switch (item.kind) {
    case 'mineral':
      return `m${item.tier}`;
    case 'relic':
      return `r${item.id}`;
    case 'kit':
      return `k:${item.id}`;
  }
}

/** Cargo grouped by item type, most valuable first (ties by label). */
export function cargoGroups(cargo: readonly CargoItem[]): CargoGroup[] {
  const groups = new Map<string, CargoGroup>();
  for (const item of cargo) {
    const key = itemKey(item);
    const g = groups.get(key);
    const value = itemValue(item);
    const mass = itemMass(item);
    if (g) {
      g.count++;
      g.totalValue += value;
      g.mass += mass;
    } else {
      groups.set(key, { item, label: itemLabel(item), count: 1, unitValue: value, totalValue: value, mass });
    }
  }
  return [...groups.values()].sort((a, b) => b.totalValue - a.totalValue || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** Σ Assay value of the cargo (allocation-free). */
export function cargoValue(cargo: readonly CargoItem[]): number {
  let sum = 0;
  for (let i = 0; i < cargo.length; i++) sum += itemValue(cargo[i]);
  return sum;
}

/** Same cargo kind (mineral tier, relic id or Kit id). */
function alike(a: CargoItem, b: CargoItem): boolean {
  if (a.kind === 'mineral') return b.kind === 'mineral' && b.tier === a.tier;
  if (a.kind === 'relic') return b.kind === 'relic' && b.id === a.id;
  return b.kind === 'kit' && b.id === a.id;
}

function isKept(item: CargoItem, keep: readonly CargoItem[] | undefined): boolean {
  if (!keep) return false;
  for (const k of keep) if (alike(k, item)) return true;
  return false;
}

/**
 * Sell every specimen, gem and relic; Kits stay aboard, and so does anything like an item in `keep` (rows the
 * Assay's Stockpile toggle holds back, 03 §6.3). Debt is paid from the proceeds first.
 */
export function sellAll(ctx: EconomyCtx, keep?: readonly CargoItem[]): Result {
  const cargo = ctx.pod.cargo;
  let gross = 0;
  let sold = 0;
  let kept = 0;
  for (let i = 0; i < cargo.length; i++) {
    const it = cargo[i];
    if (isSellable(it) && !isKept(it, keep)) {
      sold++;
      gross += itemValue(it);
    } else cargo[kept++] = it;
  }
  if (sold === 0) return fail(cargo.length === 0 ? 'Nothing to sell' : keep && keep.length > 0 ? 'Nothing left to sell' : 'The Assay Office does not buy Kits');
  cargo.length = kept;

  const w = ctx.wallet;
  const toDebt = Math.min(w.debt, gross);
  w.debt -= toDebt;
  w.cash += gross - toDebt;
  w.lifetimeEarned += gross;
  ctx.emit({ t: 'sale', amount: gross, count: sold });
  const head = `Sold ${counted(sold, 'item')} for ${dollars(gross)}`;
  return ok(toDebt > 0 ? `${head} · ${dollars(toDebt)} paid off your Co-op debt` : head, gross);
}
