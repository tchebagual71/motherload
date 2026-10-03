// Trip summary bookkeeping (01 §2.2 step 6, §2.3; 03 §6.3 "312ft · $1,240 · 4.1 L · −0 HP · 3:22"). Fed the
// drained events and the pod's fuel; a trip runs from 'left-rim' to 'trip-end', and a respawn forgets it.
// PURE MODULE.
import { MINERALS, RELICS, STEP_HZ } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import type { CargoItem } from '../shared/types';

export interface TripStats {
  trip: number;
  deepestRow: number;
  /** Items collected this trip and their Assay value. */
  collected: number;
  value: number;
  fuelUsed: number;
  hullLost: number;
  seconds: number;
}

/** Assay value of a collected item (canon §2.2–2.3); Kits are not sold. */
export function haulValue(item: CargoItem): number {
  if (item.kind === 'mineral') return MINERALS[item.tier - 1]?.value ?? 0;
  if (item.kind === 'relic') return RELICS[item.id]?.value ?? 0;
  return 0;
}

export class TripTracker {
  private active = false;
  private startStep = 0;
  private collected = 0;
  private value = 0;
  private fuelUsed = 0;
  private hullLost = 0;
  private lastFuel = 0;

  /** Start tracking now (a trip already under way when a save loads, or 'left-rim'). */
  begin(fuel: number, stepNo: number): void {
    this.active = true;
    this.startStep = stepNo;
    this.collected = 0;
    this.value = 0;
    this.fuelUsed = 0;
    this.hullLost = 0;
    this.lastFuel = fuel;
  }

  reset(): void {
    this.active = false;
  }

  get tracking(): boolean {
    return this.active;
  }

  /** Fuel only ever drops between samples except by refuels, Jerrycans and salvage, so the drops add up to use. */
  sampleFuel(fuel: number): void {
    if (!this.active) return;
    if (fuel < this.lastFuel) this.fuelUsed += this.lastFuel - fuel;
    this.lastFuel = fuel;
  }

  /** One drained event. Returns the finished trip on 'trip-end'. */
  onEvent(e: GameEvent, fuel: number, stepNo: number): TripStats | null {
    switch (e.t) {
      case 'left-rim':
        this.begin(fuel, stepNo);
        return null;
      case 'respawned':
        this.reset();
        return null;
      case 'collect':
        this.collected++;
        this.value += haulValue(e.item);
        return null;
      case 'damage':
        this.hullLost += e.amount;
        return null;
      case 'trip-end':
        return this.finish(e.trip, e.deepestRow, fuel, stepNo);
      default:
        return null;
    }
  }

  private finish(trip: number, deepestRow: number, fuel: number, stepNo: number): TripStats {
    this.sampleFuel(fuel);
    const stats: TripStats = {
      trip,
      deepestRow,
      collected: this.collected,
      value: this.value,
      fuelUsed: this.fuelUsed,
      hullLost: this.hullLost,
      seconds: this.active ? Math.max(0, Math.round((stepNo - this.startStep) / STEP_HZ)) : 0,
    };
    this.active = false;
    return stats;
  }
}
