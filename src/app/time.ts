// TimeController (04 §3.7; canon §4.5): a set of pause reasons. The pod runs only while the set is empty and
// no resume countdown is pending; the factory runs under every reason (MVP sleeps only while hidden, which the
// loop handles by not ticking). Pure: no DOM, driven by tick(dtMs).
import { HARD_LANDING_V, TOUCH } from '../shared/canon';
import type { Overlay } from './types';

export type PauseReason = 'sheet' | 'menu' | 'settings' | 'interrupt' | 'upright' | 'death' | 'title' | 'ctxlost' | 'safemode' | 'build';
export type SheetReason = 'sheet' | 'menu' | 'settings';

export interface PodMotion {
  grounded: boolean;
  vx: number;
  vy: number;
}

const SHEET_REASONS: readonly SheetReason[] = ['sheet', 'menu', 'settings'];
/** While any of these holds the pod, a new `interrupt` adds nothing: their own exit applies the gate. */
const MODAL_REASONS: readonly PauseReason[] = ['title', 'safemode', 'death', 'sheet', 'menu', 'settings', 'build'];
/** Overlay precedence, highest first (only one overlay shows at a time). 'ctxlost' is "Restoring graphics…" (04 §5.6). */
const OVERLAY_ORDER: readonly (PauseReason & Exclude<Overlay, null>)[] = ['safemode', 'title', 'upright', 'ctxlost', 'death', 'interrupt'];

/** Canon §4.5 resume gate: airborne or |v| > 3 tiles/s → 1.5 s countdown. */
export function needsResumeCountdown(p: PodMotion): boolean {
  const lim = TOUCH.resumeAirborneV;
  return !p.grounded || p.vx * p.vx + p.vy * p.vy > lim * lim;
}

/** Leaving a sheet, map or build mode airborne with |v_y| > 5.88 gets the same countdown (canon §4.5). */
export function needsSheetCountdown(p: PodMotion): boolean {
  return !p.grounded && Math.abs(p.vy) > HARD_LANDING_V;
}

export class TimeController {
  private readonly reasons = new Set<PauseReason>();
  private countdown = 0;

  /** Called after every change of reasons or countdown state (not on every countdown tick). */
  constructor(private readonly onChange: () => void = () => undefined) {}

  has(r: PauseReason): boolean {
    return this.reasons.has(r);
  }

  /** Returns true if the reason was newly added. */
  raise(r: PauseReason): boolean {
    if (this.reasons.has(r)) return false;
    this.reasons.add(r);
    this.onChange();
    return true;
  }

  /** Returns true if the reason was present. */
  clear(r: PauseReason): boolean {
    if (!this.reasons.delete(r)) return false;
    this.onChange();
    return true;
  }

  get podRunning(): boolean {
    return this.reasons.size === 0 && this.countdown <= 0;
  }

  get countdownMs(): number {
    return this.countdown;
  }

  /** Snapshot of the active reasons (debug, tests). */
  activeReasons(): PauseReason[] {
    return [...this.reasons];
  }

  /**
   * Raise `interrupt` (canon §4.5 sources). Ignored while a modal state already holds the pod unless `force`
   * (a cold-loaded save always asks for the resume tap). Cancels a running countdown.
   */
  interrupt(force = false): boolean {
    if (!force && MODAL_REASONS.some((r) => this.reasons.has(r))) return false;
    this.countdown = 0;
    if (!this.reasons.has('interrupt')) this.reasons.add('interrupt');
    this.onChange();
    return true;
  }

  /** "Tap to resume": clears `interrupt`, then the gate decides between running now and the countdown. */
  resume(p: PodMotion): void {
    if (this.clear('interrupt')) this.gate(needsResumeCountdown(p));
  }

  /** Title → play. A cold-loaded save goes through the full resume gate. */
  leaveTitle(p: PodMotion, coldLoad: boolean): void {
    if (this.clear('title') && coldLoad) this.gate(needsResumeCountdown(p));
  }

  /** The open sheet changed (null = closed). Closing applies the |v_y| > 5.88 rule. */
  setSheet(kind: SheetReason | null, p: PodMotion): void {
    let changed = false;
    for (const r of SHEET_REASONS) if (r !== kind && this.reasons.delete(r)) changed = true;
    if (kind && !this.reasons.has(kind)) {
      this.reasons.add(kind);
      changed = true;
    }
    if (changed) this.onChange();
    if (changed && kind === null) this.gate(needsSheetCountdown(p));
  }

  /**
   * Build mode (canon §4.5, §4.11): the pod freezes, the factory runs. Leaving it applies the same gate as a sheet
   * (airborne with |v_y| > 5.88 → countdown). Returns true when the state changed.
   */
  setBuild(on: boolean, p: PodMotion): boolean {
    if (on) return this.raise('build');
    if (!this.clear('build')) return false;
    this.gate(needsSheetCountdown(p));
    return true;
  }

  startCountdown(ms: number = TOUCH.resumeCountdownMs): void {
    this.countdown = ms;
    this.onChange();
  }

  /** Advance wall time. The countdown only runs while nothing else holds the pod. Returns true when it ends. */
  tick(dtMs: number): boolean {
    if (this.countdown <= 0 || this.reasons.size > 0) return false;
    this.countdown = Math.max(0, this.countdown - dtMs);
    if (this.countdown > 0) return false;
    this.onChange();
    return true;
  }

  overlay(): Overlay {
    for (const r of OVERLAY_ORDER) if (this.reasons.has(r)) return r;
    return this.countdown > 0 ? 'countdown' : null;
  }

  private gate(countdown: boolean): void {
    if (countdown && this.reasons.size === 0) this.startCountdown();
  }
}
