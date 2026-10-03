// Player-shell input (MVP): context button geometry (03 §3.5), one-handed zone and virtual origin (canon §3.12;
// 03 §3.6), the THRUST toggle (03 §3.3) and keyboard E (03 §3.7), through createInput on the fake DOM.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InputController } from '../../src/app/types';
import { createInput } from '../../src/input';
import { CanvasArbiter } from '../../src/input/arbiter';
import { controls } from '../../src/input/controlsState';
import { KeyboardState } from '../../src/input/keyboard';
import { CONTEXT_SIZE, contextRect, controlRects, ONE_HANDED_ORIGIN_Y, oneHandedZone, slotGeometry, virtualOrigin } from '../../src/input/zones';
import { TOUCH } from '../../src/shared/canon';
import { createFakeApp, type FakeApp } from '../../src/ui/fakes';
import { flush, installFakeDom, key, pointer, type FakeDom, type FakeElement } from './ui-dom.helpers';

const SE = { width: 375, height: 667, controlZone: TOUCH.controlZone.S, clearTop: 64 };

describe('context button geometry (03 §3.5; 03 §1.5)', () => {
  it('is centred over the slot cluster, one gap above it, sized 48 / 52 / 56', () => {
    for (const size of ['S', 'M', 'L'] as const) {
      const { slots } = controlRects(393, 852, 34, size, false, false);
      const c = contextRect(393, 852, 34, size, false, false);
      expect(c.x1 - c.x0).toBe(CONTEXT_SIZE[size]);
      expect((c.x0 + c.x1) / 2).toBeCloseTo((slots[0].x0 + slots[1].x1) / 2, 9);
      expect(slots[0].y0 - c.y1).toBe(slotGeometry(size, false).gap);
      expect(c.x1 - c.x0).toBeGreaterThanOrEqual(TOUCH.minHit);
    }
  });

  it('mirrors with the cluster for left-handed players, THRUST layout included', () => {
    for (const thrust of [false, true]) {
      const right = contextRect(393, 852, 34, 'M', thrust, false);
      const left = contextRect(393, 852, 34, 'M', thrust, true);
      const { slots } = controlRects(393, 852, 34, 'M', thrust, true);
      expect((left.x0 + left.x1) / 2).toBeCloseTo((slots[0].x0 + slots[1].x1) / 2, 9);
      expect(left.x0).toBeLessThan(393 / 2);
      expect(right.x0).toBeGreaterThan(393 / 2);
    }
  });

  it('one-handed uses the 2×2 cluster of 52-pt slots in the dominant corner (canon §3.12)', () => {
    expect(slotGeometry('L', false, true).slot).toBe(52);
    const r = controlRects(375, 667, 0, 'L', false, true, true);
    expect(r.slots[0].x1 - r.slots[0].x0).toBe(52);
    expect(r.slots[0].x0).toBe(16);
  });
});

describe('one-handed zone and virtual origin (canon §3.12; 03 §3.6)', () => {
  it('the zone is y ≥ 0.45 H across the screen, clear of the back-swipe edge (and the right edge when left-handed)', () => {
    const z = oneHandedZone(SE, 'S', false);
    expect(z).toEqual({ x0: 24, y0: 0.45 * 667, x1: 375, y1: 667 });
    expect(oneHandedZone(SE, 'S', true)).toEqual({ x0: 24, y0: 0.45 * 667, x1: 375 - 24, y1: 667 });
  });

  it('the origin is the pod x at 0.70 H (SE y 467), kept a stick radius inside the screen', () => {
    expect(virtualOrigin(SE, 'S', 200)).toEqual({ x: 200, y: ONE_HANDED_ORIGIN_Y * 667 });
    expect(Math.round(virtualOrigin(SE, 'S', 200).y)).toBe(467);
    expect(virtualOrigin(SE, 'S', 5).x).toBe(TOUCH.stickRadius.S);
    expect(virtualOrigin(SE, 'S', 999).x).toBe(375 - TOUCH.stickRadius.S);
    expect(virtualOrigin(SE, 'S', null).x).toBe(375 / 2);
    expect(virtualOrigin(SE, 'S', Number.NaN).x).toBe(375 / 2);
  });

  it('the arbiter measures a one-handed stick from the origin, not the touch', () => {
    const a = new CanvasArbiter({ radius: 44, deadZone: 8, followFactor: 1e6 });
    expect(a.down({ id: 1, x: 260, y: 470, t: 0 }, oneHandedZone(SE, 'S', false), { x: 200, y: 467 })).toBe('stick');
    expect(a.stick.baseX).toBe(200);
    expect(a.stick.magnitude).toBeGreaterThan(0.9);
    expect(a.stick.sx).toBeGreaterThan(0.9);
  });
});

describe('keyboard (03 §3.7)', () => {
  it('E is the context button', () => {
    expect(new KeyboardState().keyDown('KeyE', false)).toEqual({ kind: 'context' });
  });
});

describe('createInput: THRUST toggle, one-handed, keyboard E (fake DOM)', () => {
  let dom: FakeDom;
  let app: FakeApp;
  let input: InputController;
  let canvas: FakeElement;
  let thrust: FakeElement;
  let tapTarget = false;

  beforeEach(() => {
    dom = installFakeDom();
    app = createFakeApp({ scope: 'mvp', look: 'toon', styleTest: false });
    canvas = dom.document.createElement('canvas');
    dom.document.body.insertBefore(canvas, dom.root);
    thrust = dom.document.createElement('button');
    thrust.setAttribute('data-thrust', '');
    dom.root.appendChild(thrust);
    tapTarget = false;
    input = createInput({
      canvas: canvas as unknown as HTMLCanvasElement,
      uiRoot: dom.root as unknown as HTMLElement,
      app,
      getLayout: () => SE,
      isTapTarget: () => tapTarget,
      podScreen: () => ({ x: 200, y: 300 }),
    });
  });

  afterEach(() => {
    input.dispose();
    dom.restore();
  });

  const press = async (el: FakeElement, id: number) => {
    await pointer(el, 'pointerdown', { pointerId: id, x: 10, y: 10 });
    await pointer(el, 'pointerup', { pointerId: id, x: 10, y: 10 });
  };

  it('Hold: THRUST is on only while held', async () => {
    app.updateSettings({ thrustButton: true, thrustMode: 'hold' });
    await pointer(thrust, 'pointerdown', { pointerId: 1 });
    expect(input.sampleIntent().thrust).toBe(true);
    await pointer(thrust, 'pointerup', { pointerId: 1 });
    expect(input.sampleIntent().thrust).toBe(false);
  });

  it('Toggle: a tap latches full thrust until tapped again, a Down input or any dig', async () => {
    app.updateSettings({ thrustButton: true, thrustMode: 'toggle' });
    await press(thrust, 1);
    expect(controls.thrustLatched.value).toBe(true);
    expect(input.sampleIntent().thrust).toBe(true);
    expect(input.active).toBe(true);
    await press(thrust, 2);
    expect(input.sampleIntent().thrust).toBe(false);

    await press(thrust, 3);
    await key(dom.window, 'keydown', 'ArrowDown');
    expect(input.sampleIntent().thrust).toBe(false);
    await key(dom.window, 'keyup', 'ArrowDown');
    expect(controls.thrustLatched.value).toBe(false);

    await press(thrust, 4);
    app.world.pod.dig = { x: 7, r: 1, dir: 'left', progress: 0, total: 29, cleared: false, fromX: 7.5, fromY: 0.4 };
    expect(input.sampleIntent().thrust).toBe(false);
    app.world.pod.dig = null;

    await press(thrust, 5);
    input.releaseAll(); // interrupt, pointercancel
    expect(input.sampleIntent().thrust).toBe(false);
  });

  it('one-handed: a touch low on the screen steers from the virtual origin under the pod', async () => {
    app.updateSettings({ oneHanded: true });
    await pointer(canvas, 'pointerdown', { pointerId: 1, x: 260, y: 480 }); // right of the pod's x 200
    const i = input.sampleIntent();
    expect(i.sx).toBeGreaterThan(0.9);
    expect(controls.stick.baseX).toBe(200);
    expect(controls.stick.baseY).toBeCloseTo(ONE_HANDED_ORIGIN_Y * 667, 6);
    await pointer(canvas, 'pointerup', { pointerId: 1, x: 260, y: 480 });
    expect(input.sampleIntent().sx).toBe(0);
    // Above 0.45 H it is a world tap, never a stick.
    await pointer(canvas, 'pointerdown', { pointerId: 2, x: 260, y: 200 });
    expect(controls.stick.active).toBe(false);
    await pointer(canvas, 'pointerup', { pointerId: 2, x: 260, y: 200 });
  });

  it('one-handed: a touch on a dig neighbour or a sign stays a tap', async () => {
    app.updateSettings({ oneHanded: true });
    tapTarget = true;
    await pointer(canvas, 'pointerdown', { pointerId: 1, x: 200, y: 500 });
    expect(controls.stick.active).toBe(false);
    expect(input.sampleIntent().sy).toBe(0);
    await pointer(canvas, 'pointerup', { pointerId: 1, x: 200, y: 500 });
  });

  it('E runs the context action (Cargo while TOO HEAVY)', async () => {
    await key(dom.window, 'keydown', 'KeyE');
    expect(app.state.sheet.value).toBeNull();
    for (let i = 0; i < 30; i++) app.world.pod.cargo.push({ kind: 'mineral', tier: 9 });
    await key(dom.window, 'keyup', 'KeyE');
    await key(dom.window, 'keydown', 'KeyE');
    expect(app.state.sheet.value).toBe('cargo');
    await flush();
  });
});
