// Radio card timing (canon §2.12 #5; 03 §6.5), the story slot, goal chip, trip summary and Dot's office,
// rendered through Preact into the fake DOM (ui-dom.helpers.ts).
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadioMessage } from '../../src/app/types';
import { createFakeApp, type FakeApp } from '../../src/ui/fakes';
import { SheetHost } from '../../src/ui/SheetHost';
import { RadioPlayer, cardDwellMs, tickerText, type RadioInput } from '../../src/ui/story/radioPlayer';
import { StoryLayer } from '../../src/ui/story/StoryLayer';
import { tripLine } from '../../src/ui/story/TripSummaryCard';
import { flush, installFakeDom, text, type FakeDom } from './ui-dom.helpers';

const msg = (id: number, cards: string[], sender: RadioMessage['sender'] = 'Dot'): RadioMessage => ({ id, beat: 'S1', sender, cards, at: 0 });
const SHORT = 'Short card.';
const LONG = 'x'.repeat(80); // 80 × 60 ms = 4.8 s

describe('RadioPlayer (canon §2.12 #5)', () => {
  const input = (now: number, head: RadioMessage | null, p: Partial<RadioInput> = {}): RadioInput => ({ now, head, grounded: true, moving: false, covered: false, ...p });

  it('is a ticker while moving and never expires there', () => {
    const p = new RadioPlayer();
    const m = msg(1, [SHORT]);
    for (let t = 0; t <= 20_000; t += 100) expect(p.update(input(t, m, { moving: true, grounded: false })).mode).toBe('ticker');
    expect(p.done).toBe(-1);
  });

  it('opens the full card after 0.6 s grounded and idle, then auto-advances after max(4 s, 60 ms × chars)', () => {
    const p = new RadioPlayer();
    const m = msg(2, [SHORT, LONG]);
    expect(p.update(input(0, m)).mode).toBe('ticker');
    expect(p.update(input(500, m)).mode).toBe('ticker');
    let v = p.update(input(600, m));
    expect(v.mode).toBe('card');
    let t = 600;
    while (v.index === 0 && t < 10_000) v = p.update(input((t += 100), m));
    expect(t - 600).toBe(cardDwellMs(SHORT)); // 4 s minimum
    while (p.done < 0 && t < 20_000) p.update(input((t += 100), m));
    expect(p.done).toBe(2);
    expect(cardDwellMs(LONG)).toBe(4_800);
  });

  it('"›" opens the ticker as a card, then advances it; the next stick input collapses it', () => {
    const p = new RadioPlayer();
    const m = msg(3, ['one', 'two']);
    expect(p.update(input(0, m, { moving: true, grounded: false })).mode).toBe('ticker');
    p.tap(m);
    expect(p.update(input(100, m, { moving: true, grounded: false })).mode).toBe('card');
    p.tap(m);
    expect(p.update(input(200, m, { moving: true, grounded: false })).index).toBe(1);
    expect(p.update(input(300, m)).mode).toBe('card'); // stopped: still open
    expect(p.update(input(400, m, { moving: true })).mode).toBe('ticker'); // moving again: collapsed
    p.tap(m);
    p.update(input(500, m, { moving: true }));
    p.tap(m);
    expect(p.update(input(600, m, { moving: true })).mode).toBe('hidden');
    expect(p.done).toBe(3);
  });

  it('a covering sheet hides the radio and holds its clock', () => {
    const p = new RadioPlayer();
    const m = msg(4, [SHORT]);
    p.update(input(0, m));
    p.update(input(700, m)); // card open
    for (let t = 800; t < 30_000; t += 100) expect(p.update(input(t, m, { covered: true })).mode).toBe('hidden');
    expect(p.done).toBe(-1);
    expect(p.update(input(30_000, m)).mode).toBe('card');
  });

  it('the ticker shows 28 characters then an ellipsis', () => {
    expect(tickerText("Pip's tank is nearly dry, Seven. Roll left.")).toBe("Pip's tank is nearly dry, Se…");
    expect(tickerText('Short.')).toBe('Short.');
  });
});

describe('story slot in the HUD layer', () => {
  let dom: FakeDom;
  let app: FakeApp;
  let now = 0;

  beforeEach(() => {
    dom = installFakeDom();
    app = createFakeApp({ scope: 'mvp', look: 'toon', styleTest: false });
    now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(async () => {
    await flush(() => render(null, dom.root as unknown as HTMLElement));
    vi.restoreAllMocks();
    dom.restore();
  });

  const mount = () => flush(() => render(h(StoryLayer, { app }), dom.root as unknown as HTMLElement));
  const tick = (ms: number) =>
    flush(() => {
      now += ms;
      app.state.hudTick.value++;
    });

  it('shows the ticker, then the full card when idle; "›" carries [data-tap] and dismisses the last card', async () => {
    app.state.radio.value = [msg(7, ["Pip's tank is nearly dry, Seven. Roll left to the Pump House and fill her up."])];
    await mount();
    const ticker = dom.root.querySelector('.hf-radio-ticker');
    expect(ticker).not.toBeNull();
    expect(text(ticker)).toContain("Pip's tank is nearly dry, Se…");
    await tick(700);
    const card = dom.root.querySelector('.hf-radio-card');
    expect(card?.classList.contains('hf-tx-dot')).toBe(true);
    expect(card?.querySelector('.hf-avatar')).not.toBeNull();
    const next = dom.root.querySelector('.hf-radio-next')!;
    expect(next.hasAttribute('data-tap')).toBe(true);
    await flush(() => next.click());
    await tick(100);
    expect(app.state.radio.value).toEqual([]);
    expect(dom.root.querySelector('.hf-radio')).toBeNull();
  });

  it('styles Channel Zero and Deepreach logs per sender; the goal chip waits for the radio', async () => {
    app.state.goal.value = { text: 'Fill up at the Pump House', next: ['A', 'B'] };
    app.state.radio.value = [msg(8, ['…24 chains, 72 links. Mark.'], 'Channel Zero'), msg(9, ['Deepreach One, day forty.'], 'Deepreach log')];
    await mount();
    expect(dom.root.querySelector('.hf-radio')?.classList.contains('hf-tx-zero')).toBe(true);
    expect(dom.root.querySelector('.hf-goal')).toBeNull();
    app.state.radio.value = app.state.radio.value.slice(1);
    await tick(100);
    expect(dom.root.querySelector('.hf-radio')?.classList.contains('hf-tx-log')).toBe(true);
    app.state.radio.value = [];
    await tick(100);
    const chip = dom.root.querySelector('.hf-goal');
    expect(text(chip)).toBe('Fill up at the Pump House');
    await flush(() => chip!.click());
    expect(dom.root.querySelectorAll('.hf-goal-next li').map((li) => text(li))).toEqual(['A', 'B']);
  });

  it('the goal chip stands aside for a toast; everything hides under a sheet', async () => {
    app.state.goal.value = { text: 'Sell at the Assay Office' };
    await mount();
    expect(dom.root.querySelector('.hf-goal')).not.toBeNull();
    await flush(() => app.toast('Sold 7 items for $420'));
    await tick(100);
    expect(dom.root.querySelector('.hf-goal')).toBeNull();
    app.state.toasts.value = [];
    app.state.radio.value = [msg(10, ['Hello.'])];
    app.state.sheet.value = 'assay';
    await tick(100);
    expect(dom.root.querySelector('.hf-radio')).toBeNull();
    expect(dom.root.querySelector('.hf-goal')).toBeNull();
  });

  it('the trip summary shows the 03 §6.3 line and leaves on a tap', async () => {
    const summary = { trip: 3, deepestRow: 25, collected: 7, value: 1_240, fuelUsed: 4.1, hullLost: 0, seconds: 202, nextGoals: ['Upgrade at the Garage'] };
    expect(tripLine(summary)).toBe('313ft · $1,240 · 4.1 L · −0 HP · 3:22');
    app.state.tripSummary.value = summary;
    await mount();
    const card = dom.root.querySelector('.hf-trip')!;
    expect(text(card)).toContain('Trip 3 · 7 items');
    expect(text(card)).toContain('Upgrade at the Garage');
    await flush(() => card.click());
    expect(app.state.tripSummary.value).toBeNull();
  });

  it('the trip summary shows Next Goals as they are now; a refreshed list is still the same card (PLAYER-7)', async () => {
    const summary = { trip: 4, deepestRow: 25, collected: 6, value: 600, fuelUsed: 4.1, hullLost: 0, nextGoals: ['Sell at the Assay Office', 'Corkscrew Drill: $630 to go'] };
    app.state.tripSummary.value = summary;
    await mount();
    expect(text(dom.root.querySelector('.hf-trip')!)).toContain('Sell at the Assay Office');
    app.state.tripSummary.value = { ...summary, nextGoals: ['Upgrade at the Garage', 'Corkscrew Drill: $30 to go'] };
    await tick(50);
    const card = dom.root.querySelector('.hf-trip')!;
    expect(text(card)).not.toContain('Sell at the Assay Office');
    expect(text(card)).toContain('Corkscrew Drill: $30 to go');
    await flush(() => card.click());
    expect(app.state.tripSummary.value).toBeNull();
  });
});

describe("Dot's office", () => {
  let dom: FakeDom;
  let app: FakeApp;

  beforeEach(() => {
    dom = installFakeDom();
    app = createFakeApp({ scope: 'mvp', look: 'toon', styleTest: false });
  });
  afterEach(async () => {
    await flush(() => render(null, dom.root as unknown as HTMLElement));
    dom.restore();
  });

  const mount = () => flush(() => render(h(SheetHost, { app }), dom.root as unknown as HTMLElement));
  const tab = (label: string) => dom.root.querySelectorAll('[role="tab"]').find((b) => text(b) === label)!;

  it('replays the log newest first, with live values, from the flags alone', async () => {
    Object.assign(app.world.story.flags, { 'tx:0:S0': true, 'ms:1:toppedOff': true, 'tx:2:S7:2472': true });
    app.state.sheet.value = 'office';
    await mount();
    const entries = dom.root.querySelectorAll('.hf-office-log li').map((li) => text(li));
    expect(entries[0]).toContain('…24 chains, 72 links. 24 chains, 73 links. Mark.');
    expect(entries[1]).toContain('Topped Off');
    expect(entries[2]).toContain('Pump House');
  });

  it('shows the milestone board, Co-op Plans and stats', async () => {
    Object.assign(app.world.story.flags, { 'ms:0:payday': true, 'rung:U2': true });
    app.state.sheet.value = 'office';
    await mount();
    await flush(() => tab('Milestones').click());
    expect(text(dom.root.querySelector('.hf-note'))).toBe('1 of 15 on the board');
    expect(dom.root.querySelectorAll('.hf-office-got')).toHaveLength(1);
    await flush(() => tab('Plans').click());
    const plans = dom.root.querySelectorAll('.hf-list-row').map((r) => text(r));
    expect(plans[0]).toContain('Open'); // U0 comes with every claim
    expect(plans[1]).toContain('Locked · Dig past 400 ft');
    expect(plans[2]).toContain('Open');
    await flush(() => tab('Stats').click());
    expect(text(dom.root.querySelector('.hf-office-stats'))).toContain('Deepreach logs0 of 6');
  });

  it('tags the stats card "Assisted" while any assist is on (01 §6.4)', async () => {
    app.state.sheet.value = 'office';
    await mount();
    await flush(() => tab('Stats').click());
    expect(dom.root.querySelector('.hf-office-assisted')).toBeNull();
    await flush(() => (app.state.settings.value = { ...app.state.settings.value, steadyDrill: true }));
    expect(text(dom.root.querySelector('.hf-office-assisted'))).toBe('AssistedSteady Drill');
    await flush(() => (app.state.settings.value = { ...app.state.settings.value, landingAssist: true }));
    expect(text(dom.root.querySelector('.hf-office-assisted'))).toBe('AssistedLanding Assist · Steady Drill');
    await flush(() => (app.state.settings.value = { ...app.state.settings.value, landingAssist: false, steadyDrill: false }));
    expect(dom.root.querySelector('.hf-office-assisted')).toBeNull();
  });

  it('is reachable from the menu and the Assay Office', async () => {
    app.state.sheet.value = 'menu';
    await mount();
    const item = dom.root.querySelectorAll('.hf-menu-item').find((b) => text(b).includes("Dot's office"))!;
    await flush(() => item.click());
    expect(app.state.sheet.value).toBe('office');
    await flush(() => (app.state.sheet.value = 'assay'));
    await new Promise((r) => setTimeout(r, 200));
    await flush();
    const link = dom.root.querySelectorAll('.hf-menu-item').find((b) => text(b).includes("Dot's office"))!;
    await flush(() => link.click());
    expect(app.state.sheet.value).toBe('office');
  });
});
