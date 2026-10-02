// Belt topology: belt words, line (re)building and port resolution (02 §2.1–2.2, §3.4, §10.1; 04 §4.1, §4.4).
// Runs only inside commands and loads. Lines whose tiles are unchanged keep their id and items; the rest are
// rebuilt and their items keep their positions, any that would break spacing going to the Stockpile. PURE MODULE.
import type { Ent } from './ent';
import { MINE, YARD, opp, planeRows, step, W, type PlaneNum } from './geom';
import { Line, MAX_LINE_TILES, TILE_U, slotCell, slotDir, slotKey } from './line';
import type { FactoryState } from './state';

// ---------------------------------------------------------------- belt words (04 §4.1)

export const BELT_PRESENT = 0x8000;
export const BELT_JUNCTION = 0x4000;

export function beltWord(tier: number, dir: number): number {
  return BELT_PRESENT | (tier << 12) | (dir << 10);
}
export function junctionWord(tierA: number, dirA: number, tierB: number, dirB: number): number {
  return BELT_PRESENT | BELT_JUNCTION | (tierA << 12) | (dirA << 10) | (tierB << 8) | (dirB << 6);
}
export function wordTierA(w: number): number {
  return (w >> 12) & 3;
}
export function wordDirA(w: number): number {
  return (w >> 10) & 3;
}
export function wordTierB(w: number): number {
  return (w >> 8) & 3;
}
export function wordDirB(w: number): number {
  return (w >> 6) & 3;
}
export function isJunction(w: number): boolean {
  return (w & BELT_JUNCTION) !== 0;
}
/** Tier of the slot travelling `dir` in word w, or 0 if there is none. */
export function slotTier(w: number, dir: number): number {
  if ((w & BELT_PRESENT) === 0) return 0;
  if (((w >> 10) & 3) === dir) return (w >> 12) & 3;
  if ((w & BELT_JUNCTION) !== 0 && ((w >> 6) & 3) === dir) return (w >> 8) & 3;
  return 0;
}

// ---------------------------------------------------------------- slot links

/**
 * The belt slot feeding slot (cell, dir), or −1. Straight-behind wins; otherwise one side feeder makes a corner
 * (no side-loading: a second side feeder is left blocked, 02 §2.1). Junction slots only pass straight through.
 */
export function upstream(belts: Uint16Array, p: number, cell: number, dir: number): number {
  const behind = step(p, cell, opp(dir));
  if (behind >= 0 && slotTier(belts[behind], dir) !== 0) return slotKey(behind, dir);
  if (isJunction(belts[cell])) return -1;
  const e1 = (dir + 1) & 3;
  const s1 = step(p, cell, opp(e1));
  if (s1 >= 0 && slotTier(belts[s1], e1) !== 0) return slotKey(s1, e1);
  const e2 = (dir + 3) & 3;
  const s2 = step(p, cell, opp(e2));
  if (s2 >= 0 && slotTier(belts[s2], e2) !== 0) return slotKey(s2, e2);
  return -1;
}

/** The belt slot this slot feeds, or −1 (head-on, empty, or the next tile chose another feeder). */
export function downstream(belts: Uint16Array, p: number, slot: number): number {
  const dir = slotDir(slot);
  const n = step(p, slotCell(slot), dir);
  if (n < 0) return -1;
  const w = belts[n];
  if ((w & BELT_PRESENT) === 0) return -1;
  let cand: number;
  if (isJunction(w)) {
    if (slotTier(w, dir) === 0) return -1;
    cand = slotKey(n, dir);
  } else {
    const e = wordDirA(w);
    if (e === opp(dir)) return -1;
    cand = slotKey(n, e);
  }
  return upstream(belts, p, n, slotDir(cand)) === slot ? cand : -1;
}

function tierOf(belts: Uint16Array, slot: number): number {
  return slotTier(belts[slotCell(slot)], slotDir(slot));
}

/** Line owning a slot, or null. */
export function lineOfSlot(s: FactoryState, p: PlaneNum, slot: number): Line | null {
  const cell = slotCell(slot);
  const w = s.belt[p][cell];
  if (slotTier(w, slotDir(slot)) === 0) return null;
  const id = wordDirA(w) === slotDir(slot) ? s.cellLineA[p][cell] : s.cellLineB[p][cell];
  return s.lines[id] ?? null;
}
function indexOfSlot(s: FactoryState, p: PlaneNum, slot: number): number {
  const cell = slotCell(slot);
  return wordDirA(s.belt[p][cell]) === slotDir(slot) ? s.cellIdxA[p][cell] : s.cellIdxB[p][cell];
}

// ---------------------------------------------------------------- line rebuild

interface Candidate {
  plane: PlaneNum;
  tier: number;
  slots: number[];
}
interface Loose {
  plane: PlaneNum;
  slot: number;
  /** Distance from the tile's exit edge, 0..240. */
  off: number;
  item: number;
}

/** Recompute lines after belt tiles changed (02 §10.1). */
export function rebuildLines(s: FactoryState): void {
  const cands = collectCandidates(s);
  const keep = new Uint8Array(s.lines.length);
  const fresh: Candidate[] = [];
  for (const c of cands) {
    const old = lineOfSlot(s, c.plane, c.slots[0]);
    if (old && !keep[old.id] && sameTiles(old, c)) keep[old.id] = 1;
    else fresh.push(c);
  }
  const loose: Loose[] = [];
  for (let id = 1; id < s.lines.length; id++) {
    const l = s.lines[id];
    if (!l || keep[id]) continue;
    extract(l, loose);
    s.freeLine(id);
  }
  for (const c of fresh) {
    const id = s.allocLine();
    s.lines[id] = makeLine(s, id, c);
    s.wakeLine(id);
  }
  reindexSlots(s);
  reinsert(s, loose);
}

function collectCandidates(s: FactoryState): Candidate[] {
  const out: Candidate[] = [];
  for (const p of [YARD, MINE] as const) {
    const belts = s.belt[p];
    const seen = new Uint8Array(belts.length);
    const visit = (head: number): void => walk(belts, p, head, seen, out);
    forEachSlot(belts, (slot) => {
      if (isVisited(belts, seen, slot)) return;
      const d = downstream(belts, p, slot);
      if (d < 0 || tierOf(belts, d) !== tierOf(belts, slot)) visit(slot);
    });
    // What is left lies on closed loops: the first slot met in cell order is the head.
    forEachSlot(belts, (slot) => {
      if (!isVisited(belts, seen, slot)) visit(slot);
    });
  }
  return out;
}

function forEachSlot(belts: Uint16Array, fn: (slot: number) => void): void {
  for (let cell = 0; cell < belts.length; cell++) {
    const w = belts[cell];
    if (w === 0) continue;
    fn(slotKey(cell, wordDirA(w)));
    if (isJunction(w)) fn(slotKey(cell, wordDirB(w)));
  }
}

function layerBit(belts: Uint16Array, slot: number): number {
  return wordDirA(belts[slotCell(slot)]) === slotDir(slot) ? 1 : 2;
}
function isVisited(belts: Uint16Array, seen: Uint8Array, slot: number): boolean {
  return (seen[slotCell(slot)] & layerBit(belts, slot)) !== 0;
}

/** Follow feeders upstream from a head, cutting a new line every 128 tiles. */
function walk(belts: Uint16Array, p: PlaneNum, head: number, seen: Uint8Array, out: Candidate[]): void {
  const tier = tierOf(belts, head);
  let tiles: number[] = [];
  let cur = head;
  while (cur >= 0 && !isVisited(belts, seen, cur)) {
    seen[slotCell(cur)] |= layerBit(belts, cur);
    tiles.push(cur);
    if (tiles.length === MAX_LINE_TILES) {
      out.push({ plane: p, tier, slots: tiles });
      tiles = [];
    }
    const up = upstream(belts, p, slotCell(cur), slotDir(cur));
    cur = up >= 0 && tierOf(belts, up) === tier ? up : -1;
  }
  if (tiles.length > 0) out.push({ plane: p, tier, slots: tiles });
}

function sameTiles(l: Line, c: Candidate): boolean {
  if (l.plane !== c.plane || l.tier !== c.tier || l.slots.length !== c.slots.length) return false;
  for (let i = 0; i < c.slots.length; i++) if (l.slots[i] !== c.slots[i]) return false;
  return true;
}

/** A saved line's shell (load): same entry dirs and bounds as a rebuilt one. Items are appended by the caller. */
export function restoreLine(s: FactoryState, id: number, plane: PlaneNum, tier: number, slots: number[]): Line {
  return makeLine(s, id, { plane, tier, slots });
}

function makeLine(s: FactoryState, id: number, c: Candidate): Line {
  const belts = s.belt[c.plane];
  const n = c.slots.length;
  const entry = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (i + 1 < n) entry[i] = slotDir(c.slots[i + 1]);
    else {
      const up = upstream(belts, c.plane, slotCell(c.slots[i]), slotDir(c.slots[i]));
      entry[i] = slotDir(up >= 0 ? up : c.slots[i]);
    }
  }
  const l = new Line(id, c.plane, c.tier, Int32Array.from(c.slots), entry);
  let x0 = W;
  let y0 = planeRows(c.plane);
  let x1 = -1;
  let y1 = -1;
  for (const slot of c.slots) {
    const cell = slotCell(slot);
    const x = cell % W;
    const y = Math.floor(cell / W);
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  l.bx0 = x0;
  l.by0 = y0;
  l.bx1 = x1;
  l.by1 = y1;
  return l;
}

/** Lift every item off a line as (slot, offset from the tile's exit edge). */
function extract(l: Line, out: Loose[]): void {
  let pos = 0;
  const last = l.slots.length - 1;
  for (let i = 0; i < l.n; i++) {
    pos += l.gapAt(i);
    const k = Math.min(Math.floor(pos / TILE_U), last);
    out.push({ plane: l.plane as PlaneNum, slot: l.slots[k], off: pos - k * TILE_U, item: l.itemAt(i) });
  }
  l.clear();
}

export function reindexSlots(s: FactoryState): void {
  for (const p of [YARD, MINE] as const) {
    s.cellLineA[p].fill(0);
    s.cellLineB[p].fill(0);
  }
  for (const l of s.lines) {
    if (!l) continue;
    const p = l.plane as PlaneNum;
    const belts = s.belt[p];
    for (let i = 0; i < l.slots.length; i++) {
      const cell = slotCell(l.slots[i]);
      if (wordDirA(belts[cell]) === slotDir(l.slots[i])) {
        s.cellLineA[p][cell] = l.id;
        s.cellIdxA[p][cell] = i;
      } else {
        s.cellLineB[p][cell] = l.id;
        s.cellIdxB[p][cell] = i;
      }
    }
  }
}

/** Put loose items back at their positions on the new lines; spacing breaks and removed tiles displace them. */
function reinsert(s: FactoryState, loose: Loose[]): void {
  const byLine: { pos: number; item: number }[][] = [];
  for (const it of loose) {
    const l = lineOfSlot(s, it.plane, it.slot);
    if (!l) {
      s.displace(it.item);
      continue;
    }
    (byLine[l.id] ??= []).push({ pos: indexOfSlot(s, it.plane, it.slot) * TILE_U + it.off, item: it.item });
  }
  for (let id = 1; id < byLine.length; id++) {
    const list = byLine[id];
    if (!list) continue;
    const l = s.lines[id] as Line;
    list.sort((a, b) => a.pos - b.pos || a.item - b.item);
    let prev = 0;
    for (const it of list) {
      if (l.n === 0 || it.pos - prev >= l.S) {
        l.appendAt(it.pos, it.item);
        prev = it.pos;
      } else s.displace(it.item);
    }
  }
}

// ---------------------------------------------------------------- ports (02 §2.2–2.3, §3.4)

/** Resolve every line's target and feeder and every node's ports. */
export function resolvePorts(s: FactoryState): void {
  for (const e of s.ents) if (e) resetPorts(e);
  for (const l of s.lines) {
    if (!l) continue;
    l.targetNode = l.targetLine = l.feederNode = l.feederLine = l.targetSide = 0;
    const p = l.plane as PlaneNum;
    const belts = s.belt[p];
    const head = l.slots[0];
    const d = downstream(belts, p, head);
    if (d >= 0) l.targetLine = (lineOfSlot(s, p, d) as Line).id;
    else attachTarget(s, l, p, head);
    const tail = l.slots[l.slots.length - 1];
    const u = upstream(belts, p, slotCell(tail), slotDir(tail));
    if (u >= 0) l.feederLine = (lineOfSlot(s, p, u) as Line).id;
    else attachFeeder(s, l, p, tail);
  }
  for (const e of s.ents) if (e) attachDirect(s, e);
}

function resetPorts(e: Ent): void {
  e.inLines.length = 0;
  e.inSides.length = 0;
  e.outLines.length = 0;
  e.pushTo.length = 0;
  e.feeders.length = 0;
  e.sideIn.fill(0);
  e.sideOut.fill(0);
  // Round-robin pointers survive (saves must replay exactly); users take them modulo the port count.
}

const horizontal = (d: number): boolean => d === 0 || d === 2;

/** Does `e` take a belt arriving on its `side` edge at plane cell `cell` (02 §2.2 ports)? */
function takesFrom(e: Ent, p: PlaneNum, cell: number, side: number): boolean {
  if (p === YARD) {
    switch (e.kind) {
      case 'smelter':
      case 'assembler':
        return side !== e.dir;
      case 'bin':
      case 'export':
      case 'router':
        return true;
      default:
        return false; // Headframe in lift mode takes only its lift (v1 chute mode adds belts)
    }
  }
  if (!horizontal(side)) return false;
  if (e.kind === 'router') return true;
  return e.kind === 'lift' && Math.floor(cell / W) === e.foot;
}

/** Does `e` push onto a belt starting next to its cell `cell` and pointing away along `d`? */
function feedsOut(e: Ent, p: PlaneNum, cell: number, d: number): boolean {
  if (p === YARD) {
    switch (e.kind) {
      case 'smelter':
      case 'assembler':
      case 'bin':
        return d === e.dir;
      case 'headframe':
        return d !== 3; // its three Yard-side edges (02 §3.4)
      case 'router':
        return true;
      default:
        return false;
    }
  }
  if (!horizontal(d)) return false;
  if (e.kind === 'autoDrill' || e.kind === 'router') return true;
  return e.kind === 'lift' && e.y > 0 && Math.floor(cell / W) === e.y;
}

function attachTarget(s: FactoryState, l: Line, p: PlaneNum, head: number): void {
  const dir = slotDir(head);
  const n = step(p, slotCell(head), dir);
  const e = s.entAt(p, n);
  const side = opp(dir);
  if (!e || !takesFrom(e, p, n, side)) return;
  l.targetNode = e.id;
  l.targetSide = side;
  e.inLines.push(l.id);
  e.inSides.push(side);
  if (e.kind === 'router') e.sideIn[side] = l.id;
}

function attachFeeder(s: FactoryState, l: Line, p: PlaneNum, tail: number): void {
  const dir = slotDir(tail);
  const at = step(p, slotCell(tail), opp(dir));
  const e = s.entAt(p, at);
  if (!e || !feedsOut(e, p, at, dir)) return;
  l.feederNode = e.id;
  e.outLines.push(l.id);
  if (e.kind === 'router') e.sideOut[dir] = l.id;
}

/** Direct node → node pushes: drill → adjacent lift foot; lift top → its Headframe or a relay lift foot (02 §3.4). */
function attachDirect(s: FactoryState, e: Ent): void {
  if (e.kind === 'autoDrill') {
    for (let r = e.y; r < e.y + e.h; r++) {
      link(s, e, liftFootAt(s, e.x - 1, r));
      link(s, e, liftFootAt(s, e.x + e.w, r));
    }
  } else if (e.kind === 'lift') {
    if (e.y === 0) {
      const hf = s.entAt(YARD, 1 * W + e.x);
      if (hf && hf.kind === 'headframe') link(s, e, hf);
    } else {
      link(s, e, liftFootAt(s, e.x - 1, e.y));
      link(s, e, liftFootAt(s, e.x + 1, e.y));
    }
  }
}

function liftFootAt(s: FactoryState, x: number, r: number): Ent | null {
  if (x < 0 || x >= W) return null;
  const e = s.entAt(MINE, r * W + x);
  return e && e.kind === 'lift' && e.foot === r ? e : null;
}

function link(s: FactoryState, from: Ent, to: Ent | null): void {
  if (!to || to === from) return;
  from.pushTo.push(to.id);
  to.feeders.push(from.id);
}
