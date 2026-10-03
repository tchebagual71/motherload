// Build-mode gesture arbitration (04 §6.2; 03 §4.2; constants canon §3.12). Pure: fed with pointer samples in CSS
// px and a clock, it calls a GestureSink. No DOM, no timers: the DOM glue (./index.ts) calls tick() for the
// long-press and loupe clocks.
//
//   IDLE    ─down p1→ PENDING (cursor on the lifted point, 44 pt above the finger, from touch-down)
//   PENDING ─p2 down → CAMERA (nothing committed; inside the 120-ms grace or not, PENDING holds nothing)
//   PENDING ─up before the long-press, < 10 pt → TAP at the lifted point (time alone never leaves PENDING)
//   PENDING ─450 ms, < 10 pt → LONGPRESS (MVP: inspect), then LONG until the finger lifts
//   PENDING ─moved ≥ 10 pt → STROKE (tool armed, ✋ Pan off) | PAN
//   STROKE  ─p2 ≤ 120 ms after p1 down → discard the stroke → CAMERA;  later p2 → freeze it as a ghost → CAMERA
//   CAMERA  : two fingers pan + pinch; a twist past 30° snaps the yaw ±90° (Yard); one finger up → HOLD
//   HOLD    : the remaining finger pans until all lift
//   any     ─cancel → IDLE (an uncommitted stroke is discarded)
import { TOUCH } from '../../shared/canon';

export type GestureState = 'idle' | 'pending' | 'stroke' | 'pan' | 'camera' | 'hold' | 'long';

/** What the machine asks of build mode. Points are screen CSS px; "lifted" points are already 44 pt above the finger. */
export interface GestureSink {
  /** PENDING: the lifted point (the cell a tap would act on). */
  cursor(x: number, y: number): void;
  tap(x: number, y: number): void;
  longPress(x: number, y: number): void;
  /** A stroke starts from the lifted point at touch-down (04 §6.2: its first cell is under the lifted point). */
  strokeStart(x: number, y: number): void;
  strokeMove(x: number, y: number): void;
  /** The finger lifted: keep the stroke as the pending ghost (✓ commits; Instant build may commit at once). */
  strokeEnd(): void;
  /** A late second finger: keep the stroke as an uncommitted ghost and hand over to the camera. */
  strokeFreeze(): void;
  /** An early second finger or a cancel: the stroke never happened. */
  strokeDiscard(): void;
  /** Move the view with the finger(s): screen delta in px. */
  pan(dx: number, dy: number): void;
  /** Pinch: multiply the zoom by `scale` about the screen point (cx, cy). */
  zoom(scale: number, cx: number, cy: number): void;
  /** Two-finger twist past the snap angle: one 90° yaw step (Yard; ignored underground). */
  yawSnap(step: 1 | -1): void;
  /** A one-finger pan (or the whole camera gesture) ended: the ✋ Pan latch releases (03 §4.1). */
  panEnd(): void;
  /** Loupe (canon §3.12): shown after 150 ms of a stroke, at the finger; null hides it. */
  loupe(finger: { x: number; y: number } | null): void;
}

export interface MachineConfig {
  /** A tool is armed: a drag strokes it instead of panning. */
  toolArmed(): boolean;
  /** ✋ Pan latch: one finger pans with the tool still armed. */
  panLatch(): boolean;
}

export interface PointerDown {
  id: number;
  x: number;
  y: number;
  /** ms, monotonic. */
  t: number;
  /** Mouse and pen are precise: no lifted point. Mouse button 2 (right-drag) always pans (03 §3.7). */
  kind?: 'touch' | 'mouse' | 'pen';
  button?: number;
}

/** Tunables (canon §3.12 touch constants; 03 §4.9 loupe delay). */
export const GESTURE = {
  movePt: TOUCH.tapMovePt,
  longPressMs: TOUCH.longPressMs,
  graceMs: TOUCH.secondFingerGraceMs,
  liftPt: TOUCH.liftedPointPt,
  /** 03 §4.9: the loupe appears after 150 ms of drag. */
  loupeMs: 150,
  /** Canon §3.12 yaw twist snap. */
  twistSnapDeg: 30,
} as const;

interface Track {
  id: number;
  x: number;
  y: number;
  /** Lifted-point offset for this pointer (0 for mouse / pen). */
  lift: number;
}

const DEG = 180 / Math.PI;

export class GestureMachine {
  private st: GestureState = 'idle';
  private readonly a: Track = { id: -1, x: 0, y: 0, lift: 0 };
  private readonly b: Track = { id: -1, x: 0, y: 0, lift: 0 };
  /** First pointer at touch-down. */
  private x0 = 0;
  private y0 = 0;
  private t0 = 0;
  /** Largest distance the first pointer moved from touch-down. */
  private moved = 0;
  /** Stroke start (loupe clock) and whether the loupe is showing. */
  private strokeT = 0;
  private loupeOn = false;
  /** Two-finger reference: centroid, spread, angle. */
  private cx = 0;
  private cy = 0;
  private spread = 0;
  private angle = 0;
  private twist = 0;
  private readonly fingerOut = { x: 0, y: 0 };
  private readonly liftedOut = { x: 0, y: 0 };

  constructor(
    private readonly sink: GestureSink,
    private readonly cfg: MachineConfig,
  ) {}

  get state(): GestureState {
    return this.st;
  }

  /** Pointers the machine is tracking. */
  get pointers(): number {
    return (this.a.id >= 0 ? 1 : 0) + (this.b.id >= 0 ? 1 : 0);
  }

  owns(id: number): boolean {
    return id >= 0 && (id === this.a.id || id === this.b.id);
  }

  /** The finger of the first pointer (edge auto-pan, loupe). A reused object: read it before the next event. */
  get finger(): { x: number; y: number } {
    this.fingerOut.x = this.a.x;
    this.fingerOut.y = this.a.y;
    return this.fingerOut;
  }

  /** The first pointer's lifted point (a reused object). */
  get lifted(): { x: number; y: number } {
    this.liftedOut.x = this.a.x;
    this.liftedOut.y = this.a.y - this.a.lift;
    return this.liftedOut;
  }

  down(p: PointerDown): void {
    const lift = p.kind === 'mouse' || p.kind === 'pen' ? 0 : GESTURE.liftPt;
    if (this.st === 'idle') {
      set(this.a, p.id, p.x, p.y, lift);
      this.x0 = p.x;
      this.y0 = p.y;
      this.t0 = p.t;
      this.moved = 0;
      if (p.kind === 'mouse' && p.button === 2) {
        this.st = 'pan';
        return;
      }
      this.st = 'pending';
      this.sink.cursor(p.x, p.y - lift);
      return;
    }
    if (this.b.id >= 0 || this.a.id === p.id) return; // ≤ 2 pointers
    if (this.st === 'hold' || this.st === 'pan' || this.st === 'long' || this.st === 'pending') {
      // PENDING holds nothing yet; a one-finger pan or hold simply gains a second finger.
      this.enterCamera(p, lift);
      return;
    }
    if (this.st === 'stroke') {
      if (p.t - this.t0 <= GESTURE.graceMs) this.sink.strokeDiscard();
      else this.sink.strokeFreeze();
      this.setLoupe(false);
      this.enterCamera(p, lift);
    }
  }

  move(id: number, x: number, y: number, t: number): void {
    if (!this.owns(id)) return;
    const tr = id === this.a.id ? this.a : this.b;
    const dx = x - tr.x;
    const dy = y - tr.y;
    tr.x = x;
    tr.y = y;
    switch (this.st) {
      case 'pending': {
        this.moved = Math.max(this.moved, Math.hypot(x - this.x0, y - this.y0));
        if (this.moved < GESTURE.movePt) {
          this.sink.cursor(x, y - tr.lift);
          return;
        }
        if (this.cfg.toolArmed() && !this.cfg.panLatch()) {
          this.st = 'stroke';
          this.strokeT = t;
          this.sink.strokeStart(this.x0, this.y0 - tr.lift);
          this.sink.strokeMove(x, y - tr.lift);
        } else {
          this.st = 'pan';
          // Content tracks the finger exactly: the whole movement since touch-down.
          this.sink.pan(x - this.x0, y - this.y0);
        }
        return;
      }
      case 'stroke':
        this.sink.strokeMove(x, y - tr.lift);
        this.tick(t);
        return;
      case 'pan':
      case 'hold':
        this.sink.pan(dx, dy);
        return;
      case 'camera':
        this.cameraMove();
        return;
      default:
        return;
    }
  }

  up(id: number, x: number, y: number, t: number): void {
    if (!this.owns(id)) return;
    const tr = id === this.a.id ? this.a : this.b;
    if (tr.x !== x || tr.y !== y) this.move(id, x, y, t);
    switch (this.st) {
      case 'pending': {
        const lift = this.a.lift;
        const tap = this.moved < GESTURE.movePt && t - this.t0 < GESTURE.longPressMs;
        this.st = 'idle';
        this.clear();
        if (tap) this.sink.tap(this.x0, this.y0 - lift);
        return;
      }
      case 'stroke':
        this.setLoupe(false);
        this.st = 'idle';
        this.sink.strokeEnd();
        this.clear();
        return;
      case 'pan':
        this.st = 'idle';
        this.clear();
        this.sink.panEnd();
        return;
      case 'camera': {
        // One finger lifted: the other keeps panning until all lift.
        this.release(id);
        this.st = 'hold';
        return;
      }
      case 'hold':
        this.st = 'idle';
        this.clear();
        this.sink.panEnd();
        return;
      case 'long':
        this.st = 'idle';
        this.clear();
        return;
      default:
        this.clear();
    }
  }

  /** pointercancel / lostpointercapture: back to IDLE; an uncommitted stroke is discarded. */
  cancel(id: number): void {
    if (!this.owns(id)) return;
    this.reset();
  }

  /** Drop everything (mode exit, blur). */
  reset(): void {
    if (this.st === 'stroke') this.sink.strokeDiscard();
    if (this.st === 'pan' || this.st === 'camera' || this.st === 'hold') this.sink.panEnd();
    this.setLoupe(false);
    this.st = 'idle';
    this.clear();
  }

  /** Clocks: the long-press in PENDING, the loupe in STROKE. Call at least every ~50 ms while a pointer is down. */
  tick(t: number): void {
    if (this.st === 'pending' && this.moved < GESTURE.movePt && t - this.t0 >= GESTURE.longPressMs) {
      this.st = 'long';
      this.sink.longPress(this.x0, this.y0 - this.a.lift);
      return;
    }
    if (this.st === 'stroke') {
      const show = t - this.strokeT >= GESTURE.loupeMs;
      if (show) this.sink.loupe(this.finger);
      else this.setLoupe(false);
      this.loupeOn = show;
    }
  }

  // ---------------------------------------------------------------- internals

  private enterCamera(p: PointerDown, lift: number): void {
    set(this.b, p.id, p.x, p.y, lift);
    this.st = 'camera';
    this.cameraRef();
  }

  private cameraRef(): void {
    const a = this.a;
    const b = this.b;
    this.cx = (a.x + b.x) / 2;
    this.cy = (a.y + b.y) / 2;
    this.spread = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    this.angle = Math.atan2(b.y - a.y, b.x - a.x) * DEG;
    this.twist = 0;
  }

  private cameraMove(): void {
    const a = this.a;
    const b = this.b;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const spread = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const angle = Math.atan2(b.y - a.y, b.x - a.x) * DEG;
    if (cx !== this.cx || cy !== this.cy) this.sink.pan(cx - this.cx, cy - this.cy);
    if (spread !== this.spread) this.sink.zoom(spread / this.spread, cx, cy);
    let da = angle - this.angle;
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    this.twist += da;
    if (Math.abs(this.twist) >= GESTURE.twistSnapDeg) {
      this.sink.yawSnap(this.twist > 0 ? 1 : -1);
      this.twist = 0;
    }
    this.cx = cx;
    this.cy = cy;
    this.spread = spread;
    this.angle = angle;
  }

  /** One of two pointers lifted: keep the other as the first. */
  private release(id: number): void {
    if (id === this.a.id) {
      set(this.a, this.b.id, this.b.x, this.b.y, this.b.lift);
    }
    this.b.id = -1;
  }

  private clear(): void {
    this.a.id = -1;
    this.b.id = -1;
    this.moved = 0;
  }

  private setLoupe(on: boolean): void {
    if (!on && this.loupeOn) this.sink.loupe(null);
    this.loupeOn = on;
  }
}

function set(t: Track, id: number, x: number, y: number, lift: number): void {
  t.id = id;
  t.x = x;
  t.y = y;
  t.lift = lift;
}
