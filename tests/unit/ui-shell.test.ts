// Player-shell UI (MVP): context-button priorities (03 §3.5), Return Tick on the fuel bar (01 §3.5; canon §4.4),
// the style-test codes (03 §9.4), the cargo panel's discard flow (canon §3.7), "Paste save" on the title
// (canon §3.15) and the Safe Mode card (APP-5). DOM parts render into the fake DOM (ui-dom.helpers.ts).
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PodState } from '../../src/pod/types';
import type { CargoItem } from '../../src/shared/types';
import { BAY_FULL_CONTEXT_MS, cargoContext, pickContextAction, registerContextAction, runContextAction, type ContextAction } from '../../src/ui/context';
import { createFakeApp, type FakeApp } from '../../src/ui/fakes';
import { hudModel, returnTickOn } from '../../src/ui/hudModel';
import { previousCopyLabel, SafeModeCard } from '../../src/ui/overlays/SafeModeCard';
import { TitleScreen } from '../../src/ui/overlays/TitleScreen';
import { cargoKey, discardNeedsConfirm } from '../../src/ui/sheets/CargoSheet';
import { SheetHost } from '../../src/ui/SheetHost';
import { abLabel, decodeStyleResult, emptyAnswers, encodeStyleResult, lookOf, sanitizeAnswers, STYLE_QUESTIONS } from '../../src/ui/styleTest';
import type { PodStats, Wallet } from '../../src/world/api';
import { FakeEvent, flush, installFakeDom, nativeClick, text, type FakeDom, type FakeTextArea } from './ui-dom.helpers';

describe('context button priorities (03 §3.5)', () => {
  let dom: FakeDom;
  let app: FakeApp;
  beforeEach(() => {
    dom = installFakeDom();
    app = createFakeApp({ scope: 'mvp', look: 'toon' });
  });
  afterEach(() => dom.restore());
  const at = (now: number) => ({ now, idleMs: 0 });

  it('Cargo while TOO HEAVY, and for 5 s after "Bay full"; nothing otherwise', () => {
    expect(cargoContext(app, at(0))).toBeNull();
    app.state.bayFullAt.value = 1_000;
    expect(cargoContext(app, at(1_000 + BAY_FULL_CONTEXT_MS))?.id).toBe('cargo');
    expect(cargoContext(app, at(1_001 + BAY_FULL_CONTEXT_MS))).toBeNull();
    for (let i = 0; i < 30; i++) app.world.pod.cargo.push({ kind: 'mineral', tier: 9 });
    expect(cargoContext(app, at(1e9))?.id).toBe('cargo');
    app.world.pod.cargo.length = 0;
  });

  it('the build wave plugs in Place drill / BUILD; the lowest priority number wins; unregister removes it', () => {
    const run = vi.fn();
    const build: ContextAction = { priority: 3, id: 'build', label: 'BUILD', run };
    const drill: ContextAction = { priority: 2, id: 'drill', label: 'Place drill', run };
    const offBuild = registerContextAction((_a, input) => (input.idleMs >= 600 ? build : null));
    const offDrill = registerContextAction(() => drill);
    expect(pickContextAction(app, { now: 0, idleMs: 0 })?.id).toBe('drill');
    offDrill();
    expect(pickContextAction(app, { now: 0, idleMs: 0 })).toBeNull();
    expect(pickContextAction(app, { now: 0, idleMs: 600 })?.id).toBe('build');
    app.state.bayFullAt.value = 0;
    expect(pickContextAction(app, { now: 10, idleMs: 600 })?.id).toBe('cargo'); // priority 0 beats BUILD
    app.state.bayFullAt.value = Number.NEGATIVE_INFINITY;
    expect(runContextAction(app, { now: 0, idleMs: 600 })).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    offBuild();
  });

  it('never runs under a sheet or an overlay (keyboard E)', () => {
    app.state.bayFullAt.value = 0;
    app.state.sheet.value = 'menu';
    expect(runContextAction(app, { now: 1, idleMs: 0 })).toBe(false);
    app.state.sheet.value = null;
    app.state.overlay.value = 'interrupt';
    expect(runContextAction(app, { now: 1, idleMs: 0 })).toBe(false);
    app.state.overlay.value = null;
    expect(runContextAction(app, { now: 1, idleMs: 0 })).toBe(true);
    expect(app.state.sheet.value).toBe('cargo');
  });
});

describe('Return Tick (01 §3.5; canon §4.4)', () => {
  const stats = (over: Partial<PodStats> = {}): PodStats => ({
    maxFuel: 10,
    maxHull: 10,
    engineHp: 150,
    hoverCap: 100,
    vUp: 7,
    digSteps: 29,
    radiator: 1,
    baySlots: 7,
    slotsUsed: 0,
    cargoMass: 0,
    scannerLodeRadius: 1,
    ...over,
  });
  const pod = (over: Partial<PodState> = {}): PodState => ({ fuel: 6, hull: 10, cargo: [], row: 40, ...over }) as PodState;
  const wallet: Wallet = { cash: 20, debt: 0, lifetimeEarned: 0 };

  it('Training: on until the first t3 Tank or 10 trips; any assist forces it on; Hardcore forces it off', () => {
    const p = { tankTier: 1, trips: 0, assisted: false };
    expect(returnTickOn('training', p)).toBe(true);
    expect(returnTickOn('training', { ...p, trips: 10 })).toBe(false);
    expect(returnTickOn('training', { ...p, tankTier: 3 })).toBe(false);
    expect(returnTickOn('training', { ...p, tankTier: 3, assisted: true })).toBe(true);
    expect(returnTickOn('off', p)).toBe(false);
    expect(returnTickOn('off', { ...p, assisted: true })).toBe(true);
    expect(returnTickOn('on', { ...p, trips: 99, tankTier: 7 })).toBe(true);
    expect(returnTickOn('on', { ...p, hardcore: true })).toBe(false);
  });

  it('marks L_ret on the bar; the bar turns red below 1.25 × L_ret', () => {
    const ok = hudModel(pod({ fuel: 6 }), stats(), wallet, { liters: 2, shown: true });
    expect(ok.returnTick).toBeCloseTo(0.2, 9);
    expect(ok.fuelShort).toBe(false);
    expect(hudModel(pod({ fuel: 2.6 }), stats(), wallet, { liters: 2, shown: true }).fuelShort).toBe(false);
    expect(hudModel(pod({ fuel: 2.4 }), stats(), wallet, { liters: 2, shown: true }).fuelShort).toBe(true);
  });

  it('hidden on the Rim, when off, and as "short" with no tick when too heavy to climb', () => {
    expect(hudModel(pod({ row: 0 }), stats(), wallet, { liters: 0, shown: true }).returnTick).toBeNull();
    const off = hudModel(pod({ fuel: 0.5 }), stats(), wallet, { liters: 2, shown: false });
    expect([off.returnTick, off.fuelShort]).toEqual([null, false]);
    const heavy = hudModel(pod(), stats(), wallet, { liters: Infinity, shown: true });
    expect([heavy.returnTick, heavy.fuelShort]).toEqual([null, true]);
    expect(hudModel(pod({ fuel: 6 }), stats(), wallet, { liters: 30, shown: true }).returnTick).toBe(1);
  });
});

describe('style test codes (03 §9.4)', () => {
  it('labels A / B by seed parity, so the tester never learns which look is which', () => {
    expect(abLabel('toon', 8)).toBe('A');
    expect(abLabel('pixel', 8)).toBe('B');
    expect(abLabel('toon', 7)).toBe('B');
    expect(abLabel('pixel', 7)).toBe('A');
    for (const seed of [7, 8, 0xffffffff]) for (const l of ['A', 'B'] as const) expect(abLabel(lookOf(l, seed), seed)).toBe(l);
  });

  it('round-trips the result code; rejects anything else', () => {
    const answers = { ...emptyAnswers(), a: [5, 4, 3, 2, 1, 5], ship: 'both' as const, note: 'nice ✓' };
    const code = encodeStyleResult({ v: 1, build: '0.1.0', seed: 7, aIs: 'pixel', answers, perf: 'HFP1:abc' });
    expect(code.startsWith('HFST1:')).toBe(true);
    expect(code).not.toMatch(/[+/=]/);
    expect(decodeStyleResult(code)).toEqual({ v: 1, build: '0.1.0', seed: 7, aIs: 'pixel', answers, perf: 'HFP1:abc' });
    expect(() => decodeStyleResult('HF1:abc')).toThrow();
    expect(() => decodeStyleResult(`HFST1:${btoa('{"v":2}')}`)).toThrow();
  });

  it('sanitizes stored answers field by field', () => {
    const s = sanitizeAnswers({ a: [9, 3, 'x'], b: 'nope', ship: 'C', note: 'x'.repeat(900) });
    expect(s.a).toEqual([0, 3, 0, 0, 0, 0]);
    expect(s.b).toEqual(STYLE_QUESTIONS.map(() => 0));
    expect(s.ship).toBeNull();
    expect(s.note).toHaveLength(500);
    expect(sanitizeAnswers(null)).toEqual(emptyAnswers());
  });
});

describe('cargo panel (canon §3.7)', () => {
  let dom: FakeDom;
  let app: FakeApp;
  const copper: CargoItem = { kind: 'mineral', tier: 2 };
  beforeEach(async () => {
    dom = installFakeDom();
    app = createFakeApp({ scope: 'mvp', look: 'toon', sheet: 'cargo' });
    app.world.pod.cargo = [copper, { ...copper }, { ...copper }, { kind: 'mineral', tier: 7 }, { kind: 'relic', id: 0 }];
    await flush(() => render(h(SheetHost, { app }), dom.root as unknown as HTMLElement));
  });
  afterEach(async () => {
    await flush(() => render(null, dom.root as unknown as HTMLElement));
    dom.restore();
  });
  const row = (label: string) => dom.root.querySelectorAll('.hf-cargo-row').find((r) => text(r.querySelector('.hf-list-title')).startsWith(label))!;
  const button = (label: string) => dom.root.querySelectorAll('button').find((b) => text(b) === label)!;
  const tick = () => flush(() => app.state.hudTick.value++);

  it('one row per kind; gems (tiers 7–10) and relics confirm first', () => {
    expect(cargoKey(copper)).toBe(cargoKey({ kind: 'mineral', tier: 2 }));
    expect(cargoKey(copper)).not.toBe(cargoKey({ kind: 'mineral', tier: 3 }));
    expect(discardNeedsConfirm(copper)).toBe(false);
    expect(discardNeedsConfirm({ kind: 'mineral', tier: 7 })).toBe(true);
    expect(discardNeedsConfirm({ kind: 'relic', id: 2 })).toBe(true);
    expect(dom.root.querySelectorAll('.hf-cargo-row')).toHaveLength(3);
  });

  it('a row expands on tap to "Discard 1" and the "Discard all" hold; Undo puts it back until close', async () => {
    const copperRow = row('Copper');
    await nativeClick(copperRow.querySelector('.hf-cargo-head')!);
    expect(copperRow.querySelector('.hf-cargo-head')!.getAttribute('aria-expanded')).toBe('true');
    expect(text(copperRow.querySelector('.hf-cargo-actions'))).toContain('Discard 1');
    expect(copperRow.querySelector('.hf-hold')).not.toBeNull();
    await nativeClick(button('Discard 1'));
    await tick();
    expect(app.world.pod.cargo.filter((c) => c.kind === 'mineral' && c.tier === 2)).toHaveLength(2);
    expect(text(dom.root.querySelector('.hf-undo-bar'))).toContain('Discarded 1 × Copper');
    await nativeClick(button('Undo'));
    await tick();
    expect(app.world.pod.cargo).toHaveLength(5);
    expect(dom.root.querySelector('.hf-undo-bar')).toBeNull();
  });

  it('a gem asks before it goes overboard; Keep cancels', async () => {
    const gem = row('Peridot');
    await nativeClick(gem.querySelector('.hf-cargo-head')!);
    await nativeClick(button('Discard 1'));
    expect(text(gem.querySelector('.hf-confirm'))).toMatch(/Throw out one Peridot\? Worth \$/);
    expect(app.world.pod.cargo).toHaveLength(5);
    await nativeClick(button('Keep'));
    expect(gem.querySelector('.hf-confirm')).toBeNull();
    await nativeClick(button('Discard 1'));
    await nativeClick(dom.root.querySelector('.hf-confirm .hf-btn-danger')!);
    await tick();
    expect(app.world.pod.cargo.some((c) => c.kind === 'mineral' && c.tier === 7)).toBe(false);
  });

  it('keyboard activation of "Discard all" fires at once (the hold is for touch)', async () => {
    await nativeClick(row('Copper').querySelector('.hf-cargo-head')!);
    await flush(() => dom.root.querySelector('.hf-hold')!.click());
    await tick();
    expect(app.world.pod.cargo.some((c) => c.kind === 'mineral' && c.tier === 2)).toBe(false);
  });
});

describe('title "Paste save" (canon §3.15; 03 §6.3)', () => {
  let dom: FakeDom;
  let app: FakeApp;
  beforeEach(() => {
    dom = installFakeDom();
    app = createFakeApp({ scope: 'mvp', look: 'toon', overlay: 'title', standalone: true, importOffer: true });
  });
  afterEach(async () => {
    await flush(() => render(null, dom.root as unknown as HTMLElement));
    vi.unstubAllGlobals();
    dom.restore();
  });
  const mount = () => flush(() => render(h(TitleScreen, { app }), dom.root as unknown as HTMLElement));
  const button = (label: string) => dom.root.querySelectorAll('button').find((b) => text(b) === label) ?? null;

  it('first standalone launch with no save offers it; Skip hides it', async () => {
    await mount();
    expect(button('Paste save')).not.toBeNull();
    await nativeClick(button('Skip')!);
    expect(dom.root.querySelector('.hf-paste-save')).toBeNull();
    expect(button('Play')).not.toBeNull();
  });

  it('one tap imports the clipboard code, and Play turns into Continue', async () => {
    const code = await app.exportSave();
    app.world.wallet.cash = 0;
    vi.stubGlobal('navigator', { clipboard: { readText: async () => code } });
    app.world.story.deepestRow = 0;
    await mount();
    expect(button('Play')).not.toBeNull();
    const importSave = vi.spyOn(app, 'importSave').mockImplementation(async () => {
      app.world.story.deepestRow = 12;
      return { ok: true, message: 'Save imported' };
    });
    await nativeClick(button('Paste save')!);
    await vi.waitFor(() => expect(dom.root.querySelector('.hf-paste-done')).not.toBeNull());
    expect(importSave).toHaveBeenCalledWith(code);
    await flush();
    expect(button('Continue')).not.toBeNull();
  });

  it('a blocked or empty clipboard opens the paste box; a bad code says why', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: async () => '' } });
    await mount();
    await nativeClick(button('Paste save')!);
    await vi.waitFor(() => expect(dom.root.querySelector('.hf-paste-save textarea')).not.toBeNull());
    expect(text(dom.root.querySelector('.hf-paste-save .hf-note-bad'))).toMatch(/paste the code below/);
    const box = dom.root.querySelector('.hf-paste-save textarea') as unknown as FakeTextArea;
    box.value = 'not a code';
    await flush(() => box.dispatchEvent(new FakeEvent('input')));
    await nativeClick(button('Import')!);
    expect(text(dom.root.querySelector('.hf-paste-save .hf-note-bad'))).toBe('Save codes start with HF1:');
  });
});

describe('Safe Mode card (APP-3, APP-5; 04 §4.13)', () => {
  let dom: FakeDom;
  beforeEach(() => {
    dom = installFakeDom();
  });
  afterEach(async () => {
    await flush(() => render(null, dom.root as unknown as HTMLElement));
    dom.restore();
  });

  it('names the older copy it would load, or the retry when there is none', () => {
    expect(previousCopyLabel(4 * 60_000)).toBe('Load previous copy (4 min older)');
    expect(previousCopyLabel(null)).toBe('Try this save again');
  });

  it('shows a failed recovery on the card itself', async () => {
    const app = createFakeApp({ scope: 'mvp', look: 'toon', overlay: 'safemode', safeModePreviousMs: 2 * 3_600_000 });
    await flush(() => render(h(SafeModeCard, { app }), dom.root as unknown as HTMLElement));
    const labels = dom.root.querySelectorAll('button').map((b) => text(b));
    expect(labels).toEqual(['Export this save code', 'Load previous copy (2 h older)', 'New game (export first)']);
    await flush(() => (app.state.safeMode.value = { previousOlderByMs: null, error: 'No older copy: export or start over' }));
    expect(text(dom.root.querySelector('[role="alert"]'))).toBe('No older copy: export or start over');
  });
});
