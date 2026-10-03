// Build-mode input (03 §3.7, §4.2; 04 §6.2): canvas pointers go through the pure GestureMachine into the build
// session; a rAF runs only while a finger is down, for the long-press and loupe clocks and edge auto-pan. Mouse:
// left = touch without the lifted point, right-drag pans, wheel zooms, hover moves the cursor. The dev keyboard
// covers place / cancel / rotate / bulldoze / overlay, undo / redo, pan, zoom and yaw.
//
// Touches that land off the canvas (the dock band, a button, a chip) still count as fingers (03 §4.13: 0
// pinch-painted belts): one that lands while a canvas finger is down, or just before one (the pinch window), joins
// the machine as the second finger, so the gesture becomes the camera; its own click is then swallowed.
import type { AppController } from '../../app/types';
import { TOUCH } from '../../shared/canon';
import type { BuildSession } from '../../ui/build/session';
import { edgePanVelocity } from './edgePan';
import { GestureMachine, type PointerDown } from './machine';

export interface BuildInput {
  /** The pointer belongs to a build gesture (it keeps going here even if build mode closed meanwhile). */
  owns(id: number): boolean;
  /** Canvas-relative CSS px. */
  down(e: PointerEvent, x: number, y: number): void;
  move(e: PointerEvent, x: number, y: number): void;
  up(e: PointerEvent, x: number, y: number): void;
  cancel(id: number): void;
  wheel(e: WheelEvent, x: number, y: number): void;
  /** Build-mode keys; true when handled (the caller prevents the default). */
  key(e: KeyboardEvent): boolean;
  readonly touching: boolean;
  releaseAll(): void;
  dispose(): void;
}

const WHEEL_STEP = 1.1;
/** Edge auto-pan ignores frame gaps above this (a stalled tab must not fling the view). */
const MAX_DT_S = 0.05;
/**
 * After a frame gap this long the clocks wait one frame: pointer moves queued behind the stall are delivered
 * first, so a busy frame never turns the start of a drag into a long-press.
 */
const STALL_MS = 120;
/** A control pressed as part of a camera gesture ignores the click that follows its release this soon. */
const CLICK_SWALLOW_MS = 600;

const PAN_KEYS: Readonly<Record<string, [number, number]>> = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
};

// Gesture times are taken when a handler runs, never from Event.timeStamp: a touch delivered late (a busy main
// thread) would otherwise arrive already 450 ms old and become a long-press on the next frame.
export function createBuildInput(opts: {
  session: BuildSession;
  app: AppController;
  now?: () => number;
  /** Where off-canvas touches are watched (capture phase); default `window`, none outside a browser. */
  events?: EventTarget | null;
}): BuildInput {
  const { session, app } = opts;
  const now = opts.now ?? (() => performance.now());
  const events = opts.events !== undefined ? opts.events : typeof window !== 'undefined' ? window : null;
  const machine = new GestureMachine(session, {
    toolArmed: () => session.tool !== null,
    panLatch: () => session.panLatch,
  });
  session.onEnd = () => machine.reset();
  const vel = { vx: 0, vy: 0 };
  const sample: PointerDown = { id: 0, x: 0, y: 0, t: 0 };
  let raf = 0;
  let lastT = -1;
  /** Client → canvas offset, from the last canvas pointer (off-canvas touches are fed in canvas px). */
  let offX = 0;
  let offY = 0;
  /** Touches down off the canvas: client position, touch-down time, and whether the machine took them. */
  const foreign = new Map<number, { x: number; y: number; t: number; el: EventTarget | null; joined: boolean }>();
  /** The control under an off-canvas finger that was part of a camera gesture: its click is not a press. */
  let swallow: { el: EventTarget | null; until: number } | null = null;

  const frame = (): void => {
    raf = 0;
    if (machine.pointers === 0) return;
    const t = now();
    if (lastT >= 0 && t - lastT <= STALL_MS) machine.tick(t);
    if (machine.state === 'stroke' && session.active) {
      const f = machine.finger;
      const dt = lastT < 0 ? 0 : Math.min(MAX_DT_S, (t - lastT) / 1000);
      if (dt > 0 && edgePanVelocity(f.x, f.y, session.area, vel)) {
        session.edgePan(vel.vx, vel.vy, dt);
        const p = machine.lifted;
        session.strokeMove(p.x, p.y);
      }
    }
    lastT = t;
    raf = requestAnimationFrame(frame);
  };

  const ensureFrame = (): void => {
    if (!raf) {
      lastT = -1;
      raf = requestAnimationFrame(frame);
    }
  };

  const stopFrame = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const kindOf = (e: PointerEvent): PointerDown['kind'] => (e.pointerType === 'mouse' ? 'mouse' : e.pointerType === 'pen' ? 'pen' : 'touch');

  /** Hand an off-canvas touch to the machine as the second finger (the gesture becomes the camera). */
  const join = (id: number): void => {
    const f = foreign.get(id);
    if (!f || f.joined) return;
    sample.id = id;
    sample.x = f.x - offX;
    sample.y = f.y - offY;
    sample.t = now();
    sample.kind = 'touch';
    sample.button = 0;
    machine.down(sample);
    f.joined = machine.owns(id);
  };

  const isCanvas = (t: EventTarget | null): boolean => (t as { tagName?: string } | null)?.tagName === 'CANVAS';

  const onForeignDown = (ev: Event): void => {
    const e = ev as PointerEvent;
    if (e.pointerType !== 'touch' || isCanvas(e.target) || !session.active) return;
    foreign.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now(), el: e.target, joined: false });
    // A canvas finger is down: this one is its second finger, wherever it landed.
    if (machine.pointers > 0) join(e.pointerId);
  };

  const onForeignMove = (ev: Event): void => {
    const e = ev as PointerEvent;
    const f = foreign.get(e.pointerId);
    if (!f) return;
    f.x = e.clientX;
    f.y = e.clientY;
    if (machine.owns(e.pointerId)) machine.move(e.pointerId, f.x - offX, f.y - offY, now());
  };

  const onForeignUp = (ev: Event): void => {
    const e = ev as PointerEvent;
    const f = foreign.get(e.pointerId);
    if (!f) return;
    foreign.delete(e.pointerId);
    if (f.joined) swallow = { el: f.el, until: now() + CLICK_SWALLOW_MS };
    if (!machine.owns(e.pointerId)) return;
    if (e.type === 'pointercancel') {
      machine.cancel(e.pointerId);
      stopFrame();
      return;
    }
    machine.up(e.pointerId, e.clientX - offX, e.clientY - offY, now());
    if (machine.pointers === 0) stopFrame();
  };

  const onClick = (ev: Event): void => {
    const sw = swallow;
    if (!sw) return;
    if (now() > sw.until) {
      swallow = null;
      return;
    }
    const el = sw.el as Node | null;
    const t = ev.target as Node | null;
    if (el && t && (el === t || (typeof el.contains === 'function' && el.contains(t)))) {
      swallow = null;
      ev.stopPropagation();
      ev.preventDefault();
    }
  };

  const listen: [string, (e: Event) => void][] = [
    ['pointerdown', onForeignDown],
    ['pointermove', onForeignMove],
    ['pointerup', onForeignUp],
    ['pointercancel', onForeignUp],
    ['click', onClick],
  ];
  if (events) for (const [type, fn] of listen) events.addEventListener(type, fn, true);

  const api: BuildInput = {
    owns: (id) => machine.owns(id),
    down(e, x, y) {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
        offX = e.clientX - x;
        offY = e.clientY - y;
      }
      const first = machine.pointers === 0;
      sample.id = e.pointerId;
      sample.x = x;
      sample.y = y;
      sample.t = now();
      sample.kind = kindOf(e);
      sample.button = e.button;
      machine.down(sample);
      if (!machine.owns(e.pointerId)) return;
      ensureFrame();
      // A touch that landed off the canvas just before this one is the other finger of a pinch.
      if (first && e.pointerType === 'touch') {
        const t = now();
        for (const [id, f] of foreign) {
          if (!f.joined && t - f.t <= TOUCH.pinchWindowMs) {
            join(id);
            break;
          }
        }
      }
    },
    move(e, x, y) {
      if (machine.owns(e.pointerId)) machine.move(e.pointerId, x, y, now());
      else if (e.pointerType === 'mouse' && machine.pointers === 0 && session.active) session.cursor(x, y);
    },
    up(e, x, y) {
      if (!machine.owns(e.pointerId)) return;
      machine.up(e.pointerId, x, y, now());
      if (machine.pointers === 0) stopFrame();
    },
    cancel(id) {
      if (!machine.owns(id)) return;
      machine.cancel(id);
      stopFrame();
    },
    wheel(e, x, y) {
      if (!session.active) return;
      e.preventDefault();
      session.zoom(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, x, y);
    },
    key(e) {
      if (!session.active) return false;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        if (e.code === 'KeyY' || e.shiftKey) session.redo();
        else session.undo();
        return true;
      }
      if (mod || e.altKey) return false;
      const pan = PAN_KEYS[e.code];
      if (pan) {
        session.nudgeView(pan[0], pan[1]);
        return true;
      }
      if (e.repeat && e.code !== 'Minus' && e.code !== 'Equal') return e.code in KEYS;
      const fn = KEYS[e.code];
      if (!fn) return false;
      fn(session, app);
      return true;
    },
    get touching() {
      return machine.pointers > 0;
    },
    releaseAll() {
      machine.reset();
      stopFrame();
      foreign.clear();
      swallow = null;
    },
    dispose() {
      machine.reset();
      stopFrame();
      foreign.clear();
      if (events) for (const [type, fn] of listen) events.removeEventListener(type, fn, true);
      if (session.onEnd) session.onEnd = null;
    },
  };
  return api;
}

/** 03 §3.7 build keys. */
const KEYS: Readonly<Record<string, (s: BuildSession, app: AppController) => void>> = {
  Escape: (s, app) => {
    if (!s.back()) app.exitBuild();
  },
  KeyB: (_s, app) => app.exitBuild(),
  Enter: (s) => void s.confirm(),
  NumpadEnter: (s) => void s.confirm(),
  KeyR: (s) => s.rotate(),
  Delete: (s) => s.arm(s.tool === 'bulldoze' ? null : 'bulldoze'),
  Backspace: (s) => s.arm(s.tool === 'bulldoze' ? null : 'bulldoze'),
  KeyO: (s) => s.toggleOverlay(),
  KeyL: (s) => s.toggleLMode(),
  Minus: (s) => s.zoomOut(),
  NumpadSubtract: (s) => s.zoomOut(),
  Equal: (s) => s.zoomIn(),
  NumpadAdd: (s) => s.zoomIn(),
  BracketLeft: (s) => s.yawStep(-1),
  BracketRight: (s) => s.yawStep(1),
};
