// Button taps from the pointer sequence (canon §3.12: a tap is up within 250 ms and < 10 pt). Pure.
// Browsers synthesize `click` only for a single-touch tap, so a HUD button tapped by a second finger
// while the other thumb holds the stick would do nothing. input/index.ts feeds [data-tap] buttons'
// pointers through this tracker, activates them itself, and swallows the browser's own click if it
// follows (ClickSwallow), so each tap activates exactly once with one finger or two.
import { TOUCH } from '../shared/canon';
import type { PointerSample } from './arbiter';

export interface ButtonTapConfig {
  tapMs: number;
  tapMovePt: number;
}

interface Down {
  x: number;
  y: number;
  t: number;
  maxMove2: number;
}

export class TapTracker {
  private readonly downs = new Map<number, Down>();
  private readonly cfg: ButtonTapConfig;

  constructor(cfg: ButtonTapConfig = { tapMs: TOUCH.tapMs, tapMovePt: TOUCH.tapMovePt }) {
    this.cfg = { ...cfg };
  }

  /** Pointers currently tracked. */
  get count(): number {
    return this.downs.size;
  }

  has(id: number): boolean {
    return this.downs.has(id);
  }

  down(p: PointerSample): void {
    this.downs.set(p.id, { x: p.x, y: p.y, t: p.t, maxMove2: 0 });
  }

  move(p: PointerSample): void {
    const d = this.downs.get(p.id);
    if (!d) return;
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    d.maxMove2 = Math.max(d.maxMove2, dx * dx + dy * dy);
  }

  /** Pointer lifted: true if it was a tap (quick, and never moved ≥ tapMovePt from the down point). */
  up(p: PointerSample): boolean {
    const d = this.downs.get(p.id);
    if (!d) return false;
    this.move(p);
    this.downs.delete(p.id);
    const slop = this.cfg.tapMovePt;
    return p.t - d.t <= this.cfg.tapMs && d.maxMove2 < slop * slop;
  }

  cancel(id: number): void {
    this.downs.delete(id);
  }

  clear(): void {
    this.downs.clear();
  }
}

/**
 * After a tap activated a button, the browser may still deliver its own click for the same touch (one
 * finger) or not at all (a second finger). Swallow at most one click on that button within `windowMs`;
 * a new press on it, or any later click, drops the claim so a stale one never eats a real click.
 */
export class ClickSwallow<T> {
  private el: T | null = null;
  private until = 0;

  constructor(private readonly windowMs = 600) {}

  /** A tap just activated `el` at time t. */
  claim(el: T, t: number): void {
    this.el = el;
    this.until = t + this.windowMs;
  }

  /** A new press started on `el`: its own click (if any) is a fresh one. */
  pressed(el: T): void {
    if (this.el === el) this.el = null;
  }

  /** A click on `el` at time t: true if it must be swallowed. `within` = el is (inside) the claimed one. */
  take(t: number, within: (claimed: T) => boolean): boolean {
    const el = this.el;
    if (el === null) return false;
    this.el = null;
    return t <= this.until && within(el);
  }

  clear(): void {
    this.el = null;
  }
}
