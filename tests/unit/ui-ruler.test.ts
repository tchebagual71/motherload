// Depth ruler in build mode (03 §4.11 "Build: the hit strip shrinks to the rail; dragging scrubs the camera (to
// discovered rows + 4)"; §4.12 MVP "ruler scrub"): the rail clears the dock band and the build controls on its side,
// and a drag on it moves the real build session's Mine camera through the session's own pan.
import { signal } from '@preact/signals';
import { h, render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/app/settings';
import type { AppController, AppState, Mode, Settings } from '../../src/app/types';
import type { Cell, Plane } from '../../src/factory/api';
import type { BuildCamera, BuildRendererApi } from '../../src/render/api';
import { MVP_SEAL_ROW } from '../../src/shared/canon';
import { BuildSession } from '../../src/ui/build/session';
import { DOCK_H, TRAY_H } from '../../src/ui/build/tools';
import { Ruler } from '../../src/ui/map/Ruler';
import { BUILD_CHIP_STACK, BUILD_SIDE_STACK, RULER_RAIL, buildRulerGeometry, railToRow, rowToRail, rulerGeometry, type RulerSettings } from '../../src/ui/map/rulerLayout';
import { scrubBuildCamera, scrubLimit } from '../../src/ui/map/rulerScrub';
import type { Viewport } from '../../src/ui/viewport';
import { World } from '../../src/world/world';
import { flush, installFakeDom, pointer, type FakeDom, type FakeElement } from './ui-dom.helpers';

const SE: Viewport = { w: 375, h: 667, it: 20, ib: 0, il: 0, ir: 0 };
const P15: Viewport = { w: 393, h: 852, it: 59, ib: 34, il: 0, ir: 0 };
const base: RulerSettings = { controlSize: 'M', thrustButton: false, leftHanded: false, oneHanded: false };

/** 30 px per cell, fixed (the camera is not modelled): enough for the session's local projection. */
const P = 30;
class FakeRenderer implements BuildRendererApi {
  readonly cams: (BuildCamera | null)[] = [];
  setBuildCamera(cam: BuildCamera | null): void {
    this.cams.push(cam);
  }
  screenToYardCell(px: number, py: number): Cell | null {
    return { x: Math.floor(px / P), y: Math.floor((1000 - py) / P) };
  }
  screenToMineCell(px: number, py: number): Cell | null {
    return { x: Math.floor(px / P), y: Math.floor((py - 100) / P) };
  }
  cellToScreen(plane: Plane, x: number, y: number): { x: number; y: number } {
    return plane === 'yard' ? { x: (x + 0.5) * P, y: 1000 - (y + 0.5) * P } : { x: (x + 0.5) * P, y: 100 + (y + 0.5) * P };
  }
  pickEntity(): number | null {
    return null;
  }
}

function rig(deepestRow = 60) {
  const world = new World({ seed: 7, scope: 'mvp' });
  world.story.deepestRow = deepestRow;
  const state = {
    settings: signal<Settings>(defaultSettings(393, 852)),
    buildFrame: signal(null),
    mode: signal<Mode>('play'),
    hudTick: signal(0),
    sheet: signal(null),
  } as unknown as AppState;
  const holder: { s: BuildSession | null } = { s: null };
  const app = {
    state,
    world,
    toast: () => {},
    afterAction: () => {},
    openSheet: (id: string) => ((state.sheet as unknown as { value: string }).value = id),
    enterBuild: () => {
      state.mode.value = 'build';
      holder.s?.begin();
    },
  } as unknown as AppController;
  const renderer = new FakeRenderer();
  const s = new BuildSession({ app, renderer: () => renderer, area: () => ({ x0: 0, y0: 64, x1: 393, y1: 600 }) });
  holder.s = s;
  return { world, app, s, renderer };
}

describe('build-mode ruler geometry (03 §4.11)', () => {
  it('is rail-wide and ends above the dock band and the chip stack on its side', () => {
    for (const v of [SE, P15]) {
      const g = buildRulerGeometry(v, base);
      const dockTop = v.h - v.ib - TRAY_H - DOCK_H;
      expect(g.hitX1 - g.hitX0).toBe(RULER_RAIL);
      expect(g.side).toBe('right');
      expect(g.top).toBe(rulerGeometry(v, base).top);
      expect(g.bottom).toBeLessThanOrEqual(dockTop - BUILD_CHIP_STACK);
      expect(g.bottom - g.top).toBeGreaterThan(200);
    }
    // One-handed puts the rail on the non-dominant side, over the zoom stack: it ends above that instead.
    const one = buildRulerGeometry(P15, { ...base, oneHanded: true });
    expect(one.side).toBe('left');
    expect(one.bottom).toBeLessThanOrEqual(P15.h - P15.ib - TRAY_H - DOCK_H - BUILD_SIDE_STACK);
  });

  it('maps rail y back to the row (the inverse of rowToRail), clamped to the rail', () => {
    for (const row of [0, 40, 160, MVP_SEAL_ROW]) expect(railToRow(rowToRail(row, MVP_SEAL_ROW, 100, 420), MVP_SEAL_ROW, 100, 420)).toBeCloseTo(row, 9);
    expect(railToRow(50, MVP_SEAL_ROW, 100, 420)).toBe(0);
    expect(railToRow(900, MVP_SEAL_ROW, 100, 420)).toBe(MVP_SEAL_ROW);
  });
});

describe('ruler scrub through the build session (03 §4.11)', () => {
  it('switches the Yard view to the Mine and centres the camera on the row, to the discovered rows + 4', () => {
    const { app, s } = rig(60);
    expect(scrubBuildCamera(s, 30, 60)).toBeNull(); // not in build mode
    app.enterBuild();
    expect(s.plane).toBe('yard');
    expect(scrubBuildCamera(s, 30, 60)).toBe(30);
    expect(s.plane).toBe('mine');
    expect(s.cam.cy).toBeCloseTo(30, 9);
    expect(scrubBuildCamera(s, 12, 60)).toBe(12);
    expect(s.cam.cy).toBeCloseTo(12, 9);
    // Below what has been seen: the scrub stops at the discovered rows + 4 (and so does the session's own clamp).
    expect(scrubLimit(60)).toBe(64);
    expect(scrubBuildCamera(s, 300, 60)).toBe(64);
    expect(s.cam.cy).toBeCloseTo(64, 9);
    expect(scrubBuildCamera(s, -5, 60)).toBe(0);
    expect(s.cam.cy).toBeCloseTo(0, 9);
  });
});

describe('ruler component in build mode', () => {
  let dom: FakeDom | null = null;
  afterEach(async () => {
    if (!dom) return;
    await flush(() => render(null, dom!.root as unknown as HTMLElement));
    dom.restore();
    dom = null;
  });

  it('a drag on the rail scrubs the Mine camera and moves the view bracket; a tap never opens the map', async () => {
    dom = installFakeDom();
    const { app, s } = rig(200);
    const vp = signal<Viewport>(P15);
    app.enterBuild();
    await flush(() => render(h(Ruler, { app, vp, build: s }), dom!.root as unknown as HTMLElement));
    const el = dom.root.querySelector('.hf-ruler') as FakeElement;
    expect(el.getAttribute('aria-label')).toMatch(/Drag to move the view/);
    const g = buildRulerGeometry(P15, app.state.settings.value);
    el.rect = { left: g.hitX0, top: g.top, width: RULER_RAIL, height: g.bottom - g.top };
    const yOf = (row: number) => rowToRail(row, MVP_SEAL_ROW, g.top, g.bottom);
    await pointer(el, 'pointerdown', { pointerId: 4, x: g.railX0 + 12, y: yOf(80) });
    expect(s.plane).toBe('mine');
    expect(s.cam.cy).toBeCloseTo(80, 6);
    await pointer(el, 'pointermove', { pointerId: 4, x: g.railX0 + 12, y: yOf(150) });
    expect(s.cam.cy).toBeCloseTo(150, 6);
    await pointer(el, 'pointerup', { pointerId: 4, x: g.railX0 + 12, y: yOf(150) });
    await pointer(el, 'pointermove', { pointerId: 4, x: g.railX0 + 12, y: yOf(20) }); // released: no scrub
    expect(s.cam.cy).toBeCloseTo(150, 6);
    await flush();
    const bracket = dom.root.querySelector('.hf-ruler-view') as FakeElement;
    expect(bracket).not.toBeNull();
    expect((bracket.style as unknown as { top: string }).top).toBe(`${(150 / MVP_SEAL_ROW) * 100}%`);
    await flush(() => el.click());
    expect(app.state.sheet.peek()).toBeNull();
  });
});
