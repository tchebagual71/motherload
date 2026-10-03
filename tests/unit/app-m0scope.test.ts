// INT-16: the M0 build's own features, with the build scope forced to 'm0' (the suite otherwise runs the default
// mvp scope, vite.config.ts). Covers the sim (r128 floor, Hardrock/Magma strip, no Co-op Credit), the app (fresh
// and loaded claims play M0; no sign tap) and the UI gates (no Cargo item, MVP settings rows hidden, the look test
// kept, no Return Tick, no Cargo context).
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/scope', () => {
  const ORDER = { m0: 0, mvp: 1, v1: 2 } as const;
  return {
    SCOPE: 'm0',
    inScope: (tier: keyof typeof ORDER, current: keyof typeof ORDER = 'm0') => ORDER[current] >= ORDER[tier],
  };
});

import { worlds } from '../../src/app/bootWorld';
import { GameApp } from '../../src/app/controller';
import { refusalNotice } from '../../src/app/notices';
import { defaultSettings } from '../../src/app/settings';
import type { InputController } from '../../src/app/types';
import { NO_INTENT } from '../../src/pod/types';
import { M0_FLOOR_ROW } from '../../src/shared/canon';
import { T } from '../../src/shared/types';
import { M0_DEBUG_STRIP } from '../../src/terrain/scope';
import { cargoContext } from '../../src/ui/context';
import { createFakeApp, type FakeApp } from '../../src/ui/fakes';
import { SheetHost } from '../../src/ui/SheetHost';
import { World } from '../../src/world/world';
import { flush, installFakeDom, text, type FakeDom } from './ui-dom.helpers';

describe('M0 scope in the sim', () => {
  it('fresh and loaded claims play the build scope: M0 (INT-6)', () => {
    const fresh = worlds.create(7);
    expect(fresh.scope).toBe('m0');
    expect(worlds.deserialize(new World({ seed: 7, scope: 'm0' }).serialize()).scope).toBe('m0');
    // An MVP save cannot load into an M0 build.
    expect(() => worlds.deserialize(new World({ seed: 7, scope: 'mvp' }).serialize())).toThrow();
  });

  it('digging stops at the r128 test floor with the M0 notice', () => {
    const w = new World({ seed: 7, scope: 'm0' });
    w.debugTeleport(M0_FLOOR_ROW + 50);
    expect(w.pod.row).toBe(M0_FLOOR_ROW - 1);
    const ev = [];
    for (let i = 0; i < 30; i++) {
      w.step({ ...NO_INTENT, sy: -1 }, true);
      ev.push(...w.drainEvents());
    }
    const refused = ev.filter((e) => e.t === 'dig-refused');
    expect(refused.map((e) => e.t === 'dig-refused' && e.reason)).toEqual(['floor']);
    expect(w.pod.row).toBe(M0_FLOOR_ROW - 1);
    expect(refusalNotice('floor', w.scope)).toBe('Test floor: the M0 dig ends here');
  });

  it('carries the Hardrock/Magma debug strip; an MVP claim does not', () => {
    const count = (w: World) => {
      const s = M0_DEBUG_STRIP;
      let n = 0;
      for (let r = s.top; r <= s.bottom; r++) for (let x = s.x0; x <= s.x1; x++) if (w.terrain.get(x, r) === T.HARDROCK || w.terrain.get(x, r) === T.MAGMA) n++;
      return n;
    };
    expect(count(new World({ seed: 7, scope: 'm0' }))).toBeGreaterThan(60);
    expect(count(new World({ seed: 7, scope: 'mvp' }))).toBeLessThan(count(new World({ seed: 7, scope: 'm0' })) / 4);
  });
});

describe('M0 scope in the app', () => {
  it('a sign tap does nothing (MVP row), even grounded on the Rim', () => {
    const world = worlds.create(7);
    const input = { releaseAll: vi.fn(), sampleIntent: vi.fn(), touching: false, active: false, dispose: vi.fn() } as unknown as InputController;
    const app = new GameApp({
      world,
      worlds,
      codes: { encode: () => 'HF1:x', decode: () => ({ ok: false, reason: 'nope' }) },
      settings: defaultSettings(393, 852),
      look: 'toon',
      settingsStore: { loadSettings: vi.fn(), saveSettings: vi.fn(), loadLook: vi.fn(), saveLook: vi.fn() },
      styleTest: true,
      standalone: true,
      canInstall: false,
      coldLoad: false,
      resolveQuality: () => 'mid',
      now: () => 0,
      randomSeed: () => 1,
    });
    app.attachInput(input);
    app.start();
    expect(world.onRim()).toBe(true);
    app.signTap('garage');
    expect(app.driveTarget).toBeNull();
    expect(app.state.sheet.value).toBeNull();
    expect(app.state.toasts.value).toEqual([]);
  });
});

describe('M0 scope in the UI', () => {
  let dom: FakeDom;
  let app: FakeApp;
  beforeEach(() => {
    dom = installFakeDom();
    app = createFakeApp({ scope: 'm0', look: 'toon', styleTest: true });
  });
  afterEach(async () => {
    await flush(() => render(null, dom.root as unknown as HTMLElement));
    dom.restore();
  });
  const open = async (id: 'menu' | 'settings') => {
    app.state.sheet.value = id;
    await flush(() => render(h(SheetHost, { app }), dom.root as unknown as HTMLElement));
  };

  it('the menu has no Cargo item and names the M0 build', async () => {
    await open('menu');
    const labels = dom.root.querySelectorAll('.hf-menu button').map((b) => text(b));
    expect(labels.some((l) => l.startsWith('Cargo'))).toBe(false);
    expect(labels.some((l) => l.startsWith('Settings'))).toBe(true);
    expect(text(dom.root.querySelector('.hf-version'))).toMatch(/M0$/);
  });

  it('Settings hides the MVP rows and keeps About: Perf Report, jetsam probe, Look test', async () => {
    await open('settings');
    const body = text(dom.root.querySelector('.hf-sheet'));
    for (const mvpRow of ['Text size', 'One-handed', 'THRUST works by', 'Landing Assist', 'Steady Drill', 'Return Tick']) expect(body).not.toContain(mvpRow);
    for (const kept of ['Left-handed', 'THRUST button', 'Copy Perf Report', 'Jetsam probe', 'Look test']) expect(body).toContain(kept);
  });

  it('no Cargo context: the cargo panel is MVP', () => {
    for (let i = 0; i < 30; i++) app.world.pod.cargo.push({ kind: 'mineral', tier: 9 });
    expect(app.world.stats().cargoMass).toBeGreaterThan(app.world.stats().hoverCap);
    expect(cargoContext(app, { now: 0, idleMs: 0 })).toBeNull();
  });
});
