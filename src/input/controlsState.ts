// Tiny shared state between input/ (writer) and ui/ (control-zone visuals). One instance per page.
// The stick snapshot is a mutable object bumped through `stickVersion`, so pointermove allocates nothing;
// the UI subscribes to the version and writes transforms straight to the DOM.
import { signal, type Signal } from '@preact/signals';
import type { Sector } from '../pod/types';

export interface StickView {
  active: boolean;
  baseX: number;
  baseY: number;
  knobX: number;
  knobY: number;
  radius: number;
  /** Output magnitude m′ in [0, 1]. */
  magnitude: number;
  /** Sector the push acts in (visual only; the pod keeps the authoritative one). */
  sector: Sector;
}

export interface ControlsState {
  readonly stick: StickView;
  readonly stickVersion: Signal<number>;
  readonly thrustHeld: Signal<boolean>;
  /** Quick slot currently held down (-1 = none), for the pressed look. */
  readonly pressedSlot: Signal<number>;
  /** Refused press feedback (shake): bumps `serial` each time so repeats retrigger. */
  readonly denied: Signal<{ slot: number; serial: number }>;
}

export function createControlsState(): ControlsState {
  return {
    stick: { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0, radius: 52, magnitude: 0, sector: 'none' },
    stickVersion: signal(0),
    thrustHeld: signal(false),
    pressedSlot: signal(-1),
    denied: signal({ slot: -1, serial: 0 }),
  };
}

/** The page's controls state (input writes, UI reads). */
export const controls: ControlsState = createControlsState();
