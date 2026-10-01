// Pure scope helpers (no build-time globals) for sim code. PURE MODULE.
import type { Scope } from './types';

const ORDER: Record<Scope, number> = { m0: 0, mvp: 1, v1: 2 };
export function scopeAtLeast(current: Scope, tier: Scope): boolean {
  return ORDER[current] >= ORDER[tier];
}
