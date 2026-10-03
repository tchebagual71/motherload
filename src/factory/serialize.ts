// Factory save sections (04 §4.9): FMET (meta), FENT (entities), FLIN (belts and lines), FINV (inventories),
// FQUE (lift queues), FGHO (ghost jobs). The World embeds the whole blob as its FACT section. The state hash is
// FNV-1a 32 over FENT, FLIN, FINV and FQUE (02 §10.9). Awake sets, statuses and flow counters are derived and
// left out: a load wakes everything, which replays exactly (02 §10.8). Every read is bounds-checked. PURE MODULE.
import { MINE_H } from '../shared/canon';
import { BUILDINGS, MVP_KINDS, V1_KINDS, type BuildingKind, type Dir } from './api';
import { FactoryLoadError, Reader, Writer, fnv1a } from './bytes';
import { addGhost, createEnt, setBelt, structureChanged } from './build';
import type { Ent } from './ent';
import { MAX_ID, type FactoryState } from './state';
import { MINE, W, YARD, YARD_H, type PlaneNum } from './geom';
import { ITEMS, itemByNum, kitItemId } from './items';
import { slotCell, slotDir, slotKey } from './line';
import { RECIPES } from './recipes';
import { reindexSlots, restoreLine } from './topology';

export const FACTORY_SAVE_VERSION = 1;
const HASHED = ['FENT', 'FLIN', 'FINV', 'FQUE'] as const;

const KINDS: readonly BuildingKind[] = [...MVP_KINDS, ...V1_KINDS];
const kindByNum = (n: number): BuildingKind | undefined => KINDS.find((k) => BUILDINGS[k].num === n);
const SCOPES = ['m0', 'mvp', 'v1'] as const;

// ---------------------------------------------------------------- write

export function serializeState(s: FactoryState): Uint8Array {
  const w = new Writer();
  w.u16(FACTORY_SAVE_VERSION);
  section(w, 'FMET', () => writeMeta(w, s));
  section(w, 'FENT', () => writeEnts(w, s));
  section(w, 'FLIN', () => writeLines(w, s));
  section(w, 'FINV', () => writeInv(w, s));
  section(w, 'FQUE', () => writeQueues(w, s));
  section(w, 'FGHO', () => writeGhosts(w, s));
  return w.bytes();
}

export function stateHash(s: FactoryState): number {
  const w = new Writer();
  writeEnts(w, s);
  writeLines(w, s);
  writeInv(w, s);
  writeQueues(w, s);
  return fnv1a(w.bytes());
}

function section(w: Writer, tag: string, body: () => void): void {
  w.tag(tag);
  const at = w.begin();
  body();
  w.end(at);
}

function writeMeta(w: Writer, s: FactoryState): void {
  w.u8(SCOPES.indexOf(s.scope));
  w.u8(s.yardRows);
  w.u8(s.away ? 1 : 0);
  w.u32(s.rungs);
  w.u8((s.firstLift ? 1 : 0) | (s.firstIngot ? 2 : 0));
  w.u16(s.seen.length);
  for (let i = 0; i < s.seen.length; i++) w.u8(s.seen[i]);
  w.u16(s.recipeOpen.length);
  for (let i = 0; i < s.recipeOpen.length; i++) w.u8(s.recipeOpen[i]);
  w.u16(s.purityKnown.length);
  for (let i = 0; i < s.purityKnown.length; i++) w.u8(s.purityKnown[i]);
  const meters = Object.keys(s.kitMeter).sort().filter((k) => (s.kitMeter[k] ?? 0) > 0);
  w.u8(meters.length);
  for (const k of meters) {
    w.u16(ITEMS.find((d) => d.id === kitItemId(k))?.num ?? 0);
    w.u16(s.kitMeter[k]);
  }
  const c = s.count;
  for (const v of [c.imported, c.produced, c.sold, c.consumed, c.taken, c.scrapped]) w.f64(v);
  w.f64(s.ghostSeq);
}

function writeEnts(w: Writer, s: FactoryState): void {
  w.f64(s.tickNo);
  w.u32(s.sQ);
  w.u16(s.ents.length);
  w.u16(s.entFree.length);
  for (const id of s.entFree) w.u16(id);
  let n = 0;
  for (const e of s.ents) if (e) n++;
  w.u16(n);
  for (const e of s.ents) if (e) writeEnt(w, e);
}

function writeEnt(w: Writer, e: Ent): void {
  w.u16(e.id);
  w.u8(e.def.num);
  w.u8(e.mk);
  w.u8(e.plane === 'yard' ? YARD : MINE);
  w.u8(e.x);
  w.u16(e.y);
  w.u16(e.h);
  w.u8(e.dir);
  w.u8((e.rusted ? 1 : 0) | (e.stalled ? 2 : 0));
  w.f64(e.paid);
  w.u8(e.rrIn);
  w.u8(e.rrOut);
  switch (e.kind) {
    case 'smelter':
    case 'assembler':
      w.i16(e.recipeNum);
      w.i16(e.craftNum);
      w.f64(e.acc);
      return;
    case 'autoDrill':
      w.u8(e.lodeId);
      w.f64(e.acc);
      return;
    case 'export':
      w.f64(e.acc);
      return;
    case 'router':
      w.u8(e.mode);
      w.i16(e.primary);
      w.u16(e.filter);
      return;
    case 'bin':
      w.u16(e.unload);
      w.f64(e.nextAllowedTick);
      return;
    case 'lift':
      w.f64(e.clock);
      w.f64(e.credit);
      w.u8(e.rails);
      return;
  }
}

function writeLines(w: Writer, s: FactoryState): void {
  w.u16(s.lines.length);
  w.u16(s.lineFree.length);
  for (const id of s.lineFree) w.u16(id);
  for (const p of [YARD, MINE] as const) {
    const belts = s.belt[p];
    let n = 0;
    for (let c = 0; c < belts.length; c++) if (belts[c]) n++;
    w.u32(n);
    for (let c = 0; c < belts.length; c++) {
      if (!belts[c]) continue;
      w.u16(c);
      w.u16(belts[c]);
    }
  }
  let n = 0;
  for (const l of s.lines) if (l) n++;
  w.u16(n);
  for (const l of s.lines) {
    if (!l) continue;
    w.u16(l.id);
    w.u8(l.plane);
    w.u8(l.tier);
    w.u16(l.slots.length);
    for (let i = 0; i < l.slots.length; i++) {
      w.u16(slotCell(l.slots[i]));
      w.u8(slotDir(l.slots[i]));
    }
    w.u16(l.n);
    for (let i = 0; i < l.n; i++) {
      w.u16(l.itemAt(i));
      w.u16(l.gapAt(i));
    }
  }
}

function writeInv(w: Writer, s: FactoryState): void {
  for (const e of s.ents) {
    if (!e || (!e.out && !e.inv && e.inCount.length === 0)) continue;
    w.u16(e.id);
    w.u8(e.inCount.length);
    for (let i = 0; i < e.inCount.length; i++) {
      w.u16(e.inItem[i]);
      w.u16(e.inCount[i]);
    }
    const out = e.out;
    w.u8(out ? out.n : 0);
    if (out) for (let i = 0; i < out.n; i++) w.u16(out.at(i));
    const inv = e.inv;
    w.u8(inv ? inv.runs : 0);
    if (inv) {
      for (let i = 0; i < inv.runs; i++) {
        w.u16(inv.items[i]);
        w.u32(inv.counts[i]);
      }
    }
  }
  w.u16(0);
}

function writeQueues(w: Writer, s: FactoryState): void {
  for (const e of s.ents) {
    if (!e || !e.queue) continue;
    w.u16(e.id);
    w.u16(e.lip);
    w.u32(e.queue.n);
    for (let i = 0; i < e.queue.n; i++) {
      w.u16(e.queue.itemAt(i));
      w.f64(e.queue.entryAt(i));
    }
  }
  w.u16(0);
}

function writeGhosts(w: Writer, s: FactoryState): void {
  w.u16(s.ghosts.length);
  w.u16(s.ghostFree.length);
  for (const id of s.ghostFree) w.u16(id);
  let n = 0;
  for (const g of s.ghosts) if (g) n++;
  w.u16(n);
  for (const g of s.ghosts) {
    if (!g) continue;
    w.u16(g.id);
    w.f64(g.order);
    w.u8(BUILDINGS[g.kind].num);
    w.u8(g.mk);
    w.u8(g.x);
    w.u16(g.y);
    w.u8(g.w);
    w.u16(g.h);
    w.u8(g.dir);
    w.u8(g.partCode);
    w.u16(ITEMS.find((d) => d.id === kitItemId(g.kit))?.num ?? 0);
    w.u16(g.kitUnits);
  }
}

// ---------------------------------------------------------------- read

/** Restore into a fresh state (nothing placed yet). Throws FactoryLoadError on malformed bytes. */
export function readState(s: FactoryState, bytes: Uint8Array): void {
  const r = new Reader(bytes);
  const version = r.u16();
  if (version !== FACTORY_SAVE_VERSION) throw new FactoryLoadError(`unknown version ${version}`);
  const found: Record<string, Reader> = {};
  while (!r.done()) {
    const tag = r.tag();
    const len = r.u32();
    if (r.pos + len > r.end) throw new FactoryLoadError(`section ${tag} overruns the blob`);
    found[tag] = new Reader(bytes, r.pos, r.pos + len);
    r.pos += len;
  }
  for (const tag of ['FMET', ...HASHED, 'FGHO']) if (!found[tag]) throw new FactoryLoadError(`missing section ${tag}`);
  readMeta(found.FMET, s);
  readEnts(found.FENT, s);
  readLines(found.FLIN, s);
  readInv(found.FINV, s);
  readQueues(found.FQUE, s);
  readGhosts(found.FGHO, s);
  for (const e of s.ents) if (e && e.kind === 'autoDrill' && e.lodeId >= 0) s.lodeDrill[e.lodeId] = e.id;
  structureChanged(s, false);
}

function readMeta(r: Reader, s: FactoryState): void {
  r.u8(); // scope at save time (informational; the running build's scope applies)
  s.yardRows = r.range(r.u8(), 8, 32, 'yard rows');
  s.away = r.u8() === 1;
  s.rungs = r.u32();
  const flags = r.u8();
  s.firstLift = (flags & 1) !== 0;
  s.firstIngot = (flags & 2) !== 0;
  readBytes(r, s.seen, 'seen');
  readBytes(r, s.recipeOpen, 'recipes');
  readBytes(r, s.purityKnown, 'purity');
  const meters = r.u8();
  for (let i = 0; i < meters; i++) {
    const d = itemByNum(r.u16());
    const units = r.u16();
    if (!d || d.cls !== 'kit') throw new FactoryLoadError('kit meter on a non-Kit item');
    s.kitMeter[d.id.slice(4)] = units;
  }
  const c = s.count;
  c.imported = r.int();
  c.produced = r.int();
  c.sold = r.int();
  c.consumed = r.int();
  c.taken = r.int();
  c.scrapped = r.int();
  s.ghostSeq = r.int();
}

function readBytes(r: Reader, into: Uint8Array, what: string): void {
  const n = r.u16();
  if (n > into.length) throw new FactoryLoadError(`${what}: ${n} entries`);
  for (let i = 0; i < n; i++) into[i] = r.u8();
}

function readIdList(r: Reader, max: number): { length: number; free: number[] } {
  const length = r.range(r.u16(), 1, max + 1, 'id space');
  const nFree = r.range(r.u16(), 0, length, 'free list');
  const free: number[] = [];
  for (let i = 0; i < nFree; i++) free.push(r.range(r.u16(), 1, length - 1, 'free id'));
  return { length, free };
}

function readEnts(r: Reader, s: FactoryState): void {
  s.tickNo = r.int();
  s.sQ = r.range(r.u32(), 0, 65_536, 's_Q');
  const ids = readIdList(r, MAX_ID);
  while (s.ents.length < ids.length) s.ents.push(null);
  s.entFree.push(...ids.free);
  const n = r.u16();
  for (let i = 0; i < n; i++) readEnt(r, s, ids.length);
}

function readEnt(r: Reader, s: FactoryState, idSpace: number): void {
  const id = r.range(r.u16(), 1, idSpace - 1, 'entity id');
  const kind = kindByNum(r.u8());
  if (!kind) throw new FactoryLoadError('unknown building kind');
  if (s.ents[id]) throw new FactoryLoadError(`duplicate entity ${id}`);
  const mk = r.range(r.u8(), 1, BUILDINGS[kind].mks.length, 'Mk');
  const plane = r.range(r.u8(), 0, 1, 'plane') as PlaneNum;
  const x = r.range(r.u8(), 0, W - 1, 'x');
  const y = r.range(r.u16(), 0, (plane === YARD ? YARD_H : MINE_H) - 1, 'y');
  const h = r.range(r.u16(), 1, plane === YARD ? 3 : MINE_H, 'h');
  const dir = r.range(r.u8(), 0, 3, 'dir') as Dir;
  if (x + BUILDINGS[kind].w > W || y + h > (plane === YARD ? YARD_H : MINE_H)) throw new FactoryLoadError(`entity ${id} outside its plane`);
  const flags = r.u8();
  const e = createEnt(s, kind, mk, plane === YARD ? 'yard' : 'mine', x, y, dir, h, id) as Ent;
  e.rusted = (flags & 1) !== 0;
  e.stalled = (flags & 2) !== 0;
  e.paid = r.int();
  e.rrIn = r.u8();
  e.rrOut = r.u8();
  switch (kind) {
    case 'smelter':
    case 'assembler':
      e.recipeNum = r.range(r.i16(), -1, RECIPES.length - 1, 'recipe');
      e.craftNum = r.range(r.i16(), -1, RECIPES.length - 1, 'craft');
      e.acc = r.int();
      return;
    case 'autoDrill':
      e.lodeId = r.range(r.u8(), 0, s.grid.lodes.length - 1, 'lode');
      e.acc = r.int();
      return;
    case 'export':
      e.acc = r.int();
      return;
    case 'router':
      e.mode = r.range(r.u8(), 0, 2, 'router mode');
      e.primary = r.range(r.i16(), -1, 3, 'primary');
      e.filter = r.u16();
      return;
    case 'bin':
      e.unload = r.u16();
      e.nextAllowedTick = r.int();
      return;
    case 'lift':
      e.clock = r.int();
      e.credit = r.int();
      e.rails = r.u8();
      return;
  }
}

function readLines(r: Reader, s: FactoryState): void {
  const ids = readIdList(r, MAX_ID);
  while (s.lines.length < ids.length) s.lines.push(null);
  s.lineFree.push(...ids.free);
  for (const p of [YARD, MINE] as const) {
    const n = r.range(r.u32(), 0, s.belt[p].length, 'belt cells');
    for (let i = 0; i < n; i++) {
      const cell = r.range(r.u16(), 0, s.belt[p].length - 1, 'belt cell');
      setBelt(s, p, cell, r.u16());
    }
  }
  const n = r.u16();
  for (let i = 0; i < n; i++) {
    const id = r.range(r.u16(), 1, ids.length - 1, 'line id');
    const plane = r.range(r.u8(), 0, 1, 'line plane') as PlaneNum;
    const tier = r.range(r.u8(), 1, 3, 'tier');
    const tiles = r.range(r.u16(), 1, 128, 'line tiles');
    const slots: number[] = [];
    for (let k = 0; k < tiles; k++) slots.push(slotKey(r.range(r.u16(), 0, s.belt[plane].length - 1, 'tile'), r.range(r.u8(), 0, 3, 'tile dir')));
    const l = restoreLine(s, id, plane, tier, slots);
    const items = r.u16();
    let pos = 0;
    for (let k = 0; k < items; k++) {
      const item = r.u16();
      pos += r.u16();
      if (pos > l.L) throw new FactoryLoadError(`line ${id}: item beyond its length`);
      l.appendAt(pos, item);
    }
    s.lines[id] = l;
  }
  reindexSlots(s);
}

function readInv(r: Reader, s: FactoryState): void {
  for (let id = r.u16(); id !== 0; id = r.u16()) {
    const e = s.ent(id);
    if (!e) throw new FactoryLoadError(`inventory for missing entity ${id}`);
    const k = r.u8();
    if (k !== e.inCount.length) throw new FactoryLoadError(`entity ${id}: input slots`);
    for (let i = 0; i < k; i++) {
      e.inItem[i] = r.u16();
      e.inCount[i] = r.u16();
    }
    const outN = r.u8();
    for (let i = 0; i < outN; i++) if (!e.out || !e.out.push(r.u16())) throw new FactoryLoadError(`entity ${id}: output overflow`);
    const runs = r.u8();
    for (let i = 0; i < runs; i++) {
      const item = r.u16();
      const count = r.u32();
      if (!e.inv || !e.inv.fits(item, count)) throw new FactoryLoadError(`entity ${id}: storage overflow`);
      e.inv.add(item, count);
      s.stockTotals[item] += count;
    }
  }
}

function readQueues(r: Reader, s: FactoryState): void {
  for (let id = r.u16(); id !== 0; id = r.u16()) {
    const e = s.ent(id);
    if (!e || !e.queue) throw new FactoryLoadError(`queue for non-lift ${id}`);
    e.lip = r.u16();
    const n = r.range(r.u32(), 0, 1 << 16, 'queue length');
    for (let i = 0; i < n; i++) {
      const item = r.u16();
      e.queue.push(item, r.int());
    }
  }
}

function readGhosts(r: Reader, s: FactoryState): void {
  const ids = readIdList(r, 1 << 15);
  while (s.ghosts.length < ids.length) s.ghosts.push(null);
  s.ghostFree.push(...ids.free);
  const n = r.u16();
  for (let i = 0; i < n; i++) {
    const id = r.range(r.u16(), 1, ids.length - 1, 'ghost id');
    const order = r.int();
    const kind = kindByNum(r.u8());
    if (!kind) throw new FactoryLoadError('unknown ghost kind');
    const mk = r.u8();
    const x = r.range(r.u8(), 0, W - 1, 'ghost x');
    const y = r.range(r.u16(), 0, MINE_H - 1, 'ghost y');
    const w = r.range(r.u8(), 1, W - x, 'ghost w');
    const h = r.range(r.u16(), 1, MINE_H - y, 'ghost h');
    const dir = r.range(r.u8(), 0, 3, 'ghost dir') as Dir;
    const part = r.range(r.u8(), 0, 2, 'ghost part');
    const kit = itemByNum(r.u16());
    const units = r.u16();
    if (!kit || kit.cls !== 'kit') throw new FactoryLoadError('ghost without a Kit');
    addGhost(s, { kind, mk, x, y, w, h, dir, part, kit: kit.id.slice(4), units }, id, order);
  }
}
