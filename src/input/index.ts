// Pod-mode input (03 §3; 04 §6.1; canon §3.12): Pointer Events on the canvas (floating stick, world
// taps), delegated pointer handling on the UI root for quick slots and THRUST, the dev keyboard, and
// browser-gesture suppression. Produces one PodIntent per sim step via sampleIntent().
import type { AppController, InputController } from '../app/types';
import { inScope, SCOPE } from '../config/scope';
import type { PodIntent } from '../pod/types';
import { TOUCH } from '../shared/canon';
import { closeCurrentSheet } from '../ui/actions';
import { debugEnabled } from '../ui/env';
import { CanvasArbiter, type PointerSample } from './arbiter';
import { SlotPress, type SlotKind } from './arming';
import { controls } from './controlsState';
import { installGestureGuards } from './gestures';
import { KeyboardState, type KeyCommand, type KeyIntent } from './keyboard';
import { stickSector } from './sectors';
import { slotDecision } from './slots';
import { stickSpawnZone, type ControlSize, type InputLayout } from './zones';

export interface CreateInputOptions {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  app: AppController;
  /** World tap (< 200 ms, < 10 pt, any zone) in CSS px relative to the canvas: signs, buildings, marks. */
  onWorldTap?: (px: number, py: number) => void;
  getLayout: () => InputLayout;
  /** `pointercancel` on the stick or THRUST: the app raises `interrupt` (canon §4.5). */
  onInterrupt?: (reason: 'pointercancel') => void;
}

/** The base slides when the thumb passes 1.25 R (03 §3.1 [UX]). */
const STICK_FOLLOW = 1.25;
/** Synthetic pointer ids for keyboard slot presses (real Pointer Events ids are never negative). */
const KEY_POINTER_BASE = -10;

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
  let pendingFire = -1;
  let armRaf = 0;

  const sample = (e: PointerEvent): PointerSample => {
    scratch.id = e.pointerId;
    scratch.x = e.clientX - canvasLeft;
    scratch.y = e.clientY - canvasTop;
    scratch.t = performance.now();
    return scratch;
  };

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

  // ---------------------------------------------------------------- canvas pointers
  const onCanvasDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    app.unlockAudio();
    const rect = canvas.getBoundingClientRect();
    canvasLeft = rect.left;
    canvasTop = rect.top;
    const s = settings();
    if (!arbiter.stick.active) {
      arbiter.stick.configure({ radius: TOUCH.stickRadius[s.controlSize], deadZone: TOUCH.stickDeadZone, followFactor: STICK_FOLLOW });
    }
    const zone = stickSpawnZone(opts.getLayout(), s.controlSize, s.leftHanded);
    const role = arbiter.down(sample(e), zone);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for synthetic or already-released pointers; tracking still works on the canvas.
    }
    if (role === 'stick') publishStick();
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

  // ---------------------------------------------------------------- UI-root pointers (slots, THRUST)
  const controlOf = (e: PointerEvent): HTMLElement | null =>
    e.target instanceof Element ? (e.target.closest('[data-slot],[data-thrust]') as HTMLElement | null) : null;

  const onUiDown = (e: PointerEvent): void => {
    const el = controlOf(e);
    if (!el) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    app.unlockAudio();
    e.preventDefault();
    let captured = false;
    if (el.dataset.thrust !== undefined) {
      if (thrustPointer !== -1) return;
      thrustPointer = e.pointerId;
      controls.thrustHeld.value = true;
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
    if (e.pointerId !== press.pointerId) return;
    if (press.move(sample(e))) clearPressVisuals();
  };

  const onUiUp = (e: PointerEvent): void => {
    if (e.pointerId === thrustPointer) releaseThrust();
    else if (e.pointerId === press.pointerId) endPress(sample(e));
  };

  const onUiCancel = (e: PointerEvent): void => {
    if (e.pointerId === thrustPointer) {
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
    keys.clear();
    pendingFire = -1;
    publishStick();
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') releaseAll();
  };

  const disposeGuards = installGestureGuards(canvas);
  const listen: [EventTarget, string, EventListener][] = [
    [canvas, 'pointerdown', onCanvasDown as EventListener],
    [canvas, 'pointermove', onCanvasMove as EventListener],
    [canvas, 'pointerup', onCanvasUp as EventListener],
    [canvas, 'pointercancel', onCanvasCancel as EventListener],
    [canvas, 'lostpointercapture', onCanvasLostCapture as EventListener],
    [uiRoot, 'pointerdown', onUiDown as EventListener],
    [uiRoot, 'pointermove', onUiMove as EventListener],
    [uiRoot, 'pointerup', onUiUp as EventListener],
    [uiRoot, 'pointercancel', onUiCancel as EventListener],
    [window, 'keydown', onKeyDown as EventListener],
    [window, 'keyup', onKeyUp as EventListener],
    [window, 'blur', releaseAll],
    [document, 'visibilitychange', onVisibility],
  ];
  for (const [target, type, fn] of listen) target.addEventListener(type, fn);

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
      intent.thrust = thrustPointer !== -1 || keyIntent.thrust;
      intent.fireSlot = pendingFire;
      pendingFire = -1;
      return intent;
    },
    get touching(): boolean {
      return arbiter.pointerCount > 0 || thrustPointer !== -1 || press.captured;
    },
    get active(): boolean {
      return arbiter.stick.magnitude > 0 || keys.active || thrustPointer !== -1;
    },
    releaseAll,
    dispose(): void {
      releaseAll();
      for (const [target, type, fn] of listen) target.removeEventListener(type, fn);
      disposeGuards();
    },
  };
}
