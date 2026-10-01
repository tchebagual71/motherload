// Build scope (canon §5.5 ledger). Set at build time via HF_SCOPE=m0|mvp|v1 (vite define).
import type { Scope } from '../shared/types';

export const SCOPE: Scope = __HF_SCOPE__;
const ORDER: Record<Scope, number> = { m0: 0, mvp: 1, v1: 2 };
/** True when the current build includes features introduced at `tier`. */
export function inScope(tier: Scope, current: Scope = SCOPE): boolean {
  return ORDER[current] >= ORDER[tier];
}
