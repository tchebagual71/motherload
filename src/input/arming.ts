// Quick-slot press state machine (canon §3.12 "Explosive / beacon"; 03 §3.4). Pure.
// Explosives and beacons ('armed'): down shows the footprint and fills a 250 ms ring; release after it
// fills fires; earlier release or a slide > 24 pt cancels and nothing is spent.
// Jerrycan and Patch Kit ('instant'): release fires, a slide > 24 pt cancels, no ring (03 §12 [UX]).
import type { PointerSample } from './arbiter';

export type SlotKind = 'armed' | 'instant';

export interface ArmConfig {
  armMs: number;
  cancelSlidePt: number;
}

export type SlotRelease =
  | { kind: 'fire'; slot: number }
  | { kind: 'cancel'; slot: number; reason: 'early' | 'slide' };

type PressState = 'idle' | 'pressing' | 'cancelled';

export class SlotPress {
  private state: PressState = 'idle';
  slot = -1;
  kind: SlotKind = 'instant';
  pointerId = -1;
  private downX = 0;
  private downY = 0;
  private downT = 0;
  private cfg: ArmConfig;

  constructor(cfg: ArmConfig) {
    this.cfg = { ...cfg };
  }

  configure(cfg: ArmConfig): void {
    this.cfg = { ...cfg };
  }

  /** A press is live (not yet released or cancelled). */
  get pressing(): boolean {
    return this.state === 'pressing';
  }

  /** A pointer is captured by this machine (pressing, or cancelled by a slide and awaiting release). */
  get captured(): boolean {
    return this.state !== 'idle';
  }

  /** Start a press. Returns false while another press holds the machine. */
  down(slot: number, kind: SlotKind, p: PointerSample): boolean {
    if (this.state !== 'idle') return false;
    this.state = 'pressing';
    this.slot = slot;
    this.kind = kind;
    this.pointerId = p.id;
    this.downX = p.x;
    this.downY = p.y;
    this.downT = p.t;
    return true;
  }

  /** Returns true when this move cancelled the press (slide beyond the limit). */
  move(p: PointerSample): boolean {
    if (this.state !== 'pressing' || p.id !== this.pointerId) return false;
    const dx = p.x - this.downX;
    const dy = p.y - this.downY;
    const limit = this.cfg.cancelSlidePt;
    if (dx * dx + dy * dy <= limit * limit) return false;
    this.state = 'cancelled';
    return true;
  }

  up(p: PointerSample): SlotRelease | null {
    if (this.state === 'idle' || p.id !== this.pointerId) return null;
    this.move(p);
    const { slot, kind } = this;
    const wasCancelled = this.state === 'cancelled';
    const armedFully = p.t - this.downT >= this.cfg.armMs;
    this.reset();
    if (wasCancelled) return { kind: 'cancel', slot, reason: 'slide' };
    if (kind === 'instant' || armedFully) return { kind: 'fire', slot };
    return { kind: 'cancel', slot, reason: 'early' };
  }

  /** pointercancel, blur, interrupt: drop the press without firing. */
  cancel(): void {
    this.reset();
  }

  /** Arming-ring progress 0..1 (0 for instant items or when not pressing). */
  progress(t: number): number {
    if (this.state !== 'pressing' || this.kind !== 'armed') return 0;
    const f = (t - this.downT) / this.cfg.armMs;
    return f <= 0 ? 0 : f >= 1 ? 1 : f;
  }

  private reset(): void {
    this.state = 'idle';
    this.slot = -1;
    this.pointerId = -1;
  }
}
