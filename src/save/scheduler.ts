// Autosave policy (canon §3.15; 04 §4.12), driven by the frame loop's clock — no timers of its own.
//   critical  — visibilitychange→hidden, pagehide, death, respawn: synchronous serialise + raw write, now.
//   soon      — shop/upgrade, Rim arrival, hull damage: compressed write ≤ 1 s later (coalesced).
//   routine   — every 30 s while dirty.
// One compressed write is in flight at a time; requests made meanwhile coalesce into one follow-up write.
// A write that does not land leaves the game dirty, so a later write retries it: a critical write the store could
// not take ('closed': it is reconnecting) is retried as a "soon" save, anything else at the routine cadence.
import { SAVE_ROUTINE_MS } from '../shared/canon';
import type { SaveSummary, WriteError, WriteOutcome } from './store';

export interface SaveSink {
  writeCritical(bytes: Uint8Array, summary?: SaveSummary): Promise<WriteOutcome>;
  writeRoutine(bytes: Uint8Array, summary?: SaveSummary): Promise<WriteOutcome>;
}

export type SaveKind = 'critical' | 'routine';

export interface SaveSchedulerOptions {
  serialize(): Uint8Array;
  summarize?(): SaveSummary;
  sink: SaveSink;
  /** Delay before a "soon" save; the window lets bursts (buy 5 L, buy 5 L, sell) coalesce. */
  soonMs?: number;
  routineMs?: number;
  onSaved?(kind: SaveKind, outcome: WriteOutcome): void;
  onError?(error: WriteError | 'serialize', kind: SaveKind): void;
}

export const SOON_MS = 300;

export class SaveScheduler {
  private dirty = false;
  private soonAt = Number.POSITIVE_INFINITY;
  private lastSavedAt: number;
  private inFlight: Promise<void> | null = null;
  private readonly soonMs: number;
  private readonly routineMs: number;
  private enabled = true;

  constructor(
    private readonly opts: SaveSchedulerOptions,
    now: number,
  ) {
    this.soonMs = opts.soonMs ?? SOON_MS;
    this.routineMs = opts.routineMs ?? SAVE_ROUTINE_MS;
    this.lastSavedAt = now;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  get busy(): boolean {
    return this.inFlight !== null;
  }

  /** Disable all writes (Safe Mode before the player decides, read-only tabs). */
  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** High-priority save, ≤ 1 s from now. */
  requestSoon(now: number): void {
    this.dirty = true;
    this.soonAt = Math.min(this.soonAt, now + this.soonMs);
  }

  /** Synchronous critical save. Returns the completion promise, or null if nothing was written. */
  critical(now: number): Promise<WriteOutcome> | null {
    if (!this.enabled) return null;
    const bytes = this.serialize('critical');
    if (!bytes) return null;
    const done = this.opts.sink.writeCritical(bytes, this.opts.summarize?.());
    this.dirty = false;
    this.soonAt = Number.POSITIVE_INFINITY;
    this.lastSavedAt = now;
    void done.then((o) => {
      if (!o.ok && o.error !== 'stale') {
        this.dirty = true;
        if (o.error === 'closed') this.soonAt = Math.min(this.soonAt, now + this.soonMs);
      }
      this.report('critical', o);
    });
    return done;
  }

  /** Call once per frame. Starts a compressed write when one is due and none is in flight. */
  tick(now: number): void {
    if (!this.enabled || this.inFlight) return;
    const soonDue = now >= this.soonAt;
    const routineDue = this.dirty && now - this.lastSavedAt >= this.routineMs;
    if (soonDue || routineDue) this.startRoutine(now);
  }

  /** Resolves when the in-flight compressed write (if any) settles. */
  async flush(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }

  private startRoutine(now: number): void {
    this.soonAt = Number.POSITIVE_INFINITY;
    const bytes = this.serialize('routine');
    if (!bytes) return;
    this.dirty = false;
    this.lastSavedAt = now;
    this.inFlight = this.opts.sink
      .writeRoutine(bytes, this.opts.summarize?.())
      .catch((): WriteOutcome => ({ ok: false, error: 'failed' }))
      .then((o) => {
        // A failed write leaves the game dirty so the next routine tick retries; 'stale' means a newer
        // critical save already covered this state.
        if (!o.ok && o.error !== 'stale') this.dirty = true;
        this.report('routine', o);
      })
      .finally(() => {
        this.inFlight = null;
      });
  }

  private serialize(kind: SaveKind): Uint8Array | null {
    try {
      return this.opts.serialize();
    } catch {
      this.opts.onError?.('serialize', kind);
      return null;
    }
  }

  private report(kind: SaveKind, o: WriteOutcome): void {
    if (o.ok) this.opts.onSaved?.(kind, o);
    else if (o.error !== 'stale') this.opts.onError?.(o.error, kind);
  }
}
