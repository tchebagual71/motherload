// Build-mode screen rendered through Preact into the fake DOM (ui-dom.helpers.ts) on a real MVP World (seed 7:
// the rusted survey Headframe, Smelter and Bin stand in the Yard). Review round 2: RENDER-4 (the ◫ overlay drew a
// second, disagreeing set of DOM status bubbles over the renderer's 3D ones) and PLAYER-5 (one tap on Deconstruct
// removed the free survey set for a $0 refund).
import { signal } from '@preact/signals';
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/app/settings';
import type { AppController, AppState, Mode, Settings } from '../../src/app/types';
import { BUILDINGS, type BuildingKind, type Cell, type EntStatus, type Plane } from '../../src/factory/api';
import type { BuildCamera, BuildFrame, BuildRendererApi } from '../../src/render/api';
import { BUBBLE_GLYPH, BUBBLE_TEXT, statusGlyph } from '../../src/render/factory/status';
import { BuildLayer } from '../../src/ui/build/BuildLayer';
import { InspectSheet, statusLine } from '../../src/ui/build/Inspect';
import { BuildSession } from '../../src/ui/build/session';
import { BUBBLE_SAY } from '../../src/ui/build/tools';
import type { Viewport } from '../../src/ui/viewport';
import { World } from '../../src/world/world';
import { flush, installFakeDom, text, type FakeDom, type FakeElement } from './ui-dom.helpers';

/** 30 px per cell; the survey set's Yard rows 1–8 land inside the world area (y 64–483). */
const P = 30;
const renderer: BuildRendererApi = {
  setBuildCamera: (_cam: BuildCamera | null) => undefined,
  screenToYardCell: (px: number, py: number): Cell | null => ({ x: Math.floor(px / P), y: Math.floor((400 - py) / P) }),
  screenToMineCell: (px: number, py: number): Cell | null => ({ x: Math.floor(px / P), y: Math.floor((py - 100) / P) }),
  cellToScreen: (plane: Plane, x: number, y: number) => (plane === 'yard' ? { x: (x + 0.5) * P, y: 400 - (y + 0.5) * P } : { x: (x + 0.5) * P, y: 100 + (y + 0.5) * P }),
  pickEntity: () => null,
};

function rig() {
  const world = new World({ seed: 7, scope: 'mvp' });
  world.factory!.unlockRung('U2');
  world.debugGiveCash(4980); // $5,000
  const state = {
    settings: signal<Settings>(defaultSettings(375, 667)),
    buildFrame: signal<BuildFrame | null>(null),
    mode: signal<Mode>('play'),
    hudTick: signal(0),
    toasts: signal([]),
    goal: signal(null),
  } as unknown as AppState;
  const holder: { s: BuildSession | null } = { s: null };
  const app = {
    state,
    world,
    toast: () => undefined,
    afterAction: () => undefined,
    enterBuild: () => {
      state.mode.value = 'build';
      holder.s?.begin();
    },
    exitBuild: () => {
      holder.s?.end();
      state.mode.value = 'play';
    },
    updateSettings: (p: Partial<Settings>) => {
      state.settings.value = { ...state.settings.value, ...p };
    },
  } as unknown as AppController;
  const s = new BuildSession({ app, renderer: () => renderer, area: () => ({ x0: 0, y0: 64, x1: 375, y1: 483 }) });
  holder.s = s;
  const vp = signal<Viewport>({ w: 375, h: 667, it: 20, ib: 0, il: 0, ir: 0 });
  return { world, f: world.factory!, s, app, state, vp };
}

let dom: FakeDom;
let now = 10_000;

beforeEach(() => {
  dom = installFakeDom();
  now = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(async () => {
  await flush(() => render(null, dom.root as unknown as HTMLElement));
  dom.restore();
  vi.restoreAllMocks();
});

const button = (label: string): FakeElement | undefined => dom.root.querySelectorAll('button').find((b) => text(b) === label);

describe('Inspect → Deconstruct (PLAYER-5)', () => {
  it('asks before removing the free rusted survey set, stating the rebuild price; Keep it backs out', async () => {
    const r = rig();
    r.app.enterBuild();
    const hf = r.f.entities().find((e) => e.kind === 'headframe' && e.rusted)!;
    r.s.openInspect(hf.id);
    await flush(() => render(h(InspectSheet, { app: r.app, build: r.s }), dom.root as unknown as HTMLElement));
    now += 1000;
    await flush(() => button('Deconstruct')!.click());
    expect(r.f.entity(hf.id)).not.toBeNull(); // one tap did not remove it
    expect(text(dom.root.querySelector('.hf-inspect-q'))).toBe('Remove survey Headframe? Rebuilding costs $200');
    expect(dom.root.querySelector('.hf-inspect-q')!.getAttribute('role')).toBe('alert');
    expect(button('Deconstruct')).toBeUndefined();
    // A double tap does not answer its own question.
    await flush(() => button('Remove')!.click());
    expect(r.f.entity(hf.id)).not.toBeNull();
    await flush(() => button('Keep it')!.click());
    expect(dom.root.querySelector('.hf-inspect-q')).toBeNull();
    expect(button('Deconstruct')).toBeDefined();
    // Ask again, then confirm.
    await flush(() => button('Deconstruct')!.click());
    now += 1000;
    await flush(() => button('Remove')!.click());
    expect(r.f.entity(hf.id)).toBeNull();
  });

  it('removes a building bought at full price in one tap (its refund covers the rebuild)', async () => {
    const r = rig();
    r.app.enterBuild();
    const placed = r.f.place('bin', 1, 20, 5, 0);
    expect(placed.ok).toBe(true);
    const bin = r.f.entities().find((e) => e.kind === 'bin' && !e.rusted)!;
    r.s.openInspect(bin.id);
    await flush(() => render(h(InspectSheet, { app: r.app, build: r.s }), dom.root as unknown as HTMLElement));
    now += 1000;
    await flush(() => button('Deconstruct')!.click());
    expect(r.f.entity(bin.id)).toBeNull();
    expect(dom.root.querySelector('.hf-inspect-q')).toBeNull();
  });
});

describe('◫ Logistics overlay (RENDER-4)', () => {
  it('draws no DOM status bubbles over the 3D ones; its screen-reader list uses the renderer’s glyph table', async () => {
    const r = rig();
    r.app.enterBuild();
    expect(r.s.plane).toBe('yard');
    await flush(() => render(h(BuildLayer, { app: r.app, build: r.s, vp: r.vp }), dom.root as unknown as HTMLElement));
    expect(dom.root.querySelector('.hf-status-list')).toBeNull();
    now += 1000;
    const toggle = dom.root.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'Logistics overlay (O)')!;
    await flush(() => toggle.click());
    expect(r.s.overlay).toBe(true);
    expect(r.state.buildFrame.value?.overlay).toBe('logistics'); // the renderer draws the bubbles and jam heads
    expect(dom.root.querySelectorAll('.hf-bubble')).toHaveLength(0);
    const list = dom.root.querySelector('.hf-status-list')!;
    expect(list.getAttribute('class')).toContain('hf-sr');
    // One line per building that wears a 3D bubble, in the bubble's words.
    const want = r.f
      .entities()
      .filter((e) => e.plane === 'yard' && statusGlyph(e.kind, e.status) !== -1)
      .map((e) => BUBBLE_SAY[statusGlyph(e.kind, e.status) as 0]);
    const items = list.querySelectorAll('li').map((li) => text(li));
    expect(items.map((t) => t.split(': ')[1]).sort()).toEqual(want.sort());
    // The survey Smelter starts with nothing to smelt: the 3D bubble shows ○, the list says "no input".
    const smelter = r.f.entities().find((e) => e.kind === 'smelter')!;
    expect(BUBBLE_TEXT[statusGlyph(smelter.kind, smelter.status) as 0]).toBe('○');
    expect(items).toContain('Smelter: no input');
    expect(items.some((t) => t.startsWith('Storage Bin') || t.startsWith('Headframe:'))).toBe(false); // idle by design
  });
});

describe('the Inspect status line agrees with the bubble (RENDER-4)', () => {
  it('says what the 3D bubble shows, and plain "Idle" where idling is normal', () => {
    const say: Record<number, RegExp> = {
      [BUBBLE_GLYPH.NO_INPUT]: /waiting for input/,
      [BUBBLE_GLYPH.FULL]: /output full/,
      [BUBBLE_GLYPH.NO_RECIPE]: /recipe/,
      [BUBBLE_GLYPH.DISCONNECTED]: /^Disconnected/,
    };
    const statuses: EntStatus[] = ['working', 'idle', 'blocked', 'noRecipe', 'noOutput'];
    for (const kind of Object.keys(BUILDINGS) as BuildingKind[]) {
      for (const st of statuses) {
        const g = statusGlyph(kind, st);
        if (g !== -1) expect(statusLine(kind, st), `${kind} ${st}`).toMatch(say[g]);
      }
    }
    expect(statusLine('headframe', 'idle')).toBe('Idle');
    expect(statusLine('bin', 'idle')).toBe('Idle');
    expect(statusLine('smelter', 'idle')).toBe('Idle: waiting for input');
    expect(statusLine('smelter', 'noOutput')).toBe('Disconnected: nothing takes its output'); // was "Output full" (▣ vs ⛓)
    expect(statusLine('smelter', 'working')).toBe('Working');
  });
});
