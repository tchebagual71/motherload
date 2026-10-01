// Salvage after destruction (canon §4.2; 01 §6.1–6.2). PURE MODULE.
import type { CargoItem } from '../shared/types';
import { maxFuelOf, maxHullOf } from '../pod/stats';
import { salvageFee } from './catalogue';
import type { EconomyCtx } from './types';

export interface SalvageResult {
  fee: number;
  /** Total Co-op debt after the fee. */
  debt: number;
  lost: CargoItem[];
}

/**
 * Charge the salvage fee (always; a shortfall becomes Co-op debt), take the cargo and refuel and repair
 * the pod. Kept: tiers, consumables, quick slots, cash after the fee (canon §4.2). Positioning the pod
 * is the caller's job.
 */
export function salvage(ctx: EconomyCtx): SalvageResult {
  const pod = ctx.pod;
  const w = ctx.wallet;
  const fee = salvageFee(pod.tiers);
  const paid = Math.min(fee, w.cash);
  w.cash -= paid;
  w.debt += fee - paid;
  const lost = pod.cargo.slice();
  pod.cargo.length = 0;
  pod.fuel = maxFuelOf(pod.tiers.tank);
  pod.hull = maxHullOf(pod.tiers.hull);
  return { fee, debt: w.debt, lost };
}
