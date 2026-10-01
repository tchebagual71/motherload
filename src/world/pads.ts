// Rim pad arming (canon §2.4, §3.12 touch table; 03 §6.4). PURE MODULE.
// A pad is armed while the pod is grounded on the Rim with its centre inside the pad's x range and the
// pad is not latched. Stick neutral for PAD_NEUTRAL_STEPS on an armed pad fires 'pad-arrive' and latches
// it (the sheet opens). A latch clears only once the pod fully leaves the pad's x range or has been
// airborne ≥ PAD_REARM_AIRBORNE_STEPS, so closing a sheet never re-opens it. Respawn, the Homing Beacon
// and sheetClosed() latch a pad directly.
import { PAD_NEUTRAL_STEPS, PAD_REARM_AIRBORNE_STEPS, POD_W, RIM_BUILDINGS } from '../shared/canon';
import type { PodIntent, PodState } from '../pod/types';
import type { RimBuildingId } from '../shared/types';
import type { PadSnapshot } from '../save/codec';

const HALF_W = POD_W / 2;
/** Stick output is exactly 0 inside the input dead zone; this only absorbs float noise. */
const NEUTRAL_EPS = 0.05;

export const PAD_COUNT = RIM_BUILDINGS.length;
export const PUMP_PAD = RIM_BUILDINGS.findIndex((b) => b.id === 'pump');

export function padIndexOf(id: RimBuildingId): number {
  return RIM_BUILDINGS.findIndex((b) => b.id === id);
}

/** Pad whose x range [x0, x1 + 1) holds the pod centre, or −1. */
export function padIndexAt(x: number): number {
  for (let i = 0; i < PAD_COUNT; i++) {
    const b = RIM_BUILDINGS[i];
    if (x >= b.x0 && x < b.x1 + 1) return i;
  }
  return -1;
}

/** Does any part of the pod's footprint overlap pad i's x range? */
function overlapsPad(x: number, i: number): boolean {
  const b = RIM_BUILDINGS[i];
  return x + HALF_W > b.x0 && x - HALF_W < b.x1 + 1;
}

/** Grounded on the Rim: standing on row 0's top face (y = 0), never in a hole or the sky. */
export function isOnRim(pod: Readonly<PodState>): boolean {
  return pod.grounded && pod.y > 0;
}

export function isNeutral(intent: PodIntent): boolean {
  return !intent.thrust && Math.abs(intent.sx) < NEUTRAL_EPS && Math.abs(intent.sy) < NEUTRAL_EPS;
}

export class PadArming {
  readonly latched: boolean[];
  /** Consecutive neutral steps on the current armed pad. */
  neutralSteps: number;

  constructor(snapshot?: PadSnapshot) {
    this.latched = RIM_BUILDINGS.map((_, i) => snapshot?.latched[i] ?? false);
    this.neutralSteps = snapshot?.neutralSteps ?? 0;
  }

  snapshot(): PadSnapshot {
    return { latched: this.latched.slice(), neutralSteps: this.neutralSteps };
  }

  /** Disarm pad i until the pod leaves it (sheet closed, respawn, Homing Beacon). */
  latch(i: number): void {
    if (i < 0 || i >= PAD_COUNT) return;
    this.latched[i] = true;
    this.neutralSteps = 0;
  }

  isArmed(pod: Readonly<PodState>, i: number): boolean {
    return isOnRim(pod) && padIndexAt(pod.x) === i && !this.latched[i];
  }

  /** One running pod step. Returns the index of the pad that fires 'pad-arrive', or −1. */
  step(pod: Readonly<PodState>, neutral: boolean): number {
    const flown = pod.airSteps >= PAD_REARM_AIRBORNE_STEPS;
    for (let i = 0; i < PAD_COUNT; i++) {
      if (this.latched[i] && (flown || !overlapsPad(pod.x, i))) this.latched[i] = false;
    }
    const pad = isOnRim(pod) ? padIndexAt(pod.x) : -1;
    if (pad < 0 || this.latched[pad] || !neutral) {
      this.neutralSteps = 0;
      return -1;
    }
    if (++this.neutralSteps < PAD_NEUTRAL_STEPS) return -1;
    this.latch(pad);
    return pad;
  }
}
