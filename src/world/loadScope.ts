// Which scope a loaded save plays under (INT-6; canon §5.5: config/scope.ts is the one scope gate). PURE MODULE.
// A save always plays under the build's scope, so the sim (floor, Seal overlay, economy gates) and the UI agree.
// An older save migrates forward: scope only hides content and never changes generation (canon §3.2), so
// m0 → mvp keeps the world as it is and only lifts the r128 floor; the M0 debug strip stays dug-or-not as the
// player left it. A save from a newer scope cannot load here (like a newer HFSV version, 04 §4.11).
import { SaveError } from '../save/codec';
import type { Scope } from '../shared/types';

const ORDER: Record<Scope, number> = { m0: 0, mvp: 1, v1: 2 };

export function loadScope(saved: Scope, build: Scope): Scope {
  if (ORDER[saved] > ORDER[build]) throw new SaveError('version', `a ${saved} save cannot load in a ${build} build`);
  return build;
}
