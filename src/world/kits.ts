// Kits in the pod's bay (canon §3.7, §4.8; 02 §2.6–2.7): the factory's Kit source for ghost completion and its
// refund sink for deconstruction. Metered Kits (KIT_METER: Belt 8 tiles, Lamp 4, Chute 16) count in units; a
// partly used Kit keeps its remaining units in `CargoItem.units` (absent = full). PURE MODULE.
import { kitUnits, type KitSink, type KitSource } from '../factory/api';
import { baySlotsOf, cargoSlotsUsed, kitSpec } from '../pod/stats';
import type { PodState } from '../pod/types';
import type { CargoItem } from '../shared/types';

type KitItem = Extract<CargoItem, { kind: 'kit' }>;

/** Units left in one cargo Kit. */
export function unitsOf(k: { id: string; units?: number }): number {
  return k.units ?? kitUnits(k.id);
}

/** A fresh, full Kit for the bay. */
export function newKit(id: string): KitItem {
  return { kind: 'kit', id };
}

/** Σ units of `kitId` aboard (allocation-free: the ghost search calls it every pod step). */
export function cargoKitUnits(cargo: readonly CargoItem[], kitId: string): number {
  let n = 0;
  for (let i = 0; i < cargo.length; i++) {
    const c = cargo[i];
    if (c.kind === 'kit' && c.id === kitId) n += unitsOf(c);
  }
  return n;
}

/** Kits of `kitId` aboard, whatever their fill. */
export function cargoKitCount(cargo: readonly CargoItem[], kitId: string): number {
  let n = 0;
  for (let i = 0; i < cargo.length; i++) {
    const c = cargo[i];
    if (c.kind === 'kit' && c.id === kitId) n++;
  }
  return n;
}

/**
 * Take `n` units of `kitId`, least-full Kit first (ties: the earliest in the bay), so full Kits stay whole.
 * An emptied Kit leaves the bay. Throws if the bay is short (callers check `cargoKitUnits` first).
 */
export function takeKitUnits(cargo: CargoItem[], kitId: string, n: number): void {
  let left = n;
  while (left > 0) {
    let best = -1;
    let bestUnits = Infinity;
    for (let i = 0; i < cargo.length; i++) {
      const c = cargo[i];
      if (c.kind !== 'kit' || c.id !== kitId) continue;
      const u = unitsOf(c);
      if (u < bestUnits) {
        best = i;
        bestUnits = u;
      }
    }
    if (best < 0) throw new Error(`cargo short of ${left} ${kitId}`);
    if (bestUnits <= left) {
      cargo.splice(best, 1);
      left -= bestUnits;
    } else {
      cargo[best] = { kind: 'kit', id: kitId, units: bestUnits - left };
      left = 0;
    }
  }
}

/** Room left in the partly used Kits of `kitId` aboard (metered Kits merge, 02 §2.7). */
function partialRoom(cargo: readonly CargoItem[], kitId: string): number {
  const per = kitUnits(kitId);
  let room = 0;
  for (const c of cargo) if (c.kind === 'kit' && c.id === kitId) room += per - unitsOf(c);
  return room;
}

/** New Kit items that `n` refunded units of `kitId` would add after topping up partial Kits. */
export function newKitsFor(cargo: readonly CargoItem[], kitId: string, n: number): number {
  const extra = n - partialRoom(cargo, kitId);
  return extra <= 0 ? 0 : Math.ceil(extra / kitUnits(kitId));
}

/** Put `n` units of `kitId` in the bay: top up partial Kits (fullest first), then new Kits (the last may be partial). */
export function putKitUnits(cargo: CargoItem[], kitId: string, n: number): void {
  const per = kitUnits(kitId);
  let left = n;
  while (left > 0) {
    let best = -1;
    let bestUnits = -1;
    for (let i = 0; i < cargo.length; i++) {
      const c = cargo[i];
      if (c.kind !== 'kit' || c.id !== kitId) continue;
      const u = unitsOf(c);
      if (u < per && u > bestUnits) {
        best = i;
        bestUnits = u;
      }
    }
    if (best < 0) break;
    const add = Math.min(per - bestUnits, left);
    const units = bestUnits + add;
    cargo[best] = units === per ? newKit(kitId) : { kind: 'kit', id: kitId, units };
    left -= add;
  }
  while (left > 0) {
    const units = Math.min(per, left);
    cargo.push(units === per ? newKit(kitId) : { kind: 'kit', id: kitId, units });
    left -= units;
  }
}

/** Free bay slots right now. */
export function freeSlots(pod: Readonly<PodState>): number {
  return baySlotsOf(pod.tiers.bay) - cargoSlotsUsed(pod.cargo);
}

/** The bay as the factory's Kit source (02 §2.6): units for metered Kits, whole Kits otherwise. */
export class CargoKitSource implements KitSource {
  constructor(private readonly pod: PodState) {}
  count(kitId: string): number {
    return cargoKitUnits(this.pod.cargo, kitId);
  }
  take(kitId: string, n: number): void {
    takeKitUnits(this.pod.cargo, kitId, n);
  }
}

/**
 * The bay as a refund target for one deconstruct call (02 §2.7: free slot needed; metered Kits merge). The
 * factory asks `canPut` once per refunded stack before any `put`, so the sink reserves the room each yes
 * promised: two stacks never share the last free slot.
 */
export class CargoKitSink implements KitSink {
  private readonly ids: string[] = [];
  private readonly units: number[] = [];

  constructor(private readonly pod: PodState) {}

  canPut(kitId: string, n: number): boolean {
    let i = this.ids.indexOf(kitId);
    if (i < 0) {
      i = this.ids.length;
      this.ids.push(kitId);
      this.units.push(0);
    }
    this.units[i] += n;
    if (this.slotsNeeded() <= freeSlots(this.pod)) return true;
    this.units[i] -= n;
    return false;
  }

  put(kitId: string, n: number): void {
    putKitUnits(this.pod.cargo, kitId, n);
  }

  private slotsNeeded(): number {
    let slots = 0;
    for (let i = 0; i < this.ids.length; i++) slots += newKitsFor(this.pod.cargo, this.ids[i], this.units[i]) * kitSpec(this.ids[i]).slots;
    return slots;
  }
}
