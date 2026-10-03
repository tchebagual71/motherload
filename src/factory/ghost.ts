// Underground ghost jobs (02 §2.6): a job is one Kit's worth of structure, built when the pod has stayed near it
// for 1.0 s and calls completeGhost. PURE MODULE.
import { BUILDINGS, LIFT_RAIL_KIT, type BuildingKind, type Dir, type GhostSpec, type GhostView } from './api';

/** Belt run per job (02 §2.6: ≤ 8 tiles in one row, one Belt Kit). */
export const BELT_JOB_TILES = 8;
/** Lift Foot Kit: the foot plus ≤ 31 rows; each Lift Rail ≤ 32 rows (02 §3.4). */
export const LIFT_SECTION_ROWS = 32;
/** ≤ 256 pending jobs (02 §2.6). */
export const MAX_GHOSTS = 256;

export const PART_NONE = 0;
export const PART_FOOT = 1;
export const PART_RAIL = 2;

export class Ghost implements GhostView {
  constructor(
    readonly id: number,
    readonly order: number,
    readonly kind: BuildingKind,
    readonly mk: number,
    /** Footprint min corner (belt runs: leftmost tile; lift sections: top row). */
    readonly x: number,
    readonly y: number,
    readonly w: number,
    readonly h: number,
    readonly dir: Dir,
    readonly partCode: number,
    readonly kit: string,
    readonly kitUnits: number,
  ) {}

  get part(): 'foot' | 'rail' | null {
    return this.partCode === PART_FOOT ? 'foot' : this.partCode === PART_RAIL ? 'rail' : null;
  }
  /** The job's shape (undo of removeGhost recreates exactly this job). */
  shape(): JobShape {
    return { kind: this.kind, mk: this.mk, x: this.x, y: this.y, w: this.w, h: this.h, dir: this.dir, part: this.partCode, kit: this.kit, units: this.kitUnits };
  }
}

/** One job of a ghost spec, before ids are assigned. */
export interface JobShape {
  kind: BuildingKind;
  mk: number;
  x: number;
  y: number;
  w: number;
  h: number;
  dir: Dir;
  part: number;
  kit: string;
  units: number;
}

/** Split a spec into Kit-sized jobs (02 §2.6). Belt runs normalise to their leftmost tile. */
export function jobsOf(spec: GhostSpec): JobShape[] {
  const mk = spec.kind === 'router' ? 1 : (spec.mk ?? 1);
  const kitOf = (kind: BuildingKind): string => BUILDINGS[kind].mks[mk - 1]?.kit ?? '';
  switch (spec.kind) {
    case 'belt': {
      const jobs: JobShape[] = [];
      const step = spec.dir === 2 ? -1 : 1;
      for (let done = 0; done < spec.length; done += BELT_JOB_TILES) {
        const n = Math.min(BELT_JOB_TILES, spec.length - done);
        const a = spec.x + step * done;
        const b = a + step * (n - 1);
        jobs.push({ kind: 'belt', mk, x: Math.min(a, b), y: spec.y, w: n, h: 1, dir: spec.dir, part: PART_NONE, kit: kitOf('belt'), units: n });
      }
      return jobs;
    }
    case 'router':
      return [{ kind: 'router', mk: 1, x: spec.x, y: spec.y, w: 1, h: 1, dir: 0, part: PART_NONE, kit: kitOf('router'), units: 1 }];
    case 'autoDrill':
      return [{ kind: 'autoDrill', mk, x: spec.x, y: spec.y, w: 2, h: 2, dir: 0, part: PART_NONE, kit: kitOf('autoDrill'), units: 1 }];
    case 'lift': {
      const jobs: JobShape[] = [];
      let bottom = spec.foot;
      while (bottom >= spec.top) {
        const top = Math.max(spec.top, bottom - LIFT_SECTION_ROWS + 1);
        const foot = jobs.length === 0;
        jobs.push({ kind: 'lift', mk, x: spec.x, y: top, w: 1, h: bottom - top + 1, dir: 0, part: foot ? PART_FOOT : PART_RAIL, kit: foot ? kitOf('lift') : LIFT_RAIL_KIT, units: 1 });
        bottom = top - 1;
      }
      return jobs;
    }
  }
}
