// Build session (03 §4; 02 §2) on a real MVP World (seed 7: survey column 26, Headframe x 26–27 rows 1–2, Smelter
// rows 4–5, Bin rows 7–8; scripted Copper lode at x 27, top 46) with a linear fake renderer for picking.
import { signal } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/app/settings';
import type { AppController, AppState, Mode, Settings } from '../../src/app/types';
import { DIR, type Cell, type Plane } from '../../src/factory/api';
import type { BuildCamera, BuildFrame, BuildRendererApi } from '../../src/render/api';
import { T, F } from '../../src/shared/types';
import { BuildSession } from '../../src/ui/build/session';
import { World } from '../../src/world/world';
import type { Result } from '../../src/world/api';

/** 30 px per cell. Yard: x right, rows up-screen; mine: x right, rows down-screen. */
const P = 30;
class FakeRenderer implements BuildRendererApi {
  readonly cams: (BuildCamera | null)[] = [];
  setBuildCamera(cam: BuildCamera | null): void {
    this.cams.push(cam);
  }
  screenToYardCell(px: number, py: number): Cell | null {
    const x = Math.floor(px / P);
    const y = Math.floor((1000 - py) / P);
    return x >= 0 && x < 48 && y >= 1 && y <= 32 ? { x, y } : null;
  }
  screenToMineCell(px: number, py: number): Cell | null {
    const x = Math.floor(px / P);
    const y = Math.floor((py - 100) / P);
    return x >= 0 && x < 48 && y >= 0 ? { x, y } : null;
  }
  cellToScreen(plane: Plane, x: number, y: number): { x: number; y: number } {
    return plane === 'yard' ? { x: (x + 0.5) * P, y: 1000 - (y + 0.5) * P } : { x: (x + 0.5) * P, y: 100 + (y + 0.5) * P };
  }
  pickEntity(): number | null {
    return null;
  }
}

function rig(patch: Partial<Settings> = {}) {
  const world = new World({ seed: 7, scope: 'mvp' });
  const f = world.factory!;
  f.unlockRung('U2');
  world.debugGiveCash(4980); // $5,000
  const toasts: string[] = [];
  const saved: Result[] = [];
  const state = {
    settings: signal<Settings>({ ...defaultSettings(375, 667), ...patch }),
    buildFrame: signal<BuildFrame | null>(null),
    mode: signal<Mode>('play'),
  } as unknown as AppState;
  const renderer = new FakeRenderer();
  const holder: { s: BuildSession | null } = { s: null };
  const app = {
    state,
    world,
    toast: (t: string) => toasts.push(t),
    afterAction: (r: Result) => {
      saved.push(r);
      if (!r.ok) toasts.push(r.reason);
    },
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
  const at = (plane: Plane, x: number, y: number) => renderer.cellToScreen(plane, x, y);
  const yard = (x: number, y: number) => at('yard', x, y);
  const mine = (x: number, y: number) => at('mine', x, y);
  const belts = (plane: Plane = 'yard') => Array.from(f.beltWords(plane)).filter((w) => w !== 0).length;
  return { world, f, s, app, state, toasts, saved, renderer, yard, mine, belts };
}

function tapAt(s: BuildSession, p: { x: number; y: number }): void {
  s.tap(p.x, p.y);
}
function stroke(s: BuildSession, pts: { x: number; y: number }[]): void {
  s.strokeStart(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) s.strokeMove(p.x, p.y);
  s.strokeEnd();
}

describe('build session: entering, the camera and the frame', () => {
  it('opens on the Yard from the Rim, centred on a nearby Headframe, and writes the build frame', () => {
    const r = rig();
    (r.world.pod as { x: number }).x = 24;
    r.app.enterBuild();
    expect(r.s.active).toBe(true);
    expect(r.s.plane).toBe('yard');
    expect(r.renderer.cams.at(-1)).toEqual({ plane: 'yard', cx: 27, cy: 4, ppu: 39, yaw: 0 });
    expect(r.state.buildFrame.value).toEqual({ plane: 'yard', cursor: null, preview: null, bulldoze: false, selectedId: null, overlay: null, tool: null });
    r.app.exitBuild();
    expect(r.s.active).toBe(false);
    expect(r.state.buildFrame.value).toBeNull();
  });

  it('re-entering frames the pod afresh, keeping only the zoom and yaw (BUILD-2)', () => {
    const r = rig();
    const pod = r.world.pod as { x: number };
    pod.x = 24;
    r.app.enterBuild();
    expect(r.s.cam).toMatchObject({ cx: 27, cy: 4 });
    r.s.zoomIn();
    r.s.yawStep(1);
    const ppu = r.s.cam.ppu;
    r.s.pan(-5 * P, 0);
    r.app.exitBuild();
    // Pip drives 19 columns west, past the Headframe's 12-column reach: the Yard opens on Pip.
    pod.x = 8.6;
    r.app.enterBuild();
    expect(r.s.cam).toMatchObject({ plane: 'yard', cx: 8.6, cy: 4, ppu, yaw: 1 });
    expect(r.renderer.cams.at(-1)).toEqual(r.s.cam);
    // Within one session the [Yard│Mine] swap still returns to where the Yard view was left.
    r.s.pan(-2 * P, 0);
    const yardCam = { ...r.s.cam };
    r.s.setPlane('mine');
    r.s.setPlane('yard');
    expect(r.s.cam).toEqual(yardCam);
  });

  it('the mine opens on the pod every time, wherever it was left (BUILD-2)', () => {
    const r = mineRig();
    (r.world.story as { deepestRow: number }).deepestRow = r.lode.top; // the pan bounds reach the seen rows
    r.app.enterBuild();
    expect(r.s.plane).toBe('mine');
    expect(r.s.cam.cy).toBeCloseTo(-r.world.pod.y, 6);
    r.app.exitBuild();
    r.world.debugTeleport(20);
    r.app.enterBuild();
    expect(r.s.cam).toMatchObject({ plane: 'mine', cx: r.world.pod.x });
    expect(r.s.cam.cy).toBeCloseTo(-r.world.pod.y, 6);
    expect(r.s.cam.cy).toBeLessThan(22);
  });

  it('writes the ◫ overlay and the armed building into the build frame', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('belt');
    expect(r.state.buildFrame.value).toMatchObject({ tool: 'belt', overlay: null });
    r.s.toggleOverlay();
    expect(r.state.buildFrame.value).toMatchObject({ tool: 'belt', overlay: 'logistics' });
    r.s.arm('bulldoze');
    expect(r.state.buildFrame.value).toMatchObject({ tool: null, bulldoze: true, overlay: 'logistics' });
    r.s.toggleOverlay();
    expect(r.state.buildFrame.value?.overlay).toBeNull();
  });

  it('a 1×1 tool eases the Yard zoom to 44 ppu; zoom and yaw stay in range; the mine has no yaw', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('belt');
    expect(r.s.cam.ppu).toBe(44);
    for (let i = 0; i < 10; i++) r.s.zoomIn();
    expect(r.s.cam.ppu).toBe(64);
    for (let i = 0; i < 10; i++) r.s.zoomOut();
    expect(r.s.cam.ppu).toBe(44);
    r.s.yawStep(1);
    r.s.yawStep(1);
    expect(r.s.cam.yaw).toBe(2);
    r.s.setPlane('mine');
    expect(r.s.cam).toMatchObject({ plane: 'mine', ppu: 47 });
    r.s.yawStep(1);
    expect(r.s.cam.yaw).toBe(0);
  });

  it('pans the camera with the finger (inverse of the projection) and pinch-zooms about the fingers', () => {
    const r = rig();
    r.app.enterBuild();
    const c0 = { ...r.s.cam };
    r.s.pan(P, 0); // content right → the view centre moves one cell left
    expect(r.s.cam.cx).toBeCloseTo(c0.cx - 1, 6);
    r.s.pan(0, P); // content down on the Yard (rows run up-screen) → one row farther from the Rim
    expect(r.s.cam.cy).toBeCloseTo(c0.cy + 1, 6);
    const c1 = { ...r.s.cam };
    const fingers = r.yard(c1.cx + 3 - 0.5, c1.cy - 0.5);
    r.s.zoom(1.2, fingers.x, fingers.y);
    expect(r.s.cam.ppu).toBeCloseTo(39 * 1.2, 6);
    // The plane point under the fingers keeps its place: the centre moved toward it by 1 − 1/1.2.
    expect(r.s.cam.cx).toBeCloseTo(c1.cx + 3 * (1 - 1 / 1.2), 6);
  });
});

describe('build session: Yard belts (02 §2.1; 03 §4.4)', () => {
  it('paints a path, snaps its end into the Smelter, confirms, undoes and redoes', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('belt');
    stroke(r.s, [r.yard(25, 2), r.yard(25, 3), r.yard(26, 3)]);
    expect(r.s.pending).toEqual({ t: 'path', cells: [{ x: 25, y: 2 }, { x: 25, y: 3 }, { x: 26, y: 3 }] });
    expect(r.s.error).toBeNull();
    expect(r.s.chip()).toEqual({ text: '$15 · 3 tiles', tone: 'info' });
    const pv = r.state.buildFrame.value?.preview;
    expect(pv).toMatchObject({ kind: 'belt', valid: true, dir: DIR.S });
    expect(pv?.path).toHaveLength(3);
    const cash = r.world.wallet.cash;
    expect(r.s.confirm()).toBe(true);
    expect(r.belts()).toBe(3);
    expect(r.world.wallet.cash).toBe(cash - 15);
    expect(r.s.pending).toBeNull();
    expect(r.s.tool).toBe('belt'); // the tool stays armed for the next stroke
    // The last tile faces into the Smelter's north edge.
    const w = r.f.beltWords('yard')[3 * 48 + 26];
    expect((w >> 10) & 3).toBe(DIR.S);
    r.s.undo();
    expect(r.belts()).toBe(0);
    expect(r.toasts.at(-1)).toBe('Undid: Belt ×3 (+$15)');
    r.s.redo();
    expect(r.belts()).toBe(3);
    expect(r.toasts.at(-1)).toBe('Redid: Belt ×3 (−$15)');
    r.s.redo();
    expect(r.toasts.at(-1)).toBe('Nothing to redo');
  });

  it('repainting belts exactly as they are is no step: ✓ stays off and the undo toasts stay in step (BUILD-5)', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('belt');
    const path = [r.yard(20, 2), r.yard(21, 2), r.yard(22, 2)];
    stroke(r.s, path);
    expect(r.s.confirm()).toBe(true);
    r.s.arm('bin');
    tapAt(r.s, r.yard(23, 5));
    expect(r.s.confirm()).toBe(true);
    r.s.arm('belt');
    stroke(r.s, path);
    expect(r.s.chip()).toEqual({ text: 'Belts already there', tone: 'info' });
    expect(r.s.canConfirm).toBe(false);
    expect(r.s.confirm()).toBe(false);
    // The same cells the other way round do change something.
    stroke(r.s, path.slice().reverse());
    expect(r.s.canConfirm).toBe(true);
    r.s.clear();
    const cash = r.world.wallet.cash;
    r.s.undo();
    expect(r.toasts.at(-1)).toBe('Undid: Storage Bin (+$250)');
    r.s.undo();
    expect(r.toasts.at(-1)).toBe('Undid: Belt ×3 (+$15)');
    expect(r.world.wallet.cash).toBe(cash + 265);
    r.s.redo();
    expect(r.toasts.at(-1)).toBe('Redid: Belt ×3 (−$15)');
  });

  it('picking the recipe a machine already runs is no step (BUILD-5)', () => {
    const r = rig();
    r.f.unlockRung('U3');
    r.app.enterBuild();
    r.s.arm('assembler');
    tapAt(r.s, r.yard(20, 5));
    expect(r.s.confirm()).toBe(true);
    const id = r.f.entities().find((e) => e.kind === 'assembler')!.id;
    r.s.setRecipe(id, 'A1');
    expect(r.f.inspect(id)?.recipe).toBe('A1');
    r.s.setRecipe(id, 'A1');
    r.s.undo();
    expect(r.toasts.at(-1)).toBe('Undid: Recipe A1');
    expect(r.f.inspect(id)?.recipe).toBeNull();
    r.s.undo();
    expect(r.toasts.at(-1)).toBe('Undid: Assembler (+$500)');
    expect(r.f.entity(id)).toBeNull();
  });

  it('L mode draws an L from the stroke start; ⇋ flips its legs', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('belt');
    r.s.toggleLMode();
    r.s.strokeStart(r.yard(20, 2).x, r.yard(20, 2).y);
    r.s.strokeMove(r.yard(22, 4).x, r.yard(22, 4).y);
    expect(r.s.pending).toMatchObject({ cells: [{ x: 20, y: 2 }, { x: 21, y: 2 }, { x: 22, y: 2 }, { x: 22, y: 3 }, { x: 22, y: 4 }] });
    r.s.flipL();
    expect(r.s.pending).toMatchObject({ cells: [{ x: 20, y: 2 }, { x: 20, y: 3 }, { x: 20, y: 4 }, { x: 21, y: 4 }, { x: 22, y: 4 }] });
  });

  it('a path over a building is red with its reason; ✓ refuses it', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('belt');
    stroke(r.s, [r.yard(25, 4), r.yard(26, 4)]);
    expect(r.s.error?.code).toBe('E_OCCUPIED');
    expect(r.s.canConfirm).toBe(false);
    expect(r.state.buildFrame.value?.preview?.valid).toBe(false);
    expect(r.s.chip()).toEqual({ text: "Something's already here", tone: 'bad' });
    expect(r.s.confirm()).toBe(false);
    expect(r.belts()).toBe(0);
  });

  it('a late second finger keeps the stroke; an early one discards it back to the previous ghost', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('belt');
    stroke(r.s, [r.yard(20, 2), r.yard(21, 2)]);
    const before = JSON.stringify(r.s.pending);
    r.s.strokeStart(r.yard(10, 5).x, r.yard(10, 5).y);
    r.s.strokeMove(r.yard(12, 5).x, r.yard(12, 5).y);
    r.s.strokeDiscard();
    expect(JSON.stringify(r.s.pending)).toBe(before);
    r.s.strokeStart(r.yard(10, 5).x, r.yard(10, 5).y);
    r.s.strokeMove(r.yard(12, 5).x, r.yard(12, 5).y);
    r.s.strokeFreeze();
    expect(r.s.pending).toMatchObject({ t: 'path', cells: [{ x: 10, y: 5 }, { x: 11, y: 5 }, { x: 12, y: 5 }] });
  });
});

describe('build session: Yard buildings (03 §4.3)', () => {
  it('drops a ghost at the lifted point, moves it by drag, rotates it and commits on ✓', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('bin');
    tapAt(r.s, r.yard(23, 5));
    expect(r.s.pending).toEqual({ t: 'piece', kind: 'bin', x: 23, y: 5, dir: DIR.S });
    expect(r.s.chip()).toEqual({ text: 'Storage Bin · $250', tone: 'info' });
    // A tap inside the ghost is a drag handle: no move; a drag from inside keeps the grab offset.
    tapAt(r.s, r.yard(24, 6));
    expect(r.s.pending).toMatchObject({ x: 23, y: 5 });
    stroke(r.s, [r.yard(24, 6), r.yard(30, 6)]);
    expect(r.s.pending).toMatchObject({ x: 29, y: 5 });
    r.s.nudge(1, 0);
    r.s.nudge(0, 1);
    r.s.nudge(-1, -1);
    expect(r.s.pending).toMatchObject({ x: 29, y: 5 });
    r.s.rotate();
    expect(r.s.pending).toMatchObject({ dir: DIR.W });
    expect(r.state.buildFrame.value?.preview).toMatchObject({ kind: 'bin', x: 29, y: 5, w: 2, h: 2, dir: DIR.W, valid: true });
    const cash = r.world.wallet.cash;
    expect(r.s.confirm()).toBe(true);
    const bin = r.f.entities().find((e) => e.kind === 'bin' && e.x === 29);
    expect(bin).toMatchObject({ y: 5, dir: DIR.W });
    expect(r.world.wallet.cash).toBe(cash - 250);
    // Rotation is remembered per type.
    tapAt(r.s, r.yard(20, 5));
    expect(r.s.pending).toMatchObject({ dir: DIR.W });
  });

  it('an invalid spot is red and cannot be confirmed; its reason is toasted only when the ghost is off screen', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('smelter');
    tapAt(r.s, r.yard(26, 5)); // on the survey Smelter, off this 375-px screen (x 795)
    expect(r.s.error?.code).toBe('E_OCCUPIED');
    expect(r.s.ghostOnScreen()).toBe(false);
    expect(r.toasts.at(-1)).toBe("Something's already here");
    expect(r.s.canConfirm).toBe(false);
    tapAt(r.s, r.yard(12, 2)); // under the Assay Office
    expect(r.s.error?.code).toBe('E_YARD');
    expect(r.toasts.at(-1)).toBe('Outside your Yard');
    // On screen, the label on the ghost and the pending chip say it: no third copy in a toast (BUILD-7).
    const n = r.toasts.length;
    tapAt(r.s, r.yard(5, 20)); // past the purchased Yard rows, inside the world area
    expect(r.s.error?.code).toBe('E_YARD');
    expect(r.s.ghostOnScreen()).toBe(true);
    expect(r.s.chip()).toEqual({ text: 'Outside your Yard', tone: 'bad' });
    expect(r.toasts).toHaveLength(n);
  });

  it('short of cash: "Need $n more"', () => {
    const r = rig();
    r.world.debugGiveCash(-r.world.wallet.cash + 100);
    r.app.enterBuild();
    r.s.arm('smelter');
    tapAt(r.s, r.yard(20, 5));
    expect(r.s.chip()).toEqual({ text: 'Need $200 more', tone: 'bad' });
  });

  it('locked cards explain their rung and arm nothing', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('router');
    expect(r.s.tool).toBeNull();
    expect(r.toasts.at(-1)).toBe('Unlocks: Produce an ingot');
  });

  it('Instant build commits a placement on lift; painting still previews', () => {
    const r = rig({ instantBuild: true });
    r.app.enterBuild();
    r.s.arm('bin');
    tapAt(r.s, r.yard(23, 5));
    expect(r.s.pending).toBeNull();
    expect(r.f.entities().filter((e) => e.kind === 'bin')).toHaveLength(2);
    r.s.arm('belt');
    stroke(r.s, [r.yard(20, 2), r.yard(21, 2)]);
    expect(r.s.pending?.t).toBe('path');
    expect(r.belts()).toBe(0);
  });
});

describe('build session: Bulldoze, inspect and Esc (03 §4.7, §6.3)', () => {
  it('marks belts and buildings, shows the refund, and removes them on ✓', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('belt');
    stroke(r.s, [r.yard(20, 2), r.yard(21, 2), r.yard(22, 2)]);
    r.s.confirm();
    r.s.arm('bin');
    tapAt(r.s, r.yard(23, 6));
    r.s.confirm();
    const cash = r.world.wallet.cash;
    r.s.clear(); // nothing pending: ✗ arms Bulldoze
    expect(r.s.tool).toBe('bulldoze');
    tapAt(r.s, r.yard(21, 2));
    expect(r.s.pending).toEqual({ t: 'remove', id: null, ghost: null, cells: [{ x: 21, y: 2 }] });
    expect(r.s.chip()).toEqual({ text: 'Remove 1 belt · refund $5', tone: 'bad' });
    expect(r.state.buildFrame.value).toMatchObject({ bulldoze: true, preview: { kind: 'belt', valid: false } });
    // A drag paints more belts onto the mark.
    stroke(r.s, [r.yard(20, 2), r.yard(22, 2)]);
    expect((r.s.pending as { cells: Cell[] }).cells).toHaveLength(3);
    expect(r.s.confirm()).toBe(true);
    expect(r.belts()).toBe(0);
    expect(r.world.wallet.cash).toBe(cash + 15);
    const bin = r.f.entities().find((e) => e.kind === 'bin' && !e.rusted)!;
    tapAt(r.s, r.yard(bin.x, bin.y));
    expect(r.s.pending).toMatchObject({ id: bin.id });
    expect(r.state.buildFrame.value?.selectedId).toBe(bin.id);
    expect(r.s.chip()?.text).toBe('Remove Storage Bin · refund $250');
    r.s.confirm();
    expect(r.f.entity(bin.id)).toBeNull();
    expect(r.world.wallet.cash).toBe(cash + 15 + 250);
    r.s.undo();
    expect(r.f.entities().some((e) => e.kind === 'bin' && !e.rusted)).toBe(true);
  });

  it('the Bulldoze chip refunds a crossing as the factory does, and says the crossing line goes (BUILD-8)', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('belt');
    stroke(r.s, [r.yard(22, 3), r.yard(22, 6)]);
    expect(r.s.confirm()).toBe(true);
    stroke(r.s, [r.yard(21, 4), r.yard(23, 4)]);
    expect(r.s.confirm()).toBe(true);
    expect(r.belts()).toBe(6);
    r.s.arm('bulldoze');
    stroke(r.s, [r.yard(22, 3), r.yard(22, 6)]);
    expect(r.s.chip()).toEqual({ text: 'Remove 4 belts, 1 crossing · refund $25', tone: 'bad' });
    const cash = r.world.wallet.cash;
    expect(r.s.confirm()).toBe(true);
    expect(r.world.wallet.cash).toBe(cash + 25);
    expect(r.belts()).toBe(2);
  });

  it('bulldozing the rusted survey set warns that it is not free to get back (BUILD-4)', () => {
    const r = rig();
    r.app.enterBuild();
    r.s.arm('bulldoze');
    tapAt(r.s, r.yard(26, 1));
    expect(r.s.chip()).toEqual({ text: 'Remove survey Headframe · rebuild $200', tone: 'bad' });
    tapAt(r.s, r.yard(26, 1)); // a second tap unmarks it
    tapAt(r.s, r.yard(26, 4));
    expect(r.s.chip()).toEqual({ text: 'Remove survey Smelter · rebuild $300', tone: 'bad' });
  });

  it('with no tool a tap inspects; Esc closes, clears, disarms, then lets build mode exit', () => {
    const r = rig();
    r.app.enterBuild();
    tapAt(r.s, r.yard(26, 5));
    const smelter = r.f.entities().find((e) => e.kind === 'smelter')!;
    expect(r.s.inspectId).toBe(smelter.id);
    expect(r.state.buildFrame.value?.selectedId).toBe(smelter.id);
    expect(r.s.back()).toBe(true);
    expect(r.s.inspectId).toBeNull();
    r.s.arm('bin');
    tapAt(r.s, r.yard(20, 5));
    expect(r.s.back()).toBe(true);
    expect(r.s.pending).toBeNull();
    expect(r.s.back()).toBe(true);
    expect(r.s.tool).toBeNull();
    expect(r.s.back()).toBe(false);
  });

  it('a long-press inspects (the gesture machine sends one only with no tool armed, BUILD-1)', () => {
    const r = rig();
    r.app.enterBuild();
    const p = r.yard(26, 1);
    r.s.longPress(p.x, p.y);
    expect(r.f.entity(r.s.inspectId ?? -1)?.kind).toBe('headframe');
  });
});

/** Dot's shaft dug and seen, the 2×2 drill site above the lode, a floor run at row 45 west of the shaft. */
function mineRig() {
  const r = rig();
  const w = r.world;
  const g = w.terrain;
  const lode = g.lodes[w.meta.scriptedLodeId];
  const c = w.meta.surveyColumn;
  const open = (x: number, y: number): void => {
    g.set(x, y, T.AIR);
    g.setFlag(x, y, F.SEEN);
  };
  for (let y = 0; y <= lode.top - 1; y++) open(c, y);
  for (let y = lode.top - 2; y <= lode.top - 1; y++) for (let x = lode.x0; x <= lode.x0 + 1; x++) open(x, y);
  for (let x = c - 6; x < c; x++) {
    open(x, lode.top - 1);
    g.set(x, lode.top, T.DIRT);
  }
  r.f.discoverLode(lode.id, true);
  w.debugTeleport(lode.top - 1);
  const pod = w.pod as { x: number; cargo: unknown[] };
  pod.x = c + 0.5;
  pod.cargo.push({ kind: 'kit', id: 'autoDrill' }, { kind: 'kit', id: 'liftFoot' }, { kind: 'kit', id: 'liftRail' }, { kind: 'kit', id: 'belt' });
  return { ...r, lode, c };
}

describe('build session: underground (02 §2.3–2.6; 03 §4.4–4.6)', () => {
  it('Place drill opens the Mine with the drill snapped to the scripted lode; Route to surface proposes the shaft', () => {
    const r = mineRig();
    r.s.placeDrill(r.lode.id);
    expect(r.state.mode.value).toBe('build');
    expect(r.s.plane).toBe('mine');
    expect(r.s.tool).toBe('autoDrill');
    expect(r.s.pending).toEqual({ t: 'piece', kind: 'autoDrill', ...r.f.surveyPlan().drill, dir: DIR.S });
    expect(r.s.tab.mine).toBe('extract'); // the armed Drill card is in view (BUILD-11)
    expect(r.s.error).toBeNull();
    expect(r.s.chip()?.text).toBe('Auto-Drill · 1 Auto-Drill Kit');
    expect(r.s.confirm()).toBe(true);
    expect(r.f.ghosts().map((g) => g.kind)).toEqual(['autoDrill']);
    expect(r.s.routeFrom).not.toBeNull();
    r.s.setTab('tools');
    expect(r.s.routeToSurface()).toBe(true);
    expect(r.s.tool).toBe('lift');
    expect(r.s.tab.mine).toBe('logistics');
    expect(r.s.pending).toEqual({ t: 'lift', x: r.c, foot: r.lode.top - 1, top: 0, headframe: { state: 'existing', x0: 26 } });
    expect(r.s.chip()?.text).toBe('H 45 · Foot Kit + 1 Rail · 30/min · 30 s');
    expect(r.s.confirm()).toBe(true);
    expect(r.f.ghosts().map((g) => [g.kind, g.part])).toEqual([
      ['autoDrill', null],
      ['lift', 'foot'],
      ['lift', 'rail'],
    ]);
    // Undo removes the lift ghost again (one step).
    r.s.undo();
    expect(r.f.ghosts().map((g) => g.kind)).toEqual(['autoDrill']);
  });

  it('places a lift by two endpoints: foot, then top (column ±1)', () => {
    const r = mineRig();
    r.app.enterBuild();
    r.s.arm('lift');
    tapAt(r.s, r.mine(r.c, r.lode.top - 1));
    expect(r.s.pending).toMatchObject({ t: 'lift', foot: 45, top: null });
    expect(r.s.canConfirm).toBe(false);
    expect(r.s.chip()?.text).toBe('Tap the top of the shaft');
    tapAt(r.s, r.mine(r.c + 1, 10));
    expect(r.s.pending).toMatchObject({ x: r.c, foot: 45, top: 10 });
    expect(r.s.canConfirm).toBe(true);
    expect(r.state.buildFrame.value?.preview).toMatchObject({ kind: 'lift', x: r.c, y: 10, h: 36, valid: true });
  });

  it('a lift through rock stops red at the first blocked row', () => {
    const r = mineRig();
    r.app.enterBuild();
    r.s.arm('lift');
    r.world.terrain.set(r.c, 20, T.DIRT);
    tapAt(r.s, r.mine(r.c, 45));
    tapAt(r.s, r.mine(r.c, 5));
    expect(r.s.error).toMatchObject({ code: 'E_COLUMN', y: 20 });
    expect(r.s.chip()?.text).toBe('Shaft blocked at row 20');
  });

  it('underground belts run along a floor, row-locked, and stop red at the first bad cell', () => {
    const r = mineRig();
    r.app.enterBuild();
    r.s.arm('belt');
    const y = r.lode.top - 1;
    stroke(r.s, [r.mine(r.c - 1, y), r.mine(r.c - 4, y + 3)]);
    expect(r.s.pending).toMatchObject({ t: 'run', run: { x: r.c - 1, y, dir: DIR.W, length: 4 } });
    expect(r.s.error).toBeNull();
    expect(r.s.chip()?.text).toBe('4 tiles = 1 Belt Kit');
    expect(r.s.confirm()).toBe(true);
    expect(r.f.ghosts().map((g) => [g.kind, g.x, g.y, g.w, g.kitUnits])).toEqual([['belt', r.c - 4, y, 4, 4]]);
    // Floorless cell two tiles in: the run ends red there.
    r.world.terrain.set(r.c - 5, r.lode.top, T.AIR);
    r.world.terrain.setFlag(r.c - 5, r.lode.top, F.SEEN);
    stroke(r.s, [r.mine(r.c - 4, y), r.mine(r.c - 6, y)]);
    expect(r.s.error?.code).toBe('E_OCCUPIED'); // starts on the pending ghost run
    r.s.clear();
    stroke(r.s, [r.mine(r.c - 5, y), r.mine(r.c - 6, y)]);
    expect(r.s.error?.code).toBe('E_FLOOR');
    expect(r.s.chip()?.text).toBe('Needs a floor');
    // Into seen but solid rock beyond the dug run.
    for (let x = r.c - 9; x <= r.c - 7; x++) r.world.terrain.setFlag(x, y, F.SEEN);
    r.s.clear();
    stroke(r.s, [r.mine(r.c - 6, y), r.mine(r.c - 9, y)]);
    expect(r.s.pending).toMatchObject({ run: { length: 2 } });
    expect(r.s.error?.code).toBe('E_SOLID');
    expect(r.s.chip()?.text).toBe('Dig this out first');
  });

  it('Bulldoze removes an underground ghost', () => {
    const r = mineRig();
    r.s.placeDrill(r.lode.id);
    r.s.confirm();
    r.s.arm('bulldoze');
    const d = r.f.surveyPlan().drill;
    tapAt(r.s, r.mine(d.x, d.y));
    expect(r.s.pending).toMatchObject({ t: 'remove', ghost: r.f.ghosts()[0].id });
    expect(r.s.confirm()).toBe(true);
    expect(r.f.ghosts()).toHaveLength(0);
  });

  it('a tap with no tool on a ghost opens its sheet', () => {
    const r = mineRig();
    r.s.placeDrill(r.lode.id);
    r.s.confirm();
    r.s.arm(null);
    const d = r.f.surveyPlan().drill;
    tapAt(r.s, r.mine(d.x + 1, d.y + 1));
    expect(r.s.inspectGhost).toBe(r.f.ghosts()[0].id);
  });
});

describe('build session: review round 2 (PLAYER-8, PLAYER-5)', () => {
  const POD_AWAY = { minX: 0, maxX: 0.8, minY: -1.9, maxY: -1.1 };
  const kits = { count: () => 9, take: () => undefined };

  it('a Drill tap on the middle of a discovered lode snaps to its drill site (PLAYER-8)', () => {
    const r = mineRig();
    r.app.enterBuild();
    r.s.setPlane('mine');
    r.s.arm('autoDrill');
    const site = r.f.surveyPlan().drill;
    // Anywhere on the 3×2 block, the far column included (its own site is not dug out: the survey site is valid).
    for (const [x, y] of [[r.lode.x0 + 1, r.lode.top], [r.lode.x0 + 1, r.lode.top + 1], [r.lode.x0 + 2, r.lode.top + 1], [r.lode.x0, r.lode.top]]) {
      tapAt(r.s, r.mine(x, y));
      expect(r.s.pending).toEqual({ t: 'piece', kind: 'autoDrill', x: site.x, y: site.y, dir: DIR.S });
      expect(r.s.error).toBeNull();
      expect(r.s.chip()?.text).toBe('Auto-Drill · 1 Auto-Drill Kit');
    }
    // A drag over the lode carries the ghost with it, snapped the same way.
    stroke(r.s, [r.mine(r.lode.x0 - 4, r.lode.top - 4), r.mine(r.lode.x0 + 2, r.lode.top + 1)]);
    expect(r.s.pending).toMatchObject({ x: site.x, y: site.y });
    expect(r.s.error).toBeNull();
  });

  it('when the drill truly cannot go, the lode tap names the real reason, not "Drills sit on a discovered lode"', () => {
    const r = mineRig();
    r.app.enterBuild();
    r.s.setPlane('mine');
    r.s.arm('autoDrill');
    const site = r.f.surveyPlan().drill;
    const mid = r.mine(r.lode.x0 + 1, r.lode.top + 1);
    // The footprint is not dug out.
    r.world.terrain.set(site.x + 1, site.y, T.DIRT);
    tapAt(r.s, mid);
    expect(r.s.pending).toMatchObject({ x: site.x, y: site.y });
    expect(r.s.error?.code).toBe('E_SOLID');
    expect(r.s.chip()?.text).toBe('Dig this out first');
    r.world.terrain.set(site.x + 1, site.y, T.AIR);
    // A drill ghost already on the lode.
    r.s.clear();
    tapAt(r.s, mid);
    expect(r.s.confirm()).toBe(true);
    tapAt(r.s, mid);
    expect(r.s.pending).toMatchObject({ x: site.x, y: site.y });
    expect(r.s.chip()).toEqual({ text: 'This lode has a drill', tone: 'bad' });
    // A built drill.
    const ghost = r.f.ghosts().find((g) => g.kind === 'autoDrill')!;
    expect(r.f.completeGhost(ghost.id, POD_AWAY, kits).ok).toBe(true);
    r.s.clear();
    tapAt(r.s, mid);
    expect(r.s.error?.code).toBe('E_LODE');
    expect(r.s.chip()?.text).toBe('This lode has a drill');
    // An undiscovered lode still says what a drill needs.
    const other = r.world.terrain.lodes.find((l) => !l.discovered && l.scope === 'mvp');
    if (other) {
      r.s.clear();
      tapAt(r.s, r.mine(other.x0 + 1, other.top + 1));
      expect(r.s.chip()?.text).toBe('Drills sit on a discovered lode');
    }
  });

  it('Deconstruct of the free rusted survey set asks first, with the rebuild price (PLAYER-5)', () => {
    const r = rig();
    r.app.enterBuild();
    const hf = r.f.entities().find((e) => e.kind === 'headframe' && e.rusted)!;
    r.s.openInspect(hf.id);
    const cash = r.world.wallet.cash;
    expect(r.s.deconstruct(hf.id)).toBe(false); // one tap only asks
    expect(r.f.entity(hf.id)).not.toBeNull();
    expect(r.s.askRemove).toBe(hf.id);
    expect(r.s.inspectId).toBe(hf.id);
    r.s.keepBuilding();
    expect(r.s.askRemove).toBeNull();
    expect(r.s.deconstruct(hf.id)).toBe(false);
    // Closing the sheet forgets the question: reopening asks again.
    r.s.closeInspect();
    r.s.openInspect(hf.id);
    expect(r.s.askRemove).toBeNull();
    expect(r.s.deconstruct(hf.id)).toBe(false);
    expect(r.s.deconstruct(hf.id)).toBe(true); // the second tap removes
    expect(r.f.entity(hf.id)).toBeNull();
    expect(r.world.wallet.cash).toBe(cash);
    expect(r.s.askRemove).toBeNull();
    expect(r.s.inspectId).toBeNull();
    // A building bought at full price comes back in one tap: its refund covers the rebuild.
    r.s.arm('bin');
    tapAt(r.s, r.yard(20, 5));
    expect(r.s.confirm()).toBe(true);
    r.s.arm(null);
    const bin = r.f.entities().find((e) => e.kind === 'bin' && !e.rusted)!;
    r.s.openInspect(bin.id);
    expect(r.s.deconstruct(bin.id)).toBe(true);
    expect(r.f.entity(bin.id)).toBeNull();
  });
});
