// A save written during the 3 s death card (pod destroyed, not yet respawned) must load into a playable
// game: the real World driven through the real GameApp, as the loop does (canon §4.2, §4.5; 04 §4.12–4.13).
import { describe, expect, it, vi } from 'vitest';
import { GameApp, type ControllerOptions } from '../../src/app/controller';
import { defaultSettings } from '../../src/app/settings';
import type { InputController } from '../../src/app/types';
import { NO_INTENT, type PodIntent } from '../../src/pod/types';
import { START_CASH, STEP_HZ } from '../../src/shared/canon';
import type { WorldApi } from '../../src/world/api';
import { World } from '../../src/world/world';

const UP: PodIntent = { ...NO_INTENT, sy: 1 };
const FRAME_MS = 1_000 / STEP_HZ;

/** Seed 7: thrust until the tank runs dry mid-air, then serialize the wreck (what beginDeath's save writes). */
function wreckBytes(): Uint8Array {
  const w = new World({ seed: 7, scope: 'm0' });
  w.pod.fuel = 0.3;
  for (let i = 0; i < 3_000 && !w.pod.destroyed; i++) w.step(UP, true);
  expect(w.pod.destroyed).toBe(true);
  expect(w.pod.grounded).toBe(false);
  return w.serialize();
}

function makeApp(world: WorldApi, coldLoad: boolean) {
  let now = 0;
  const opts: ControllerOptions = {
    world,
    worlds: { create: (seed) => new World({ seed, scope: 'm0' }), deserialize: (b) => World.deserialize(b) },
    codes: { encode: () => 'HF1:x', decode: (c) => ({ ok: true, bytes: Uint8Array.from(c.slice(4).split(',').map(Number)) }) },
    settings: defaultSettings(393, 852),
    look: 'toon',
    settingsStore: { loadSettings: vi.fn(), saveSettings: vi.fn(), loadLook: vi.fn(), saveLook: vi.fn() } as unknown as ControllerOptions['settingsStore'],
    styleTest: true,
    standalone: true,
    canInstall: false,
    coldLoad,
    resolveQuality: () => 'low',
    now: () => now,
    randomSeed: () => 7,
  };
  const app = new GameApp(opts);
  app.attachSaves({ markDirty: vi.fn(), requestSoon: vi.fn(), critical: vi.fn(() => null), setEnabled: vi.fn() });
  app.attachInput({ releaseAll: vi.fn(), sampleIntent: vi.fn(), touching: false, active: false, dispose: vi.fn() } as unknown as InputController);
  /** Loop frames at 60 Hz: tick, one step (with `intent` while the pod runs), events to the app. */
  const frames = (n: number, intent: PodIntent = NO_INTENT) => {
    for (let i = 0; i < n; i++) {
      now += FRAME_MS;
      app.tick(FRAME_MS, now);
      const running = app.podRunning();
      app.world.step(running ? intent : NO_INTENT, running);
      app.handleEvents(app.world.drainEvents());
    }
  };
  return { app, frames };
}

function expectSalvaged(app: GameApp): void {
  const w = app.world;
  expect(w.pod.destroyed).toBe(false);
  expect(w.padUnderPod()).toBe('pump');
  expect(w.pod.fuel).toBe(w.stats().maxFuel);
  expect(w.wallet).toMatchObject({ cash: 0, debt: 25 - START_CASH }); // the $25 fee was charged
  expect(app.state.overlay.value).toBeNull();
  expect(app.podRunning()).toBe(true);
}

describe('a save made during the death card', () => {
  it('cold-loads into the death card after Play, then salvages and respawns on the Pump House pad', () => {
    const { app, frames } = makeApp(World.deserialize(wreckBytes()), true);
    frames(120); // behind the title: no death, no fee
    expect(app.world.pod.destroyed).toBe(true);
    expect(app.world.wallet.cash).toBe(START_CASH);
    app.start();
    app.resume();
    frames(2 * STEP_HZ, UP); // past the airborne 1.5 s countdown; the stick does nothing to a wreck
    expect(app.state.death.value).toMatchObject({ cause: 'fuel', fee: 25 });
    frames(4 * STEP_HZ);
    expectSalvaged(app);
  });

  it('an imported code of that save does the same after the resume tap', async () => {
    const { app, frames } = makeApp(new World({ seed: 7, scope: 'm0' }), false);
    app.start();
    frames(10);
    const r = await app.importSave(`HF1:${Array.from(wreckBytes()).join(',')}`);
    expect(r).toMatchObject({ ok: true });
    expect(app.world.pod.destroyed).toBe(true);
    app.resume();
    frames(2 * STEP_HZ, UP);
    expect(app.state.death.value).toMatchObject({ cause: 'fuel', fee: 25 });
    frames(4 * STEP_HZ);
    expectSalvaged(app);
  });
});
