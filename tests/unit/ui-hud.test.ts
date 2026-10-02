// HUD and UI root rendered into the fake DOM (ui-dom.helpers.ts): the HUD is not a live region and only
// crossed warnings reach the assertive region (UI-10); the Reduced motion switch alone drives .hf-reduced,
// whatever the OS preference (UI-8).
import { signal } from '@preact/signals';
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeApp, type FakeApp } from '../../src/ui/fakes';
import { Hud } from '../../src/ui/Hud';
import { mountUI } from '../../src/ui/index';
import type { Viewport } from '../../src/ui/viewport';
import { flush, installFakeDom, text, type FakeDom } from './ui-dom.helpers';

let dom: FakeDom;
let app: FakeApp;

beforeEach(() => {
  dom = installFakeDom();
  app = createFakeApp({ scope: 'm0', look: 'toon', styleTest: false });
});

afterEach(() => {
  dom.restore();
});

describe('HUD announcements (UI-10)', () => {
  const vp = signal<Viewport>({ w: 375, h: 667, it: 0, ib: 0, il: 0, ir: 0 });

  afterEach(async () => {
    await flush(() => render(null, dom.root as unknown as HTMLElement));
  });

  it('is a labelled group, not a live region', async () => {
    await flush(() => render(h(Hud, { app, vp }), dom.root as unknown as HTMLElement));
    const hud = dom.root.querySelector('.hf-hud')!;
    expect(hud.getAttribute('role')).toBe('group');
    expect(hud.getAttribute('aria-label')).toBe('Pod status');
    expect(hud.hasAttribute('aria-live')).toBe(false);
    expect(dom.root.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(hud.querySelectorAll('[aria-live]')).toHaveLength(0);
  });

  it('announces crossed warnings once and never the ticking numbers', async () => {
    await flush(() => render(h(Hud, { app, vp }), dom.root as unknown as HTMLElement));
    const region = dom.root.querySelector('[aria-live="assertive"]')!;
    const pod = app.world.pod;
    const tick = () => flush(() => app.state.hudTick.value++);

    for (const fuel of [5.9, 5.0, 3.1, 2.05]) {
      pod.fuel = fuel;
      await tick();
      expect(text(region)).toBe('');
    }
    pod.fuel = 1.95;
    await tick();
    expect(text(region)).toBe('Fuel low, 1.9 L left');
    const said = region.firstChild;
    pod.fuel = 1.5;
    pod.row = 30;
    await tick();
    expect(region.firstChild).toBe(said); // same node: nothing new is read
    pod.hull = 2;
    await tick();
    expect(text(region)).toBe('Hull low, 2 HP left');
    expect(region.firstChild).not.toBe(said);
  });
});

describe('Reduced motion root class (UI-8)', () => {
  it('follows the setting even when the OS asks for reduced motion', async () => {
    dom.media.add('(prefers-reduced-motion: reduce)');
    app.state.settings.value = { ...app.state.settings.peek(), reducedMotion: true };
    let unmount = () => {};
    await flush(() => (unmount = mountUI(dom.root as unknown as HTMLElement, app)));
    try {
      expect(dom.root.classList.contains('hf-reduced')).toBe(true);
      await flush(() => app.updateSettings({ reducedMotion: false }));
      expect(dom.root.classList.contains('hf-reduced')).toBe(false);
      await flush(() => app.updateSettings({ reducedMotion: true }));
      expect(dom.root.classList.contains('hf-reduced')).toBe(true);
    } finally {
      await flush(() => unmount());
    }
  });
});
