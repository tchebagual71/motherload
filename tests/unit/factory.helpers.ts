// Shared fixtures for factory tests: a synthetic mine grid, a wallet, an event log and Kit cargo.
import type { Purity } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import { F, T, type Lode, type LodeMetal } from '../../src/shared/types';
import { TerrainGrid } from '../../src/terrain/grid';
import { Factory } from '../../src/factory/factory';
import type { FactoryOptions, FactoryPorts, KitSink, KitSource, PodBox } from '../../src/factory/api';

/** Solid dirt everywhere below a turf row 0; nothing seen. */
export function makeGrid(): TerrainGrid {
  const g = new TerrainGrid(7);
  g.terrain.fill(T.DIRT);
  for (let x = 0; x < g.w; x++) g.terrain[x] = T.TURF;
  return g;
}

/** Excavate and mark seen every cell in [x0..x1] × [y0..y1]. */
export function carve(g: TerrainGrid, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = g.idx(x, y);
      g.terrain[i] = T.AIR;
      g.flags[i] |= F.SEEN;
    }
  }
}

export function addLode(g: TerrainGrid, metal: LodeMetal, purity: Purity, x0: number, top: number, discovered = false): Lode {
  const lode: Lode = { id: g.lodes.length, metal, purity, x0, top, scripted: g.lodes.length === 0, scope: metal === 'thorium' || metal === 'kerogen' ? 'v1' : 'mvp', discovered };
  g.lodes.push(lode);
  for (let y = top; y < top + 2; y++) {
    for (let x = x0; x < x0 + 3; x++) {
      g.terrain[g.idx(x, y)] = T.LODE_ROCK;
      g.lodeIndex[g.idx(x, y)] = lode.id + 1;
    }
  }
  return lode;
}

export class Wallet {
  constructor(public cashNow = 100_000) {}
  readonly log: { kind: 'debit' | 'credit'; n: number; reason: string }[] = [];
  cash(): number {
    return this.cashNow;
  }
  debit(n: number, reason: string): boolean {
    if (n > this.cashNow) return false;
    this.cashNow -= n;
    this.log.push({ kind: 'debit', n, reason });
    return true;
  }
  credit(n: number, reason: string): void {
    this.cashNow += n;
    this.log.push({ kind: 'credit', n, reason });
  }
}

export class Cargo implements KitSource, KitSink {
  readonly kits: Record<string, number> = {};
  constructor(init: Record<string, number> = {}) {
    Object.assign(this.kits, init);
  }
  count(id: string): number {
    return this.kits[id] ?? 0;
  }
  take(id: string, n: number): void {
    if (this.count(id) < n) throw new Error(`cargo short of ${id}`);
    this.kits[id] -= n;
  }
  canPut(): boolean {
    return true;
  }
  put(id: string, n: number): void {
    this.kits[id] = this.count(id) + n;
  }
}

/** A pod box far from everything. */
export const POD_AWAY: PodBox = { minX: 0.1, maxX: 0.9, minY: -0.9, maxY: -0.1 };

export interface Rig {
  grid: TerrainGrid;
  wallet: Wallet;
  events: GameEvent[];
  ports: FactoryPorts;
  f: Factory;
}

/** The onboarding layout: scripted Copper at x0 20, top r46; survey shaft in column 19, rows 0–45. */
export const ONBOARD = { x0: 20, top: 46, column: 19 } as const;

export function onboardingGrid(): TerrainGrid {
  const g = makeGrid();
  addLode(g, 'copper', 'normal', ONBOARD.x0, ONBOARD.top);
  carve(g, ONBOARD.column, 0, ONBOARD.column, ONBOARD.top - 1);
  carve(g, ONBOARD.x0, ONBOARD.top - 2, ONBOARD.x0 + 1, ONBOARD.top - 1);
  return g;
}

export function rig(opts: Partial<FactoryOptions> = {}, grid = onboardingGrid(), cash = 100_000): Rig {
  const wallet = new Wallet(cash);
  const events: GameEvent[] = [];
  const ports: FactoryPorts = { grid, wallet, emit: (e) => events.push(e) };
  const f = Factory.create(ports, { scope: 'mvp', surveyColumn: ONBOARD.column, scriptedLodeId: 0, checkInvariants: true, ...opts });
  return { grid, wallet, events, ports, f };
}

/** Restore a rig's factory from bytes onto the same grid and wallet. */
export function reload(r: Rig, bytes: Uint8Array, opts: Partial<FactoryOptions> = {}): Factory {
  return Factory.deserialize(bytes, r.ports, { scope: 'mvp', surveyColumn: ONBOARD.column, scriptedLodeId: 0, checkInvariants: true, ...opts });
}

export function ticks(f: Factory, n: number): void {
  for (let i = 0; i < n; i++) f.tick();
}

/** Build the onboarding chain: drill on the lode, lift up the shaft, two 1-tile belts on the Yard. */
export function buildOnboarding(r: Rig): void {
  const { f } = r;
  f.discoverLode(0, true);
  const plan = f.surveyPlan();
  const cargo = new Cargo({ autoDrill: 1, liftFoot: 1, liftRail: 1, belt: 16 });
  const drill = f.placeGhost({ kind: 'autoDrill', x: plan.drill.x, y: plan.drill.y });
  const lift = f.placeGhost({ kind: 'lift', x: plan.lift.x, foot: plan.lift.foot, top: plan.lift.top });
  if (!drill.ok || !lift.ok) throw new Error(`ghosts: ${JSON.stringify([drill, lift])}`);
  for (const id of [...drill.ids, ...lift.ids]) {
    const done = f.completeGhost(id, POD_AWAY, cargo);
    if (!done.ok) throw new Error(`completeGhost ${id}: ${JSON.stringify(done)}`);
  }
  const x = ONBOARD.column;
  for (const y of [3, 6]) {
    const p = f.paintBelts([{ x, y }], 1, 1);
    if (!p.ok) throw new Error(`paint: ${JSON.stringify(p)}`);
  }
}

export function binOf(f: Factory): number {
  const bin = f.entities().find((e) => e.kind === 'bin');
  if (!bin) throw new Error('no bin');
  return bin.id;
}

/** The grid a World would restore from TERR + LODE: terrain, flags and lodes; mount/occupant left for the factory. */
export function cloneGrid(g: TerrainGrid): TerrainGrid {
  const c = new TerrainGrid(g.seed);
  c.terrain.set(g.terrain);
  c.flags.set(g.flags);
  c.lodeIndex.set(g.lodeIndex);
  c.lodes = g.lodes.map((l) => ({ ...l }));
  return c;
}
