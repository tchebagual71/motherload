// Undo / redo records (02 §2.7, canon §4.11: ≥ 50 steps). Each record is applied forward (redo) or backward
// (undo) by the Factory through the same structure helpers its commands use. PURE MODULE.
import type { BuildingKind, Dir } from './api';
import type { JobShape } from './ghost';

/** Steps kept (canon §4.11 asks for ≥ 50). */
export const UNDO_DEPTH = 64;

/** Yard cell state in a belt diff: a belt word, or ROUTER_CELL for a Router entity. */
export const ROUTER_CELL = -1;

export interface Config {
  recipe: number;
  mode: number;
  primary: number;
  filter: number;
  unload: number;
}

/**
 * An underground job: pending as ghost `ghost`, or built (`ent` = entity id, or BUILT_TILES for a belt run), or
 * neither (0, 0). Records that concern the same job share one JobRef object, so ghost ids and built entity ids
 * stay right in every record without remapping.
 */
export interface JobRef {
  shape: JobShape;
  ghost: number;
  ent: number;
  /** Ent.serial of `ent`. */
  serial: number;
}
export const BUILT_TILES = -1;

export type UndoEntry =
  /** Yard crane placement; inverse: deconstruct. */
  | { t: 'place'; kind: BuildingKind; mk: number; x: number; y: number; dir: Dir; id: number; serial: number }
  /** Yard deconstruct; inverse: place again with its configuration. */
  | { t: 'unplace'; kind: BuildingKind; mk: number; x: number; y: number; dir: Dir; id: number; serial: number; cfg: Config }
  /** Yard belt paint / removal, Routers on T's included: per-cell before/after states. */
  | { t: 'belts'; cells: number[]; before: number[]; after: number[] }
  /** Underground jobs added (`adds`) or removed (built pieces deconstructed or ghosts dropped). */
  | { t: 'jobs'; adds: boolean; refs: JobRef[] }
  /** Configuration change. */
  | { t: 'config'; id: number; serial: number; before: Config; after: Config };

/** Point every record of incarnation `fromSerial` at its re-creation (a re-created building may get a new id). */
export function remapId(stack: UndoEntry[], fromSerial: number, toId: number, toSerial: number): void {
  for (const u of stack) {
    if ((u.t === 'place' || u.t === 'unplace' || u.t === 'config') && u.serial === fromSerial) {
      u.id = toId;
      u.serial = toSerial;
    }
  }
}

/** The shared record of ghost `ghost` (or of a structure built from jobs, by entity id), if any record has one. */
export function findRefs(stacks: readonly UndoEntry[][], match: (r: JobRef) => boolean): JobRef[] {
  const out: JobRef[] = [];
  for (const stack of stacks) {
    for (const u of stack) {
      if (u.t !== 'jobs') continue;
      for (const r of u.refs) if (match(r) && !out.includes(r)) out.push(r);
    }
  }
  return out;
}
