// Sheet behaviour rendered through Preact into the fake DOM (ui-dom.helpers.ts): Garage card order and
// double-tap guard (UI-1), BottomSheet swipe-close then quick re-open (UI-5).
import { render } from 'preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeApp, type FakeApp } from '../../src/ui/fakes';
import { garageOrder, inGarageOrder } from '../../src/ui/sheets/GarageSheet';
import { SheetHost } from '../../src/ui/SheetHost';
import type { UpgradeCard } from '../../src/world/api';
import { flush, installFakeDom, pointer, text, type FakeDom, type FakeElement } from './ui-dom.helpers';

let dom: FakeDom;
let app: FakeApp;

beforeEach(() => {
  dom = installFakeDom();
  app = createFakeApp({ scope: 'm0', look: 'toon', styleTest: false });
});

afterEach(async () => {
  await flush(() => render(null, dom.root as unknown as HTMLElement));
  dom.restore();
});

const mount = () => flush(() => render(h(SheetHost, { app }), dom.root as unknown as HTMLElement));
const cardTitles = () => dom.root.querySelectorAll('.hf-card-title').map((e) => text(e));
const buyButtons = () => dom.root.querySelectorAll('.hf-card .hf-btn-primary');
/** The app bumps hudTick ≤ 10 Hz; the sheets re-render on it. */
const tick = () => flush(() => app.state.hudTick.value++);

describe('Garage card order (UI-1)', () => {
  it('ranks buyable lines first when the sheet opens', () => {
    const card = (line: UpgradeCard['line'], available: boolean, blocker: string | null) => ({ line, available, blocker }) as UpgradeCard;
    const order = garageOrder([card('drill', true, 'Need $5 more'), card('hull', false, null), card('engine', true, null)]);
    expect(order).toEqual(['engine', 'drill', 'hull']);
  });

  it('keeps cards where they were after a purchase, appending unknown lines', () => {
    const cards = app.world.garageCards();
    const order = garageOrder(cards);
    expect(inGarageOrder(order, cards).map((c) => c.line)).toEqual(order);
    expect(inGarageOrder(['engine', 'drill'], cards).slice(0, 2).map((c) => c.line)).toEqual(['engine', 'drill']);
    expect(inGarageOrder(['engine', 'drill'], cards)).toHaveLength(cards.length);
  });

  it('a second tap on the same BUY never buys a different line', async () => {
    app.world.wallet.cash = 1_600;
    app.state.sheet.value = 'garage';
    await mount();
    const before = cardTitles();
    expect(before[0]).toBe('Drill');
    expect(before[1]).toBe('Engine');

    await flush(() => buyButtons()[0].click());
    expect(app.world.pod.tiers.drill).toBe(2);
    expect(app.world.wallet.cash).toBe(850);
    await tick();
    // The drill is now blocked ("Need $1,150 more") but stays in place: the finger is still over it.
    expect(cardTitles()).toEqual(before);
    const drillBuy = buyButtons()[0];
    expect(drillBuy.disabled).toBe(true);

    await flush(() => drillBuy.click());
    await tick();
    expect(app.world.pod.tiers.engine).toBe(1);
    expect(app.world.wallet.cash).toBe(850);
  });

  it('ignores a second BUY within the double-tap window, then allows it', async () => {
    app.world.wallet.cash = 10_000;
    app.state.sheet.value = 'garage';
    await mount();
    await flush(() => buyButtons()[0].click());
    await tick();
    expect(app.world.pod.tiers.drill).toBe(2);
    await flush(() => buyButtons()[0].click()); // t3 is affordable: a double tap must not buy it
    expect(app.world.pod.tiers.drill).toBe(2);
    await new Promise((r) => setTimeout(r, 360));
    await flush(() => buyButtons()[0].click());
    expect(app.world.pod.tiers.drill).toBe(3);
  });

  it('re-ranks on the next open', async () => {
    app.world.wallet.cash = 800;
    app.state.sheet.value = 'garage';
    await mount();
    await flush(() => buyButtons()[0].click());
    await flush(() => (app.state.sheet.value = null));
    await new Promise((r) => setTimeout(r, 220));
    await flush();
    expect(dom.root.querySelector('.hf-sheet')).toBeNull();
    await flush(() => (app.state.sheet.value = 'garage'));
    // Nothing is affordable now: available lines keep their catalogue order, out-of-scope ones last.
    expect(cardTitles().slice(0, 4)).toEqual(['Drill', 'Engine', 'Tank', 'Cargo bay']);
  });
});

describe('BottomSheet swipe-close and quick re-open (UI-5)', () => {
  const sheet = () => dom.root.querySelector('.hf-sheet') as FakeElement;
  const head = () => dom.root.querySelector('.hf-sheet-head') as FakeElement;

  it('drops the drag offset when the same sheet is wanted again during the exit animation', async () => {
    app.state.sheet.value = 'menu';
    await mount();
    await pointer(head(), 'pointerdown', { pointerId: 3, y: 300, t: 0 });
    await pointer(head(), 'pointermove', { pointerId: 3, y: 460, t: 200 });
    expect(sheet().style.transform).toBe('translate3d(0, 160px, 0)');
    await pointer(head(), 'pointerup', { pointerId: 3, y: 460, t: 220 });
    expect(app.state.sheet.value).toBeNull();
    expect(dom.root.querySelector('.hf-leaving')).not.toBeNull();

    await flush(() => app.openSheet('menu')); // 60 ms later, before the 180-ms exit ends
    expect(dom.root.querySelector('.hf-leaving')).toBeNull();
    expect(sheet().style.transform).toBe('');
    expect(sheet().style.transition).toBe('');
    expect(text(dom.root.querySelector('.hf-sheet-foot'))).toBe('Resume');
  });

  it('a short drag snaps back and the sheet stays open', async () => {
    app.state.sheet.value = 'menu';
    await mount();
    await pointer(head(), 'pointerdown', { pointerId: 4, y: 300, t: 0 });
    await pointer(head(), 'pointermove', { pointerId: 4, y: 340, t: 400 });
    await pointer(head(), 'pointerup', { pointerId: 4, y: 340, t: 420 });
    expect(app.state.sheet.value).toBe('menu');
    expect(sheet().style.transform).toBe('');
  });
});
