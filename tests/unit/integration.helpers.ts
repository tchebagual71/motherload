// A scripted pilot for whole-World scenarios: drives the real pod with intents (no teleports) through
// World.step, collecting every event. Used by the integration and determinism suites.
import { approachSpeed } from '../../src/app/autoDrive';
import { NO_INTENT, type PodIntent } from '../../src/pod/types';
import { RIM_BUILDINGS, VX_MAX, type RimBuildingId } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import { T } from '../../src/shared/types';
import { World } from '../../src/world/world';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class Pilot {
  readonly events: GameEvent[] = [];
  constructor(readonly w: World) {}

  get pod() {
    return this.w.pod;
  }
  /** The pod's cell (row −1 above the Rim). */
  cell(): { x: number; r: number } {
    return { x: Math.floor(this.pod.x), r: Math.floor(-this.pod.y) };
  }

  /** One World step; drained events are kept. */
  step(intent: PodIntent = NO_INTENT, running = true): void {
    this.w.step(intent, running);
    const ev = this.w.drainEvents();
    for (const e of ev) this.events.push(e);
  }

  run(n: number, intent: PodIntent = NO_INTENT, running = true): void {
    for (let i = 0; i < n; i++) this.step(intent, running);
  }

  /** Step with `drive()` until `done()`; throws after `max` steps naming `what`. */
  until(what: string, drive: () => PodIntent, done: () => boolean, max = 6_000): void {
    for (let i = 0; i < max; i++) {
      if (done()) return;
      if (this.pod.destroyed) throw new Error(`${what}: the pod was destroyed (${this.where()})`);
      this.step(drive());
    }
    if (done()) return;
    throw new Error(`${what}: not done in ${max} steps (${this.where()})`);
  }

  where(): string {
    const p = this.pod;
    return `x ${p.x.toFixed(2)} y ${p.y.toFixed(2)} vx ${p.vx.toFixed(2)} vy ${p.vy.toFixed(2)} grounded ${p.grounded} fuel ${p.fuel.toFixed(1)} hull ${p.hull.toFixed(1)}`;
  }

  count(t: GameEvent['t']): number {
    let n = 0;
    for (const e of this.events) if (e.t === t) n++;
    return n;
  }

  // ------------------------------------------------------------------ manoeuvres

  /** Drive along the Rim and park on column centre x + 0.5 (the 01 §3.10 auto-drive curve). */
  driveRimTo(x: number): void {
    const target = x + 0.5;
    this.until(
      `drive to x ${x}`,
      () => {
        const want = approachSpeed(target - this.pod.x);
        const sx = Math.abs(want) >= VX_MAX ? Math.sign(want) : (want - this.pod.vx) * 2;
        return { ...NO_INTENT, sx: clamp(sx, -1, 1) };
      },
      () => this.pod.grounded && Math.abs(target - this.pod.x) < 0.3 && Math.abs(this.pod.vx) < 0.15,
    );
    this.run(4);
  }

  driveToPad(id: RimBuildingId): void {
    const b = RIM_BUILDINGS.find((p) => p.id === id)!;
    this.driveRimTo(Math.floor((b.x0 + b.x1 + 1) / 2));
  }

  /** Drop into the 1-wide shaft at column c from the Rim and brake down to its floor. */
  descendShaft(c: number, bottom: number): void {
    this.driveRimToHole(c);
    this.until(
      `descend shaft ${c}`,
      () => ({ ...NO_INTENT, thrust: this.pod.vy < -3.5, sx: clamp((c + 0.5 - this.pod.x) * 0.8, -0.3, 0.3) }),
      () => this.pod.grounded && this.cell().r >= bottom && this.pod.dig === null,
    );
    this.run(10);
  }

  /** Creep onto the shaft mouth slowly enough that gap skim lets the pod drop in (01 §3.2). */
  private driveRimToHole(c: number): void {
    const target = c + 0.5;
    this.until(
      `reach the mouth of ${c}`,
      () => {
        const dx = target - this.pod.x;
        const want = Math.abs(dx) > 3 ? Math.sign(dx) * VX_MAX : dx * 0.8;
        return { ...NO_INTENT, sx: clamp((want - this.pod.vx) * 2, -1, 1) };
      },
      () => this.pod.y < -0.6,
    );
  }

  /** Fly straight up a shaft, out over the Rim, then across and down onto the Rim near column `landX`. */
  flyOut(c: number, landX: number): void {
    this.until(
      'climb the shaft',
      () => ({ ...NO_INTENT, thrust: true, sx: clamp((c + 0.5 - this.pod.x) * 0.8, -0.3, 0.3) }),
      () => this.pod.y > 1.2,
    );
    this.until(
      `cross to x ${landX}`,
      () => ({ ...NO_INTENT, thrust: this.pod.y < 2.2 || this.pod.vy < -1, sx: clamp((landX + 0.5 - this.pod.x) * 0.6, -1, 1) }),
      () => Math.abs(landX + 0.5 - this.pod.x) < 1.5,
    );
    this.until('land on the Rim', () => ({ ...NO_INTENT, thrust: this.pod.vy < -2.5 }), () => this.pod.grounded && this.pod.y > 0);
    this.driveRimTo(landX);
  }

  /** One dig in `dir` (or a move into open air), ending still on the new cell's centre. */
  dig(dir: 'down' | 'left' | 'right'): void {
    const start = this.cell();
    const tx = dir === 'down' ? start.x : start.x + (dir === 'right' ? 1 : -1);
    const push: PodIntent = dir === 'down' ? { ...NO_INTENT, sy: -1 } : { ...NO_INTENT, sx: dir === 'right' ? 1 : -1 };
    const open = this.w.terrain.get(tx, dir === 'down' ? start.r + 1 : start.r) === T.AIR;
    const refusals = this.count('dig-refused');
    // Once the pod is in the target column (or its dig started), stop pushing: a drop through the new cell
    // must not carry the push on into the next one.
    let reached = false;
    this.until(
      `dig ${dir} from ${start.x},${start.r}`,
      () => {
        if (this.count('dig-refused') > refusals) throw new Error(`dig ${dir} refused at ${start.x},${start.r}: ${JSON.stringify(this.events.filter((e) => e.t === 'dig-refused').at(-1))}`);
        if (this.pod.dig || this.cell().x === tx) reached = reached || dir !== 'down' || this.pod.dig !== null;
        if (!this.pod.grounded && this.pod.vy < -4) return { ...NO_INTENT, thrust: true }; // brake cavern drops
        return this.pod.dig || reached || (open && this.cell().x === tx) ? NO_INTENT : push;
      },
      () => this.pod.dig === null && this.pod.grounded && (dir === 'down' ? this.cell().r > start.r : this.cell().x === tx),
      1_200,
    );
    this.settle();
  }

  /** Brake to a stop on the current column's centre (stick below the dig threshold). */
  settle(): void {
    const cx = this.cell().x + 0.5;
    this.until(
      'settle',
      () => ({ ...NO_INTENT, sx: clamp((cx - this.pod.x) * 2 - this.pod.vx, -0.4, 0.4) }),
      () => this.pod.grounded && this.pod.dig === null && Math.abs(cx - this.pod.x) < 0.2 && Math.abs(this.pod.vx) < 0.1,
      1_200,
    );
  }

  /** Dig straight down until the pod stands in `row` or deeper. */
  digDownTo(row: number): void {
    while (this.cell().r < row) this.dig('down');
  }

  /** Move or dig sideways until the pod's column is `x` (same row). */
  walkTo(x: number): void {
    while (this.cell().x !== x) this.dig(this.cell().x < x ? 'right' : 'left');
  }
}

/** Steps until `done` (podRunning true, no input); returns the steps taken. */
export function runUntil(p: Pilot, what: string, done: () => boolean, max: number): number {
  for (let i = 0; i < max; i++) {
    if (done()) return i;
    p.step();
  }
  if (done()) return max;
  throw new Error(`${what}: not done in ${max} steps`);
}

/** Carve the 2×2 drill site (02 §2.4) from above, the 01 §2.5 way: down, sideways, down, back. */
export function excavateDrillSite(p: Pilot, x0: number, top: number): void {
  const g = p.w.terrain;
  const solid = (x: number, r: number): boolean => g.get(x, r) !== T.AIR;
  const remaining = (): boolean => solid(x0, top) || solid(x0 + 1, top) || solid(x0, top + 1) || solid(x0 + 1, top + 1);
  for (let guard = 0; guard < 12 && remaining(); guard++) {
    const { x, r } = p.cell();
    if (x !== x0 && x !== x0 + 1) throw new Error(`drill site: pod in column ${x}, not ${x0}–${x0 + 1}`);
    const o = x === x0 ? x0 + 1 : x0;
    const side = o > x ? 'right' : 'left';
    if (r < top) p.dig('down');
    else if (r === top) {
      if (solid(o, top)) p.dig(side);
      else if (solid(x, top + 1)) p.dig('down');
      else p.dig(side);
    } else if (solid(o, top + 1)) p.dig(side);
    else throw new Error(`drill site: row ${top} is out of reach from below (${p.where()})`);
  }
  if (remaining()) throw new Error('drill site: still solid');
}

/**
 * 01 §2.5–2.6 up to the Yard belts on a generated claim: down Dot's shaft (S1 ping, scripted lode found),
 * up to the Supply Shed for the Starter Kit, the access dig at the chevrons, ghosts for the drill and the lift
 * (completed by proximity, the rail on the way up), and two 1-tile Yard belts Headframe → Smelter → Bin.
 */
export function onboardingWorld(seed = 7): { w: World; p: Pilot; plan: { drill: { x: number; y: number }; lift: { x: number; foot: number; top: number } } } {
  const w = new World({ seed, scope: 'mvp' });
  w.debugGiveCash(10_000);
  w.debugSetTier('tank', 4);
  w.pod.fuel = w.stats().maxFuel;
  const p = new Pilot(w);
  const f = w.factory!;
  const c = w.meta.surveyColumn;
  const lode = w.terrain.lodes[w.meta.scriptedLodeId];
  p.descendShaft(c, lode.top - 1);
  p.flyOut(c, 41);
  const claim = w.claimStarterKit();
  if (!claim.ok) throw new Error(`claim: ${claim.reason}`);
  const plan = f.surveyPlan();
  p.driveRimTo(lode.x0 + 1);
  p.digDownTo(plan.drill.y - 1);
  excavateDrillSite(p, plan.drill.x, plan.drill.y);
  p.walkTo(c);
  p.run(3, NO_INTENT, false); // build mode: the pod is frozen while ghosts go down
  const drill = f.placeGhost({ kind: 'autoDrill', ...plan.drill });
  const lift = f.placeGhost({ kind: 'lift', ...plan.lift });
  if (!drill.ok || !lift.ok) throw new Error(`ghosts: ${JSON.stringify([drill, lift])}`);
  runUntil(p, 'drill and lift foot', () => f.ghosts().length === 1, 400);
  p.flyOut(c, c + 4);
  if (f.ghosts().length !== 0) throw new Error('lift rail not completed on the way up');
  const hx = f.entities().find((e) => e.kind === 'headframe')!.x;
  for (const y of [3, 6]) {
    const r = f.paintBelts([{ x: hx, y }], 1, 1);
    if (!r.ok) throw new Error(`paint: ${JSON.stringify(r)}`);
  }
  return { w, p, plan };
}
