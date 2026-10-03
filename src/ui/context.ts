// Context button actions (03 §3.5): one button over the slot cluster shows the most urgent action that applies,
// hidden when none does. Priorities: 0 Cargo (TOO HEAVY, or ≤ 5 s after "Bay full"); 1 Realign (v1); 2 Place
// drill; 3 BUILD. This module owns priority 0; the build wave registers 2 and 3 with registerContextAction().
import type { AppController } from '../app/types';
import { inScope } from '../config/scope';

/** 03 §3.5: the Cargo context stays this long after a "Bay full". */
export const BAY_FULL_CONTEXT_MS = 5_000;

export interface ContextAction {
  /** 03 §3.5 priority: lower wins (0 Cargo, 1 Realign, 2 Place drill, 3 BUILD). */
  priority: number;
  /** Stable id (tests, analytics, the button's key). */
  id: string;
  /** Button label, ≤ 12 characters at size S. */
  label: string;
  run(app: AppController): void;
}

export interface ContextInput {
  /** performance.now(). */
  now: number;
  /** ms since the last stick, key or THRUST input (03 §3.5 BUILD: "no stick for 0.6 s"). */
  idleMs: number;
}

/** Returns the action this provider offers right now, or null. Called ≤ 10 Hz; keep it cheap. */
export type ContextProvider = (app: AppController, input: ContextInput) => ContextAction | null;

const CARGO: ContextAction = { priority: 0, id: 'cargo', label: 'Cargo', run: (app) => app.openSheet('cargo') };

/** Priority 0 (03 §3.5; 01 §3.7): TOO HEAVY, or within 5 s of "Bay full". */
export const cargoContext: ContextProvider = (app, input) => {
  if (!inScope('mvp')) return null;
  const s = app.world.stats();
  const heavy = s.cargoMass > s.hoverCap;
  const bayFull = input.now - app.state.bayFullAt.peek() <= BAY_FULL_CONTEXT_MS;
  return heavy || bayFull ? CARGO : null;
};

const providers: ContextProvider[] = [cargoContext];

/** Add a provider (the build wave: Place drill, BUILD). Returns a function that removes it. */
export function registerContextAction(p: ContextProvider): () => void {
  providers.push(p);
  return () => {
    const i = providers.indexOf(p);
    if (i >= 0) providers.splice(i, 1);
  };
}

/** The action the button shows: the lowest priority number among the providers that offer one. */
export function pickContextAction(app: AppController, input: ContextInput): ContextAction | null {
  let best: ContextAction | null = null;
  for (const p of providers) {
    const a = p(app, input);
    if (a && (!best || a.priority < best.priority)) best = a;
  }
  return best;
}

/** Keyboard E (03 §3.7) and the button's tap. Returns true when an action ran. */
export function runContextAction(app: AppController, input: ContextInput): boolean {
  if (app.state.sheet.peek() !== null || app.state.overlay.peek() !== null) return false;
  const a = pickContextAction(app, input);
  a?.run(app);
  return a !== null;
}
