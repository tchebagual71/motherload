// Structure mutations shared by commands, undo and loading: entities, belt tiles, ghosts and the grid layers
// they write (02 §10.1: structure changes only in commands). PURE MODULE.
import { BUILDINGS, type BuildingKind, type Dir, type Plane } from './api';
import { Ent } from './ent';
import { MINE, W, YARD, planeNum, type PlaneNum } from './geom';
import { Ghost, MAX_GHOSTS, type JobShape } from './ghost';
import { liftTransitTicks } from './nodes';
import { Q16 } from './ent';
import type { FactoryState } from './state';
import { rebuildLines, resolvePorts } from './topology';

/** Create an entity and write its cells. Returns null when the id space is exhausted. */
export function createEnt(s: FactoryState, kind: BuildingKind, mk: number, plane: Plane, x: number, y: number, dir: Dir, h = BUILDINGS[kind].h, id = s.allocEnt()): Ent | null {
  if (id === 0) return null;
  const def = BUILDINGS[kind];
  const e = new Ent(id, kind, mk, plane, x, y, def.w, h, dir);
  e.serial = s.serialSeq++;
  s.ents[id] = e;
  writeCells(s, e, id);
  if (kind === 'lift') e.transit = liftTransitTicks(mk, h - 1) * Q16;
  s.wakeEnt(id);
  return e;
}

/** Remove an entity's cells and free its id (contents are the caller's business). */
export function destroyEnt(s: FactoryState, e: Ent): void {
  writeCells(s, e, 0);
  if (e.lodeId >= 0 && s.lodeDrill[e.lodeId] === e.id) s.lodeDrill[e.lodeId] = 0;
  s.freeEnt(e.id);
}

/** Write (id) or clear (0) an entity's footprint in the plane layers and the mine grid, then refresh anchors. */
function writeCells(s: FactoryState, e: Ent, id: number): void {
  const p = planeNum(e.plane);
  const occupant = p === MINE && e.def.mine === 'occupant';
  for (let y = e.y; y < e.y + e.h; y++) {
    for (let x = e.x; x < e.x + e.w; x++) {
      const c = y * W + x;
      if (p === YARD) s.build[YARD][c] = id;
      else if (occupant) s.setOccupant(c, id);
      else {
        s.build[MINE][c] = id;
        s.setMount(c, id);
      }
    }
  }
  if (p === MINE) for (let x = e.x; x < e.x + e.w; x++) for (let y = e.y; y <= e.y + e.h; y++) s.refreshAnchor(x, y);
}

/** Grow a lift upward by a rail section (02 §3.4): the queue keeps its items, transit rescales. */
export function extendLift(s: FactoryState, e: Ent, top: number): void {
  const rows = e.y - top;
  for (let y = top; y < e.y; y++) {
    const c = y * W + e.x;
    s.build[MINE][c] = e.id;
    s.setMount(c, e.id);
  }
  e.h += rows;
  e.y = top;
  e.rails++;
  e.transit = liftTransitTicks(e.mk, e.h - 1) * Q16;
}

/** Set one belt cell's word (0 clears it); mine cells mirror into grid.mount and re-anchor the floor. */
export function setBelt(s: FactoryState, p: PlaneNum, cell: number, word: number): void {
  s.belt[p][cell] = word;
  if (p !== MINE) return;
  s.setMount(cell, word);
  s.refreshAnchor(cell % W, Math.floor(cell / W) + 1);
}

/** After any structure change: rebuild lines (if belts moved), resolve ports, wake everything, bump the version. */
export function structureChanged(s: FactoryState, belts: boolean): void {
  if (belts) rebuildLines(s);
  resolvePorts(s);
  s.wakeAll();
  s.topologyVersion++;
}

// ---------------------------------------------------------------- ghosts

export function addGhost(s: FactoryState, j: JobShape, id = allocGhost(s), order = s.ghostSeq++): Ghost | null {
  if (id === 0) return null;
  const g = new Ghost(id, order, j.kind, j.mk, j.x, j.y, j.w, j.h, j.dir, j.part, j.kit, j.units);
  s.ghosts[id] = g;
  markGhost(s, g, id);
  return g;
}

export function dropGhost(s: FactoryState, g: Ghost): void {
  markGhost(s, g, 0);
  s.ghosts[g.id] = null;
  s.ghostFree.push(g.id);
}

export function ghostCount(s: FactoryState): number {
  let n = 0;
  for (const g of s.ghosts) if (g) n++;
  return n;
}

function allocGhost(s: FactoryState): number {
  if (ghostCount(s) >= MAX_GHOSTS) return 0;
  if (s.ghostFree.length > 0) return s.ghostFree.pop() as number;
  s.ghosts.push(null);
  return s.ghosts.length - 1;
}

function markGhost(s: FactoryState, g: Ghost, id: number): void {
  for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) s.ghostAt[MINE][y * W + x] = id;
}
