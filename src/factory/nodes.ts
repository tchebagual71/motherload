// Node behaviour per tick phase (02 §10.2, §10.4–10.6): accept/receive, P2 timers, P4 pulls, P5 pushes, and the
// timer test the P6 sleep rule needs. Integer Q16 maths only (02 §10.9). PURE MODULE.
import { DRILL_RATE_PER_MIN, EXPORT_ITEMS_PER_MIN, LIFT_RATE_PER_MIN } from '../shared/canon';
import type { Purity } from '../shared/types';
import { DRILL_OUT, DRILL_UNIT, EXPORT_BUF, HEADFRAME_BUF, Q16, ST_BLOCKED, ST_IDLE, ST_NO_OUTPUT, ST_NO_RECIPE, ST_WORKING, invOf, outOf, queueOf, type Ent } from './ent';
import { ITEMS, item } from './items';
import type { Line } from './line';
import { RECIPES, inputCap, inputIndex, outputCap, smeltRecipeFor, type RecipeDef } from './recipes';
import { ITEM_SLOTS, type FactoryState } from './state';

/** One lift admission / Export sale per 1,200 × 65,536 of credit (02 §10.5–10.6). */
export const RATE_UNIT = 1_200 * Q16;
/** Bin unload port: 1 item per 5 ticks (02 §10.5). */
export const UNLOAD_TICKS = 5;
export const PURITY_PCT: Readonly<Record<Purity, number>> = { poor: 50, normal: 100, rich: 200 };

// Item facts by registry num (no string work in the tick).
const UNDERGROUND = new Uint8Array(ITEM_SLOTS);
const EXPORT_PRICE = new Int32Array(ITEM_SLOTS);
const IS_ORE = new Uint8Array(ITEM_SLOTS);
const IS_INGOT = new Uint8Array(ITEM_SLOTS);
for (const d of ITEMS) {
  UNDERGROUND[d.num] = d.underground ? 1 : 0;
  EXPORT_PRICE[d.num] = d.exportable ? Math.floor((d.value * 9) / 10) : -1;
  IS_ORE[d.num] = d.cls === 'ore' ? 1 : 0;
  IS_INGOT[d.num] = d.cls === 'ingot' ? 1 : 0;
}
export function rides(itemNum: number): boolean {
  return UNDERGROUND[itemNum] === 1;
}

/** Bucket Lift transit in ticks for H rows (02 §10.6): Mk I ⌊(40H + 2)/3⌋, Mk II 8H, Mk III 5H. */
export function liftTransitTicks(mk: number, rows: number): number {
  if (mk === 2) return 8 * rows;
  if (mk === 3) return 5 * rows;
  return Math.floor((40 * rows + 2) / 3);
}

/** Ore item num a drill on this lode produces. */
export function oreFor(metal: string): number {
  return item(metal === 'kerogen' ? 'kerogen' : `${metal}Ore`).num;
}

// ---------------------------------------------------------------- accept / receive

/** Would `e` take this item now (02 §10.5 accept())? Pure test; `receive` stores it. */
export function accepts(s: FactoryState, e: Ent, itemNum: number): boolean {
  if (e.plane !== 'yard' && !rides(itemNum)) return false; // canon §4.9: underground nodes refuse gems, relics, …
  switch (e.kind) {
    case 'smelter': {
      if (smeltRecipeFor(itemNum, s.v1) < 0) return false;
      if (e.inCount[0] === 0) return true;
      return itemNum === e.inItem[0] && e.inCount[0] < inputCap(RECIPES[e.recipeNum], 0);
    }
    case 'assembler': {
      if (e.recipeNum < 0) return false;
      const r = RECIPES[e.recipeNum];
      const i = inputIndex(r, itemNum);
      return i >= 0 && e.inCount[i] < inputCap(r, i);
    }
    case 'bin':
      return invOf(e).fits(itemNum, 1);
    case 'export':
      return !s.away && EXPORT_PRICE[itemNum] >= 0 && outOf(e).n < EXPORT_BUF;
    case 'headframe':
      return outOf(e).n < HEADFRAME_BUF;
    case 'router':
      return outOf(e).n === 0;
    case 'lift':
      return e.lip === 0;
    default:
      return false;
  }
}

export function receive(s: FactoryState, e: Ent, itemNum: number): void {
  e.active = true;
  switch (e.kind) {
    case 'smelter':
      if (e.inCount[0] === 0) {
        e.inItem[0] = itemNum;
        e.recipeNum = smeltRecipeFor(itemNum, s.v1);
      }
      e.inCount[0]++;
      return;
    case 'assembler':
      e.inCount[inputIndex(RECIPES[e.recipeNum], itemNum)]++;
      return;
    case 'bin':
      invOf(e).add(itemNum, 1);
      s.stockTotals[itemNum]++;
      return;
    case 'lift':
      e.lip = itemNum;
      return;
    default:
      outOf(e).push(itemNum);
  }
}

/** Hand an item to an adjacent node (drill → lip, lift → Headframe). */
function offer(s: FactoryState, to: Ent, itemNum: number): boolean {
  if (!accepts(s, to, itemNum)) return false;
  receive(s, to, itemNum);
  s.wakeEnt(to.id);
  return true;
}

// ---------------------------------------------------------------- P2 timers

export function p2(s: FactoryState, e: Ent): void {
  switch (e.kind) {
    case 'autoDrill':
      return drillP2(s, e);
    case 'smelter':
    case 'assembler':
      return craftP2(s, e);
    case 'lift':
      return liftP2(s, e);
    case 'export':
      return exportP2(s, e);
  }
}

function drillP2(s: FactoryState, e: Ent): void {
  const out = outOf(e);
  const lode = s.grid.lodes[e.lodeId];
  if (out.n >= DRILL_OUT || !lode) {
    e.statusCode = lode ? ST_BLOCKED : ST_NO_OUTPUT;
    return; // a full buffer stops progress (02 §3.2)
  }
  e.statusCode = ST_WORKING;
  e.acc += DRILL_RATE_PER_MIN[e.mk - 1] * PURITY_PCT[lode.purity] * s.sQ;
  e.active = true;
  if (e.acc < DRILL_UNIT) return;
  e.acc -= DRILL_UNIT;
  const ore = oreFor(lode.metal);
  out.push(ore);
  s.count.produced++;
  s.see(ore);
  s.purityKnown[lode.id] = 1; // the first ore shows the purity (02 §3.6)
}

function craftP2(s: FactoryState, e: Ent): void {
  if (e.craftNum >= 0) {
    const r = RECIPES[e.craftNum];
    const done = r.ticks * Q16;
    if (e.acc < done) {
      e.acc = Math.min(done, e.acc + s.sQ);
      e.active = true;
    }
    if (e.acc < done) {
      e.statusCode = ST_WORKING;
      return;
    }
    if (!finishCraft(s, e, r)) {
      e.statusCode = ST_BLOCKED;
      return;
    }
  }
  startCraft(s, e);
}

/** Craft complete: outputs into the buffer if they fit (02 §3.2 out caps). */
function finishCraft(s: FactoryState, e: Ent, r: RecipeDef): boolean {
  const out = outOf(e);
  let n = 0;
  for (const o of r.outputs) n += o.n;
  if (out.n + n > outputCap(r)) return false;
  for (const o of r.outputs) {
    for (let k = 0; k < o.n; k++) out.push(o.num);
    s.count.produced += o.n;
    s.see(o.num);
    if (r.machine === 'smelter' && IS_INGOT[o.num]) firstIngot(s, o.item);
  }
  e.craftNum = -1;
  e.acc = 0;
  e.active = true;
  return true;
}

function firstIngot(s: FactoryState, id: string): void {
  if (s.firstIngot) return;
  s.firstIngot = true;
  s.emit({ t: 'first-ingot', item: id });
  s.unlock('U3');
}

/** Start the next craft when its inputs are buffered (consumed now; progress counts this tick). */
function startCraft(s: FactoryState, e: Ent): void {
  if (e.recipeNum < 0) {
    e.statusCode = e.kind === 'assembler' ? ST_NO_RECIPE : ST_IDLE;
    return;
  }
  const r = RECIPES[e.recipeNum];
  const smelter = r.machine === 'smelter';
  for (let i = 0; i < r.inputs.length; i++) {
    const have = smelter ? (e.inItem[0] === r.inputs[0].num ? e.inCount[0] : 0) : e.inCount[i];
    if (have < r.inputs[i].n) {
      e.statusCode = ST_IDLE;
      return;
    }
  }
  for (let i = 0; i < r.inputs.length; i++) {
    e.inCount[i] -= r.inputs[i].n;
    s.count.consumed += r.inputs[i].n;
  }
  e.craftNum = r.num;
  e.acc = s.sQ;
  e.active = true;
  e.statusCode = ST_WORKING;
}

/** Lift clocks and lip admission (02 §10.6). A stalled lift freezes; an empty one keeps no clock running. */
function liftP2(s: FactoryState, e: Ent): void {
  const q = queueOf(e);
  if (e.stalled) {
    e.statusCode = ST_BLOCKED;
    return;
  }
  if (q.n === 0 && e.lip === 0) {
    e.statusCode = ST_IDLE;
    return;
  }
  e.statusCode = ST_WORKING;
  e.active = true;
  e.clock += s.sQ;
  if (e.lip === 0) return;
  e.credit += LIFT_RATE_PER_MIN[e.mk - 1] * s.sQ;
  if (e.credit < RATE_UNIT) return;
  e.credit -= RATE_UNIT;
  q.push(e.lip, e.clock);
  e.lip = 0;
  s.wakeFeeders(e);
}

/** Export sells its oldest item each 1,200 × 65,536 of credit at ⌊value × 9/10⌋ (02 §0.1, §10.5). */
function exportP2(s: FactoryState, e: Ent): void {
  const out = outOf(e);
  if (out.n === 0) {
    e.statusCode = ST_IDLE;
    return;
  }
  e.statusCode = ST_WORKING;
  e.active = true;
  e.acc += EXPORT_ITEMS_PER_MIN * s.sQ;
  if (e.acc < RATE_UNIT) return;
  e.acc -= RATE_UNIT;
  const price = EXPORT_PRICE[out.shift()];
  s.wallet.credit(price, 'export');
  s.count.sold++;
  s.saleAmount += price;
  s.saleCount++;
}

// ---------------------------------------------------------------- P4 pulls

export function p4(s: FactoryState, e: Ent): void {
  if (e.inLines.length === 0) return;
  if (e.kind === 'router') return routerPull(s, e);
  const lines = e.inLines;
  const m = lines.length;
  const start = e.rrIn % m;
  let took = -1;
  for (let k = 0; k < m; k++) {
    const i = (start + k) % m;
    const l = s.lines[lines[i]] as Line;
    if (!l.headReady() || !accepts(s, e, l.headItem())) continue;
    receive(s, e, pop(s, l));
    took = i;
  }
  if (took >= 0) e.rrIn = (took + 1) % m;
}

function pop(s: FactoryState, l: Line): number {
  l.noteExit(s.tickNo);
  s.wakeLine(l.id);
  return l.popHead();
}

/** Router P4 (02 §10.4): if empty, take the head of the first ready In side from rrIn. */
function routerPull(s: FactoryState, e: Ent): void {
  if (outOf(e).n !== 0) return;
  for (let k = 0; k < 4; k++) {
    const side = (e.rrIn + k) & 3;
    const l = s.lines[e.sideIn[side]];
    if (!l || !l.headReady() || !accepts(s, e, l.headItem())) continue;
    receive(s, e, pop(s, l));
    e.rrIn = (side + 1) & 3;
    return;
  }
}

// ---------------------------------------------------------------- P5 pushes

export function p5(s: FactoryState, e: Ent): void {
  switch (e.kind) {
    case 'smelter':
    case 'assembler':
      pushLines(s, e);
      return;
    case 'headframe':
      if (pushLines(s, e)) s.wakeFeeders(e);
      return;
    case 'autoDrill':
      return drillPush(s, e);
    case 'router':
      return routerPush(s, e);
    case 'bin':
      return binUnload(s, e);
    case 'lift':
      return liftDeliver(s, e);
  }
}

/** Output buffer → output-edge lines, round-robin, one item per line per tick. Returns whether any left. */
function pushLines(s: FactoryState, e: Ent): boolean {
  const out = outOf(e);
  const m = e.outLines.length;
  if (out.n === 0 || m === 0) return false;
  const start = e.rrOut % m;
  let last = -1;
  for (let k = 0; k < m && out.n > 0; k++) {
    const i = (start + k) % m;
    if (!insert(s, s.lines[e.outLines[i]] as Line, out.peek())) continue;
    out.shift();
    last = i;
  }
  if (last < 0) return false;
  e.rrOut = (last + 1) % m;
  e.active = true;
  return true;
}

function insert(s: FactoryState, l: Line, itemNum: number): boolean {
  if (!l.insertTail(itemNum)) return false;
  s.wakeLine(l.id);
  return true;
}

/** Drill output → adjacent belt tails and lift lips, round-robin (02 §10.5). */
function drillPush(s: FactoryState, e: Ent): void {
  const out = outOf(e);
  const nl = e.outLines.length;
  const m = nl + e.pushTo.length;
  if (out.n === 0) return;
  if (m === 0) {
    e.statusCode = ST_NO_OUTPUT;
    return;
  }
  const start = e.rrOut % m;
  for (let k = 0; k < m; k++) {
    const i = (start + k) % m;
    const ok = i < nl ? insert(s, s.lines[e.outLines[i]] as Line, out.peek()) : offer(s, s.ents[e.pushTo[i - nl]] as Ent, out.peek());
    if (!ok) continue;
    out.shift();
    e.rrOut = (i + 1) % m;
    e.active = true;
    return;
  }
}

/** Router P5 (02 §10.4): Even, Overflow (primary then clockwise) or Filter(X). */
function routerPush(s: FactoryState, e: Ent): void {
  const out = outOf(e);
  if (out.n === 0) return;
  const itemNum = out.peek();
  const primary = routerPrimary(e);
  let side: number;
  if (e.mode === 1) side = tryOut(s, e, itemNum, primary, -1);
  else if (e.mode === 2 && itemNum === e.filter) side = tryOne(s, e, itemNum, primary) ? primary : -1;
  else side = tryOut(s, e, itemNum, e.rrOut & 3, e.mode === 2 ? primary : -1);
  if (side < 0) {
    e.statusCode = ST_BLOCKED;
    return;
  }
  out.shift();
  e.statusCode = ST_WORKING;
  e.active = true;
  if (e.mode !== 1) e.rrOut = (side + 1) & 3;
}

/** Primary Out: the set one, else straight across from the first In side. */
export function routerPrimary(e: Ent): number {
  if (e.primary >= 0) return e.primary;
  for (let k = 0; k < 4; k++) if (e.sideIn[k] !== 0) return (k + 2) & 3;
  return 0;
}

/** Try Out sides clockwise from `from` (skipping `skip`); returns the side that took it or −1. */
function tryOut(s: FactoryState, e: Ent, itemNum: number, from: number, skip: number): number {
  for (let k = 0; k < 4; k++) {
    const side = (from + k) & 3;
    if (side !== skip && tryOne(s, e, itemNum, side)) return side;
  }
  return -1;
}

function tryOne(s: FactoryState, e: Ent, itemNum: number, side: number): boolean {
  const l = s.lines[e.sideOut[side]];
  return !!l && insert(s, l, itemNum);
}

/** Bin unload port: the filtered item, 1 per 5 ticks (02 §10.5, nextAllowedTick). */
function binUnload(s: FactoryState, e: Ent): void {
  const inv = invOf(e);
  const m = e.outLines.length;
  if (e.unload === 0 || m === 0 || s.tickNo < e.nextAllowedTick || inv.count(e.unload) === 0) return;
  const start = e.rrOut % m;
  for (let k = 0; k < m; k++) {
    const i = (start + k) % m;
    if (!insert(s, s.lines[e.outLines[i]] as Line, e.unload)) continue;
    inv.remove(e.unload, 1);
    s.stockTotals[e.unload]--;
    e.nextAllowedTick = s.tickNo + UNLOAD_TICKS;
    e.rrOut = (i + 1) % m;
    e.active = true;
    return;
  }
}

/** Deliver due items at the top (02 §10.6): refusal stalls the lift, acceptance clears the stall. */
function liftDeliver(s: FactoryState, e: Ent): void {
  const q = queueOf(e);
  while (q.n > 0 && e.clock - q.headEntry() >= e.transit) {
    const itemNum = q.headItem();
    const to = deliverTop(s, e, itemNum);
    if (!to) {
      e.stalled = true;
      e.statusCode = e.pushTo.length + e.outLines.length === 0 ? ST_NO_OUTPUT : ST_BLOCKED;
      return;
    }
    q.shift();
    e.stalled = false;
    e.active = true;
    if (to.kind === 'headframe' && IS_ORE[itemNum] && !s.firstLift) {
      s.firstLift = true;
      s.emit({ t: 'first-lift-delivery' });
    }
  }
}

/** Offer an item to the lift's top targets round-robin; returns the node that took it (or the lift for a belt). */
function deliverTop(s: FactoryState, e: Ent, itemNum: number): Ent | null {
  const nl = e.outLines.length;
  const m = nl + e.pushTo.length;
  if (m === 0) return null;
  const start = e.rrOut % m;
  for (let k = 0; k < m; k++) {
    const i = (start + k) % m;
    if (i < nl) {
      if (!insert(s, s.lines[e.outLines[i]] as Line, itemNum)) continue;
      e.rrOut = (i + 1) % m;
      return e;
    }
    const to = s.ents[e.pushTo[i - nl]] as Ent;
    if (!offer(s, to, itemNum)) continue;
    e.rrOut = (i + 1) % m;
    return to;
  }
  return null;
}

// ---------------------------------------------------------------- P6 sleep test

/** Work that continues with no outside event: such a node must stay awake (02 §10.8 rate-limiter rule). */
export function hasTimer(s: FactoryState, e: Ent): boolean {
  switch (e.kind) {
    case 'autoDrill':
      return outOf(e).n < DRILL_OUT && e.lodeId >= 0;
    case 'smelter':
    case 'assembler':
      return e.craftNum >= 0 && e.acc < RECIPES[e.craftNum].ticks * Q16;
    case 'lift':
      return !e.stalled && (queueOf(e).n > 0 || e.lip !== 0);
    case 'export':
      return outOf(e).n > 0;
    case 'bin':
      return e.unload !== 0 && e.outLines.length > 0 && e.nextAllowedTick > s.tickNo + 1 && invOf(e).count(e.unload) > 0;
    default:
      return false;
  }
}
