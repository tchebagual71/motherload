// Sign-tap auto-drive (01 §3.10; 03 §6.4; SIM-3, INT-10): with Pip grounded on the Rim, a sign tap drives it to
// that building's pad at full speed (normal burn) and brakes onto the pad's centre; the sheet opens on arrival,
// armed or not. Stick input, leaving the Rim (a hole, a hop) or any pause cancels it. Pure: no DOM; the app
// feeds it the pod after each step.
import { RIM_BUILDINGS, VX_MAX, type RimBuildingId } from '../shared/canon';
import type { PodIntent, PodState } from '../pod/types';

export type DriveStatus = 'idle' | 'driving' | 'arrived' | 'lost';

/** Parked: this close to the pad's centre (tiles) and slower than ARRIVE_V (tiles/s). */
const ARRIVE_DX = 0.3;
const ARRIVE_V = 0.15;
/**
 * Planned braking (tiles/s²): below the drive's real deceleration (6.9 empty, ≈ 4.6 at a full t1 hover load,
 * 01 §3.2), so the pod brakes in time and stops on the pad instead of coasting through it (a coasting pod would
 * trip the pad's neutral-stick rule while still moving).
 */
const PLAN_DECEL = 3;
/** Stick per (tiles/s) of speed error. */
const GAIN = 2;
/** Rim end to end is ≈ 11 s (01 §3.2); a drive still going after this is stuck. */
const MAX_DRIVE_STEPS = 20 * 60;

/** Speed to hold `dx` tiles from the target: full speed, then the braking curve v = √(2·a·|dx|). */
export function approachSpeed(dx: number): number {
  return Math.sign(dx) * Math.min(VX_MAX, Math.sqrt(2 * PLAN_DECEL * Math.abs(dx)));
}

function padOf(id: RimBuildingId): (typeof RIM_BUILDINGS)[number] {
  const b = RIM_BUILDINGS.find((p) => p.id === id);
  if (!b) throw new Error(`no Rim building ${id}`);
  return b;
}

export class AutoDrive {
  private target: RimBuildingId | null = null;
  private steps = 0;

  get active(): boolean {
    return this.target !== null;
  }

  get destination(): RimBuildingId | null {
    return this.target;
  }

  start(id: RimBuildingId): void {
    this.target = id;
    this.steps = 0;
  }

  cancel(): void {
    this.target = null;
  }

  /**
   * One step: writes the drive intent into `out` while 'driving'. 'arrived' (parked on the pad) and 'lost'
   * (no longer on the Rim) end the drive.
   */
  step(pod: Readonly<PodState>, onRim: boolean, out: PodIntent): DriveStatus {
    const id = this.target;
    if (id === null) return 'idle';
    if (!onRim || ++this.steps > MAX_DRIVE_STEPS) {
      this.target = null;
      return 'lost';
    }
    const b = padOf(id);
    const dx = (b.x0 + b.x1 + 1) / 2 - pod.x;
    if (Math.abs(dx) < ARRIVE_DX && Math.abs(pod.vx) < ARRIVE_V) {
      this.target = null;
      return 'arrived';
    }
    const want = approachSpeed(dx);
    // Cruise with the stick pinned (v_x clamps at VX_MAX): a zero push would read as a neutral stick, and passing
    // pads would open (canon §2.4 pad rule).
    const sx = Math.abs(want) >= VX_MAX ? Math.sign(want) : (want - pod.vx) * GAIN;
    out.sx = sx < -1 ? -1 : sx > 1 ? 1 : sx;
    out.sy = 0;
    out.thrust = false;
    out.digEngage = undefined;
    return 'driving';
  }
}
