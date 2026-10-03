// Minimal economy bot (04 §11.2; canon §4.3.1, §4.4): a headless player over the real World, no rendering. It plays
// trips (descend, dig toward seen minerals, turn back on its fuel rule, climb, sell, refuel, buy upgrades in order)
// and runs the onboarding factory once the Starter Kit is offered. Every move goes through World.step with a
// PodIntent, and every trade or build through the WorldApi / FactoryApi a player's taps would reach.
import { FUEL_MOVE_K, LINES, MINERALS, RELICS, RIM_BUILDINGS, STEP_HZ, TIER_PRICE, type Line, type RimBuildingId } from '../../src/shared/canon';
import { engineOf } from '../../src/pod/stats';
import type { GameEvent } from '../../src/shared/events';
import { Rng } from '../../src/shared/rng';
import { T, type Scope } from '../../src/shared/types';
import { NO_INTENT, type PodIntent } from '../../src/pod/types';
import { climbSpeed, forcedFloorRow } from '../../src/pod';
import { partsFor, tierExists, tierInScope } from '../../src/economy';
import { scopeFloorRow } from '../../src/terrain/scope';
import { tierSpread } from '../../src/terrain/cells';
import { World } from '../../src/world/world';
import { Metrics } from './metrics';
import { MineView, Planner, W, node, nodeR, nodeX, type Cell, type Costs } from './nav';
import { PathFollower, podCell, same, type MoveStatus } from './pilot';
import { UPGRADE_ORDER, type BotProfile } from './profiles';
import { YardBrain, type UndergroundJob } from './yard';

export interface Act {
  intent: PodIntent;
  /** False while a sheet or build mode pauses the pod (the factory keeps running, canon §4.5). */
  running: boolean;
}
export type Co<T = void> = Generator<Act, T, undefined>;

const RUN_IDLE: Act = { intent: NO_INTENT, running: true };
const PAUSED: Act = { intent: NO_INTENT, running: false };
const run = (intent: PodIntent): Act => ({ intent, running: true });

/** Generator expectation of a mineral cell's Assay value at row r (01 §4.2 cell pass; canon §2.2–2.3). */
const EXPECTED_VALUE: Float64Array = (() => {
  const out = new Float64Array(620);
  const relicAvg = RELICS.reduce((s, r) => s + r.value, 0) / RELICS.length;
  const tierAvg = (lo: number, k: number): number => {
    let s = 0;
    for (let i = 0; i < k; i++) s += MINERALS[Math.min(lo + i, 10) - 1].value;
    return s / k;
  };
  for (let r = 0; r < out.length; r++) {
    const k = tierSpread(r);
    const relics = r + 5 > 80;
    const deep = relics ? 0.25 * relicAvg + 0.75 * tierAvg(3, k) : tierAvg(3, k);
    out[r] = 0.8 * tierAvg(1, k) + 0.16 * tierAvg(2, k) + 0.04 * deep;
  }
  return out;
})();

/** Exploration's worth relative to a seen mineral of the frontier's expected value (a [tune] knob). */
const EXPLORE_WEIGHT = 0.5;
/** Rows of digging an exploration target is worth per step of travel (λ). */
const EXPLORE_LAMBDA = 1 / 20;

export interface BotOptions {
  seed: number;
  profile: BotProfile;
  scope?: Scope;
  /** Build the onboarding factory and its workshop (default true). */
  factory?: boolean;
  /** Restore this World instead of a new one. */
  world?: World;
  log?: (line: string) => void;
}

export class Bot {
  readonly w: World;
  readonly profile: BotProfile;
  readonly view: MineView;
  readonly planner: Planner;
  readonly follow: PathFollower;
  readonly m: Metrics;
  readonly rng: Rng;
  readonly yard: YardBrain;
  readonly log: (line: string) => void;
  /** Move timing by kind (calibration): [count, steps]. */
  moveStats: Record<string, [number, number]> | null = null;
  /** Verbose move trace (debugging). */
  trace: ((line: string) => void) | null = null;
  private co: Co;
  private salvaging = false;
  private thinkDebt = 0;
  /** Cells a move kept failing into (avoided by the planner for a while). */
  private readonly avoid = new Set<number>();
  private avoidUntil = 0;
  /** Step of the last trip end or respawn. */
  lastTripEnd = 0;
  /** Longest gap between trip ends, in steps (the longest trip, Rim time included). */
  longestTripGap = 0;
  /** Step of the last sign of progress: a dig, a find, a sale or purchase, a trip end, a salvage (soft-lock watch). */
  lastProgress = 0;
  /** Longest stretch without progress, in steps (04 §11.2: no seed stuck > 10 game-min). */
  longestStall = 0;
  private onEventHook: ((e: GameEvent) => void) | null = null;
  /** Sees every act just before the World steps with it (the soak mirrors them onto a reloaded copy). */
  onAct: ((act: Act) => void) | null = null;
  /**
   * What the bot is doing. Only 'rim' and 'job' call WorldApi / FactoryApi commands besides World.step; 'mine' and
   * 'home' act through stick intents alone.
   */
  activity: 'rim' | 'job' | 'mine' | 'home' | 'salvage' = 'rim';

  constructor(opts: BotOptions) {
    const scope = opts.scope ?? 'mvp';
    this.w = opts.world ?? new World({ seed: opts.seed, scope });
    this.profile = opts.profile;
    this.view = new MineView(this.w.terrain, this.w.scope, forcedFloorRow(scopeFloorRow(this.w.scope)));
    this.planner = new Planner(this.view);
    this.follow = new PathFollower(this.w.pod, this.view, { brakeV: opts.profile.brakeV, fallV: opts.profile.fallV, driveV: opts.profile.driveV });
    this.m = new Metrics(this.w.scope);
    this.rng = new Rng(opts.seed, opts.profile.name === 'proficient' ? 101 : 202);
    this.yard = new YardBrain(this, opts.factory ?? true);
    this.log = opts.log ?? (() => {});
    this.co = this.main();
  }

  onEvent(fn: (e: GameEvent) => void): void {
    this.onEventHook = fn;
  }

  get pod() {
    return this.w.pod;
  }

  /** Play `steps` 60 Hz steps. */
  run(steps: number): void {
    for (let i = 0; i < steps; i++) this.tick();
  }

  /** Play until `done()` or `maxSteps`. */
  runUntil(done: () => boolean, maxSteps: number): boolean {
    for (let i = 0; i < maxSteps; i++) {
      if (done()) return true;
      this.tick();
    }
    return done();
  }

  tick(): void {
    if (this.pod.destroyed && !this.salvaging) {
      this.salvaging = true;
      this.co = this.salvage();
    }
    let r = this.co.next();
    if (r.done) {
      this.co = this.main();
      r = this.co.next();
    }
    const act = r.done ? RUN_IDLE : r.value;
    this.stepWorld(act);
  }

  private stepWorld(act: Act): void {
    const w = this.w;
    this.onAct?.(act);
    this.m.tick(w.story.deepestRow);
    w.step(act.intent, act.running);
    for (const e of w.drainEvents()) {
      this.m.event(e, w.story.deepestRow);
      if (e.t === 'trip-end' || e.t === 'respawned') {
        const gap = this.m.steps - this.lastTripEnd;
        if (gap > this.longestTripGap) this.longestTripGap = gap;
        this.lastTripEnd = this.m.steps;
      }
      if (e.t === 'dug' || e.t === 'collect' || e.t === 'sale' || e.t === 'purchase' || e.t === 'trip-end' || e.t === 'respawned') {
        const stall = this.m.steps - this.lastProgress;
        if (stall > this.longestStall) this.longestStall = stall;
        this.lastProgress = this.m.steps;
      }
      this.onEventHook?.(e);
    }
    if (this.avoid.size > 0 && this.m.steps > this.avoidUntil) this.avoid.clear();
    if (this.m.steps % (60 * STEP_HZ) === 0) this.yard.sampleFlows();
  }

  /** Steps since the last progress event (a soft-lock shows as > 10 game-minutes, 04 §11.2). */
  sinceProgress(): number {
    return this.m.steps - this.lastProgress;
  }

  // ================================================================ coroutines

  private *main(): Co {
    for (;;) {
      yield* this.rimVisit();
      yield* this.trip();
    }
  }

  /** Destruction (01 §3.11): the 3 s card, then salvage on the Pump House pad. */
  private *salvage(): Co {
    this.activity = 'salvage';
    for (let i = 0; i < 3 * STEP_HZ; i++) yield PAUSED;
    this.w.respawn();
    this.salvaging = false;
    this.thinkDebt = 0;
  }

  *wait(steps: number, act: Act = RUN_IDLE): Co {
    for (let i = 0; i < steps; i++) yield act;
  }

  /** Build mode: the pod frozen while the player taps (canon §4.5: the factory keeps running). */
  *buildPause(commands: number): Co {
    yield* this.wait(Math.round(commands * this.profile.buildSeconds * STEP_HZ), PAUSED);
  }

  /**
   * Follow a path to its end. Think time (01 §2.2: 20% / 60% of play) accrues while moving and is paid standing
   * still at cell boundaries, so it never breaks a dig press or a chain of digs.
   */
  *followPath(path: Cell[], abort?: () => boolean): Co<MoveStatus | 'aborted'> {
    const f = this.follow;
    f.set(path);
    this.trace?.(`${this.clock()} path ${path.map((c) => `${c.x},${c.r}`).join(' ')} fuel ${this.pod.fuel.toFixed(2)}`);
    const ratio = this.profile.think / (1 - this.profile.think);
    let idx = -1;
    let since = 0;
    for (;;) {
      if (abort?.()) return 'aborted';
      const p = this.pod;
      if (f.idx !== idx) {
        if (idx >= 0 && this.moveStats) {
          const a = f.path[idx];
          const b = f.path[Math.min(f.idx, idx + 1)];
          if (a && b) {
            const k = `${b.r > a.r ? 'down' : b.r < a.r ? 'up' : 'side'}${this.view.supported(a.x, a.r) ? '' : '-air'}${f.idx - idx > 1 ? '+' : ''}`;
            const e = (this.moveStats[k] ??= [0, 0]);
            e[0]++;
            e[1] += since / (f.idx - idx);
          }
        }
        since = 0;
        idx = f.idx;
        if (this.thinkDebt >= 1 && p.grounded && !p.dig && Math.abs(p.vx) < 0.3) {
          const n = Math.floor(this.thinkDebt);
          this.thinkDebt -= n;
          for (let i = 0; i < n; i++) yield RUN_IDLE;
        }
      }
      const it = f.stepIntent();
      yield run(it);
      since++;
      if (this.pod.destroyed) return 'stuck';
      this.thinkDebt += ratio;
      const st = f.status();
      if (st === 'arrived' || st === 'blocked') return st;
      if (st !== 'moving') {
        this.trace?.(`${this.clock()} ${st} at ${JSON.stringify(podCell(this.pod))} idx ${f.idx} pod ${this.pod.x.toFixed(2)},${this.pod.y.toFixed(2)} v ${this.pod.vx.toFixed(2)},${this.pod.vy.toFixed(2)} g ${this.pod.grounded}`);
        this.m.stuck++;
        if (st === 'stuck') {
          const t = f.path[f.idx + 1];
          if (t) this.avoidCell(t);
        }
        return st;
      }
    }
  }

  private shaftAvoid: Set<number> | null = null;

  /**
   * Cells mining runs stay out of: failed moves, and (until Dot's survey ping, canon §3.9) her shaft: a first-time
   * player digs the Tutorial Patch before anyone tells them the shaft is a way down (01 §2.5).
   */
  private mineAvoid(): ReadonlySet<number> {
    const f = this.w.factory;
    if (f && !f.isUnlocked('U1')) {
      if (!this.shaftAvoid) {
        this.shaftAvoid = new Set(this.avoid);
        const c = this.w.meta.surveyColumn;
        for (let r = 0; r <= 46; r++) this.shaftAvoid.add(node(c, r));
      }
      for (const n of this.avoid) this.shaftAvoid.add(n);
      return this.shaftAvoid;
    }
    return this.avoid;
  }

  private avoidCell(c: Cell): void {
    this.avoid.add(node(c.x, c.r));
    this.avoidUntil = this.m.steps + 120 * STEP_HZ;
  }

  /** Where plans start: the pod's cell, or (while a dig has not broken through yet) the cell it is drilling from. */
  planCell(): Cell {
    const c = podCell(this.pod);
    if (this.view.open(c.x, c.r) || !this.pod.dig) return c;
    const r = Math.floor(-this.pod.y);
    return { x: Math.min(47, Math.max(0, Math.floor(this.pod.x))), r: r < -1 ? -1 : r };
  }

  costs(): Costs {
    const s = this.w.stats();
    const v = Math.max(1, climbSpeed(this.pod));
    // Calibrated on the pilot's measured move times (stop-and-go at shaft junctions included).
    return { dig: s.digSteps + 8, fall: 12, climb: STEP_HZ / v + 8, side: 20, sideAir: 50 };
  }

  /** Path from the pod over open cells only, to the first cell `goal` accepts (cheapest), or null. */
  pathOpen(goal: (x: number, r: number) => boolean, maxCost = 1e9): Cell[] | null {
    let hit = -1;
    this.planner.search(this.planCell(), this.costs(), { dig: false, maxCost, avoid: this.avoid }, (n) => {
      if (goal(nodeX(n), nodeR(n))) {
        hit = n;
        return true;
      }
      return false;
    });
    return hit >= 0 ? this.planner.path(hit) : null;
  }

  /** Path from the pod with drilling allowed, ending in (and drilling) `target`. */
  pathDig(target: Cell, maxCost = 1e9): Cell[] | null {
    const goal = node(target.x, target.r);
    let hit = -1;
    this.planner.search(this.planCell(), this.costs(), { dig: true, maxCost, avoid: this.avoid }, (n) => {
      if (n === goal) {
        hit = n;
        return true;
      }
      return false;
    });
    return hit >= 0 ? this.planner.path(hit) : null;
  }

  // ---------------------------------------------------------------- the Rim

  private padX(id: RimBuildingId): number {
    const b = RIM_BUILDINGS.find((p) => p.id === id)!;
    return Math.floor((b.x0 + b.x1 + 1) / 2);
  }

  /** Drive (or fly) to a Rim pad and stop on it; the sheet opens after 0.3 s neutral; then read time. */
  *gotoPad(id: RimBuildingId): Co<boolean> {
    const x = this.padX(id);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.w.padUnderPod() === id && this.w.onRim() && Math.abs(this.pod.vx) < 0.2) break;
      const path = this.pathOpen((cx, r) => cx === x && r === -1);
      if (!path) return false;
      const st = yield* this.followPath(path);
      if (st === 'arrived') break;
    }
    if (!this.w.onRim()) return false;
    yield* this.wait(20 + Math.round(this.profile.shopSeconds * STEP_HZ));
    return this.w.onRim();
  }

  /** Everything between two trips: land, sell (and Stockpile), build, upgrade, repair, Kits, refuel. */
  private *rimVisit(): Co {
    this.activity = 'rim';
    // Land first if hovering over a hole at the Rim level.
    if (!this.w.onRim()) {
      const path = this.pathOpen((x, r) => r === -1 && this.view.supported(x, r));
      if (path) yield* this.followPath(path);
    }
    if (this.w.cargoValue() > 0 || this.yard.wantsStockpile()) {
      if (yield* this.gotoPad('assay')) {
        this.yard.stockpileAtAssay();
        if (this.w.cargoValue() > 0) this.w.sellAll();
      }
    }
    // The pump next: the Rim is 48 tiles of driving, and a pod home on fumes must not run dry between pads.
    if (this.pod.fuel < this.w.stats().maxFuel - 0.5 && (yield* this.gotoPad('pump'))) this.w.buyFuel('fill');
    yield* this.yard.rimWork();
    if (this.wantsGarage() && (yield* this.gotoPad('garage'))) {
      this.w.repairAll();
      this.buyUpgrades();
    }
    const pops = this.popsWanted();
    if ((this.yard.wantsShed() || pops > 0) && (yield* this.gotoPad('shed'))) {
      this.yard.shedWork();
      if (pops > 0) this.w.buyConsumable('pop', pops);
    }
    if (this.pod.fuel < this.w.stats().maxFuel - 1 && (yield* this.gotoPad('pump'))) this.w.buyFuel('fill');
  }

  /** Pop Charges to buy for the shaft's Hardrock (from r110, when the cash is spare). */
  private popsWanted(): number {
    const want = this.profile.pops - this.pod.consumables.pop;
    if (want <= 0 || this.w.story.deepestRow < 110) return 0;
    const spare = this.w.wallet.cash - this.reserveCash() - this.yard.cashWanted() - (this.nextUpgradeCost() ?? 0);
    return Math.max(0, Math.min(want, Math.floor(spare / 2_000)));
  }

  /** Price of the upgrade being saved for (the first cash-blocked one with its parts in stock), if any. */
  private nextUpgradeCost(): number | null {
    const f = this.w.factory;
    for (const [line, tier] of UPGRADE_ORDER) {
      if (this.pod.tiers[line] >= tier || !tierExists(line, tier) || !tierInScope(this.w.scope, line, tier)) continue;
      if (!partsFor(this.w.scope, line, tier).every((r) => (f ? f.stockpileCount(r.part) : 0) >= r.n)) continue;
      return TIER_PRICE[tier - 1];
    }
    return null;
  }

  /** Cash a fill-up and repair would take (never spent on upgrades). */
  reserveCash(): number {
    const s = this.w.stats();
    return s.maxFuel + 15 * Math.max(0, s.maxHull - this.pod.hull) + this.profile.reserve;
  }

  private wantsGarage(): boolean {
    return this.pod.hull < this.w.stats().maxHull - 0.05 || this.nextUpgrade() !== null;
  }

  /** The next affordable upgrade in UPGRADE_ORDER: part-blocked ones are skipped, a cash-blocked one is saved for. */
  nextUpgrade(): readonly [Line, number] | null {
    const cash = this.w.wallet.cash - this.reserveCash() - this.yard.cashWanted();
    const f = this.w.factory;
    for (const u of UPGRADE_ORDER) {
      const [line, tier] = u;
      if (this.pod.tiers[line] >= tier || !tierExists(line, tier) || !tierInScope(this.w.scope, line, tier)) continue;
      const parts = partsFor(this.w.scope, line, tier);
      const partsOk = parts.every((r) => (f ? f.stockpileCount(r.part) : 0) >= r.n);
      if (!partsOk) continue;
      if (cash >= TIER_PRICE[tier - 1]) return u;
      return null;
    }
    return null;
  }

  private buyUpgrades(): void {
    for (let guard = 0; guard < LINES.length * 7; guard++) {
      const u = this.nextUpgrade();
      if (!u) return;
      const r = this.w.buyUpgrade(u[0], u[1]);
      if (!r.ok) return;
      this.log(`${this.clock()} bought ${u[0]} t${u[1]}`);
    }
  }

  clock(): string {
    const s = Math.floor(this.m.steps / STEP_HZ);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------- trips

  private *trip(): Co {
    for (let jobs = 0; jobs < 4; jobs++) {
      const job = this.yard.job();
      if (!job || this.mustReturn()) break;
      this.activity = 'job';
      const done = yield* this.runJob(job);
      if (!done) break;
    }
    this.activity = 'mine';
    yield* this.mine();
    this.activity = 'home';
    yield* this.goHome();
  }

  /**
   * Turn-back rule (canon §4.4 profiles): bay full, fuel ≤ greed × climb + margin, or a battered hull. "Climb" is
   * the larger of the Return Tick (01 §3.5) and the fuel of the planned way home at full thrust: the Return Tick
   * ignores sideways routing, which a player who dug the tunnels knows about.
   */
  mustReturn(): boolean {
    const s = this.w.stats();
    const p = this.pod;
    if (p.y > -1) return false;
    if (s.slotsUsed >= s.baySlots) return true;
    if (p.fuel <= this.profile.greed * this.homeFuel() + this.profile.fuelMargin) return true;
    return p.hull < this.profile.hullFloor * s.maxHull;
  }

  private homeCell = -1;
  private homeLiters = 0;

  /** Litres to fly home from here and drive to the Assay pad, plus the hop on to the Pump (cached per cell). */
  homeFuel(): number {
    const c = this.planCell();
    const n = node(c.x, c.r);
    if (n !== this.homeCell) {
      this.homeCell = n;
      const assay = node(this.padX('assay'), -1);
      let steps = Infinity;
      const costs = this.costs();
      this.planner.search(c, costs, { dig: false, maxCost: 1e9 }, (k, cost) => {
        if (k === assay) {
          steps = cost;
          return true;
        }
        return false;
      });
      const pumpHop = Math.abs(this.padX('assay') - this.padX('pump')) * costs.side;
      const burn = (FUEL_MOVE_K * engineOf(this.pod.tiers.engine).hp) / STEP_HZ;
      this.homeLiters = steps === Infinity ? Infinity : (steps + pumpHop) * burn;
    }
    return Math.max(this.w.returnFuel(), this.homeLiters);
  }

  private *mine(): Co {
    let empty = 0;
    for (let guard = 0; guard < 400; guard++) {
      if (this.mustReturn()) return;
      const plan = this.chooseTarget();
      if (!plan) {
        if (++empty > 2) return;
        continue;
      }
      empty = 0;
      const blastAt = this.blastAt;
      const mineralsBefore = this.m.minerals;
      const st = yield* this.followPath(plan, () => this.mustReturn());
      if (st === 'aborted') return;
      if (st === 'arrived' && blastAt) {
        this.blastAt = blastAt;
        yield* this.blast();
        continue;
      }
      if (st === 'arrived' && this.profile.wander > 0 && this.m.minerals > mineralsBefore) {
        const w = this.profile.wander;
        const n = Math.floor(w) + (this.rng.chance(w - Math.floor(w)) ? 1 : 0);
        for (let k = 0; k < n && !this.mustReturn(); k++) yield* this.wanderDig();
      }
    }
  }

  /** An aimless extra dig into plain rock (the slow player's dig efficiency): a nearby drillable non-mineral cell. */
  private *wanderDig(): Co {
    const v = this.view;
    const cands: number[] = [];
    this.planner.search(this.planCell(), this.costs(), { dig: true, maxCost: 90, avoid: this.mineAvoid() }, (n) => {
      const x = nodeX(n);
      const r = nodeR(n);
      if (!v.open(x, r) && v.value(x, r) === 0) cands.push(n);
      return false;
    });
    if (cands.length === 0) return;
    const path = this.planner.path(this.rng.pick(cands));
    if (!path) return;
    yield* this.followPath(path, () => this.mustReturn());
  }

  /** The main shaft: one straight column dug a little deeper each trip, side-stepping blockers (Hardrock, lodes). */
  private shaftX = 7;
  private shaftBottom = -1;

  /** Blast the Hardrock under the shaft bottom once the pod stands there (set by chooseTarget). */
  private blastAt: Cell | null = null;

  /**
   * The next cell that deepens the main shaft, or null if it is boxed in. Hardrock right below is blasted with a
   * Pop Charge when one is aboard (the target is then the shaft bottom itself); else the shaft side-steps.
   */
  private shaftTarget(): { cell: Cell; blast: boolean } | null {
    const v = this.view;
    let x = this.shaftX;
    let r = this.shaftBottom;
    while (r + 1 < v.floor && v.open(x, r + 1)) r++;
    this.shaftBottom = r;
    if (r + 1 >= v.floor) return null;
    if (v.diggable(x, r + 1)) return { cell: { x, r: r + 1 }, blast: false };
    if (r >= 0 && this.w.terrain.get(x, r + 1) === T.HARDROCK && v.seen(x, r + 1) && this.popSlot() >= 0) return { cell: { x, r }, blast: true };
    // Blocked below: step sideways on the blocker and carry on down from there.
    for (const dx of x < 24 ? [1, -1] : [-1, 1]) {
      const nx = x + dx;
      if (nx < 0 || nx >= W || r < 0) continue;
      const side = v.open(nx, r) || v.diggable(nx, r);
      const below = v.open(nx, r + 1) || v.diggable(nx, r + 1);
      if (!side || !below) continue;
      this.shaftX = nx;
      return { cell: v.open(nx, r) ? { x: nx, r: r + 1 } : { x: nx, r }, blast: false };
    }
    return null;
  }

  /** Quick slot holding a Pop Charge with charges aboard, or −1. */
  private popSlot(): number {
    if (this.pod.consumables.pop <= 0) return -1;
    return this.pod.quickSlots.indexOf('pop');
  }

  /** Fire the Pop Charge standing on the shaft's Hardrock (canon §3.3: clears the 3×3, never hurts the pod). */
  private *blast(): Co {
    const at = this.blastAt;
    this.blastAt = null;
    const slot = this.popSlot();
    if (!at || slot < 0 || !same(podCell(this.pod), at)) return;
    for (let i = 0; i < 30 && !(this.pod.grounded && Math.abs(this.pod.vx) < 0.2); i++) yield RUN_IDLE;
    yield run({ ...NO_INTENT, fireSlot: slot });
    yield* this.wait(10);
  }

  /**
   * Pick the next target (04 §11.2 "BFS to value-weighted seen targets"): a seen mineral or relic scored value ÷
   * (steps + overhead), or deepening the main shaft, worth the frontier's expected mineral value, whichever pays.
   */
  chooseTarget(): Cell[] | null {
    const v = this.view;
    const pr = this.profile;
    const start = this.planCell();
    const s = this.w.stats();
    const room = s.slotsUsed < s.baySlots;
    const shaft = this.shaftTarget();
    const shaftNode = shaft ? node(shaft.cell.x, shaft.cell.r) : -1;
    this.blastAt = null;
    let best = -1;
    let bestScore = 0;
    let shaftCost = -1;
    let explore = -1;
    let exploreKey = -Infinity;
    let exploreCost = 0;
    this.planner.search(start, this.costs(), { dig: true, maxCost: Math.max(pr.sight, 1_200 + 20 * Math.max(0, this.shaftBottom - start.r)), avoid: this.mineAvoid() }, (n, cost) => {
      if (n === shaftNode) shaftCost = cost;
      const x = nodeX(n);
      const r = nodeR(n);
      if (v.open(x, r)) return false;
      if (room && cost <= pr.sight) {
        const val = v.value(x, r);
        if (val > 0) {
          const noise = pr.noise > 0 ? 1 + pr.noise * (this.rng.next() * 2 - 1) : 1;
          const score = (val * noise) / (cost + pr.overhead);
          if (score > bestScore) {
            bestScore = score;
            best = n;
          }
        }
      }
      if (r > start.r && cost <= pr.sight) {
        const key = r - EXPLORE_LAMBDA * cost;
        if (key > exploreKey) {
          exploreKey = key;
          explore = n;
          exploreCost = cost;
        }
      }
      return false;
    });
    // Deepen the main shaft; failing that, the deepest drillable cell worth its travel.
    const target = shaftCost >= 0 ? shaftNode : explore;
    const tCost = shaftCost >= 0 ? shaftCost : exploreCost;
    if (target >= 0) {
      const r = nodeR(target);
      const score = (EXPLORE_WEIGHT * EXPECTED_VALUE[Math.max(0, r)]) / (tCost + pr.overhead);
      if (score > bestScore || best < 0) {
        best = target;
        bestScore = score;
        if (target === shaftNode && shaft?.blast) this.blastAt = shaft.cell;
      }
    }
    return best >= 0 ? this.planner.path(best) : null;
  }

  /** Home: the cheapest open route to a Rim cell with turf under it (no digging up, canon §3.6). */
  private *goHome(): Co {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (this.w.onRim()) return;
      const path = this.pathOpen((x, r) => r === -1 && this.view.supported(x, r));
      if (!path) {
        this.m.stuck++;
        this.log(`${this.clock()} no way home from ${JSON.stringify(podCell(this.pod))}`);
        // Wait it out (a later version could fire a Homing Beacon); the soak flags a stall.
        yield* this.wait(60);
        continue;
      }
      const st = yield* this.followPath(path);
      if (st === 'arrived' && this.w.onRim()) return;
    }
  }

  // ---------------------------------------------------------------- underground jobs (factory)

  /** Excavate, stand, place ghosts and wait for them (02 §2.6); false if the trip had to turn back. */
  private *runJob(job: UndergroundJob): Co<boolean> {
    // 1) Visit / excavate.
    for (let guard = 0; guard < 200; guard++) {
      if (this.mustReturn()) return false;
      const left = job.dig.filter((c) => !this.view.open(c.x, c.r));
      if (left.length === 0) break;
      const top = Math.min(...left.map((c) => c.r));
      let best: Cell[] | null = null;
      for (const c of left.filter((k) => k.r === top)) {
        const p = this.pathDig(c);
        if (p && (!best || p.length < best.length)) best = p;
      }
      if (!best) {
        this.log(`${this.clock()} job ${job.name}: cannot reach ${JSON.stringify(left[0])}`);
        job.onFail?.();
        return true;
      }
      const st = yield* this.followPath(best, () => this.mustReturn());
      if (st === 'aborted') return false;
    }
    if (job.stand) {
      const stand = job.stand;
      const path = this.pathOpen((x, r) => x === stand.x && r === stand.r);
      if (!path) {
        job.onFail?.();
        return true;
      }
      const st = yield* this.followPath(path, () => this.mustReturn());
      if (st === 'aborted') return false;
      if (!same(podCell(this.pod), stand)) return true;
    }
    if (job.place) {
      yield* this.wait(3, PAUSED);
      const n = job.place();
      yield* this.buildPause(n);
    }
    if (job.built) {
      for (let i = 0; i < 20 * STEP_HZ && !job.built(); i++) {
        yield run(this.follow.path.length ? this.follow.stepIntent() : NO_INTENT);
      }
    }
    if (job.after) yield* job.after();
    return true;
  }

  /** Fly straight up `column` from the pod at a gentle climb (Lift Rail jobs complete on the way, 02 §2.6). */
  *climbColumn(column: number, vUp: number): Co {
    const pod = this.pod;
    for (let i = 0; i < 60 * STEP_HZ; i++) {
      if (pod.y > 0.8) break;
      const sx = Math.max(-0.3, Math.min(0.3, (column + 0.5 - pod.x) * 2 - pod.vx * 0.5));
      const sy = pod.vy < vUp ? 1 : 0.35;
      yield run({ sx, sy, thrust: false, fireSlot: -1 });
    }
  }
}
