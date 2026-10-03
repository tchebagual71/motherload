// Sign-tap auto-drive (01 §3.10; 03 §6.4; SIM-3, INT-10): with Pip grounded on the Rim, a sign tap drives it to
// that building's pad at full speed (normal burn) and brakes onto the pad's centre; the sheet opens on arrival,
// armed or not. Stick input, leaving the Rim (a hole, a hop) or any pause cancels it. The drive never runs Pip into
// a hole it cannot skim (01 §3.2: gap skim bridges 1-wide gaps only): a hole on the way refuses the drive, and one
// that opens mid-drive brakes Pip at its edge ('blocked'). Pure: no DOM; the app feeds it the pod after each step.
import { GAP_SKIM_VX, POD_W, RIM_BUILDINGS, VX_MAX, type RimBuildingId } from '../shared/canon';
import type { PodIntent, PodState } from '../pod/types';

export type DriveStatus = 'idle' | 'driving' | 'arrived' | 'blocked' | 'lost';

/** Does the Rim's top row (row 0) hold the pod up at column `c`? Solid ground, a factory occupant, the side frame. */
export type RimFloor = (c: number) => boolean;

/** Parked: this close to the pad's centre (tiles) and slower than ARRIVE_V (tiles/s). */
const ARRIVE_DX = 0.3;
const ARRIVE_V = 0.15;
/**
 * Planned braking (tiles/s²): below the drive's real deceleration (6.9 empty, ≈ 4.6 at a full t1 hover load,
 * 01 §3.2), so the pod brakes in time and stops on the pad instead of coasting through it (a coasting pod would
 * trip the pad's neutral-stick rule while still moving). Also the run-up acceleration a hole check counts on.
 */
const PLAN_DECEL = 3;
/** Stick per (tiles/s) of speed error. */
const GAIN = 2;
/** Rim end to end is ≈ 11 s (01 §3.2); a drive still going after this is stuck. */
const MAX_DRIVE_STEPS = 20 * 60;
const HALF_W = POD_W / 2;
/** Where a hole stop parks the pod: its leading edge this far short of the open cell (tiles). */
const HOLE_MARGIN = 0.1;
/** A 1-wide gap counts as skimmable only at this speed or more (GAP_SKIM_VX with a margin for a heavy pod). */
const SKIM_SAFE_V = GAP_SKIM_VX + 0.3;
/** Run-up a refused-looking 1-wide gap gets from the hole stop (back off, then cross): the pod width plus the margin. */
const RUN_UP = POD_W + HOLE_MARGIN;

/** Speed to hold `dx` tiles from the target: full speed, then the braking curve v = √(2·a·|dx|). */
export function approachSpeed(dx: number): number {
  return Math.sign(dx) * Math.min(VX_MAX, Math.sqrt(2 * PLAN_DECEL * Math.abs(dx)));
}

function padOf(id: RimBuildingId): (typeof RIM_BUILDINGS)[number] {
  const b = RIM_BUILDINGS.find((p) => p.id === id);
  if (!b) throw new Error(`no Rim building ${id}`);
  return b;
}

/** The pad's centre x, where a drive parks. */
export function padCentre(id: RimBuildingId): number {
  const b = padOf(id);
  return (b.x0 + b.x1 + 1) / 2;
}

/**
 * The first hole between the pod (centre `x`, speed `vx`) and `targetX` that would swallow it, as the centre x
 * where the pod must stop short of it; null when the road is clear. A run of ≥ 2 open cells always swallows the pod.
 * A 1-wide gap is skimmed (01 §3.2) when the drive crosses it at ≥ SKIM_SAFE_V: reachable from the current speed (or,
 * with `runUp`, from a standing start at the hole stop) and not yet braking for the pad.
 */
export function holeStop(x: number, vx: number, targetX: number, floor: RimFloor, runUp = false): number | null {
  const dir = Math.sign(targetX - x);
  if (dir === 0) return null;
  // Columns the pod's leading edge sweeps on the way: from the one under its centre to the target's leading column.
  const first = Math.floor(x);
  const last = dir > 0 ? Math.ceil(targetX + HALF_W) - 1 : Math.floor(targetX - HALF_W);
  const v0 = Math.sign(vx) === dir ? Math.abs(vx) : 0;
  for (let c = first; dir > 0 ? c <= last : c >= last; c += dir) {
    if (floor(c)) continue;
    // An open run starts at c (the cell before it is solid, or is the pod's own column): is it 1 wide?
    const narrow = floor(c + dir) && (c !== first || floor(c - dir));
    if (narrow) {
      // The pod is held up by neither side only while its centre is within [c + HALF_W, c + 1 − HALF_W].
      const entry = dir > 0 ? c + HALF_W : c + 1 - HALF_W;
      const exit = dir > 0 ? c + 1 - HALF_W : c + HALF_W;
      let d = (entry - x) * dir;
      if (runUp) d = Math.max(d, RUN_UP);
      const reach = Math.sqrt(v0 * v0 + 2 * PLAN_DECEL * Math.max(0, d));
      const brake = Math.abs(approachSpeed(targetX - exit));
      if (Math.min(reach, brake, VX_MAX) >= SKIM_SAFE_V) continue;
    }
    return dir > 0 ? c - HALF_W - HOLE_MARGIN : c + 1 + HALF_W + HOLE_MARGIN;
  }
  return null;
}

export class AutoDrive {
  private target: RimBuildingId | null = null;
  private steps = 0;

  /** `floor`: the Rim's row 0 (null: no hole checks, e.g. a headless test of the braking curve). */
  constructor(private readonly floor: RimFloor | null = null) {}

  get active(): boolean {
    return this.target !== null;
  }

  get destination(): RimBuildingId | null {
    return this.target;
  }

  /**
   * Start a drive from the pod's current spot: 'driving', or 'blocked' (and no drive) when a hole Pip cannot skim
   * lies between it and the pad.
   */
  start(id: RimBuildingId, pod?: Readonly<PodState>): 'driving' | 'blocked' {
    if (pod && this.floor && holeStop(pod.x, pod.vx, padCentre(id), this.floor, true) !== null) {
      this.target = null;
      return 'blocked';
    }
    this.target = id;
    this.steps = 0;
    return 'driving';
  }

  cancel(): void {
    this.target = null;
  }

  /**
   * One step: writes the drive intent into `out` while 'driving'. 'arrived' (parked on the pad), 'blocked' (parked
   * at the edge of a hole that opened on the way) and 'lost' (no longer on the Rim, or stuck) end the drive.
   */
  step(pod: Readonly<PodState>, onRim: boolean, out: PodIntent): DriveStatus {
    const id = this.target;
    if (id === null) return 'idle';
    if (!onRim || ++this.steps > MAX_DRIVE_STEPS) {
      this.target = null;
      return 'lost';
    }
    const pad = padCentre(id);
    const stop = this.floor ? holeStop(pod.x, pod.vx, pad, this.floor) : null;
    const dx = (stop ?? pad) - pod.x;
    if (Math.abs(dx) < ARRIVE_DX && Math.abs(pod.vx) < ARRIVE_V) {
      this.target = null;
      return stop === null ? 'arrived' : 'blocked';
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
