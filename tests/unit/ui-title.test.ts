// Title screen rendered into the fake DOM (ui-dom.helpers.ts): the install card scrolls under the real
// touchmove guard while the actions stay pinned (UI-2), and each install step is one line of text (UI-7).
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGestureGuards } from '../../src/input/gestures';
import { createFakeApp, type FakeApp } from '../../src/ui/fakes';
import { TitleScreen } from '../../src/ui/overlays/TitleScreen';
import { FakeEvent, FakeText, flush, installFakeDom, text, type FakeDom, type FakeElement } from './ui-dom.helpers';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let dom: FakeDom;
let app: FakeApp;

beforeEach(() => {
  dom = installFakeDom();
  app = createFakeApp({ scope: 'm0', look: 'toon', overlay: 'title', canInstall: true, standalone: false });
  app.world.story.deepestRow = 7; // a returning player: "New game" shows next to "Play in browser"
});

afterEach(async () => {
  await flush(() => render(null, dom.root as unknown as HTMLElement));
  vi.unstubAllGlobals();
  dom.restore();
});

const mount = () => flush(() => render(h(TitleScreen, { app }), dom.root as unknown as HTMLElement));
const button = (label: string) => dom.root.querySelectorAll('button').find((b) => text(b) === label) ?? null;

function touch(el: FakeElement, type: 'touchstart' | 'touchmove', y: number): FakeEvent {
  const ev = new FakeEvent(type, { touches: [{ clientX: 100, clientY: y }] });
  el.dispatchEvent(ev);
  return ev;
}

describe('Title screen install card (UI-2)', () => {
  it('scrolls the logo and install card in a [data-scroll] area; the actions stay outside it', async () => {
    await mount();
    const scroll = dom.root.querySelector('.hf-title [data-scroll]');
    expect(scroll).not.toBeNull();
    expect(scroll!.querySelector('.hf-install')).not.toBeNull();
    const play = button('Play in browser');
    const fresh = button('New game');
    expect(play && fresh).toBeTruthy();
    expect(scroll!.contains(play)).toBe(false);
    expect(scroll!.contains(fresh)).toBe(false);
  });

  it('after Install, a drag over the steps scrolls instead of being blocked', async () => {
    await mount();
    const scroll = dom.root.querySelector('[data-scroll]')!;
    scroll.scrollHeight = 470;
    await flush(() => button('Install')!.click());
    expect(button('Install')).toBeNull();
    expect(dom.root.querySelector('.hf-steps')).not.toBeNull();
    // The steps open at the bottom of the scroll area and are scrolled into view, again once the copy
    // result (a note under them) arrives.
    expect(scroll.scrollTop).toBe(470);
    scroll.scrollHeight = 520;
    await flush(() => new Promise((r) => setTimeout(r, 0)));
    expect(dom.root.querySelector('.hf-steps .hf-note')).not.toBeNull();
    expect(scroll.scrollTop).toBe(520);

    // 548-pt Safari viewport: the card overflows its area; the finger drags up over a step.
    scroll.scrollTop = 0;
    scroll.scrollHeight = 520;
    scroll.clientHeight = 380;
    const canvas = dom.document.createElement('canvas');
    const dispose = installGestureGuards(canvas as unknown as HTMLElement);
    try {
      const step = dom.root.querySelector('.hf-steps li')!;
      touch(step, 'touchstart', 400);
      expect(touch(step, 'touchmove', 250).defaultPrevented).toBe(false);
      // Outside any [data-scroll] the page itself still never pans.
      const panel = dom.root.querySelector('.hf-title-panel')!;
      touch(panel, 'touchstart', 600);
      expect(touch(panel, 'touchmove', 450).defaultPrevented).toBe(true);
    } finally {
      dispose();
    }
  });
});

describe('Install steps layout (UI-7)', () => {
  for (const ua of ['iOS', 'Android'] as const) {
    it(`renders each ${ua} step as the icon plus one text span`, async () => {
      if (ua === 'iOS') vi.stubGlobal('navigator', { userAgent: IPHONE, maxTouchPoints: 5 });
      await mount();
      await flush(() => button('Install')!.click());
      const items = dom.root.querySelectorAll('.hf-steps li');
      expect(items).toHaveLength(3);
      for (const li of items) {
        expect(li.childNodes.filter((n) => n instanceof FakeText && n.data.trim() !== '')).toHaveLength(0);
        expect(li.children.map((c) => c.localName)).toEqual(['svg', 'span']);
      }
      const first = text(items[0].querySelector('.hf-step-text'));
      expect(first).toBe(ua === 'iOS' ? "Tap Share in Safari's toolbar" : "Open your browser's menu");
    });
  }
});
