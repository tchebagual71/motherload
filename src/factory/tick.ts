// One 20 Hz factory tick (02 §10.2): P2 timers → P3 move → P4 head transfers → P5 node outputs → P6 bookkeeping.
// Each phase walks the awake sets in ascending id; an id woken above the cursor runs this phase, one below it
// next tick, which reproduces an always-awake run exactly (02 §10.8). MVP has no P1: s_Q ≡ 65,536. PURE MODULE.
import type { Ent } from './ent';
import type { Line } from './line';
import { hasTimer, p2, p4, p5 } from './nodes';
import type { FactoryState } from './state';

type EntFn = (s: FactoryState, e: Ent) => void;
type LineFn = (s: FactoryState, l: Line) => void;

export function runTick(s: FactoryState): void {
  eachEnt(s, p2);
  eachLine(s, moveLine);
  eachEnt(s, p4);
  eachLine(s, lineToLine);
  eachEnt(s, p5);
  bookkeeping(s);
  s.tickNo++;
}

/** Ascending-id walk of the awake entity set; re-reads the word so ids woken above the cursor run now. */
function eachEnt(s: FactoryState, fn: EntFn): void {
  const set = s.entAwake;
  const words = (s.ents.length + 31) >>> 5;
  for (let w = 0; w < words; w++) {
    let bits = set[w];
    while (bits !== 0) {
      const b = 31 - Math.clz32(bits & -bits);
      fn(s, s.ents[(w << 5) | b] as Ent);
      bits = b === 31 ? 0 : set[w] & (~0 << (b + 1));
    }
  }
}

function eachLine(s: FactoryState, fn: LineFn): void {
  const set = s.lineAwake;
  const words = (s.lines.length + 31) >>> 5;
  for (let w = 0; w < words; w++) {
    let bits = set[w];
    while (bits !== 0) {
      const b = 31 - Math.clz32(bits & -bits);
      fn(s, s.lines[(w << 5) | b] as Line);
      bits = b === 31 ? 0 : set[w] & (~0 << (b + 1));
    }
  }
}

/** P3 (02 §10.3). A moving line wakes its feeder when its tail has room and its target when the head arrives. */
function moveLine(s: FactoryState, l: Line): void {
  if (!l.move()) return;
  l.active = true;
  if (l.canInsert()) s.wakeLineFeeder(l);
  if (l.targetNode !== 0 && l.headReady()) s.wakeEnt(l.targetNode);
}

/** P4 second half: line → line transfers (tier changes, 128-tile breaks, loops) in line-id order. */
function lineToLine(s: FactoryState, l: Line): void {
  if (l.targetLine === 0 || !l.headReady()) return;
  const t = s.lines[l.targetLine] as Line;
  if (!t.canInsert()) return;
  l.noteExit(s.tickNo);
  t.insertTail(l.popHead());
  s.wakeLine(t.id);
  s.wakeLine(l.id);
}

/** P6: sleep what did nothing and has no running timer; report this tick's Export sales once. */
function bookkeeping(s: FactoryState): void {
  if (s.saleCount > 0) {
    s.emit({ t: 'export-sale', amount: s.saleAmount, count: s.saleCount });
    s.saleAmount = 0;
    s.saleCount = 0;
  }
  if (s.noSleep) {
    eachLine(s, clearLine);
    eachEnt(s, clearEnt);
  } else {
    eachLine(s, settleLine);
    eachEnt(s, settleEnt);
  }
  if (s.checkInvariants && !s.conservationOk()) throw new Error(`factory: conservation broken at tick ${s.tickNo}`);
}

function settleLine(s: FactoryState, l: Line): void {
  if (l.n === 0 || !l.active) s.sleepLine(l.id);
  l.active = false;
}
function settleEnt(s: FactoryState, e: Ent): void {
  if (!e.active && !hasTimer(s, e)) s.sleepEnt(e.id);
  e.active = false;
}
function clearLine(_s: FactoryState, l: Line): void {
  l.active = false;
}
function clearEnt(_s: FactoryState, e: Ent): void {
  e.active = false;
}
