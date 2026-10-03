// createInput wired to the fake DOM (ui-dom.helpers.ts) with the real HUD and style chip rendered: a
// second-finger tap on [data-tap] buttons while the stick is held (UI-6), and quick-slot keys pressed in
// a menu (UI-9).
import { signal } from '@preact/signals';
import { Fragment, h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InputController } from '../../src/app/types';
import { createInput } from '../../src/input';
import { ClickSwallow, TapTracker } from '../../src/input/taps';
import { TOUCH } from '../../src/shared/canon';
import { createFakeApp, type FakeApp } from '../../src/ui/fakes';
import { Hud } from '../../src/ui/Hud';
import { StyleChip } from '../../src/ui/overlays/StyleChip';
import type { Viewport } from '../../src/ui/viewport';
import { flush, installFakeDom, key, nativeClick, pointer, type FakeDom, type FakeElement } from './ui-dom.helpers';

describe('TapTracker (canon §3.12 tap: ≤ 250 ms, < 10 pt)', () => {
  const s = (id: number, x: number, y: number, t: number) => ({ id, x, y, t });

  it('accepts a quick, still press and rejects slow or sliding ones', () => {
    const taps = new TapTracker();
    taps.down(s(1, 10, 10, 0));
    expect(taps.up(s(1, 14, 13, TOUCH.tapMs))).toBe(true);
    taps.down(s(2, 10, 10, 0));
    expect(taps.up(s(2, 10, 10, TOUCH.tapMs + 1))).toBe(false);
    taps.down(s(3, 10, 10, 0));
    taps.move(s(3, 10, 22, 50)); // slid off and back: not a tap
    expect(taps.up(s(3, 10, 10, 100))).toBe(false);
    expect(taps.up(s(9, 0, 0, 0))).toBe(false); // never went down
    expect(taps.count).toBe(0);
  });

  it('tracks several pointers independently and forgets cancelled ones', () => {
    const taps = new TapTracker();
    taps.down(s(1, 0, 0, 0));
    taps.down(s(2, 50, 50, 10));
    taps.cancel(1);
    expect(taps.up(s(1, 0, 0, 20))).toBe(false);
    expect(taps.up(s(2, 50, 50, 30))).toBe(true);
  });
});

describe('ClickSwallow', () => {
  const inside = (a: string) => (claimed: string) => claimed === a;

  it('swallows one click on the claimed button within the window', () => {
    const sw = new ClickSwallow<string>(600);
    sw.claim('menu', 100);
    expect(sw.take(150, inside('menu'))).toBe(true);
    expect(sw.take(160, inside('menu'))).toBe(false);
  });

  it('never eats a late click, a click elsewhere, or a fresh press', () => {
    const sw = new ClickSwallow<string>(600);
    sw.claim('menu', 100);
    expect(sw.take(800, inside('menu'))).toBe(false);
    sw.claim('menu', 1_000);
    expect(sw.take(1_010, inside('chip'))).toBe(false);
    expect(sw.take(1_020, inside('menu'))).toBe(false);
    sw.claim('menu', 2_000);
    sw.pressed('menu');
    expect(sw.take(2_300, inside('menu'))).toBe(false);
  });
});

describe('createInput with the HUD (fake DOM)', () => {
  let dom: FakeDom;
  let app: FakeApp;
  let input: InputController;
  let canvas: FakeElement;
  const vp = signal<Viewport>({ w: 375, h: 667, it: 0, ib: 0, il: 0, ir: 0 });

  beforeEach(async () => {
    dom = installFakeDom();
    app = createFakeApp({ scope: 'm0', look: 'toon', styleTest: true });
    canvas = dom.document.createElement('canvas');
    dom.document.body.insertBefore(canvas, dom.root);
    input = createInput({
      canvas: canvas as unknown as HTMLCanvasElement,
      uiRoot: dom.root as unknown as HTMLElement,
      app,
      getLayout: () => ({ width: 375, height: 667, controlZone: TOUCH.controlZone.S, clearTop: 64 }),
    });
    await flush(() => render(h(Fragment, null, h(Hud, { app, vp }), h(StyleChip, { app })), dom.root as unknown as HTMLElement));
  });

  afterEach(async () => {
    input.dispose();
    await flush(() => render(null, dom.root as unknown as HTMLElement));
    dom.restore();
  });

  const menu = () => dom.root.querySelector('.hf-pill-menu')!;
  const chip = () => dom.root.querySelector('.hf-style-chip')!;
  const holdStick = async () => {
    await pointer(canvas, 'pointerdown', { pointerId: 1, x: 130, y: 560 });
    await pointer(canvas, 'pointermove', { pointerId: 1, x: 170, y: 560 });
    expect(input.active).toBe(true);
  };
  /** A tap; `single` = the only finger down, so the browser follows it with its own click. */
  const tap = async (el: FakeElement, id: number, single: boolean, pointerType = 'touch') => {
    await pointer(el, 'pointerdown', { pointerId: id, x: 5, y: 5, pointerType });
    await pointer(el, 'pointerup', { pointerId: id, x: 6, y: 5, pointerType });
    if (single) await nativeClick(el);
  };

  it('tags the HUD buttons and the chip for tap delegation', () => {
    const tagged = dom.root.querySelectorAll('[data-tap]').map((e) => e.className.split(' ')[1] ?? e.className);
    expect(tagged).toEqual(['hf-pill-cargo', 'hf-pill-info', 'hf-pill-menu', 'hf-style-chip']);
  });

  it('a second finger opens the menu while the other thumb holds the stick (no browser click)', async () => {
    await holdStick();
    await tap(menu(), 2, false);
    expect(app.state.sheet.value).toBe('menu');
  });

  it('a second finger flips the A/B look while the stick is held', async () => {
    await holdStick();
    await tap(chip(), 2, false);
    expect(app.state.look.value).toBe('pixel');
  });

  it('a single-finger tap activates once: the browser click that follows is swallowed', async () => {
    await tap(menu(), 5, true);
    expect(app.state.sheet.value).toBe('menu'); // a second activation would have toggled it shut
    await tap(chip(), 6, true);
    expect(app.state.look.value).toBe('pixel');
    await tap(chip(), 7, true);
    expect(app.state.look.value).toBe('toon');
  });

  it('a button that removes itself on tap does not pass the browser click to what was under it', async () => {
    const done = dom.document.createElement('button');
    done.setAttribute('data-tap', '');
    done.addEventListener('click', () => done.remove());
    dom.root.appendChild(done);
    await pointer(done, 'pointerdown', { pointerId: 9, x: 5, y: 5 });
    await pointer(done, 'pointerup', { pointerId: 9, x: 6, y: 5 });
    expect(done.isConnected).toBe(false);
    await nativeClick(menu()); // the click lands on the element that was underneath
    expect(app.state.sheet.value).toBeNull();
    await tap(menu(), 10, true); // the next real tap still works
    expect(app.state.sheet.value).toBe('menu');
  });

  it('a slow single-finger press still works through the browser click', async () => {
    await pointer(chip(), 'pointerdown', { pointerId: 8, t: 0 });
    await pointer(chip(), 'pointerup', { pointerId: 8, t: TOUCH.tapMs + 200 });
    expect(app.state.look.value).toBe('toon');
    await nativeClick(chip());
    expect(app.state.look.value).toBe('pixel');
  });

  it('mouse and keyboard keep the native click', async () => {
    await tap(chip(), 1, true, 'mouse');
    expect(app.state.look.value).toBe('pixel');
    await flush(() => chip().click()); // Enter / Space on a focused button
    expect(app.state.look.value).toBe('toon');
  });

  it('a cancelled press does nothing', async () => {
    await pointer(menu(), 'pointerdown', { pointerId: 4 });
    await pointer(menu(), 'pointercancel', { pointerId: 4 });
    await pointer(menu(), 'pointerup', { pointerId: 4 });
    expect(app.state.sheet.value).toBeNull();
  });

  it('a quick-slot key pressed in a menu does not fire when the menu closes (UI-9)', async () => {
    const pod = app.world.pod;
    pod.consumables.jerrycan = 3; // slot 3 (Digit3) holds the jerrycan; fuel 6 / 10
    await key(dom.window, 'keydown', 'Escape');
    expect(app.state.sheet.value).toBe('menu');
    const down = await key(dom.window, 'keydown', 'Digit3');
    await key(dom.window, 'keyup', 'Digit3');
    expect(down.defaultPrevented).toBe(false);
    await key(dom.window, 'keydown', 'Escape');
    expect(app.state.sheet.value).toBeNull();
    expect(input.sampleIntent().fireSlot).toBe(-1);

    // Control: in play the same key fires on release.
    await key(dom.window, 'keydown', 'Digit3');
    await key(dom.window, 'keyup', 'Digit3');
    expect(input.sampleIntent().fireSlot).toBe(2);
  });

  it('quick-slot keys are ignored under an overlay too', async () => {
    app.world.pod.consumables.jerrycan = 3;
    await flush(() => (app.state.overlay.value = 'interrupt'));
    await key(dom.window, 'keydown', 'Digit3');
    await key(dom.window, 'keyup', 'Digit3');
    await flush(() => (app.state.overlay.value = null));
    expect(input.sampleIntent().fireSlot).toBe(-1);
  });
});
