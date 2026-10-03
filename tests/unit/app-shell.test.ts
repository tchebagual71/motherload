// Player-shell features on the real World and GameApp: cargo discard + undo (canon §3.7), build-scope loading
// (INT-6), Return Tick litres (01 §3.5), sign-tap auto-drive (01 §3.10; SIM-3), bay-full and refusal toasts
// (INT-3, INT-9), assists as intent shaping (01 §6.4), debug previews through the time model (INT-18).
import { describe, expect, it, vi } from 'vitest';
import { BAY_FULL_TOAST_MS, GameApp, UPRIGHT_PREVIEW_MS, type ControllerOptions } from '../../src/app/controller';
import { NOTICE, refusalNotice } from '../../src/app/notices';
import { defaultSettings } from '../../src/app/settings';
import type { StyleView } from '../../src/app/styleViews';
import type { InputController, Settings } from '../../src/app/types';
import { applyAssists, landingAssistThrust, returnTickLiters, stickForThrust, thrustInput } from '../../src/pod';
import { NO_INTENT, type PodIntent } from '../../src/pod/types';
import { LANDING_ASSIST_V, POD_H, RIM_BUILDINGS, STEADY_DRILL_ENGAGE_STEPS } from '../../src/shared/canon';
import type { GameEvent } from '../../src/shared/events';
import { T, type CargoItem } from '../../src/shared/types';
import { SaveError } from '../../src/save/codec';
import { M0_DEBUG_STRIP, scopeFloorRow } from '../../src/terrain/scope';
import { loadScope } from '../../src/world/loadScope';
import { World } from '../../src/world/world';

const STAND_Y = POD_H / 2;
const copper: CargoItem = { kind: 'mineral', tier: 2 };
const peridot: CargoItem = { kind: 'mineral', tier: 7 };
const relic: CargoItem = { kind: 'relic', id: 0 };

function newWorld(scope: 'm0' | 'mvp' = 'mvp'): World {
  return new World({ seed: 7, scope });
}

/** Stand the pod still on the Rim at x. */
function standOnRim(w: World, x: number): void {
  const p = w.pod;
  p.x = p.prevX = x;
  p.y = p.prevY = STAND_Y;
  p.vx = p.vy = 0;
  p.grounded = true;
}

function makeApp(world: World, settings: Partial<Settings> = {}, over: Partial<ControllerOptions> = {}) {
  let now = 0;
  const input = { releaseAll: vi.fn(), sampleIntent: vi.fn(), touching: false, active: false, dispose: vi.fn() } as unknown as InputController;
  const app = new GameApp({
    world,
    worlds: { create: (seed) => new World({ seed, scope: 'mvp' }), deserialize: (b) => World.deserialize(b, 'mvp') },
    codes: { encode: () => 'HF1:x', decode: () => ({ ok: false, reason: 'nope' }) },
    settings: { ...defaultSettings(393, 852), ...settings },
    look: 'toon',
    settingsStore: { loadSettings: vi.fn(), saveSettings: vi.fn(), loadLook: vi.fn(), saveLook: vi.fn() },
    styleTest: false,
    standalone: true,
    canInstall: false,
    coldLoad: false,
    resolveQuality: () => 'mid',
    now: () => now,
    randomSeed: () => 1,
    ...over,
  });
  app.attachInput(input);
  app.attachSaves({ markDirty: vi.fn(), requestSoon: vi.fn(), critical: vi.fn(() => null), setEnabled: vi.fn() });
  app.start();
  /** The loop's step (app/loop.ts stepOnce + the frame's event hand-off). */
  const step = (n: number, raw: PodIntent = NO_INTENT): GameEvent[] => {
    const all: GameEvent[] = [];
    for (let i = 0; i < n; i++) {
      const running = app.podRunning();
      world.step(running ? app.shapeIntent(raw) : NO_INTENT, running);
      const ev = world.drainEvents();
      all.push(...ev);
      app.handleEvents(ev);
    }
    return all;
  };
  return { app, step, advance: (ms: number) => (now += ms), input };
}

const toastTexts = (app: GameApp) => app.state.toasts.value.map((t) => t.text);

describe('World cargo discard with undo (canon §3.7)', () => {
  it('"Discard 1" takes the newest item of that kind; "all" the whole group; undo puts each batch back', () => {
    const w = newWorld();
    w.pod.cargo.push(copper, peridot, { ...copper }, relic, { ...copper });
    expect(w.discardCargo(copper, 1)).toMatchObject({ ok: true, amount: 1 });
    expect(w.pod.cargo).toEqual([copper, peridot, copper, relic]);
    expect(w.discardCargo(copper, 'all')).toMatchObject({ ok: true, amount: 2 });
    expect(w.pod.cargo).toEqual([peridot, relic]);
    expect(w.discardsPending).toBe(2);
    expect(w.stats().slotsUsed).toBe(2);

    expect(w.undoDiscard()).toMatchObject({ ok: true, amount: 2 });
    expect(w.pod.cargo.filter((c) => c.kind === 'mineral' && c.tier === 2)).toHaveLength(2);
    expect(w.undoDiscard()).toMatchObject({ ok: true, amount: 1 });
    expect(w.pod.cargo).toHaveLength(5);
    expect(w.undoDiscard().ok).toBe(false);
  });

  it('relics match by id, minerals by tier; nothing matching is refused', () => {
    const w = newWorld();
    w.pod.cargo.push(relic, { kind: 'relic', id: 3 }, peridot);
    expect(w.discardCargo({ kind: 'relic', id: 3 }, 'all')).toMatchObject({ ok: true, amount: 1 });
    expect(w.pod.cargo).toEqual([relic, peridot]);
    expect(w.discardCargo(copper, 1)).toEqual({ ok: false, reason: 'Nothing like that aboard' });
    expect(w.discardCargo(peridot, 0).ok).toBe(false);
  });

  it('closing the panel commits: undo has nothing left, and nothing runs on a destroyed pod', () => {
    const w = newWorld();
    w.pod.cargo.push(copper);
    w.discardCargo(copper, 1);
    w.commitDiscards();
    expect(w.discardsPending).toBe(0);
    expect(w.undoDiscard().ok).toBe(false);
    w.pod.cargo.push(copper);
    w.pod.destroyed = true;
    expect(w.discardCargo(copper, 1).ok).toBe(false);
    expect(w.pod.cargo).toHaveLength(1);
  });

  it('discards are not saved as pending: a reload keeps the bay as the panel left it', () => {
    const w = newWorld();
    w.pod.cargo.push(copper, peridot);
    w.discardCargo(copper, 1);
    const back = World.deserialize(w.serialize(), 'mvp');
    expect(back.pod.cargo).toEqual([peridot]);
    expect(back.discardsPending).toBe(0);
  });
});

describe('Scope on load (INT-6; 04 §4.11)', () => {
  it('a save always plays under the build scope; an older one migrates, a newer one is refused', () => {
    expect(loadScope('m0', 'mvp')).toBe('mvp');
    expect(loadScope('mvp', 'mvp')).toBe('mvp');
    expect(loadScope('m0', 'v1')).toBe('v1');
    expect(() => loadScope('v1', 'mvp')).toThrow(SaveError);
    expect(() => loadScope('mvp', 'm0')).toThrow(SaveError);
  });

  it('m0 → mvp keeps the world as saved (the dug or undug debug strip) and lifts the r128 floor', () => {
    const m0 = newWorld('m0');
    const s = M0_DEBUG_STRIP;
    const strip = (w: World) => {
      const out: number[] = [];
      for (let r = s.top; r <= s.bottom; r++) for (let x = s.x0; x <= s.x1; x++) out.push(w.terrain.get(x, r));
      return out;
    };
    m0.terrain.set(s.x0, s.top, T.AIR); // a dug strip cell stays dug
    const mvp = World.deserialize(m0.serialize(), 'mvp');
    expect(mvp.scope).toBe('mvp');
    expect(strip(mvp)).toEqual(strip(m0));
    expect(strip(mvp)).toContain(T.HARDROCK);
    expect(mvp.terrain.get(s.x0, s.top)).toBe(T.AIR);
    mvp.debugTeleport(200);
    expect(mvp.pod.row).toBe(200);
    expect(scopeFloorRow(mvp.scope)).toBe(320);
  });

  it('without a build scope the saved scope stands (tools, fixtures)', () => {
    expect(World.deserialize(newWorld('m0').serialize()).scope).toBe('m0');
  });
});

describe('Return Tick litres and the Rim test (01 §3.5; canon §2.4)', () => {
  it('returnFuel is L_ret at the pod row and load: 0 on the Rim, Infinity when too heavy', () => {
    const w = newWorld();
    expect(w.returnFuel()).toBe(0);
    w.debugTeleport(100);
    expect(w.returnFuel()).toBeCloseTo(returnTickLiters(w.pod, false), 9);
    expect(w.returnFuel()).toBeGreaterThan(1);
    for (let i = 0; i < 20; i++) w.pod.cargo.push({ kind: 'mineral', tier: 9 });
    expect(w.returnFuel()).toBe(Infinity);
  });

  it('onRim: grounded on the Rim top only, never airborne, in a hole or destroyed', () => {
    const w = newWorld();
    expect(w.onRim()).toBe(true);
    w.pod.grounded = false;
    expect(w.onRim()).toBe(false);
    w.debugTeleport(0);
    expect(w.onRim()).toBe(false);
    standOnRim(w, 20.5);
    w.pod.destroyed = true;
    expect(w.onRim()).toBe(false);
  });
});

describe('Sign-tap auto-drive in the app (01 §3.10; SIM-3, INT-10)', () => {
  it('grounded on the Rim: drives to the pad at full speed and opens the sheet on arrival', () => {
    const w = newWorld();
    const { app, step } = makeApp(w);
    app.signTap('garage');
    expect(app.driveTarget).toBe('garage');
    let steps = 0;
    while (app.state.sheet.value === null && steps < 1_500) {
      step(1);
      steps++;
    }
    expect(app.state.sheet.value).toBe('garage');
    expect(app.driveTarget).toBeNull();
    expect(w.padUnderPod()).toBe('garage');
    expect(steps).toBeLessThan(12 * 60);
  });

  it('already on that pad: opens at once', () => {
    const w = newWorld();
    const pump = RIM_BUILDINGS[0];
    standOnRim(w, (pump.x0 + pump.x1 + 1) / 2);
    const { app } = makeApp(w);
    app.signTap('pump');
    expect(app.state.sheet.value).toBe('pump');
  });

  it('airborne or in a hole: no drive, no sheet, a "Land on the Rim first" toast', () => {
    const w = newWorld();
    const { app, step } = makeApp(w);
    step(20, { ...NO_INTENT, thrust: true });
    expect(w.pod.grounded).toBe(false);
    app.signTap('pump');
    expect(app.driveTarget).toBeNull();
    expect(app.state.sheet.value).toBeNull();
    expect(toastTexts(app)).toContain(NOTICE.landFirst);
    w.debugTeleport(0);
    app.signTap('assay');
    expect(app.driveTarget).toBeNull();
  });

  it('a hole Pip cannot skim on the way: no drive, a "Hole in the way" toast, no fall (PLAYER-4)', () => {
    const w = newWorld();
    const assay = RIM_BUILDINGS[1];
    standOnRim(w, (assay.x0 + assay.x1 + 1) / 2);
    for (const x of [8, 9]) for (let r = 0; r < 3; r++) w.terrain.set(x, r, T.AIR); // the Tutorial Patch, dug
    const { app, step } = makeApp(w);
    const hull = w.pod.hull;
    app.signTap('pump');
    expect(app.driveTarget).toBeNull();
    expect(toastTexts(app)).toEqual([NOTICE.holeAhead]);
    step(120);
    expect(w.onRim()).toBe(true);
    expect(w.pod.hull).toBe(hull);
    expect(app.state.sheet.value).not.toBe('pump');
  });

  it('a drive that ends with Pip off the Rim says so instead of stopping silently', () => {
    const w = newWorld();
    const { app, step } = makeApp(w);
    app.signTap('garage');
    step(10);
    expect(app.driveTarget).toBe('garage');
    w.debugTeleport(5); // e.g. knocked into a hole
    step(1);
    expect(app.driveTarget).toBeNull();
    expect(toastTexts(app)).toContain(NOTICE.driveLeftRim);
    for (const t of [NOTICE.holeAhead, NOTICE.driveLeftRim, NOTICE.driveStuck]) expect(t.length).toBeLessThanOrEqual(40);
  });

  it('any stick or THRUST input cancels the drive; so do a sheet or an interrupt', () => {
    const w = newWorld();
    const { app, step } = makeApp(w);
    app.signTap('shed');
    step(30);
    expect(app.driveTarget).toBe('shed');
    step(1, { ...NO_INTENT, sx: -0.4 });
    expect(app.driveTarget).toBeNull();
    app.signTap('shed');
    app.openSheet('menu');
    expect(app.driveTarget).toBeNull();
    app.closeSheet();
    app.signTap('shed');
    app.interrupt();
    expect(app.driveTarget).toBeNull();
  });
});

describe('Event feedback (INT-3, INT-9)', () => {
  it('"Bay full" stamps the pill callout clock and toasts (the silent switch mutes the sound)', () => {
    const w = newWorld();
    const { app, advance } = makeApp(w);
    advance(1_234);
    app.handleEvents([{ t: 'bay-full', item: copper }]);
    expect(app.state.bayFullAt.value).toBe(1_234);
    expect(toastTexts(app)).toEqual([NOTICE.bayFull]);
    // More ore lost to the full bay: the callout flashes again, but the toast (which hides the goal chip) waits.
    app.state.toasts.value = [];
    advance(3_000);
    app.handleEvents([{ t: 'bay-full', item: copper }]);
    expect(app.state.bayFullAt.value).toBe(4_234);
    expect(toastTexts(app)).toEqual([]);
    advance(BAY_FULL_TOAST_MS);
    app.handleEvents([{ t: 'bay-full', item: copper }]);
    expect(toastTexts(app)).toEqual([NOTICE.bayFull]);
  });

  it('a refused dig says why once per push (paved), and stays quiet for Hardrock and lode rock', () => {
    const w = newWorld();
    const pump = RIM_BUILDINGS[0];
    standOnRim(w, pump.x0 + 1.5);
    const { app, step } = makeApp(w);
    const down = { ...NO_INTENT, sy: -1 };
    const ev = step(40, down);
    expect(ev.filter((e) => e.t === 'dig-refused')).toHaveLength(1);
    expect(toastTexts(app)).toEqual(['Paved — dig beside the pad']);
    expect(refusalNotice('hardrock', 'mvp')).toBeNull();
    expect(refusalNotice('lode', 'mvp')).toBeNull();
    expect(refusalNotice('anchored', 'mvp')).toBe('Supports a belt — remove it first');
    expect(refusalNotice('floor', 'm0')).toMatch(/M0/);
    expect(refusalNotice('floor', 'mvp')).not.toMatch(/M0/);
    for (const r of ['paved', 'anchored', 'floor', 'seam', 'heartstone', 'seal'] as const) {
      expect((refusalNotice(r, 'mvp') ?? '').length).toBeLessThanOrEqual(40);
    }
  });

  it('closing the cargo panel commits its discards', () => {
    const w = newWorld();
    w.pod.cargo.push(copper);
    const { app } = makeApp(w);
    app.openSheet('cargo');
    w.discardCargo(copper, 1);
    expect(w.discardsPending).toBe(1);
    app.closeSheet();
    expect(w.discardsPending).toBe(0);
  });
});

describe('Assists as intent shaping (01 §6.4)', () => {
  it('stickForThrust inverts the canon thrust curve', () => {
    for (const st of [0.1, 0.4, 0.75, 1]) expect(thrustInput({ ...NO_INTENT, sy: stickForThrust(st) })).toBeCloseTo(st, 9);
    expect(stickForThrust(0)).toBe(0);
  });

  it('Landing Assist only acts with the stick neutral while falling faster than 5.5 tiles/s', () => {
    const w = newWorld();
    const p = w.pod;
    p.grounded = false;
    p.y = 10;
    p.vy = -8;
    expect(landingAssistThrust(p, NO_INTENT)).toBeGreaterThan(0);
    expect(landingAssistThrust(p, { ...NO_INTENT, sx: 0.5 })).toBe(0);
    expect(landingAssistThrust(p, { ...NO_INTENT, thrust: true })).toBe(0);
    p.vy = -5;
    expect(landingAssistThrust(p, NO_INTENT)).toBe(0);
    p.vy = -8;
    p.grounded = true;
    expect(landingAssistThrust(p, NO_INTENT)).toBe(0);
  });

  it('a long fall with Landing Assist lands softly; without it, it hurts', () => {
    const fall = (landingAssist: boolean) => {
      const w = newWorld();
      standOnRim(w, 20.5);
      const { step } = makeApp(w, { landingAssist });
      step(240, { ...NO_INTENT, thrust: true }); // climb well into the sky
      w.pod.vy = 0;
      let vMin = 0;
      const ev: GameEvent[] = [];
      for (let i = 0; i < 900 && !(w.pod.grounded && i > 5); i++) {
        ev.push(...step(1));
        vMin = Math.min(vMin, w.pod.vy);
      }
      return { vMin, damage: ev.filter((e) => e.t === 'damage').length, grounded: w.pod.grounded };
    };
    const off = fall(false);
    const on = fall(true);
    expect(off.damage).toBe(1);
    expect(on.grounded).toBe(true);
    expect(on.damage).toBe(0);
    expect(on.vMin).toBeGreaterThan(-LANDING_ASSIST_V - 0.25);
  });

  it('Steady Drill holds the engage gate at 12 steps instead of 7', () => {
    const engage = (steadyDrill: boolean) => {
      const w = newWorld();
      w.debugTeleport(20);
      const { step } = makeApp(w, { steadyDrill });
      step(3);
      for (let n = 1; n <= 30; n++) if (step(1, { ...NO_INTENT, sy: -1 }).some((e) => e.t === 'dig-start')) return n;
      return -1;
    };
    expect(engage(false)).toBe(7);
    expect(engage(true)).toBe(STEADY_DRILL_ENGAGE_STEPS);
  });

  it('applyAssists copies the intent into a reused object and never touches the input', () => {
    const w = newWorld();
    const raw: PodIntent = { sx: 0.2, sy: -1, thrust: false, fireSlot: 2 };
    const out: PodIntent = { ...NO_INTENT };
    expect(applyAssists(w.pod, raw, { landingAssist: false, steadyDrill: true }, out)).toBe(out);
    expect(out).toEqual({ ...raw, digEngage: STEADY_DRILL_ENGAGE_STEPS });
    expect(raw.digEngage).toBeUndefined();
    applyAssists(w.pod, raw, { landingAssist: false, steadyDrill: false }, out);
    expect(out.digEngage).toBeUndefined();
  });
});

describe('Debug previews and the style-test bookmarks (INT-18; 03 §9.4)', () => {
  it('the upright preview clears itself and asks for the resume tap', () => {
    const { app, advance } = makeApp(newWorld());
    app.previewOverlay('upright');
    expect(app.state.overlay.value).toBe('upright');
    advance(UPRIGHT_PREVIEW_MS + 50);
    app.tick(UPRIGHT_PREVIEW_MS + 50, UPRIGHT_PREVIEW_MS + 50);
    expect(app.state.overlay.value).toBe('interrupt');
    app.resume();
    expect(app.state.overlay.value).toBeNull();
  });

  it('a bookmark replaces the live view until the style test closes; world taps are off meanwhile', () => {
    const view = { world: newWorld('m0'), mode: 'play' } as StyleView;
    const styleView = vi.fn(() => view);
    const w = newWorld();
    const { app } = makeApp(w, {}, { styleView });
    app.openSheet('styletest');
    app.styleBookmark(3);
    expect(styleView).toHaveBeenCalledWith(7, 3);
    expect(app.view).toBe(view);
    app.closeSheet();
    expect(app.view).toBeNull();
  });

  it('Play ends the "Paste save" offer', () => {
    const w = newWorld();
    const { app } = makeApp(w, {}, { importOffer: true });
    expect(app.state.importOffer.value).toBe(false); // makeApp pressed Play
  });
});
