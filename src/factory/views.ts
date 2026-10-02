// Read-only render views (04 §3.3): belt items and lift buckets filled into reusable typed arrays, positions in
// cell units with a one-tick displacement for α extrapolation. Called once per frame; allocates only to grow.
// PURE MODULE.
import type { BeltItemsView, LiftBucketsView, ViewRect } from './api';
import { DX, DY, MINE, W, planeNum } from './geom';
import { BELT_V, TILE_U, slotCell, slotDir, type Line } from './line';
import type { FactoryState } from './state';

export function newBeltItemsView(cap = 256): BeltItemsView {
  return { count: 0, plane: new Uint8Array(cap), item: new Uint16Array(cap), x: new Float32Array(cap), y: new Float32Array(cap), dx: new Float32Array(cap), dy: new Float32Array(cap) };
}
export function newLiftBucketsView(cap = 64): LiftBucketsView {
  return { count: 0, lift: new Uint16Array(cap), item: new Uint16Array(cap), x: new Float32Array(cap), row: new Float32Array(cap), dRow: new Float32Array(cap) };
}

function growBelt(v: BeltItemsView, need: number): void {
  if (need <= v.item.length) return;
  let cap = v.item.length * 2;
  while (cap < need) cap *= 2;
  const n = newBeltItemsView(cap);
  n.plane.set(v.plane);
  n.item.set(v.item);
  n.x.set(v.x);
  n.y.set(v.y);
  n.dx.set(v.dx);
  n.dy.set(v.dy);
  Object.assign(v, n, { count: v.count });
}

function growLift(v: LiftBucketsView, need: number): void {
  if (need <= v.item.length) return;
  let cap = v.item.length * 2;
  while (cap < need) cap *= 2;
  const n = newLiftBucketsView(cap);
  n.lift.set(v.lift);
  n.item.set(v.item);
  n.x.set(v.x);
  n.row.set(v.row);
  n.dRow.set(v.dRow);
  Object.assign(v, n, { count: v.count });
}

function lineVisible(l: Line, rect: ViewRect | undefined): boolean {
  if (!rect) return true;
  if (planeNum(rect.plane) !== l.plane) return false;
  return l.bx1 >= rect.x0 && l.bx0 <= rect.x1 && l.by1 >= rect.y0 && l.by0 <= rect.y1;
}

/** Point at distance `pos` (belt units) from a line's head edge, in cell units, into px/py scratch. */
const pt = new Float32Array(2);
function pointAt(l: Line, pos: number): void {
  const last = l.slots.length - 1;
  const k = Math.min(Math.floor(pos / TILE_U), last);
  const t = (pos - k * TILE_U) / TILE_U;
  const cell = slotCell(l.slots[k]);
  const cx = (cell % W) + 0.5;
  const cy = Math.floor(cell / W) + 0.5;
  if (t <= 0.5) {
    const d = slotDir(l.slots[k]);
    pt[0] = cx + (0.5 - t) * DX[d];
    pt[1] = cy + (0.5 - t) * DY[d];
  } else {
    const d = l.entry[k];
    pt[0] = cx - (t - 0.5) * DX[d];
    pt[1] = cy - (t - 0.5) * DY[d];
  }
}

export function fillBeltItems(s: FactoryState, out: BeltItemsView, rect?: ViewRect): void {
  out.count = 0;
  for (const l of s.lines) {
    if (!l || l.n === 0 || !lineVisible(l, rect)) continue;
    growBelt(out, out.count + l.n);
    // Replay next tick's move without mutating: item i shifts by the slack consumed at gaps 0..i (02 §10.3).
    let r = l.moved ? BELT_V : 0;
    let pos = 0;
    let shift = 0;
    for (let i = 0; i < l.n; i++) {
      const g = l.gapAt(i);
      pos += g;
      if (r > 0) {
        const slack = i === 0 ? g : g - l.S;
        if (slack > 0) {
          const d = slack < r ? slack : r;
          r -= d;
          shift += d;
        }
      }
      const k = out.count++;
      pointAt(l, pos);
      out.plane[k] = l.plane;
      out.item[k] = l.itemAt(i);
      out.x[k] = pt[0];
      out.y[k] = pt[1];
      pointAt(l, pos - shift);
      out.dx[k] = pt[0] - out.x[k];
      out.dy[k] = pt[1] - out.y[k];
    }
  }
}

export function fillLiftBuckets(s: FactoryState, out: LiftBucketsView, rect?: ViewRect): void {
  out.count = 0;
  if (rect && planeNum(rect.plane) !== MINE) return;
  for (const e of s.ents) {
    if (!e || !e.queue) continue;
    if (rect && (e.x < rect.x0 || e.x > rect.x1 || e.foot < rect.y0 || e.y > rect.y1)) continue;
    const q = e.queue;
    growLift(out, out.count + q.n + 1);
    const rows = e.foot - e.y;
    const perTick = e.stalled || e.transit === 0 ? 0 : (rows * s.sQ) / e.transit;
    for (let i = 0; i < q.n; i++) {
      const frac = e.transit === 0 ? 1 : Math.min(1, (e.clock - q.entryAt(i)) / e.transit);
      put(out, e.id, q.itemAt(i), e.x + 0.5, e.foot + 0.5 - frac * rows, frac < 1 ? -perTick : 0);
    }
    if (e.lip !== 0) put(out, e.id, e.lip, e.x + 0.5, e.foot + 0.5, 0);
  }
}

function put(out: LiftBucketsView, lift: number, item: number, x: number, row: number, dRow: number): void {
  const k = out.count++;
  out.lift[k] = lift;
  out.item[k] = item;
  out.x[k] = x;
  out.row[k] = row;
  out.dRow[k] = dRow;
}
