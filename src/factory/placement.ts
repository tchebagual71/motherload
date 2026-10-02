// The one synchronous placement validator (02 §2.5): red-ghost preview, confirm and ghost completion. PURE MODULE.
import { F, T, isSolid } from '../shared/types';
import { ARENA_ROW, BUILDINGS, type BuildingKind, type Dir, type Err, type ErrCode, type PodBox } from './api';
import { MINE, W, YARD, headframeFits, isRimBuildingCell } from './geom';
import { PART_RAIL, type JobShape } from './ghost';
import { item } from './items';
import type { FactoryState } from './state';

export function fail(code: ErrCode, extra?: Omit<Err, 'ok' | 'code'>): Err {
  return { ok: false, code, ...extra };
}

/** E_LOCKED: kind or Mk not unlocked (02 §9) or outside this build's scope (canon §5.5). */
export function lockErr(s: FactoryState, kind: BuildingKind, mk: number): Err | null {
  const spec = BUILDINGS[kind]?.mks[mk - 1];
  if (!spec) return fail('E_INVALID');
  if ((spec.scope === 'v1' && !s.v1) || !s.hasRung(spec.rung)) return fail('E_LOCKED', { rung: spec.rung });
  return null;
}

/** Cash and Stockpile parts for `n` copies of a Yard piece. */
export function costErr(s: FactoryState, kind: BuildingKind, mk: number, n: number, extraCash = 0): Err | null {
  const spec = BUILDINGS[kind].mks[mk - 1];
  const cash = spec.cash * n + extraCash;
  const have = s.wallet.cash();
  if (have < cash) return fail('E_FUNDS', { need: cash - have });
  for (const p of spec.parts) {
    const got = s.stockTotals[item(p.item).num];
    if (got < p.n * n) return fail('E_PARTS', { need: p.n * n - got, item: p.item });
  }
  return null;
}

/** Yard footprint: purchased rows, off the Rim strip and Rim buildings, free cells (E_YARD, E_OCCUPIED, E_COLUMN). */
export function yardCellsErr(s: FactoryState, kind: BuildingKind, x: number, y: number, ignore = 0): Err | null {
  const d = BUILDINGS[kind];
  for (let yy = y; yy < y + d.h; yy++) {
    for (let xx = x; xx < x + d.w; xx++) {
      if (xx < 0 || xx >= W || yy < 1 || yy > s.yardRows || isRimBuildingCell(xx, yy)) return fail('E_YARD', { x: xx, y: yy });
    }
  }
  if (kind === 'headframe' && !headframeFits(x, y)) return fail('E_COLUMN', { x, y });
  for (let yy = y; yy < y + d.h; yy++) {
    for (let xx = x; xx < x + d.w; xx++) {
      const c = yy * W + xx;
      const b = s.build[YARD][c];
      if ((b !== 0 && b !== ignore) || s.belt[YARD][c] !== 0) return fail('E_OCCUPIED', { x: xx, y: yy });
    }
  }
  return null;
}

/** Full Yard crane check (place / preview). */
export function checkPlace(s: FactoryState, kind: BuildingKind, mk: number, x: number, y: number, _dir: Dir): Err | null {
  if (!BUILDINGS[kind] || BUILDINGS[kind].yard === null) return fail('E_INVALID');
  return lockErr(s, kind, mk) ?? yardCellsErr(s, kind, x, y) ?? costErr(s, kind, mk, 1);
}

/** An underground job's cells and rules (02 §2.3–2.5). `self` = the job's own ghost id when re-checking it. */
export function checkJob(s: FactoryState, job: JobShape, self = 0): Err | null {
  const def = BUILDINGS[job.kind];
  if (!def || def.mine === null) return fail('E_INVALID');
  const lock = lockErr(s, job.kind, job.mk);
  if (lock) return lock;
  if (job.x < 0 || job.x + job.w > W || job.y < (job.kind === 'lift' ? 0 : 1) || job.h < 1) return fail('E_INVALID');
  if (job.kind === 'belt' && (job.dir & 1) !== 0) return fail('E_INVALID'); // underground belts run horizontally
  if (job.y + job.h - 1 >= ARENA_ROW) return fail('E_ARENA', { x: job.x, y: ARENA_ROW });
  if (job.kind === 'autoDrill') {
    const lode = lodeErr(s, job.x, job.y);
    if (lode) return lode;
  }
  for (let r = job.y; r < job.y + job.h; r++) {
    for (let x = job.x; x < job.x + job.w; x++) {
      const e = cellErr(s, job, x, r, self);
      if (e) return e;
    }
  }
  return null;
}

function cellErr(s: FactoryState, job: JobShape, x: number, r: number, self: number): Err | null {
  const g = s.grid;
  const c = r * W + x;
  const at = { x, y: r };
  const column = job.kind === 'lift';
  if ((g.flags[c] & F.SEEN) === 0) return fail('E_UNSEEN', at);
  if (g.terrain[c] !== T.AIR) return fail(column ? 'E_COLUMN' : 'E_SOLID', at);
  if (s.build[MINE][c] !== 0 || s.belt[MINE][c] !== 0) return fail(column ? 'E_COLUMN' : 'E_OCCUPIED', at);
  if (s.occ[c] !== 0) return fail('E_OCCUPIED', at);
  const gh = s.ghostAt[MINE][c];
  if (gh !== 0 && gh !== self) return fail(column ? 'E_COLUMN' : 'E_OCCUPIED', at);
  if ((job.kind === 'belt' || job.kind === 'router') && !isSolid(g.get(x, r + 1))) return fail('E_FLOOR', at);
  return null;
}

/** E_LODE (02 §2.4): 2×2 on rows top−2…top−1 over columns {lx, lx+1} or {lx+1, lx+2} of a discovered lode with no drill. */
function lodeErr(s: FactoryState, x: number, y: number): Err | null {
  const l = s.grid.lodes.find((k) => k.top === y + 2 && (x === k.x0 || x === k.x0 + 1));
  const ok = l !== undefined && l.discovered && (l.scope === 'mvp' || s.v1) && s.lodeDrill[l.id] === 0;
  return ok ? null : fail('E_LODE', { x, y });
}

/** Completion-only rules: E_POD for occupants, a lift below every rail section (02 §2.5–2.6). */
export function completionErr(s: FactoryState, job: JobShape, pod: PodBox): Err | null {
  if (BUILDINGS[job.kind].mine === 'occupant' && podTouches(job, pod)) return fail('E_POD', { x: job.x, y: job.y });
  if (job.part === PART_RAIL) {
    const below = job.y + job.h;
    const e = s.entAt(MINE, below * W + job.x);
    if (!e || e.kind !== 'lift' || e.y !== below) return fail('E_COLUMN', { x: job.x, y: below });
  }
  return null;
}

/** Cells the pod's box touches (x right, y up; row r spans y ∈ [−(r+1), −r]) overlap the footprint. */
function podTouches(job: JobShape, pod: PodBox): boolean {
  const x0 = Math.floor(pod.minX);
  const x1 = Math.ceil(pod.maxX) - 1;
  const r0 = Math.floor(-pod.maxY);
  const r1 = Math.ceil(-pod.minY) - 1;
  return x1 >= job.x && x0 < job.x + job.w && r1 >= job.y && r0 < job.y + job.h;
}
