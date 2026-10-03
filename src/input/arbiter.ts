// Pod-mode pointer arbitration on the canvas (03 §3.1; canon §3.12 touch table). Pure: fed with
// synthetic {id, x, y, t} samples so it can be unit-tested without a DOM.
//
// Order for a pointer-down that reached the canvas (controls are DOM and never get here):
//   1. A pointer while the stick is held is a "second pointer": ignored (pinch zoom is MVP).
//   2. In the spawn zone: the stick spawns centred on the touch.
//   3. Anywhere: a world-tap candidate. Up within 200 ms and < 10 pt → world tap; a stick the tap
//      spawned is discarded (its output never left the dead zone by more than 2 pt).
// One-handed mode (canon §3.12) passes a virtual origin: the stick is measured from it, not from the touch.
import { TOUCH } from '../shared/canon';
import { FloatingStick, type StickConfig } from './stick';
import { inRect, type Rect } from './zones';

export interface PointerSample {
  id: number;
  x: number;
  y: number;
  /** ms, monotonic (performance.now() / event.timeStamp). */
  t: number;
}

export type PointerRole = 'stick' | 'tap' | 'ignored';

interface Tracked {
  id: number;
  role: PointerRole;
  downX: number;
  downY: number;
  downT: number;
  /** Max squared distance from the down point so far. */
  maxMove2: number;
}

export interface TapConfig {
  worldTapMs: number;
  tapMovePt: number;
}

export interface WorldTap {
  x: number;
  y: number;
}

export class CanvasArbiter {
  readonly stick: FloatingStick;
  private readonly tracked: Tracked[] = [];
  private readonly tap: TapConfig;

  constructor(stickCfg: StickConfig, tap: TapConfig = { worldTapMs: TOUCH.worldTapMs, tapMovePt: TOUCH.tapMovePt }) {
    this.stick = new FloatingStick(stickCfg);
    this.tap = { ...tap };
  }

  /** Pointers currently down on the canvas. */
  get pointerCount(): number {
    return this.tracked.length;
  }

  roleOf(id: number): PointerRole | null {
    return this.find(id)?.role ?? null;
  }

  down(p: PointerSample, spawnZone: Rect, origin?: { x: number; y: number }): PointerRole {
    if (this.find(p.id)) return 'ignored';
    let role: PointerRole;
    if (this.stick.active) role = 'ignored';
    else if (inRect(spawnZone, p.x, p.y)) role = 'stick';
    else role = 'tap';
    this.tracked.push({ id: p.id, role, downX: p.x, downY: p.y, downT: p.t, maxMove2: 0 });
    if (role === 'stick') {
      this.stick.spawn(p.id, origin?.x ?? p.x, origin?.y ?? p.y);
      if (origin) this.stick.move(p.x, p.y);
    }
    return role;
  }

  move(p: PointerSample): void {
    const tr = this.find(p.id);
    if (!tr) return;
    this.moveTracked(tr, p);
    if (tr.role === 'stick') this.stick.move(p.x, p.y);
  }

  /** Pointer lifted. Returns the world tap it produced, if any. */
  up(p: PointerSample): WorldTap | null {
    const tr = this.remove(p.id);
    if (!tr) return null;
    this.moveTracked(tr, p);
    if (tr.role === 'stick') this.stick.release();
    if (tr.role === 'ignored') return null;
    const quick = p.t - tr.downT < this.tap.worldTapMs;
    const still = tr.maxMove2 < this.tap.tapMovePt * this.tap.tapMovePt;
    return quick && still ? { x: tr.downX, y: tr.downY } : null;
  }

  /** pointercancel / lostpointercapture: drop the pointer without a tap. Returns true if it held the stick. */
  cancel(id: number): boolean {
    const tr = this.remove(id);
    if (!tr) return false;
    if (tr.role === 'stick') {
      this.stick.release();
      return true;
    }
    return false;
  }

  releaseAll(): void {
    this.tracked.length = 0;
    this.stick.release();
  }

  private moveTracked(tr: Tracked, p: PointerSample): void {
    const dx = p.x - tr.downX;
    const dy = p.y - tr.downY;
    const d2 = dx * dx + dy * dy;
    if (d2 > tr.maxMove2) tr.maxMove2 = d2;
  }

  private find(id: number): Tracked | undefined {
    for (const t of this.tracked) if (t.id === id) return t;
    return undefined;
  }

  private remove(id: number): Tracked | undefined {
    const i = this.tracked.findIndex((t) => t.id === id);
    if (i < 0) return undefined;
    const [tr] = this.tracked.splice(i, 1);
    return tr;
  }
}
