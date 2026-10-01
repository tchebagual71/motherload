// Boot tracking and the Safe Mode decision (04 §4.13; canon §3.15). The record lives in localStorage
// (`hf-<ch>.boot`) because it must survive a crash or a jetsam kill mid-boot:
//   {slot, copy, phase, n} — phase advances load → migrate → firstTick → firstFrame; n counts the boots on this
//   copy that died before firstFrame. Two such deaths in a row put the next boot in Safe Mode.
import type { KeyValue } from '../platform/storage';
import { readJson, writeJson } from '../platform/storage';

export type BootPhase = 'load' | 'migrate' | 'firstTick' | 'firstFrame';

export interface BootRecord {
  slot: number;
  copy: string;
  phase: BootPhase;
  /** Consecutive failed boots on this copy BEFORE this one. */
  n: number;
}

const PHASE_ORDER: readonly BootPhase[] = ['load', 'migrate', 'firstTick', 'firstFrame'];

export const SAFE_MODE_AFTER_FAILS = 2;
/** The record is cleared after this long of clean running. */
export const BOOT_STABLE_MS = 10_000;

/** How many consecutive boots of `copy` died before their first frame. */
export function failedBoots(prev: BootRecord | null, slot: number, copy: string): number {
  if (!prev || prev.slot !== slot || prev.copy !== copy || prev.phase === 'firstFrame') return 0;
  return prev.n + 1;
}

export function shouldEnterSafeMode(prev: BootRecord | null, slot: number, copy: string): boolean {
  return failedBoots(prev, slot, copy) >= SAFE_MODE_AFTER_FAILS;
}

function isBootRecord(v: unknown): v is BootRecord {
  const r = v as BootRecord | null;
  return !!r && typeof r.slot === 'number' && typeof r.copy === 'string' && typeof r.phase === 'string' && typeof r.n === 'number';
}

export class BootTracker {
  private record: BootRecord | null = null;
  private readonly prev: BootRecord | null;

  constructor(
    private readonly kv: KeyValue,
    private readonly key: string,
  ) {
    const raw = readJson<unknown>(kv, key);
    this.prev = isBootRecord(raw) ? raw : null;
  }

  /** Start tracking a boot of `copy`. Returns how many earlier boots of it failed and whether that means Safe Mode. */
  begin(slot: number, copy: string): { fails: number; safeMode: boolean } {
    const fails = failedBoots(this.prev, slot, copy);
    this.record = { slot, copy, phase: 'load', n: fails };
    this.persist();
    return { fails, safeMode: fails >= SAFE_MODE_AFTER_FAILS };
  }

  /** Switch the tracked copy (fallback to an older copy) without resetting the failure count of the new one. */
  retarget(copy: string): void {
    if (!this.record) return;
    this.record = { ...this.record, copy, n: failedBoots(this.prev, this.record.slot, copy), phase: 'load' };
    this.persist();
  }

  /** Advance the phase; never moves backwards (the first frame may render before the first tick). */
  phase(p: BootPhase): void {
    if (!this.record || PHASE_ORDER.indexOf(p) <= PHASE_ORDER.indexOf(this.record.phase)) return;
    this.record = { ...this.record, phase: p };
    this.persist();
  }

  get current(): BootRecord | null {
    return this.record;
  }

  /** Booted cleanly for BOOT_STABLE_MS: forget the record. */
  clear(): void {
    this.record = null;
    this.kv.remove(this.key);
  }

  private persist(): void {
    if (this.record) writeJson(this.kv, this.key, this.record);
  }
}
