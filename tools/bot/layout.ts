// Economy bot Yard planner: lays out the whole workshop on a virtual Yard before the first crane command, so no
// later belt is boxed in. Machines go down in order; each candidate spot and facing is kept only if every belt to
// the machines already placed routes (BFS, 02 §2.2 port rules: a belt leaves a machine from its facing edge,
// pointing away, and enters any other edge; Bins, Export Terminals and Routers take every edge). A failed attempt
// restarts with fresh jitter.
import { DIR, type BuildingKind, type Dir, type FactoryApi } from '../../src/factory/api';
import { RIM_BUILDINGS } from '../../src/shared/canon';
import type { Rng } from '../../src/shared/rng';

const W = 48;
/** Rows the plan may use: the Yard after Expansion I (canon §3.1). */
export const PLAN_ROWS = 16;
/** Rows before Expansion I. */
const START_ROWS = 8;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export type Key = 'A2' | 'RW' | 'EX' | 'BW' | 'BI' | 'SL' | 'R1' | 'R2' | 'BFe' | 'BCo' | 'BAu' | 'A3' | 'BP' | 'A1' | 'A6' | 'A5';
type Kind = Extract<BuildingKind, 'bin' | 'smelter' | 'assembler' | 'export' | 'router'>;

export interface PlanMachine {
  key: Key;
  kind: Kind;
  x: number;
  y: number;
  dir: Dir;
  /** 1 wire chain (8-row Yard), 2 Hull Plate workshop, 3 assembly. */
  stage: number;
  recipe?: string;
}

export interface PlanRoute {
  from: Key;
  to: Key;
  path: { x: number; y: number }[];
  /** Direction of the last tile (into `to`). */
  end: Dir;
  /** Direction of the first tile (out of `from`): a Router's primary when it is the primary route. */
  first: Dir;
  stage: number;
}

export interface YardPlan {
  machines: Map<Key, PlanMachine>;
  routes: PlanRoute[];
}

interface Spec {
  key: Key;
  kind: Kind;
  stage: number;
  recipe?: string;
  /** Machines it should sit near. */
  near: Key[];
}

/** Placement order (A2 and RW are fixed next to the survey set). */
const SPECS: readonly Spec[] = [
  { key: 'BI', kind: 'bin', stage: 1, near: [] },
  { key: 'BW', kind: 'bin', stage: 1, near: ['RW'] },
  { key: 'EX', kind: 'export', stage: 1, near: ['RW'] },
  { key: 'SL', kind: 'smelter', stage: 2, near: ['BI'] },
  { key: 'R1', kind: 'router', stage: 2, near: ['SL'] },
  { key: 'BFe', kind: 'bin', stage: 2, near: ['R1'] },
  { key: 'R2', kind: 'router', stage: 2, near: ['R1'] },
  { key: 'BCo', kind: 'bin', stage: 2, near: ['R2', 'BFe'] },
  { key: 'BAu', kind: 'bin', stage: 2, near: ['R2'] },
  { key: 'A3', kind: 'assembler', stage: 2, recipe: 'A3', near: ['BFe', 'BCo'] },
  { key: 'BP', kind: 'bin', stage: 2, near: ['A3'] },
  { key: 'A1', kind: 'assembler', stage: 3, recipe: 'A1', near: ['BFe'] },
  { key: 'A6', kind: 'assembler', stage: 3, recipe: 'A6', near: ['A1', 'BP', 'BW'] },
  { key: 'A5', kind: 'assembler', stage: 3, recipe: 'A5', near: ['BW', 'BAu', 'BP'] },
];

/**
 * Belts, in build order; the first route out of a Router is its primary. `alt`: other Bins that will do as the
 * target (every Bin is Stockpile, canon §2.8), tried in order when `to` has no free edge left.
 */
export const EDGES: readonly { from: Key; to: Key; alt?: readonly Key[] }[] = [
  { from: 'RW', to: 'BW' },
  { from: 'RW', to: 'EX' },
  { from: 'BI', to: 'SL' },
  { from: 'SL', to: 'R1' },
  { from: 'R1', to: 'BFe' },
  { from: 'R1', to: 'R2' },
  { from: 'R2', to: 'BCo' },
  { from: 'R2', to: 'BAu' },
  { from: 'BFe', to: 'A3' },
  { from: 'BCo', to: 'A3' },
  { from: 'A3', to: 'BP' },
  { from: 'BFe', to: 'A1' },
  { from: 'A1', to: 'A6' },
  { from: 'BP', to: 'A6' },
  { from: 'BW', to: 'A6' },
  { from: 'A6', to: 'BP', alt: ['BW', 'BFe', 'BCo'] },
  { from: 'BW', to: 'A5' },
  { from: 'BAu', to: 'A5' },
  { from: 'A5', to: 'BP', alt: ['BW', 'BAu', 'BCo', 'BFe'] },
];

const HAS_OUTPUT: ReadonlySet<string> = new Set(['bin', 'smelter', 'assembler']);
const TAKES_ALL_SIDES: ReadonlySet<string> = new Set(['bin', 'export', 'router']);
const size = (k: Kind): number => (k === 'router' ? 1 : 2);

function isRim(x: number, y: number): boolean {
  if (y < 1 || y > 3) return false;
  for (const b of RIM_BUILDINGS) if (x >= b.x0 && x <= b.x1) return true;
  return false;
}

/** Cells next to a footprint's side `d` (0 E, 1 S, 2 W, 3 N). */
function sideCells(m: { x: number; y: number }, s: number, d: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (d === DIR.S) for (let x = m.x; x < m.x + s; x++) out.push({ x, y: m.y + s });
  if (d === DIR.N) for (let x = m.x; x < m.x + s; x++) out.push({ x, y: m.y - 1 });
  if (d === DIR.E) for (let y = m.y; y < m.y + s; y++) out.push({ x: m.x + s, y });
  if (d === DIR.W) for (let y = m.y; y < m.y + s; y++) out.push({ x: m.x - 1, y });
  return out;
}

/** The virtual Yard: 0 free, 1 machine, 2 belt, 3 blocked (Rim building, row 0, off the plan). */
class Grid {
  readonly c = new Uint8Array(W * (PLAN_ROWS + 1));
  constructor(src?: Grid) {
    if (src) this.c.set(src.c);
  }
  get(x: number, y: number): number {
    if (x < 0 || x >= W || y < 0 || y > PLAN_ROWS) return 3;
    return this.c[y * W + x];
  }
  set(x: number, y: number, v: number): void {
    this.c[y * W + x] = v;
  }
}

class Attempt {
  readonly g: Grid;
  /** Search nodes left before this attempt gives up (keeps the backtracking bounded). */
  budget = 300;
  readonly machines = new Map<Key, PlanMachine>();
  readonly routes: PlanRoute[] = [];
  /** Port cells already used per machine. */
  private readonly used = new Map<Key, Set<number>>();

  constructor(base: Grid) {
    this.g = new Grid(base);
  }

  place(m: PlanMachine): void {
    const s = size(m.kind);
    for (let y = m.y; y < m.y + s; y++) for (let x = m.x; x < m.x + s; x++) this.g.set(x, y, 1);
    this.machines.set(m.key, m);
  }

  unplace(m: PlanMachine): void {
    const s = size(m.kind);
    for (let y = m.y; y < m.y + s; y++) for (let x = m.x; x < m.x + s; x++) this.g.set(x, y, 0);
    this.machines.delete(m.key);
  }

  /** Output ports of `m` (cell + first direction). Routers: every side. */
  ports(m: PlanMachine): { x: number; y: number; d: Dir }[] {
    const s = size(m.kind);
    const dirs: Dir[] = m.kind === 'router' ? [0, 1, 2, 3] : [m.dir];
    const out: { x: number; y: number; d: Dir }[] = [];
    for (const d of dirs) for (const p of sideCells(m, s, d)) out.push({ ...p, d });
    return out;
  }

  /** Cells kept clear for machines' unused output ports (and the cell after each), except `source`'s. */
  reserved(source: Key | null): Set<number> {
    const out = new Set<number>();
    for (const m of this.machines.values()) {
      if (m.key === source || !HAS_OUTPUT.has(m.kind)) continue;
      const used = this.used.get(m.key);
      for (const p of this.ports(m)) {
        const c = p.y * W + p.x;
        if (used?.has(c)) continue;
        out.add(c);
        out.add((p.y + DY[p.d]) * W + p.x + DX[p.d]);
      }
    }
    return out;
  }

  /** Route a belt `from` → `to` on free cells within `maxRow`; marks it and returns it, or null. */
  route(from: PlanMachine, to: PlanMachine, maxRow: number, stage: number): PlanRoute | null {
    const g = this.g;
    const reserved = this.reserved(from.key);
    const free = (x: number, y: number): boolean => y <= maxRow && g.get(x, y) === 0 && !reserved.has(y * W + x);
    const goals = new Map<number, Dir>();
    const ts = size(to.kind);
    for (let d = 0; d < 4; d++) {
      if (!TAKES_ALL_SIDES.has(to.kind) && d === to.dir) continue;
      for (const p of sideCells(to, ts, d)) goals.set(p.y * W + p.x, ((d + 2) & 3) as Dir);
    }
    const used = this.used.get(from.key) ?? new Set<number>();
    const starts = this.ports(from).filter((p) => !used.has(p.y * W + p.x) && free(p.x, p.y));
    let found: { cells: number[]; end: Dir; first: Dir } | null = null;
    for (const s of starts) {
      const c0 = s.y * W + s.x;
      const g0 = goals.get(c0);
      if (g0 !== undefined && g0 === s.d) {
        found = { cells: [c0], end: g0, first: s.d };
        break;
      }
    }
    if (!found) {
      const prev = new Map<number, number>();
      const first = new Map<number, Dir>();
      const queue: number[] = [];
      for (const s of starts) {
        const nx = s.x + DX[s.d];
        const ny = s.y + DY[s.d];
        if (!free(nx, ny)) continue;
        const c0 = s.y * W + s.x;
        const c1 = ny * W + nx;
        if (prev.has(c1) || prev.has(c0)) continue;
        prev.set(c0, -1);
        prev.set(c1, c0);
        first.set(c1, s.d);
        queue.push(c1);
      }
      for (let qi = 0; qi < queue.length && !found; qi++) {
        const c = queue[qi];
        const gd = goals.get(c);
        if (gd !== undefined) {
          const cells: number[] = [];
          for (let k = c; k >= 0; k = prev.get(k) ?? -1) cells.push(k);
          cells.reverse();
          found = { cells, end: gd, first: first.get(c) as Dir };
          break;
        }
        const x = c % W;
        const y = Math.floor(c / W);
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          if (!free(nx, ny)) continue;
          const n = ny * W + nx;
          if (prev.has(n)) continue;
          prev.set(n, c);
          first.set(n, first.get(c) as Dir);
          queue.push(n);
        }
      }
    }
    if (!found) return null;
    for (const c of found.cells) g.c[c] = 2;
    used.add(found.cells[0]);
    this.used.set(from.key, used);
    const r: PlanRoute = { from: from.key, to: to.key, path: found.cells.map((c) => ({ x: c % W, y: Math.floor(c / W) })), end: found.end, first: found.first, stage };
    this.routes.push(r);
    return r;
  }

  unroute(r: PlanRoute): void {
    for (const p of r.path) this.g.set(p.x, p.y, 0);
    this.used.get(r.from)?.delete(r.path[0].y * W + r.path[0].x);
    this.routes.splice(this.routes.indexOf(r), 1);
  }
}

/**
 * Plan the workshop around the survey set at Headframe column `hx`, on the `side` (+1 east, −1 west) with the
 * most room. Returns null when no attempt routes everything.
 */
export function planYard(f: FactoryApi, hx: number, side: 1 | -1, rng: Rng, attempts = 40): YardPlan | null {
  const base = new Grid();
  const build = f.yardBuildings();
  const belts = f.beltWords('yard');
  const surveyBin = f.entities().find((e) => e.kind === 'bin' && e.rusted);
  for (let y = 0; y <= PLAN_ROWS; y++) {
    for (let x = 0; x < W; x++) {
      if (y === 0 || isRim(x, y)) base.set(x, y, 3);
      else if (build[y * W + x] && build[y * W + x] !== surveyBin?.id) base.set(x, y, 1);
      else if (belts[y * W + x]) base.set(x, y, 2);
    }
  }
  base.set(hx, 6, 2); // Smelter → Wire Assembler
  const out: Dir = side > 0 ? DIR.E : DIR.W;
  const a2: PlanMachine = { key: 'A2', kind: 'assembler', x: hx, y: 7, dir: out, stage: 1, recipe: 'A2' };
  const portX = side > 0 ? hx + 2 : hx - 1;
  const rw: PlanMachine = { key: 'RW', kind: 'router', x: portX + side, y: 7, dir: out, stage: 1 };
  for (let k = 0; k < attempts; k++) {
    const a = new Attempt(base);
    a.place(a2);
    a.g.set(portX, 7, 2); // Assembler → Router
    a.place(rw);
    if (fill(a, 0, hx, side, rng, k === 0 ? 0 : 6)) return { machines: a.machines, routes: a.routes };
  }
  return null;
}

/** Place SPECS[i…] by depth-first search over the best few candidates each. */
function fill(a: Attempt, i: number, hx: number, side: number, rng: Rng, jitter: number): boolean {
  if (i >= SPECS.length) return true;
  if (--a.budget < 0) return false;
  const spec = SPECS[i];
  const s = size(spec.kind);
  const maxRow = spec.stage === 1 ? START_ROWS : PLAN_ROWS;
  const dirs: Dir[] = HAS_OUTPUT.has(spec.kind) ? [DIR.S, DIR.E, DIR.W, DIR.N] : [DIR.S];
  const anchor = spec.near.map((k) => a.machines.get(k)).filter((m): m is PlanMachine => !!m);
  const cands: { x: number; y: number; score: number }[] = [];
  for (let y = 4; y + s - 1 <= maxRow; y++) {
    for (let x = 0; x + s - 1 < W; x++) {
      let ok = true;
      for (let yy = y; yy < y + s && ok; yy++) for (let xx = x; xx < x + s && ok; xx++) ok = a.g.get(xx, yy) === 0;
      if (!ok) continue;
      let score = 0;
      for (const m of anchor) score += Math.abs(x - m.x) + Math.abs(y - m.y);
      if (anchor.length === 0) score += Math.abs(x - (hx + side * 9)) + Math.abs(y - 4);
      if (side * (x - hx) < 0) score += 30;
      score += jitter * rng.next();
      cands.push({ x, y, score });
    }
  }
  cands.sort((p, q) => p.score - q.score);
  const reserved = a.reserved(null);
  // Evaluate the closest spots × facings; keep the feasible ones, best (least new belt) first.
  const options: { m: PlanMachine; cost: number }[] = [];
  let tried = 0;
  for (const c of cands) {
    if (tried >= 24 || options.length >= 6) break;
    let clash = false;
    for (let yy = c.y; yy < c.y + s && !clash; yy++) for (let xx = c.x; xx < c.x + s && !clash; xx++) clash = reserved.has(yy * W + xx);
    if (clash) continue;
    for (const d of dirs) {
      const m: PlanMachine = { key: spec.key, kind: spec.kind, x: c.x, y: c.y, dir: d, stage: spec.stage, recipe: spec.recipe };
      tried++;
      const added = tryPlace(a, m, spec);
      if (!added) continue;
      let belt = 0;
      for (const r of added) belt += r.path.length;
      options.push({ m, cost: belt + 0.5 * c.score });
      undo(a, m, added);
    }
  }
  options.sort((p, q) => p.cost - q.cost);
  for (const o of options) {
    const added = tryPlace(a, o.m, spec);
    if (!added) continue;
    if (fill(a, i + 1, hx, side, rng, jitter)) return true;
    undo(a, o.m, added);
  }
  return false;
}

/** Place `m` and route its belts to the machines already placed; null (and nothing changed) if any belt fails. */
function tryPlace(a: Attempt, m: PlanMachine, spec: Spec): PlanRoute[] | null {
  a.place(m);
  const added: PlanRoute[] = [];
  // Its own ports need room for a belt to start.
  let ok = !HAS_OUTPUT.has(m.kind) || a.ports(m).some((p) => a.g.get(p.x, p.y) === 0 && a.g.get(p.x + DX[p.d], p.y + DY[p.d]) === 0);
  for (const e of EDGES) {
    if (!ok) break;
    if (e.from !== spec.key && e.to !== spec.key) continue;
    const from = a.machines.get(e.from);
    if (!from) continue;
    let r: PlanRoute | null = null;
    let any = false;
    for (const k of [e.to, ...(e.from === spec.key ? (e.alt ?? []) : [])]) {
      const to = a.machines.get(k);
      if (!to) continue;
      any = true;
      const stage = Math.max(from.stage, to.stage, spec.stage);
      r = a.route(from, to, stage === 1 ? START_ROWS : PLAN_ROWS, stage);
      if (r) break;
    }
    if (!any) continue;
    if (!r) ok = false;
    else added.push(r);
  }
  if (ok) return added;
  undo(a, m, added);
  return null;
}

function undo(a: Attempt, m: PlanMachine, added: PlanRoute[]): void {
  for (const r of [...added].reverse()) a.unroute(r);
  a.unplace(m);
}
