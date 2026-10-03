// Economy bot (04 §11.2): the hands. Turns a planned cell path into stick intents for the real pod, one 60 Hz step
// at a time: drill presses, braked falls, climbs, hovering side-steps and parking on Rim pads. Everything a thumb
// could do through PodIntent; nothing is teleported.
import { AIR_DRAG, DIG_STICK_MIN, G, HORIZONTAL_THRUST_FRAC, STEP, THRUST_STICK_DEADZONE } from '../../src/shared/canon';
import { NO_INTENT, type PodIntent, type PodState } from '../../src/pod/types';
import { cargoMass, classifyDigTarget, digDirOf, nextSector, thrustAccel } from '../../src/pod';
import { engineOf } from '../../src/pod/stats';
import type { Cell, MineView } from './nav';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Pod half height (POD_H / 2): its centre stands this far above a floor. */
const HALF_H = 0.39;
/** Vertical position gain (1/s) and horizontal gain for the PD loops. */
const KY = 3;
const KX = 3;

/** 'blocked': the next cell to drill turned out undrillable once seen (Magma, Hardrock, a lode): plan again. */
export type MoveStatus = 'moving' | 'arrived' | 'lost' | 'stuck' | 'blocked';

/** The pod's cell: x column and row r (−1 above the Rim). While drilling, the cell it is drilling into. */
export function podCell(pod: Readonly<PodState>): Cell {
  if (pod.dig) return { x: pod.dig.x, r: pod.dig.r };
  const r = Math.floor(-pod.y);
  return { x: Math.min(47, Math.max(0, Math.floor(pod.x))), r: r < -1 ? -1 : r };
}

export const same = (a: Cell, b: Cell): boolean => a.x === b.x && a.r === b.r;

/** Pod centre height when standing in row r. */
const standY = (r: number): number => -(r + 1) + HALF_H;
/** Pod centre height when hovering in the middle of row r (the Rim level hovers a little above the turf). */
const hoverY = (r: number): number => (r < 0 ? 0.55 : -(r + 0.5));

export interface PilotTuning {
  /** Landing speed aimed for (tiles/s); hard landings hurt from 5.88. */
  brakeV: number;
  /** Top speed of a long fall down an open shaft, braked in time for the landing (tiles/s). */
  fallV: number;
  /** Ground driving top speed (tiles/s). */
  driveV: number;
}

/**
 * Follows a cell path. `stepIntent()` returns the next intent and keeps the move bookkeeping; the caller steps
 * the World with it and calls `status()` afterwards.
 */
export class PathFollower {
  path: Cell[] = [];
  idx = 0;
  /** Steps spent on the current move (target cell). */
  moveSteps = 0;
  /** Steps since the path was set. */
  totalSteps = 0;
  private lastIdx = -1;

  constructor(
    readonly pod: PodState,
    readonly view: MineView,
    readonly tune: PilotTuning,
  ) {}

  set(path: Cell[]): void {
    this.path = path;
    this.idx = 0;
    this.moveSteps = 0;
    this.totalSteps = 0;
    this.lastIdx = -1;
  }

  get goal(): Cell | null {
    return this.path.length > 0 ? this.path[this.path.length - 1] : null;
  }

  /** Re-anchor on the path (the pod may skip cells while falling); false when it has left the path. */
  private locate(): boolean {
    const cur = podCell(this.pod);
    for (let k = Math.min(this.path.length - 1, this.idx + 6); k >= this.idx; k--) {
      if (same(this.path[k], cur)) {
        this.idx = k;
        return true;
      }
    }
    return false;
  }

  status(): MoveStatus {
    if (this.path.length === 0) return 'arrived';
    if (!this.locate()) return 'lost';
    if (this.idx !== this.lastIdx) {
      this.lastIdx = this.idx;
      this.moveSteps = 0;
    }
    if (this.idx === this.path.length - 1 && this.settled()) return 'arrived';
    // The plan went through cells the pod had not seen; one it is about to drill may show as a pocket now.
    const next = this.path[this.idx + 1];
    if (next && !this.pod.dig && !this.view.open(next.x, next.r) && !this.view.diggable(next.x, next.r)) return 'blocked';
    if (this.moveSteps > 420) return 'stuck';
    return 'moving';
  }

  /** At rest in the goal cell: no dig, grounded and slow, or hovering steadily over a drop. */
  private settled(): boolean {
    const p = this.pod;
    if (p.dig) return false;
    const g = this.path[this.path.length - 1];
    if (p.grounded) return Math.abs(p.vx) < 0.4 && Math.abs(p.x - (g.x + 0.5)) < 0.35;
    return !this.view.supported(g.x, g.r) && Math.abs(p.vy) < 0.6 && Math.abs(p.vx) < 0.6;
  }

  stepIntent(): PodIntent {
    this.moveSteps++;
    this.totalSteps++;
    const i = this.idx;
    const cur = this.path[i];
    const target = this.path[i + 1];
    if (!cur) return NO_INTENT;
    if (!target) return this.park(cur);
    return this.moveIntent(cur, target, this.path[i + 2] ?? null);
  }

  // ---------------------------------------------------------------- control laws

  private accel(): number {
    const p = this.pod;
    return thrustAccel(engineOf(p.tiers.engine).cap, cargoMass(p.cargo));
  }

  /** Stick y for a desired vertical speed next step (deadbeat on velocity), 0 when gravity alone does it. */
  private syForVy(vdes: number): number {
    const p = this.pod;
    const s = clamp(((vdes / AIR_DRAG - p.vy) / STEP + G) / this.accel(), 0, 1);
    return s <= 0 ? 0 : THRUST_STICK_DEADZONE + (1 - THRUST_STICK_DEADZONE) * s;
  }

  /** Hold height ty (PD on position through the velocity loop). */
  private syToHold(ty: number, vmax = 3): number {
    return this.syForVy(clamp(KY * (ty - this.pod.y), -vmax, vmax));
  }

  /** Stick x toward column centre tx at up to vmax. */
  private sxToward(tx: number, vmax: number): number {
    const p = this.pod;
    const vdes = clamp(KX * (tx - p.x), -vmax, vmax);
    const a = HORIZONTAL_THRUST_FRAC * this.accel() * STEP;
    const dv = p.grounded ? vdes - p.vx : vdes / AIR_DRAG - p.vx;
    return clamp(dv / a, -1, 1);
  }

  /** Free fall toward column tx, braking to brakeV. */
  private fall(tx: number): PodIntent {
    const p = this.pod;
    const vb = this.tune.brakeV;
    const sy = p.vy < -vb ? this.syForVy(-vb * 0.8) : 0;
    return this.guard({ sx: this.sxToward(tx, 1.5), sy, thrust: false, fireSlot: -1 });
  }

  /** Stop and stay in `c`: stand on its floor, or hover there over a drop. */
  private park(c: Cell): PodIntent {
    const p = this.pod;
    const tx = c.x + 0.5;
    if (this.view.supported(c.x, c.r)) {
      // Above the floor: drop onto it (braked); on it: brake to the centre with the stick under the dig threshold.
      if (!p.grounded) return p.y > standY(c.r) + 0.05 ? this.fall(tx) : this.guard({ sx: this.sxToward(tx, 1.5), sy: 0, thrust: false, fireSlot: -1 });
      const sx = this.sxToward(tx, 1.2);
      return this.guard({ sx: Math.abs(tx - p.x) < 0.05 && Math.abs(p.vx) < 0.05 ? 0 : sx, sy: 0, thrust: false, fireSlot: -1 });
    }
    return this.guard({ sx: this.sxToward(tx, 1.5), sy: this.syToHold(hoverY(c.r)), thrust: false, fireSlot: -1 });
  }

  private moveIntent(cur: Cell, t: Cell, after: Cell | null): PodIntent {
    const p = this.pod;
    const v = this.view;
    const dx = t.x - cur.x;
    const dr = t.r - cur.r;
    const open = v.open(t.x, t.r);
    const tx = t.x + 0.5;
    if (dr > 0) {
      // ---- down
      if (!open) {
        // Drill the floor: stand on it and push down (the drill centres the pod itself).
        if (p.dig) return this.digPush('down');
        if (!p.grounded) return this.fall(cur.x + 0.5);
        return { sx: 0, sy: -1, thrust: false, fireSlot: -1 };
      }
      if (p.grounded && p.y > standY(t.r) + 0.3) return { sx: 0, sy: -1, thrust: false, fireSlot: -1 }; // drop in
      // Fall to the end of this vertical run: fast down the shaft, braking in time to land at brakeV on its floor
      // or to stop and hover there.
      const end = this.runEnd(1);
      const brake = Math.max(0.5, this.accel() - G) * 0.55;
      const lands = v.supported(end.x, end.r);
      const d = Math.max(0, p.y - (lands ? standY(end.r) : hoverY(end.r)));
      const vb = this.tune.brakeV;
      const vdes = lands ? -Math.min(this.tune.fallV, Math.sqrt(vb * vb + 2 * brake * d)) : -Math.min(this.tune.fallV, KY * d, Math.sqrt(2 * brake * d));
      return this.guard({ sx: this.sxToward(tx, 1.5), sy: p.vy < vdes ? this.syForVy(vdes) : 0, thrust: false, fireSlot: -1 });
    }
    if (dr < 0) {
      // ---- up (open cells only): climb hard, coasting in time to stop where the run turns (no overshoot).
      const end = this.runEnd(-1);
      const d = hoverY(end.r) - p.y;
      const vUp = engineOf(p.tiers.engine).vUp;
      const vdes = Math.min(vUp, KY * Math.max(0, d) + 0.2, Math.sqrt(2 * 0.7 * G * Math.max(0, d)) + 0.2);
      const sx = clamp(this.sxToward(cur.x + 0.5, 2), -0.3, 0.3);
      const sy = this.syForVy(vdes);
      if (sy >= 0.999) return { sx: p.grounded ? 0 : sx, sy: 0, thrust: true, fireSlot: -1 };
      return this.guard({ sx: p.grounded ? 0 : sx, sy, thrust: false, fireSlot: -1 });
    }
    // ---- sideways
    if (!open) {
      if (p.dig) return this.digPush(dx > 0 ? 'right' : 'left');
      if (!p.grounded) return v.supported(cur.x, cur.r) ? this.fall(cur.x + 0.5) : this.guard({ sx: 0, sy: this.syToHold(standY(cur.r)), thrust: false, fireSlot: -1 });
      return { sx: dx, sy: 0, thrust: false, fireSlot: -1 };
    }
    const curStand = v.supported(cur.x, cur.r);
    const tStand = v.supported(t.x, t.r);
    const dropNext = after !== null && after.r > t.r && after.x === t.x;
    if (curStand && (tStand || dropNext) && (p.grounded || p.y < standY(cur.r) + 0.2)) {
      // Drive along the floor; slow over a hole we mean to drop into (no gap skim).
      const fast = tStand && after !== null && after.r === t.r;
      const vmax = dropNext ? 1.2 : fast ? this.tune.driveV : Math.min(this.tune.driveV, 2.5);
      const target = fast ? t.x + 0.5 + Math.sign(dx) * 0.5 : tx;
      return this.guard({ sx: this.sxToward(target, vmax), sy: 0, thrust: false, fireSlot: -1 });
    }
    // Fly across: hold the row, then slide over.
    const ty = hoverY(cur.r);
    const aligned = Math.abs(p.y - ty) < 0.12 || (cur.r < 0 && p.y > 0.2);
    return this.guard({ sx: aligned ? this.sxToward(tx, 2) : this.sxToward(cur.x + 0.5, 0.5), sy: this.syToHold(ty), thrust: false, fireSlot: -1 });
  }

  /** Last cell of the straight vertical run (dir +1 down, −1 up) the path is on from the current move. */
  private runEnd(dir: 1 | -1): Cell {
    let k = this.idx + 1;
    while (k + 1 < this.path.length) {
      const a = this.path[k];
      const b = this.path[k + 1];
      if (b.x !== a.x || b.r - a.r !== dir || !this.view.open(b.x, b.r)) break;
      k++;
    }
    return this.path[Math.min(k, this.path.length - 1)];
  }

  /** While a dig runs, hold the push for the next move so a straight run of digs chains (canon §3.6). */
  private digPush(dir: 'down' | 'left' | 'right'): PodIntent {
    const i = this.idx;
    const next = this.path[i + 2];
    const t = this.path[i + 1];
    if (!next || !t) return NO_INTENT;
    const ndx = next.x - t.x;
    const ndr = next.r - t.r;
    const nOpen = this.view.open(next.x, next.r);
    if (nOpen) return NO_INTENT;
    if (ndr > 0 && dir === 'down') return { sx: 0, sy: -1, thrust: false, fireSlot: -1 };
    if (ndr === 0 && ndx !== 0 && dir !== 'down' && (ndx > 0) === (dir === 'right')) return { sx: ndx, sy: 0, thrust: false, fireSlot: -1 };
    return NO_INTENT;
  }

  /**
   * Never drill by accident: a grounded pod whose stick would engage a dig into a drillable neighbour gets its
   * stick shortened under the dig threshold (canon §3.6: m′ ≥ 0.45). Thrusting intents are left alone.
   */
  private guard(it: PodIntent): PodIntent {
    const p = this.pod;
    if (!p.grounded || it.thrust) return it;
    const s = nextSector(it.sx, it.sy, p.sector);
    const dir = digDirOf(s);
    const m = Math.sqrt(it.sx * it.sx + it.sy * it.sy);
    if (!dir || m < DIG_STICK_MIN) return it;
    if (dir === 'down' && it.sy > -0.01) return it;
    const x = Math.floor(p.x);
    const r = Math.floor(-p.y);
    const tx = dir === 'down' ? x : x + (dir === 'right' ? 1 : -1);
    const tr = dir === 'down' ? r + 1 : r;
    if (classifyDigTarget(this.view.grid, tx, tr, this.view.floor, this.view.scope) === 'open') return it;
    const k = (DIG_STICK_MIN * 0.95) / m;
    return { ...it, sx: it.sx * k, sy: it.sy * k };
  }
}
