import { describe, expect, it, vi } from 'vitest';
import { VISIBLE_IDLE_MS } from '../../src/app/away';
import { DEATH_CARD_MS, GameApp, IMPORT_DRY_RUN_STEPS, salvageFee, type ControllerOptions } from '../../src/app/controller';
import { NOTICE } from '../../src/app/notices';
import { SaveError } from '../../src/save/codec';
import { defaultSettings } from '../../src/app/settings';
import { TOAST_MS } from '../../src/app/toasts';
import type { InputController } from '../../src/app/types';
import type { PodIntent } from '../../src/pod/types';
import type { GameEvent } from '../../src/shared/events';
import type { CargoItem } from '../../src/shared/types';
import type { WorldApi } from '../../src/world/api';

const TIERS = { drill: 1, hull: 1, engine: 1, tank: 1, radiator: 1, bay: 1, scanner: 1 };

/** Just enough of WorldApi for the controller. */
class FakeWorld {
  pod = { x: 7.5, y: 0.4, vx: 0, vy: 0, fuel: 6, hull: 10, grounded: true, tiers: { ...TIERS }, cargo: [] as CargoItem[], quickSlots: [] };
  wallet = { cash: 20, debt: 0, lifetimeEarned: 0 };
  story = { deepestRow: 0, trips: 0 };
  stepNo = 0;
  steps: boolean[] = [];
  sheetClosed = vi.fn();
  respawn = vi.fn(() => ({ fee: 25, debt: 5, lost: this.pod.cargo.splice(0) }));
  step(_i: PodIntent, running: boolean): void {
    this.stepNo++;
    this.steps.push(running);
  }
  drainEvents(): GameEvent[] {
    return [];
  }
  cargoValue(): number {
    return this.pod.cargo.length * 30;
  }
  serialize(): Uint8Array {
    return new Uint8Array([1, 2, 3]);
  }
}

function fakeWorld(patch: Partial<FakeWorld> = {}): FakeWorld & WorldApi {
  return Object.assign(new FakeWorld(), patch) as unknown as FakeWorld & WorldApi;
}

function makeApp(over: Partial<ControllerOptions> = {}) {
  const world = (over.world as (FakeWorld & WorldApi) | undefined) ?? fakeWorld();
  let now = 0;
  const saves = { markDirty: vi.fn(), requestSoon: vi.fn(), critical: vi.fn(() => null), setEnabled: vi.fn() };
  const audio = { unlock: vi.fn(), play: vi.fn(), setEnabled: vi.fn(), setRespectSilent: vi.fn(), speak: vi.fn(), stopSpeech: vi.fn() };
  const input = { releaseAll: vi.fn(), sampleIntent: vi.fn(), touching: false, active: false, dispose: vi.fn() } as unknown as InputController;
  const settingsStore = { loadSettings: vi.fn(), saveSettings: vi.fn(), loadLook: vi.fn(), saveLook: vi.fn() };
  const opts: ControllerOptions = {
    world,
    worlds: { create: () => fakeWorld(), deserialize: () => fakeWorld() },
    codes: { encode: () => 'HF1:abc', decode: (c) => (c.startsWith('HF1:') ? { ok: true, bytes: new Uint8Array([9]) } : { ok: false, reason: 'nope' }) },
    settings: defaultSettings(393, 852),
    look: 'toon',
    settingsStore,
    styleTest: true,
    standalone: true,
    canInstall: false,
    coldLoad: false,
    resolveQuality: () => 'mid',
    now: () => now,
    randomSeed: () => 42,
    ...over,
  };
  const app = new GameApp(opts);
  app.attachSaves(saves);
  app.attachAudio(audio);
  app.attachInput(input);
  return { app, world, saves, audio, input, settingsStore, advance: (ms: number) => (now += ms) };
}

describe('GameApp: title, sheets, interrupts', () => {
  it('boots behind the title; Play starts the pod', () => {
    const { app } = makeApp();
    expect(app.state.overlay.value).toBe('title');
    expect(app.podRunning()).toBe(false);
    app.start();
    expect(app.state.overlay.value).toBeNull();
    expect(app.podRunning()).toBe(true);
  });

  it('cold-loaded airborne saves count down after Play', () => {
    const world = fakeWorld();
    world.pod.grounded = false;
    const { app } = makeApp({ world, coldLoad: true });
    app.start();
    expect(app.state.overlay.value).toBe('countdown');
    app.tick(1_600, 1_600);
    expect(app.state.overlay.value).toBeNull();
  });

  it('opening a sheet pauses the pod; closing a Rim sheet disarms its pad', () => {
    const { app, world, audio } = makeApp();
    app.start();
    app.openSheet('pump');
    expect(app.podRunning()).toBe(false);
    expect(audio.play).toHaveBeenCalledWith('sheetOpen');
    app.closeSheet();
    expect(world.sheetClosed).toHaveBeenCalledWith('pump');
    expect(app.state.sheet.value).toBeNull();
    expect(app.podRunning()).toBe(true);
  });

  it('a sheet set directly on the signal also pauses the pod', () => {
    const { app } = makeApp();
    app.start();
    app.state.sheet.value = 'settings';
    expect(app.podRunning()).toBe(false);
    app.state.sheet.value = null;
    expect(app.podRunning()).toBe(true);
  });

  it('pad arrival opens that sheet only when nothing else is up', () => {
    const { app, saves } = makeApp();
    app.start();
    app.handleEvents([{ t: 'pad-arrive', id: 'assay' }]);
    expect(app.state.sheet.value).toBe('assay');
    expect(saves.requestSoon).toHaveBeenCalled();
    app.closeSheet();
    app.interrupt();
    app.handleEvents([{ t: 'pad-arrive', id: 'pump' }]);
    expect(app.state.sheet.value).toBeNull();
  });

  it('interrupt shows "Tap to resume" and releases held controls', () => {
    const { app, input } = makeApp();
    app.start();
    app.interrupt();
    expect(app.state.overlay.value).toBe('interrupt');
    expect(input.releaseAll).toHaveBeenCalled();
    app.resume();
    expect(app.state.overlay.value).toBeNull();
  });

  it('landscape raises the upright card; portrait asks to resume', () => {
    const { app } = makeApp();
    app.start();
    app.setUpright(true);
    expect(app.state.overlay.value).toBe('upright');
    app.setUpright(false);
    expect(app.state.overlay.value).toBe('interrupt');
  });

  it('context loss pauses; restore asks to resume', () => {
    const { app } = makeApp();
    app.start();
    app.setContextLost(true);
    expect(app.podRunning()).toBe(false);
    app.setContextLost(false);
    expect(app.state.overlay.value).toBe('interrupt');
  });
});

describe('GameApp: death and salvage (canon §4.2)', () => {
  it('fee preview follows the installed-tier prices', () => {
    expect(salvageFee(TIERS)).toBe(25);
    expect(salvageFee({ ...TIERS, drill: 2, hull: 2, engine: 2, tank: 2, bay: 2 })).toBe(300);
    expect(salvageFee({ drill: 4, hull: 4, engine: 4, tank: 4, radiator: 4, bay: 4, scanner: 3 })).toBe(2_560);
  });

  it('shows the card for 3 s, then respawns and saves critically at both ends', () => {
    const world = fakeWorld();
    world.pod.cargo.push({ kind: 'mineral', tier: 1 }, { kind: 'mineral', tier: 1 });
    const { app, saves } = makeApp({ world });
    app.start();
    app.handleEvents([{ t: 'destroyed', cause: 'fuel' }]);
    expect(app.state.overlay.value).toBe('death');
    expect(app.state.death.value).toMatchObject({ cause: 'fuel', fee: 25, lostCount: 2, lostValue: 60 });
    expect(saves.critical).toHaveBeenCalledTimes(1);
    app.tick(DEATH_CARD_MS - 1, 2_999);
    expect(world.respawn).not.toHaveBeenCalled();
    app.tick(2, 3_001);
    expect(world.respawn).toHaveBeenCalledTimes(1);
    expect(app.state.overlay.value).toBeNull();
    expect(app.state.death.value).toMatchObject({ fee: 25, debt: 5, lostCount: 2 });
    expect(saves.critical).toHaveBeenCalledTimes(2);
  });
});

describe('GameApp: toasts, actions, settings', () => {
  it('afterAction toasts failures and saves soon after successes', () => {
    const { app, saves, audio } = makeApp();
    app.start();
    app.afterAction({ ok: false, reason: 'Need $5 more' });
    expect(app.state.toasts.value.map((t) => t.text)).toEqual(['Need $5 more']);
    expect(audio.play).toHaveBeenCalledWith('error');
    app.afterAction({ ok: true, message: 'Filled up' });
    expect(saves.requestSoon).toHaveBeenCalledTimes(1);
  });

  it('sim toast events and incentives become toasts', () => {
    const { app } = makeApp();
    app.start();
    app.handleEvents([
      { t: 'toast', text: 'Paved — dig beside the pad' },
      { t: 'incentive', row: 40, ft: 500, cash: 1_000 },
    ]);
    expect(app.state.toasts.value.map((t) => t.text)).toEqual(['Paved — dig beside the pad', '500 ft bonus: +$1,000']);
  });

  it('bumps hudTick at most every 100 ms', () => {
    const { app } = makeApp();
    const t0 = app.state.hudTick.value;
    app.tick(16, 0);
    app.tick(16, 50);
    app.tick(16, 99);
    expect(app.state.hudTick.value).toBe(t0 + 1);
    app.tick(16, 100);
    expect(app.state.hudTick.value).toBe(t0 + 2);
  });

  it('setLook persists; updateSettings applies audio and persists', () => {
    const { app, settingsStore, audio } = makeApp();
    app.setLook('pixel');
    expect(app.state.look.value).toBe('pixel');
    expect(settingsStore.saveLook).toHaveBeenCalledWith('pixel');
    app.updateSettings({ sound: false, respectSilent: false });
    expect(audio.setEnabled).toHaveBeenLastCalledWith(false);
    expect(audio.setRespectSilent).toHaveBeenLastCalledWith(false);
    expect(settingsStore.saveSettings).toHaveBeenCalled();
  });
});

describe('GameApp: toasts under the title, upright card and Safe Mode (03 §6.2)', () => {
  it('a boot notice raised behind the title shows for its full 2.5 s after Play', () => {
    const { app, advance } = makeApp();
    app.toast('Damaged save: loaded copy 5 min older', 'warn');
    expect(app.state.toasts.value).toEqual([]);
    advance(10_000); // the player reads the title for 10 s
    app.tick(16, 10_000);
    app.start();
    expect(app.state.toasts.value).toMatchObject([{ text: 'Damaged save: loaded copy 5 min older', tone: 'warn', until: 10_000 + TOAST_MS }]);
  });

  it('holds toasts while landscape and releases them with "Tap to resume"', () => {
    const { app } = makeApp();
    app.start();
    app.setUpright(true);
    app.toast('Bay full', 'warn');
    expect(app.state.toasts.value).toEqual([]);
    app.setUpright(false);
    expect(app.state.overlay.value).toBe('interrupt');
    expect(app.state.toasts.value.map((t) => t.text)).toEqual(['Bay full']);
  });

  it('a notice about the loaded world is dropped when New game replaces it; others survive', () => {
    const { app } = makeApp();
    app.worldNotice('Damaged save: loaded copy 5 min older', 'warn');
    app.toast(NOTICE.savesUnavailable, 'warn');
    app.newGame();
    expect(app.state.toasts.value.map((t) => t.text)).toEqual([NOTICE.savesUnavailable, 'New claim staked']);
  });

  it('a Safe Mode failure waits behind the card and is dropped by New game', async () => {
    const safeMode = { exportCode: vi.fn(async () => null), loadPrevious: vi.fn(async () => ({ ok: false as const, reason: NOTICE.noOlderCopy })) };
    const { app } = makeApp({ safeMode });
    app.start();
    await vi.waitFor(() => expect(safeMode.loadPrevious).toHaveBeenCalled());
    await Promise.resolve();
    expect(app.state.overlay.value).toBe('safemode');
    app.newGame();
    expect(app.state.toasts.value.map((t) => t.text)).toEqual(['New claim staked']);
  });
});

describe('GameApp: service-worker update (04 §9.2)', () => {
  it('never reloads by itself, even on the title; the chip applies it after a critical save', () => {
    const { app, saves } = makeApp();
    const apply = vi.fn(async () => undefined);
    app.notifyUpdateReady(apply);
    expect(apply).not.toHaveBeenCalled();
    expect(saves.critical).not.toHaveBeenCalled();
    expect(app.state.updateReady.value).toBe(true);
    app.start();
    expect(app.state.toasts.value.map((t) => t.text)).toEqual([NOTICE.updateReady]);
    app.applyUpdate();
    expect(saves.critical).toHaveBeenCalledTimes(1);
    expect(saves.critical.mock.invocationCallOrder[0]).toBeLessThan(apply.mock.invocationCallOrder[0]);
    expect(app.state.updateReady.value).toBe(false);
    app.applyUpdate();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe('GameApp: export and import (04 §4.13)', () => {
  it('exports the live world through the codec', async () => {
    const { app } = makeApp();
    await expect(app.exportSave()).resolves.toBe('HF1:abc');
  });

  it('rejects bad codes without touching the world', async () => {
    const { app, world } = makeApp();
    const r = await app.importSave('nope');
    expect(r).toEqual({ ok: false, reason: 'nope' });
    expect(app.world).toBe(world);
  });

  it('dry-runs 1,200 steps on a scratch world before replacing the live one', async () => {
    const scratch = fakeWorld();
    const live = fakeWorld();
    const deserialize = vi.fn().mockReturnValueOnce(scratch).mockReturnValueOnce(live);
    const { app, saves } = makeApp({ worlds: { create: () => fakeWorld(), deserialize } });
    app.start();
    const r = await app.importSave('HF1:xyz');
    expect(r.ok).toBe(true);
    expect(scratch.stepNo).toBe(IMPORT_DRY_RUN_STEPS);
    expect(scratch.steps.every(Boolean)).toBe(true);
    expect(app.world).toBe(live);
    expect(saves.critical).toHaveBeenCalled();
    expect(app.state.overlay.value).toBe('interrupt');
  });

  it('refuses a save whose dry run throws or leaves the pod outside the world', async () => {
    const crashing = fakeWorld();
    crashing.step = () => {
      throw new Error('boom');
    };
    const a = makeApp({ worlds: { create: () => fakeWorld(), deserialize: () => crashing } });
    expect((await a.app.importSave('HF1:x')).ok).toBe(false);
    const lost = fakeWorld();
    lost.pod.x = Number.NaN;
    const b = makeApp({ worlds: { create: () => fakeWorld(), deserialize: () => lost } });
    expect((await b.app.importSave('HF1:x')).ok).toBe(false);
    expect(b.app.world).not.toBe(lost);
  });
});

describe('GameApp: Safe Mode', () => {
  it('holds the pod and saving until the player picks a way out', async () => {
    const recovered = fakeWorld();
    const onSafeModeResolved = vi.fn();
    const message = 'Loaded previous copy (5 min older)';
    const safeMode = { exportCode: vi.fn(async () => 'HF1:failing'), loadPrevious: vi.fn(async () => ({ ok: true as const, world: recovered, message })) };
    const { app, saves } = makeApp({ safeMode, hooks: { onSafeModeResolved } });
    expect(app.state.overlay.value).toBe('safemode');
    expect(saves.setEnabled).toHaveBeenLastCalledWith(false);
    await expect(app.exportSave()).resolves.toBe('HF1:failing');
    app.start(); // "Try again" = load the previous copy
    await vi.waitFor(() => expect(onSafeModeResolved).toHaveBeenCalled());
    expect(app.world).toBe(recovered);
    expect(saves.setEnabled).toHaveBeenLastCalledWith(true);
    expect(app.state.overlay.value).toBe('title');
    // Which copy loaded is said once the title is gone (the toast layer is hidden under it).
    expect(app.state.toasts.value).toEqual([]);
    app.start();
    expect(app.state.toasts.value.map((t) => t.text)).toEqual([message]);
  });

  it('New game leaves Safe Mode straight into play', () => {
    const onSafeModeResolved = vi.fn();
    const safeMode = { exportCode: vi.fn(async () => null), loadPrevious: vi.fn() };
    const { app, saves } = makeApp({ safeMode, hooks: { onSafeModeResolved } });
    app.newGame();
    expect(app.state.overlay.value).toBeNull();
    expect(onSafeModeResolved).toHaveBeenCalled();
    expect(saves.critical).toHaveBeenCalled();
  });
});

/** A fake MVP world: it hosts a factory (build mode, the away rest) and records setAway. */
function factoryWorld() {
  const w = fakeWorld();
  Object.assign(w.pod, { destroyed: false, y: -3.5 });
  return Object.assign(w, { factory: { entities: () => [] }, setAway: vi.fn() });
}

describe('GameApp: build mode and death (INT-6)', () => {
  it('a death while building leaves build mode: the card and the respawn happen in play, with no stale countdown', () => {
    const world = factoryWorld();
    const { app } = makeApp({ world });
    const build = { begin: vi.fn(() => true), end: vi.fn() };
    app.attachBuild(build);
    app.start();
    app.enterBuild();
    expect(app.state.mode.value).toBe('build');
    // Destroyed mid-fall (a leaving-build gate alone would ask for the 1.5 s countdown).
    Object.assign(world.pod, { destroyed: true, grounded: false, vy: -12 });
    app.handleEvents([{ t: 'destroyed', cause: 'hull' }]);
    expect(app.state.mode.value).toBe('play');
    expect(build.end).toHaveBeenCalledTimes(1);
    expect(app.state.overlay.value).toBe('death');
    world.respawn.mockImplementation(() => {
      Object.assign(world.pod, { destroyed: false, grounded: true, vy: 0 });
      return { fee: 25, debt: 0, lost: [] };
    });
    app.tick(DEATH_CARD_MS + 1, DEATH_CARD_MS + 1);
    expect(world.respawn).toHaveBeenCalledTimes(1);
    expect(app.state.overlay.value).toBeNull();
    expect(app.state.mode.value).toBe('play');
    expect(app.podRunning()).toBe(true);
  });

  it('build mode will not open over a destroyed pod (before its death event drains, or a wreck save)', () => {
    const world = factoryWorld();
    const { app } = makeApp({ world });
    app.attachBuild({ begin: vi.fn(() => true), end: vi.fn() });
    app.start();
    Object.assign(world.pod, { destroyed: true });
    app.enterBuild();
    expect(app.state.mode.value).toBe('play');
    Object.assign(world.pod, { destroyed: false });
    app.enterBuild();
    expect(app.state.mode.value).toBe('build');
  });
});

describe('GameApp: visible-idle away (02 §8.1 steps 1–2; INT-7)', () => {
  const idle = (app: GameApp, ms: number) => {
    for (let left = ms; left > 0; left -= 1_000) app.tick(Math.min(1_000, left), 0);
  };

  it('5 min on screen without input rests the factory; the first input wakes it', () => {
    const world = factoryWorld();
    const { app } = makeApp({ world });
    app.start();
    idle(app, VISIBLE_IDLE_MS - 1_000);
    expect(world.setAway).not.toHaveBeenCalled();
    expect(app.state.resting.value).toBe(false);
    idle(app, 1_000);
    expect(world.setAway).toHaveBeenCalledWith(true);
    expect(app.state.resting.value).toBe(true);
    idle(app, 60_000); // still resting, not re-sent
    expect(world.setAway).toHaveBeenCalledTimes(1);
    app.noteInput();
    expect(world.setAway).toHaveBeenLastCalledWith(false);
    expect(app.state.resting.value).toBe(false);
    app.noteInput();
    expect(world.setAway).toHaveBeenCalledTimes(2);
  });

  it('input restarts the clock, and so does a trip through the background (hidden is its own away)', () => {
    const world = factoryWorld();
    const { app } = makeApp({ world });
    app.start();
    idle(app, VISIBLE_IDLE_MS - 1_000);
    app.noteInput();
    idle(app, VISIBLE_IDLE_MS - 1_000);
    expect(app.state.resting.value).toBe(false);
    app.setHidden(true);
    expect(world.setAway).toHaveBeenLastCalledWith(true);
    app.setHidden(false);
    expect(world.setAway).toHaveBeenLastCalledWith(false);
    idle(app, VISIBLE_IDLE_MS - 1_000);
    expect(app.state.resting.value).toBe(false);
    idle(app, 1_000);
    expect(app.state.resting.value).toBe(true);
    // Hidden while resting: still away, the chip goes; visible again wakes it.
    app.setHidden(true);
    expect(app.state.resting.value).toBe(false);
    app.setHidden(false);
    expect(world.setAway).toHaveBeenLastCalledWith(false);
  });

  it('an M0 world (no factory) never rests', () => {
    const world = Object.assign(fakeWorld(), { factory: null, setAway: vi.fn() });
    const { app } = makeApp({ world });
    idle(app, 2 * VISIBLE_IDLE_MS);
    expect(app.state.resting.value).toBe(false);
    expect(world.setAway).not.toHaveBeenCalled();
  });
});

describe('GameApp: factory unlocks (INT-9)', () => {
  it('toasts rung unlocks and possession recipes, and saves soon on progress milestones', () => {
    const { app, saves } = makeApp();
    app.start();
    app.handleEvents([{ t: 'unlock', rung: 'U3', label: 'Assembler, Router, Export Terminal' }]);
    app.handleEvents([{ t: 'unlock', rung: 'A5', label: 'Circuit' }]);
    expect(app.state.toasts.value.map((t) => [t.text, t.tone])).toEqual([
      ['New: Assembler, Router, Export Terminal', 'good'],
      ['New recipe: Circuit', 'good'],
    ]);
    expect(saves.requestSoon).toHaveBeenCalledTimes(2);
    app.handleEvents([{ t: 'first-ingot', item: 'copperIngot' }, { t: 'first-lift-delivery' }]);
    expect(saves.requestSoon).toHaveBeenCalledTimes(4);
  });
});

describe('GameApp: radio voice blips (03 §11.5; INT-4)', () => {
  const msg = (id: number) => ({ id, beat: 'S1', sender: 'Dot' as const, cards: ['One.', 'Two.'], at: 0 });

  it('speaks the card on show through the audio port, unless Voice blips is off', () => {
    const { app, audio } = makeApp();
    app.speakRadio('Dot', 'Hello, Seven.');
    expect(audio.speak).toHaveBeenCalledWith('Dot', 'Hello, Seven.');
    app.updateSettings({ voiceBlips: false });
    expect(audio.stopSpeech).toHaveBeenCalledTimes(1); // turned off mid-card
    app.speakRadio('Dot', 'Again.');
    expect(audio.speak).toHaveBeenCalledTimes(1);
    app.stopRadioSpeech();
    expect(audio.stopSpeech).toHaveBeenCalledTimes(2);
  });

  it('dismissing the message on show stops its blips; dismissing a queued one does not', () => {
    const { app, audio } = makeApp();
    app.state.radio.value = [msg(1), msg(2), msg(3)];
    app.dismissRadio(2);
    expect(audio.stopSpeech).not.toHaveBeenCalled();
    app.dismissRadio(1);
    expect(audio.stopSpeech).toHaveBeenCalledTimes(1);
    expect(app.state.radio.value.map((m) => m.id)).toEqual([3]);
  });
});

describe('GameApp: saves this build cannot load (04 §4.11; SIM-4)', () => {
  /** An HFSV header at `version` (the controller reads only the header to tell the kinds apart). */
  const header = (version: number) => new Uint8Array([0x48, 0x46, 0x53, 0x56, version, 0, 1, 2, 3, 4]);
  const refusing = (version: number) =>
    makeApp({
      codes: { encode: () => 'HF1:abc', decode: () => ({ ok: true, bytes: header(version) }) },
      worlds: {
        create: () => fakeWorld(),
        deserialize: () => {
          throw new SaveError('version', 'refused');
        },
      },
    });

  it('an imported M0 test save or newer save says so instead of "not a valid save"', async () => {
    const m0 = refusing(0);
    expect(await m0.app.importSave('HF1:m0')).toEqual({ ok: false, reason: NOTICE.testSave });
    expect(m0.app.world).toBe(m0.world);
    expect(await refusing(2).app.importSave('HF1:v2')).toEqual({ ok: false, reason: NOTICE.newerSave });
  });

  it('offers the kept copy for export', async () => {
    const keptSave = { kind: 'test' as const, fresh: true, exportCode: vi.fn(async () => 'HF1:m0') };
    const { app } = makeApp({ keptSave });
    expect(app.state.keptSave.value).toEqual({ kind: 'test', fresh: true });
    await expect(app.exportKeptSave()).resolves.toBe('HF1:m0');
    const none = makeApp();
    expect(none.app.state.keptSave.value).toBeNull();
    await expect(none.app.exportKeptSave()).resolves.toBeNull();
  });
});
