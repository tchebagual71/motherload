// Cargo discard with undo until the panel closes (canon §3.7; 01 §3.7). PURE MODULE.
// Discards come off the bay at once (the pod is paused under the panel, so mass and slots update for the HUD),
// and each batch is remembered so Undo can put it back. Closing the panel commits them.
import type { CargoItem } from '../shared/types';

/** Same cargo kind: mineral tier, relic id or Kit id (the cargo panel's rows). */
export function sameCargo(a: CargoItem, b: CargoItem): boolean {
  switch (a.kind) {
    case 'mineral':
      return b.kind === 'mineral' && b.tier === a.tier;
    case 'relic':
      return b.kind === 'relic' && b.id === a.id;
    case 'kit':
      return b.kind === 'kit' && b.id === a.id;
  }
}

/**
 * Remove up to `n` items like `item` from `cargo` (newest first, so the bay's order otherwise stays) and return
 * them. `'all'` takes the whole group.
 */
export function takeCargo(cargo: CargoItem[], item: CargoItem, n: number | 'all'): CargoItem[] {
  const limit = n === 'all' ? Infinity : Math.max(0, Math.floor(n));
  const out: CargoItem[] = [];
  for (let i = cargo.length - 1; i >= 0 && out.length < limit; i--) {
    if (!sameCargo(cargo[i], item)) continue;
    out.push(cargo[i]);
    cargo.splice(i, 1);
  }
  return out;
}

/** The undo stack of one open cargo panel. */
export class DiscardLog {
  private readonly batches: CargoItem[][] = [];

  get pending(): number {
    return this.batches.length;
  }

  push(batch: CargoItem[]): void {
    if (batch.length > 0) this.batches.push(batch);
  }

  /** The most recent batch, removed from the log, or null. */
  pop(): CargoItem[] | null {
    return this.batches.pop() ?? null;
  }

  clear(): void {
    this.batches.length = 0;
  }
}
