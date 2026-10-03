// Pod-mode input (03 §3; 04 §6.1; canon §3.12): Pointer Events on the canvas (floating stick, world
// taps), delegated pointer handling on the UI root for quick slots, THRUST and [data-tap] HUD buttons,
// the dev keyboard, and browser-gesture suppression. Produces one PodIntent per sim step via sampleIntent().
// One-handed mode measures the stick from a virtual origin under the pod (canon §3.12); THRUST may toggle (03 §3.3).
import type { AppController, InputController } from '../app/types';
import { inScope, SCOPE } from '../config/scope';
import type { PodIntent } from '../pod/types';
import { TOUCH } from '../shared/canon';
import { closeCurrentSheet } from '../ui/actions';
import { runContextAction } from '../ui/context';
import { debugEnabled } from '../ui/env';
import { CanvasArbiter, type PointerSample } from './arbiter';
import { SlotPress, type SlotKind } from './arming';
import { controls } from './controlsState';
import { installGestureGuards } from './gestures';
import { KeyboardState, type KeyCommand, type KeyIntent } from './keyboard';
import { stickSector } from './sectors';
import { slotDecision } from './slots';
import { ClickSwallow, TapTracker } from './taps';
import { oneHandedZone, stickSpawnZone, virtualOrigin, type ControlSize, type InputLayout, type Rect } from './zones';

export interface CreateInputOptions {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  app: AppController;
  /** World tap (< 200 ms, < 10 pt, any zone) in CSS px relative to the canvas: signs, buildings, marks. */
  onWorldTap?: (px: number, py: number) => void;
  getLayout: () => InputLayout;
  /** `pointercancel` on the stick or THRUST: the app raises `interrupt` (canon §4.5). */
  onInterrupt?: (reason: 'pointercancel') => void;
  /** One-handed mode: a touch on this point is a world tap (dig neighbour, sign), never a stick. */
  isTapTarget?: (px: number, py: number) => boolean;
  /** The pod's position in canvas CSS px (the one-handed virtual origin's x), or null before the first frame. */
  podScreen?: () => { x: number; y: number } | null;
}

/** The base slides when the thumb passes 1.25 R (03 §3.1 [UX]). */
const STICK_FOLLOW = 1.25;
/** Synthetic pointer ids for keyboard slot presses (real Pointer Events ids are never negative). */
const KEY_POINTER_BASE = -10;
/** One-handed: the stick is measured from the fixed virtual origin, so its base never slides after the thumb. */
const NO_FOLLOW = 1e6;
const NO_ZONE: Rect = { x0: 1, y0: 1, x1: 0, y1: 0 };

function isTextField(t: EventTarget | null): boolean {
  return t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t instanceof HTMLSelectElement;
}

export function createInput(opts: CreateInputOptions): InputController {
  const { canvas, uiRoot, app } = opts;
  const settings = () => app.state.settings.peek();
  const size = (): ControlSize => settings().controlSize;

  const arbiter = new CanvasArbiter({ radius: TOUCH.stickRadius[size()], deadZone: TOUCH.stickDeadZone, followFactor: STICK_FOLLOW });
  const press = new SlotPress({ armMs: TOUCH.explosiveArmMs, cancelSlidePt: TOUCH.explosiveCancelSlidePt });
  const keys = new KeyboardState();
  const intent: PodIntent = { sx: 0, sy: 0, thrust: false, fireSlot: -1 };
  const keyIntent: KeyIntent = { sx: 0, sy: 0, thrust: false };
  const scratch: PointerSample = { id: 0, x: 0, y: 0, t: 0 };
  let canvasLeft = 0;
  let canvasTop = 0;
  let thrustPointer = -1;
  /** THRUST "Toggle" (03 §3.3): latched on until tapped again, a Down input or any dig. */
  let thrustLatched = false;
  let pendingFire = -1;
  let armRaf = 0;
  const taps = new TapTracker();
  const tapEls = new Map<number, HTMLElement>();
  const swallow = new ClickSwallow<HTMLElement>();

  const sample = (e: PointerEvent): PointerSample => {
    scratch.id = e.pointerId;
    scratch.x = e.clientX - canvasLeft;
    scratch.y = e.clientY - canvasTop;
    scratch.t = performance.now();
    return scratch;
  };

  /** Pointer sample in client space on the event's own clock (button taps). */
  const eventSample = (e: PointerEvent): PointerSample => {
    scratch.id = e.pointerId;
    scratch.x = e.clientX;
    scratch.y = e.clientY;
    scratch.t = e.timeStamp;
    return scratch;
  };

  /** The sim is paused (sheet or overlay up): input must not queue actions for when it resumes. */
  const paused = (): boolean => app.state.sheet.peek() !== null || app.state.overlay.peek() !== null;

  // ---------------------------------------------------------------- visuals
  const publishStick = (): void => {
    const s = arbiter.stick;
    const v = controls.stick;
    v.active = s.active;
    v.baseX = s.baseX;
    v.baseY = s.baseY;
    v.knobX = s.knobX;
    v.knobY = s.knobY;
    v.radius = s.radius;
    v.magnitude = s.magnitude;
    v.sector = s.active && s.magnitude > 0 ? stickSector(s.sx, s.sy, v.sector) : 'none';
    controls.stickVersion.value++;
  };

  const setArming = (slot: number, progress: number): void => {
    const cur = app.state.arming.peek();
    if (slot < 0) {
      if (cur) app.state.arming.value = null;
    } else if (!cur || cur.slot !== slot || cur.progress !== progress) {
      app.state.arming.value = { slot, progress };
    }
  };

  const tickArming = (): void => {
    armRaf = 0;
    if (!press.pressing || press.kind !== 'armed') return;
    const p = press.progress(performance.now());
    setArming(press.slot, p);
    if (p < 1) armRaf = requestAnimationFrame(tickArming);
  };

  // ---------------------------------------------------------------- quick slots
  const beginSlot = (slot: number, p: PointerSample): boolean => {
    const pod = app.world.pod;
    const id = pod.quickSlots[slot];
    if (!id || press.captured) return false;
    const stats = app.world.stats();
    const decision = slotDecision(id, {
      count: pod.consumables[id] ?? 0,
      grounded: pod.grounded,
      fuelFrac: stats.maxFuel > 0 ? pod.fuel / stats.maxFuel : 1,
      hullFrac: stats.maxHull > 0 ? pod.hull / stats.maxHull : 1,
    });
    if (!decision.ok) {
      controls.denied.value = { slot, serial: controls.denied.peek().serial + 1 };
      return false;
    }
    return startPress(slot, decision.kind, p);
  };

  const startPress = (slot: number, kind: SlotKind, p: PointerSample): boolean => {
    if (!press.down(slot, kind, p)) return false;
    controls.pressedSlot.value = slot;
    if (kind === 'armed') {
      setArming(slot, 0);
      if (!armRaf) armRaf = requestAnimationFrame(tickArming);
    }
    return true;
  };

  const endPress = (p: PointerSample): void => {
    const r = press.up(p);
    if (!r) return;
    clearPressVisuals();
    if (r.kind === 'fire') pendingFire = r.slot;
  };

  const clearPressVisuals = (): void => {
    controls.pressedSlot.value = -1;
    setArming(-1, 0);
    if (armRaf) cancelAnimationFrame(armRaf);
    armRaf = 0;
  };

  const releaseThrust = (): void => {
    thrustPointer = -1;
    controls.thrustHeld.value = false;
  };

  const setLatch = (on: boolean): void => {
    thrustLatched = on;
    if (controls.thrustLatched.peek() !== on) controls.thrustLatched.value = on;
  };

  /** A Down push (stick or keys) or a dig releases the THRUST toggle (03 §3.3). */
  const downInput = (): boolean => {
    if (arbiter.stick.active) return controls.stick.sector === 'down';
    return keyIntent.sy < 0 && Math.abs(keyIntent.sy) >= Math.abs(keyIntent.sx);
  };

  // ---------------------------------------------------------------- canvas pointers
  const onCanvasDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    app.unlockAudio();
    const rect = canvas.getBoundingClientRect();
    canvasLeft = rect.left;
    canvasTop = rect.top;
    const s = settings();
    if (!arbiter.stick.active) {
      const followFactor = s.oneHanded ? NO_FOLLOW : STICK_FOLLOW;
      arbiter.stick.configure({ radius: TOUCH.stickRadius[s.controlSize], deadZone: TOUCH.stickDeadZone, followFactor });
    }
    const p = sample(e);
    const role = s.oneHanded ? oneHandedDown(p, s.controlSize, s.leftHanded) : arbiter.down(p, stickSpawnZone(opts.getLayout(), s.controlSize, s.leftHanded));
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for synthetic or already-released pointers; tracking still works on the canvas.
    }
    if (role === 'stick') publishStick();
  };

  /** One-handed (03 §3.6): y ≥ 0.45 H drives a stick from the virtual origin; tap targets stay taps. */
  const oneHandedDown = (p: PointerSample, size: ControlSize, leftHanded: boolean): ReturnType<CanvasArbiter['down']> => {
    const layout = opts.getLayout();
    if (opts.isTapTarget?.(p.x, p.y)) return arbiter.down(p, NO_ZONE);
    const pod = opts.podScreen?.() ?? null;
    return arbiter.down(p, oneHandedZone(layout, size, leftHanded), virtualOrigin(layout, size, pod ? pod.x : null));
  };

  const onCanvasMove = (e: PointerEvent): void => {
    if (arbiter.roleOf(e.pointerId) === null) return;
    arbiter.move(sample(e));
    if (e.pointerId === arbiter.stick.pointerId) publishStick();
  };

  const onCanvasUp = (e: PointerEvent): void => {
    const wasStick = e.pointerId === arbiter.stick.pointerId;
    const tap = arbiter.up(sample(e));
    if (wasStick) publishStick();
    if (tap && opts.onWorldTap) opts.onWorldTap(tap.x, tap.y);
  };

  const onCanvasCancel = (e: PointerEvent): void => {
    const wasStick = arbiter.cancel(e.pointerId);
    if (!wasStick) return;
    publishStick();
    opts.onInterrupt?.('pointercancel');
  };

  const onCanvasLostCapture = (e: PointerEvent): void => {
    // Fires after every pointerup too (already removed → no-op); otherwise drop the pointer quietly.
    if (arbiter.roleOf(e.pointerId) !== null && arbiter.cancel(e.pointerId)) publishStick();
  };

  // ---------------------------------------------------------------- UI-root pointers (slots, THRUST, taps)
  const controlOf = (e: PointerEvent): HTMLElement | null =>
    e.target instanceof Element ? (e.target.closest('[data-slot],[data-thrust]') as HTMLElement | null) : null;

  /** A [data-tap] button pressed by touch or pen (mouse and keyboard keep the native click). */
  const tapButtonOf = (e: PointerEvent): HTMLElement | null =>
    e.pointerType !== 'mouse' && e.target instanceof Element ? (e.target.closest('[data-tap]') as HTMLElement | null) : null;

  const onTapDown = (e: PointerEvent, el: HTMLElement): void => {
    tapEls.set(e.pointerId, el);
    taps.down(eventSample(e));
    swallow.pressed(el);
  };

  /** Activate through the button's own click handler, then claim the browser's click if one follows. */
  const onTapUp = (e: PointerEvent, el: HTMLElement): void => {
    tapEls.delete(e.pointerId);
    if (!taps.up(eventSample(e)) || !el.isConnected) return;
    el.click();
    swallow.claim(el, e.timeStamp);
  };

  const onUiClick = (e: MouseEvent): void => {
    const target = e.target;
    if (swallow.take(e.timeStamp, (el) => target instanceof Element && el.contains(target))) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const onUiDown = (e: PointerEvent): void => {
    const el = controlOf(e);
    if (!el) {
      const tap = tapButtonOf(e);
      if (tap) onTapDown(e, tap);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    app.unlockAudio();
    e.preventDefault();
    let captured = false;
    if (el.dataset.thrust !== undefined) {
      if (thrustPointer !== -1) return;
      thrustPointer = e.pointerId;
      controls.thrustHeld.value = true;
      if (settings().thrustMode === 'toggle') setLatch(!thrustLatched);
      captured = true;
    } else {
      captured = beginSlot(Number(el.dataset.slot), sample(e));
    }
    if (captured) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // See onCanvasDown.
      }
    }
  };

  const onUiMove = (e: PointerEvent): void => {
    if (taps.has(e.pointerId)) taps.move(eventSample(e));
    if (e.pointerId !== press.pointerId) return;
    if (press.move(sample(e))) clearPressVisuals();
  };

  const onUiUp = (e: PointerEvent): void => {
    const tap = tapEls.get(e.pointerId);
    if (tap) onTapUp(e, tap);
    else if (e.pointerId === thrustPointer) releaseThrust();
    else if (e.pointerId === press.pointerId) endPress(sample(e));
  };

  const onUiCancel = (e: PointerEvent): void => {
    if (tapEls.delete(e.pointerId)) taps.cancel(e.pointerId);
    else if (e.pointerId === thrustPointer) {
      releaseThrust();
      opts.onInterrupt?.('pointercancel');
    } else if (e.pointerId === press.pointerId) {
      press.cancel();
      clearPressVisuals();
    }
  };

  // ---------------------------------------------------------------- keyboard
  const keySample = (slot: number): PointerSample => {
    scratch.id = KEY_POINTER_BASE - slot;
    scratch.x = scratch.y = 0;
    scratch.t = performance.now();
    return scratch;
  };

  const runCommand = (cmd: KeyCommand): boolean => {
    const st = app.state;
    switch (cmd.kind) {
      case 'drive':
        return true;
      case 'slotDown':
        // A number key in a menu must not spend the item when the menu closes.
        if (paused()) return false;
        beginSlot(cmd.slot, keySample(cmd.slot));
        return true;
      case 'slotUp':
        if (press.pointerId === KEY_POINTER_BASE - cmd.slot) endPress(keySample(cmd.slot));
        return true;
      case 'escape':
        if (st.sheet.peek() !== null) closeCurrentSheet(app);
        else if (st.overlay.peek() === null) app.openSheet('menu');
        return true;
      case 'cargo':
        if (!inScope('mvp') || st.overlay.peek() !== null) return false;
        if (st.sheet.peek() === 'cargo') closeCurrentSheet(app);
        else app.openSheet('cargo');
        return true;
      case 'context': {
        const now = performance.now();
        return runContextAction(app, { now, idleMs: now - controls.lastInputAt });
      }
      case 'look':
        if (SCOPE !== 'm0' && !st.styleTest.peek()) return false;
        app.setLook(st.look.peek() === 'toon' ? 'pixel' : 'toon');
        return true;
      case 'debug':
        if (!debugEnabled()) return false;
        app.openSheet('debug');
        return true;
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTextField(e.target)) return;
    const cmd = keys.keyDown(e.code, e.repeat);
    if (cmd && runCommand(cmd)) e.preventDefault();
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    const cmd = keys.keyUp(e.code);
    if (cmd && cmd.kind === 'slotUp') runCommand(cmd);
  };

  // ---------------------------------------------------------------- lifecycle
  const releaseAll = (): void => {
    arbiter.releaseAll();
    press.cancel();
    clearPressVisuals();
    releaseThrust();
    setLatch(false);
    keys.clear();
    pendingFire = -1;
    taps.clear();
    tapEls.clear();
    swallow.clear();
    publishStick();
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') releaseAll();
  };

  const disposeGuards = installGestureGuards(canvas);
  const listen: [EventTarget, string, EventListener, boolean?][] = [
    [canvas, 'pointerdown', onCanvasDown as EventListener],
    [canvas, 'pointermove', onCanvasMove as EventListener],
    [canvas, 'pointerup', onCanvasUp as EventListener],
    [canvas, 'pointercancel', onCanvasCancel as EventListener],
    [canvas, 'lostpointercapture', onCanvasLostCapture as EventListener],
    [uiRoot, 'pointerdown', onUiDown as EventListener],
    [uiRoot, 'pointermove', onUiMove as EventListener],
    [uiRoot, 'pointerup', onUiUp as EventListener],
    [uiRoot, 'pointercancel', onUiCancel as EventListener],
    [uiRoot, 'click', onUiClick as EventListener, true],
    [window, 'keydown', onKeyDown as EventListener],
    [window, 'keyup', onKeyUp as EventListener],
    [window, 'blur', releaseAll],
    [document, 'visibilitychange', onVisibility],
  ];
  for (const [target, type, fn, capture] of listen) target.addEventListener(type, fn, capture);

  return {
    /** Returns a reused object: read it (or copy it) before the next call. */
    sampleIntent(): PodIntent {
      const stick = arbiter.stick;
      keys.intent(keyIntent);
      if (stick.active) {
        intent.sx = stick.sx;
        intent.sy = stick.sy;
      } else {
        intent.sx = keyIntent.sx;
        intent.sy = keyIntent.sy;
      }
      if (thrustLatched && (downInput() || app.world.pod.dig !== null)) setLatch(false);
      const button = settings().thrustMode === 'toggle' ? thrustLatched : thrustPointer !== -1;
      intent.thrust = button || keyIntent.thrust;
      intent.fireSlot = pendingFire;
      pendingFire = -1;
      if (intent.thrust || intent.sx !== 0 || intent.sy !== 0) controls.lastInputAt = performance.now();
      return intent;
    },
    get touching(): boolean {
      return arbiter.pointerCount > 0 || thrustPointer !== -1 || press.captured;
    },
    get active(): boolean {
      return arbiter.stick.magnitude > 0 || keys.active || thrustPointer !== -1 || thrustLatched;
    },
    releaseAll,
    dispose(): void {
      releaseAll();
      for (const [target, type, fn, capture] of listen) target.removeEventListener(type, fn, capture);
      disposeGuards();
    },
  };
}
