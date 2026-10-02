// Boot tracking and the Safe Mode decision (04 §4.13; canon §3.15). The record lives in localStorage
// (`hf-<ch>.boot`) because it must survive a crash or a jetsam kill mid-boot:
//   {slot, copy, phase, n, left?} — phase advances load → migrate → firstTick → firstFrame; n counts the boots on
//   this copy that died before firstFrame. Two such deaths in a row put the next boot in Safe Mode.
// Only a boot that vanishes in view is a death: one the player left before its first frame (reload, close, app
// switch: pagehide or hidden) is marked `left` and counts neither way. A crash or a jetsam kill fires neither.
import type { KeyValue } from '../platform/storage';
import { readJson, writeJson } from '../platform/storage';

export type BootPhase = 'load' | 'migrate' | 'firstTick' | 'firstFrame';

export interface BootRecord {
  slot: number;
  copy: string;
  phase: BootPhase;
  /** Consecutive failed boots on this copy BEFORE this one. */
  n: number;
  /** The page was hidden or left before firstFrame (and not visible again since): not a failure. */
  left?: true;
}

const PHASE_ORDER: readonly BootPhase[] = ['load', 'migrate', 'firstTick', 'firstFrame'];

export const SAFE_MODE_AFTER_FAILS = 2;
/** The record is cleared after this long of clean running. */
export const BOOT_STABLE_MS = 10_000;

/** How many consecutive boots of `copy` died before their first frame (a boot the player left adds none). */
export function failedBoots(prev: BootRecord | null, slot: number, copy: string): number {
  if (!prev || prev.slot !== slot || prev.copy !== copy || prev.phase === 'firstFrame') return 0;
  return prev.left ? prev.n : prev.n + 1;
}

export function shouldEnterSafeMode(prev: BootRecord | null, slot: number, copy: string): boolean {
  return failedBoots(prev, slot, copy) >= SAFE_MODE_AFTER_FAILS;
}

function isBootRecord(v: unknown): v is BootRecord {
  const r = v as BootRecord | null;
  return !!r && typeof r.slot === 'number' && typeof r.copy === 'string' && typeof r.phase === 'string' && typeof r.n === 'number';
}

export interface BootVerdict {
  fails: number;
  safeMode: boolean;
}

function verdict(fails: number): BootVerdict {
  return { fails, safeMode: fails >= SAFE_MODE_AFTER_FAILS };
}

export class BootTracker {
  private record: BootRecord | null = null;
  private readonly prev: BootRecord | null;
  private away = false;

  constructor(
    private readonly kv: KeyValue,
    private readonly key: string,
  ) {
    const raw = readJson<unknown>(kv, key);
    this.prev = isBootRecord(raw) ? raw : null;
  }

  /** Start tracking a boot of `copy`. Returns how many earlier boots of it failed and whether that means Safe Mode. */
  begin(slot: number, copy: string): BootVerdict {
    const fails = failedBoots(this.prev, slot, copy);
    this.write({ slot, copy, phase: 'load', n: fails });
    return verdict(fails);
  }

  /**
   * Switch the tracked copy (fallback to an older copy) without resetting the failure count of the new one. The
   * verdict is that copy's own: a fallback that keeps dying must reach Safe Mode too.
   */
  retarget(copy: string): BootVerdict {
    if (!this.record) return verdict(0);
    const fails = failedBoots(this.prev, this.record.slot, copy);
    this.write({ slot: this.record.slot, copy, phase: 'load', n: fails });
    return verdict(fails);
  }

  /** The page was hidden or left (true), or is in view again (false). Ignored once the first frame is drawn. */
  setLeft(left: boolean): void {
    this.away = left;
    if (this.record && this.record.phase !== 'firstFrame') this.write(this.record);
  }

  /** Advance the phase; never moves backwards (the first frame may render before the first tick). */
  phase(p: BootPhase): void {
    if (!this.record || PHASE_ORDER.indexOf(p) <= PHASE_ORDER.indexOf(this.record.phase)) return;
    this.write({ ...this.record, phase: p });
  }

  get current(): BootRecord | null {
    return this.record;
  }

  /** Booted cleanly for BOOT_STABLE_MS: forget the record. */
  clear(): void {
    this.record = null;
    this.kv.remove(this.key);
  }

  /** Store `r` with the current `left` mark (cleared at firstFrame: a boot that got there was not left). */
  private write(r: BootRecord): void {
    const { left: _left, ...rest } = r;
    this.record = this.away && r.phase !== 'firstFrame' ? { ...rest, left: true } : rest;
    writeJson(this.kv, this.key, this.record);
  }
}
