// Build-mode context actions (03 §3.5): priority 2 "Place drill" (next to a discovered lode that has no drill, with
// an Auto-Drill Kit aboard → Mine build, drill armed and snapped) and priority 3 "BUILD" (grounded, < 0.2 tiles/s,
// no stick for 0.6 s). Registered on ui/context.ts; BUILD is always on ≡ → Build and the B key too.
import type { AppController } from '../../app/types';
import { inScope } from '../../config/scope';
import type { Lode } from '../../shared/types';
import { registerContextAction, type ContextAction, type ContextInput, type ContextProvider } from '../context';
import type { BuildSession } from './session';
import { kitsInCargo } from './tools';

/** 03 §3.5: BUILD shows after 0.6 s without stick input, grounded and slower than 0.2 tiles/s. */
export const BUILD_IDLE_MS = 600;
export const BUILD_MAX_SPEED = 0.2;
/** "Next to" a lode: the pod's cell within this Chebyshev distance of the lode or its drill site (the Kit radius). */
export const LODE_REACH = 2;

const BUILD: ContextAction = { priority: 3, id: 'build', label: 'BUILD', run: (app) => app.enterBuild() };

/** Priority 3: BUILD. Hidden until something can be built (U2, the first lode: 02 §9), so the first trips stay clean. */
export const buildContext: ContextProvider = (app: AppController, input: ContextInput) => {
  if (!inScope('mvp') || app.state.mode.peek() !== 'play') return null;
  const f = app.world.factory;
  if (!f || !f.isUnlocked('U2')) return null;
  const pod = app.world.pod;
  if (!pod.grounded || pod.destroyed || Math.hypot(pod.vx, pod.vy) >= BUILD_MAX_SPEED || input.idleMs < BUILD_IDLE_MS) return null;
  return BUILD;
};

/** The discovered, drill-less lode the pod is next to, if any. */
export function lodeNextToPod(app: AppController): Lode | null {
  const w = app.world;
  const f = w.factory;
  if (!f) return null;
  const px = Math.floor(w.pod.x);
  const pr = Math.floor(-w.pod.y);
  if (pr < 1) return null;
  for (const l of w.terrain.lodes) {
    if (!l.discovered || (l.scope === 'v1' && w.scope !== 'v1')) continue;
    // Lode block x0..x0+2 × top..top+1 plus its drill site above (rows top−2..top−1).
    const dx = px < l.x0 ? l.x0 - px : px > l.x0 + 2 ? px - l.x0 - 2 : 0;
    const dy = pr < l.top - 2 ? l.top - 2 - pr : pr > l.top + 1 ? pr - l.top - 1 : 0;
    if (Math.max(dx, dy) > LODE_REACH) continue;
    const drilled = f.entities().some((e) => e.kind === 'autoDrill' && e.y === l.top - 2 && e.x >= l.x0 && e.x <= l.x0 + 1);
    const ghosted = f.ghosts().some((g) => g.kind === 'autoDrill' && g.y === l.top - 2 && g.x >= l.x0 && g.x <= l.x0 + 1);
    if (!drilled && !ghosted) return l;
  }
  return null;
}

/** Priority 2: Place drill (03 §3.5: next to a discovered lode, Auto-Drill Kit carried). */
export function placeDrillContext(session: BuildSession): ContextProvider {
  return (app) => {
    if (!inScope('mvp') || app.state.mode.peek() !== 'play' || !app.world.factory?.isUnlocked('U2')) return null;
    if ((kitsInCargo(app.world.pod.cargo).autoDrill ?? 0) < 1) return null;
    const lode = lodeNextToPod(app);
    if (!lode) return null;
    return { priority: 2, id: 'placeDrill', label: 'Place drill', run: () => session.placeDrill(lode.id) };
  };
}

/** Register both providers; returns the unregister function. */
export function installBuildContext(session: BuildSession): () => void {
  const a = registerContextAction(buildContext);
  const b = registerContextAction(placeDrillContext(session));
  return () => {
    a();
    b();
  };
}
