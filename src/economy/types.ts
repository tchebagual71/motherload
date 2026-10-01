// What the shop functions read and write. World builds one EconomyCtx and passes it to every service.
// PURE MODULE (types only).
import type { GameEvent } from '../shared/events';
import type { Scope } from '../shared/types';
import type { PodState } from '../pod/types';
import type { Result, Wallet } from '../world/api';
import type { PartsLedger } from './parts';

export interface EconomyCtx {
  readonly pod: PodState;
  readonly wallet: Wallet;
  readonly scope: Scope;
  /** Stockpile parts for t3+ upgrades (factory hook; empty until the MVP factory exists). */
  parts: PartsLedger;
  emit(e: GameEvent): void;
}

export const ok = (message?: string, amount?: number): Result => {
  const r: Result = { ok: true };
  if (message !== undefined) r.message = message;
  if (amount !== undefined) r.amount = amount;
  return r;
};

export const fail = (reason: string): Result => ({ ok: false, reason });
