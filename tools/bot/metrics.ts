// Economy bot measures (04 §11.2; canon §4.3.1–4.3.2, §4.4, §5.2; 02 §5.6): PRI per phase, factory share,
// per-trip fuel/hull warnings (P1), depth times, FirstLiftDelivery time, dig efficiency and deaths.
import { STEP_HZ, type Line } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import { partsFor } from '../../src/economy';
import { item } from '../../src/factory/items';
import type { Scope } from '../../src/shared/types';

/** Canon §4.3.1 phases by deepest row reached. */
export const PHASES = [
  { id: 'A', top: 0, bottom: 59 },
  { id: 'B', top: 60, bottom: 128 },
  { id: 'C', top: 129, bottom: 261 },
  { id: 'D', top: 262, bottom: 395 },
  { id: 'E1', top: 396, bottom: 479 },
  { id: 'E2', top: 480, bottom: 583 },
] as const;
export type PhaseId = (typeof PHASES)[number]['id'];

export function phaseIndex(row: number): number {
  for (let i = PHASES.length - 1; i >= 0; i--) if (row >= PHASES[i].top) return i;
  return 0;
}

/** Depth marks reported (rows); 319 is the last playable MVP row (the r320 temporary Seal). */
export const DEPTH_MARKS = [40, 80, 129, 200, 319] as const;

export interface PhaseStats {
  id: PhaseId;
  steps: number;
  /** Assay sales + incentives (canon §4.3.1 pod income). */
  podIncome: number;
  /** Export cash + 90% of the book value of factory parts the Garage consumed (02 §5.6). */
  factoryIncome: number;
  exportCash: number;
  trips: number;
  /** Trips with at least one fuel or hull warning. */
  tripsWarned: number;
  fuelWarnings: number;
  hullWarnings: number;
  deaths: number;
}

export interface TripRecord {
  n: number;
  startStep: number;
  endStep: number;
  deepest: number;
  phase: PhaseId;
  income: number;
  fuelWarn: number;
  hullWarn: number;
  died: boolean;
}

export interface Upgrade {
  step: number;
  line: Line;
  tier: number;
}

export class Metrics {
  readonly phases: PhaseStats[] = PHASES.map((p) => ({ id: p.id, steps: 0, podIncome: 0, factoryIncome: 0, exportCash: 0, trips: 0, tripsWarned: 0, fuelWarnings: 0, hullWarnings: 0, deaths: 0 }));
  readonly depthStep: Record<number, number | null> = Object.fromEntries(DEPTH_MARKS.map((d) => [d, null]));
  firstLiftDelivery: number | null = null;
  starterKitReady: number | null = null;
  starterKitClaimed: number | null = null;
  firstIngot: number | null = null;
  firstExport: number | null = null;
  readonly upgrades: Upgrade[] = [];
  readonly trips: TripRecord[] = [];
  digs = 0;
  minerals = 0;
  bayFullLosses = 0;
  deaths = 0;
  /** Moves the pilot gave up on (stuck or knocked off the path). */
  stuck = 0;
  /** Specimens the bot Stockpiled for the lossy path, by tier. */
  readonly stockpiled: number[] = new Array(11).fill(0);
  /** Ingots smelted from lode ore / from Stockpiled specimens (sampled belt flows, 02 §5.6 lode-parts share). */
  lodeIngots = 0;
  specimenIngots = 0;
  /** The lode-parts share at the latest t4 purchase (02 §5.6: "from game start to the last t4 purchase"). */
  lodeShareAtT4: number | null = null;
  steps = 0;
  private tripStart = 0;
  private tripIncome = 0;
  private tripFuel = 0;
  private tripHull = 0;
  private tripDied = false;
  private phase = 0;

  constructor(readonly scope: Scope) {}

  /** Once per World step, before its events: time accrues to the phase of the deepest row so far. */
  tick(deepestRow: number): void {
    this.steps++;
    this.phase = phaseIndex(deepestRow);
    this.phases[this.phase].steps++;
    for (const d of DEPTH_MARKS) if (this.depthStep[d] === null && deepestRow >= d) this.depthStep[d] = this.steps;
  }

  event(e: GameEvent, deepestRow: number): void {
    const ph = this.phases[this.phase];
    switch (e.t) {
      case 'sale':
        ph.podIncome += e.amount;
        this.tripIncome += e.amount;
        break;
      case 'incentive':
        ph.podIncome += e.cash;
        this.tripIncome += e.cash;
        break;
      case 'export-sale':
        ph.exportCash += e.amount;
        ph.factoryIncome += e.amount;
        this.firstExport ??= this.steps;
        break;
      case 'purchase':
        if (e.kind === 'upgrade' && e.line && e.tier) {
          this.upgrades.push({ step: this.steps, line: e.line, tier: e.tier });
          if (e.tier === 4) this.lodeShareAtT4 = this.lodeShare();
          for (const r of partsFor(this.scope, e.line, e.tier)) ph.factoryIncome += 0.9 * item(r.part).value * r.n;
        }
        if (e.kind === 'kit' && e.kit === 'starter') this.starterKitClaimed ??= this.steps;
        break;
      case 'starter-kit':
        this.starterKitReady ??= this.steps;
        break;
      case 'first-lift-delivery':
        this.firstLiftDelivery ??= this.steps;
        break;
      case 'first-ingot':
        this.firstIngot ??= this.steps;
        break;
      case 'fuel-warning':
        ph.fuelWarnings++;
        this.tripFuel++;
        break;
      case 'hull-warning':
        ph.hullWarnings++;
        this.tripHull++;
        break;
      case 'dug':
        this.digs++;
        break;
      case 'collect':
        if (e.item.kind === 'mineral') this.minerals++;
        break;
      case 'bay-full':
        this.bayFullLosses++;
        break;
      case 'destroyed':
        this.deaths++;
        ph.deaths++;
        this.tripDied = true;
        break;
      case 'left-rim':
        this.tripStart = this.steps;
        break;
      case 'trip-end':
        this.endTrip(e.trip, deepestRow, e.deepestRow);
        break;
      case 'respawned':
        // A trip that ended in salvage: count it where it was flown (its warnings matter for P1).
        this.endTrip(this.trips.length + 1, deepestRow, -1);
        break;
      default:
        break;
    }
  }

  private endTrip(n: number, deepestRow: number, tripDeepest: number): void {
    const p = phaseIndex(deepestRow);
    const ph = this.phases[p];
    ph.trips++;
    if (this.tripFuel + this.tripHull > 0) ph.tripsWarned++;
    this.trips.push({
      n,
      startStep: this.tripStart,
      endStep: this.steps,
      deepest: tripDeepest,
      phase: PHASES[p].id,
      income: this.tripIncome,
      fuelWarn: this.tripFuel,
      hullWarn: this.tripHull,
      died: this.tripDied,
    });
    this.tripIncome = 0;
    this.tripFuel = 0;
    this.tripHull = 0;
    this.tripDied = false;
  }

  /** Ingots from lode ore ÷ all ingots smelted so far. */
  lodeShare(): number {
    const all = this.lodeIngots + this.specimenIngots;
    return all > 0 ? this.lodeIngots / all : 0;
  }

  /** Dug tiles per mineral collected (01 §2.2 dig efficiency). */
  tilesPerMineral(): number {
    return this.minerals > 0 ? this.digs / this.minerals : Infinity;
  }

  /** Pod income per minute of play in phase i (PRI before the cross-profile median). */
  pri(i: number): number {
    const p = this.phases[i];
    return p.steps > 0 ? (p.podIncome * 60 * STEP_HZ) / p.steps : 0;
  }

  /** Factory share in phase i = factory $ ÷ (pod $ + factory $) (canon §4.3.2). */
  share(i: number): number {
    const p = this.phases[i];
    const total = p.podIncome + p.factoryIncome;
    return total > 0 ? p.factoryIncome / total : 0;
  }
}

/** Steps → "m:ss" game clock. */
export function clock(steps: number | null): string {
  if (steps === null) return '—';
  const s = Math.floor(steps / STEP_HZ);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
