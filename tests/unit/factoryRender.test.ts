import { performance } from 'node:perf_hooks';
import { BackSide, Color, InstancedMesh, SRGBColorSpace, ShaderLib, type BufferAttribute, type InstancedBufferAttribute, type Material, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { benchWorld } from '../../src/debug/bench';
import { NO_INTENT } from '../../src/pod/types';
import { LAYER_LATE } from '../../src/render/materials';
import { ITEMS, item } from '../../src/factory/items';
import type { BuildingKind, FactoryApi, ViewRect } from '../../src/factory/api';
import { MaterialKit } from '../../src/render/materials';
import { PART_FLAG } from '../../src/render/materials/glsl';
import { createShadedMaterial } from '../../src/render/materials/look';
import { ORES, ROLE } from '../../src/render/palette';
import { SHAPE_CORNER, SHAPE_JUNCTION, SHAPE_STRAIGHT, beltTiles, pathTiles } from '../../src/render/factory/belts';
import { buildItemTable, itemLook } from '../../src/render/factory/itemLooks';
import * as Models from '../../src/render/factory/models';
import { BUBBLE_GLYPH, GHOST_HATCH_PT, GHOST_STYLE, INVALID_HEX, createGlyphAtlas } from '../../src/render/factory/overlayMaterials';
import { buildPose, newPose, planeViewRect, screenRay } from '../../src/render/factory/projection';
import { BUBBLE_TEXT, statusGlyph } from '../../src/render/factory/status';
import { BUBBLE_PT, FactoryView, REGION, dirAngle, ghostHatchPx, regionKey, type FactoryFrame } from '../../src/render/factory/view';
import { INST_HIDDEN } from '../../src/render/materials/glsl';
import type { BuildFrame } from '../../src/render/api';
import { ONBOARD, POD_AWAY, Cargo, buildOnboarding, carve, rig, ticks } from './factory.helpers';

const YARD_ALL: ViewRect = { plane: 'yard', x0: 0, y0: 0, x1: 47, y1: 32 };
const MINE_ALL: ViewRect = { plane: 'mine', x0: 0, y0: 0, x1: 47, y1: 100 };

function frame(f: FactoryApi, over: Partial<FactoryFrame> = {}): FactoryFrame {
  const r = rigGrid ?? rig().grid;
  return {
    factory: f,
    grid: r,
    timeMs: 1000,
    dt: 1 / 60,
    alphaF: 0,
    pose: buildPose({ plane: 'yard', cx: ONBOARD.column, cy: 5, ppu: 39, yaw: 0 }, newPose()),
    yardRect: YARD_ALL,
    mineRect: MINE_ALL,
    build: null,
    ghostProgress: null,
    texel: 0,
    animate: true,
    itemCap: 1500,
    smokeCap: 12,
    ...over,
  };
}
let rigGrid: ReturnType<typeof rig>['grid'] | null = null;

/** Visible instance count of a named factory mesh. */
function count(view: FactoryView, name: string): number {
  let n = 0;
  view.root.traverse((o) => {
    if (o instanceof InstancedMesh && o.name === name) n = o.visible ? o.count : 0;
  });
  return n;
}
function mesh(view: FactoryView, name: string): InstancedMesh {
  let m: InstancedMesh | null = null;
  view.root.traverse((o) => {
    if (o instanceof InstancedMesh && o.name === name) m = o;
  });
  if (!m) throw new Error(`no mesh ${name}`);
  return m;
}
function inst(view: FactoryView, name: string, i: number): number[] {
  const a = mesh(view, name).geometry.getAttribute('hfInst') as InstancedBufferAttribute;
  return Array.from((a.array as Float32Array).slice(i * 4, i * 4 + 4));
}
function translation(view: FactoryView, name: string, i: number): [number, number, number] {
  const e = mesh(view, name).instanceMatrix.array as Float32Array;
  return [e[i * 16 + 12], e[i * 16 + 13], e[i * 16 + 14]];
}

function onboarded(): ReturnType<typeof rig> {
  const r = rig();
  buildOnboarding(r);
  rigGrid = r.grid;
  return r;
}

describe('factory render: belt tiles (02 §2.1; 04 §4.1 word layout)', () => {
  it('classifies straights, corners with their turn, Junctions and line ends from the belt words', () => {
    const r = rig();
    r.f.unlockRung('U2');
    r.f.unlockRung('U3');
    // An L: east along row 4, then south (away from the Rim) down column 8.
    expect(r.f.paintBelts([{ x: 5, y: 4 }, { x: 6, y: 4 }, { x: 7, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 5 }, { x: 8, y: 6 }], 1, 1).ok).toBe(true);
    // A straight crossing of a north–south line over an east–west one makes a Junction.
    expect(r.f.paintBelts([{ x: 30, y: 4 }, { x: 30, y: 5 }, { x: 30, y: 6 }], 1, 1).ok).toBe(true);
    expect(r.f.paintBelts([{ x: 29, y: 5 }, { x: 30, y: 5 }, { x: 31, y: 5 }], 1, 0).ok).toBe(true);
    const tiles = beltTiles(r.f.beltWords('yard'), 33);
    const at = (x: number, y: number) => tiles.find((t) => t.x === x && t.y === y);
    expect(at(5, 4)).toMatchObject({ shape: SHAPE_STRAIGHT, dir: 0, tail: true, head: false });
    expect(at(8, 4)).toMatchObject({ shape: SHAPE_CORNER, entry: 0, dir: 1, turn: 1 });
    expect(at(8, 6)).toMatchObject({ shape: SHAPE_STRAIGHT, dir: 1, head: true });
    const j = at(30, 5);
    expect(j?.shape).toBe(SHAPE_JUNCTION);
    expect(new Set([j?.dir, j?.dirB])).toEqual(new Set([0, 1]));
    expect(at(31, 5)).toMatchObject({ shape: SHAPE_STRAIGHT, dir: 0, head: true });
  });

  it('turns an anticlockwise corner the other way and builds preview paths with corners', () => {
    const r = rig();
    r.f.unlockRung('U2');
    expect(r.f.paintBelts([{ x: 24, y: 7 }, { x: 24, y: 6 }, { x: 25, y: 6 }], 1, 0).ok).toBe(true);
    const c = beltTiles(r.f.beltWords('yard'), 33).find((t) => t.x === 24 && t.y === 6);
    // Travelling north (3) then east (0): 0 − 3 ≡ 1 → clockwise.
    expect(c).toMatchObject({ shape: SHAPE_CORNER, entry: 3, dir: 0, turn: 1 });
    const p = pathTiles([{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 1 }], 3);
    expect(p.map((t) => [t.shape, t.dir, t.entry, t.turn])).toEqual([
      [SHAPE_STRAIGHT, 0, 0, 0],
      [SHAPE_CORNER, 3, 0, -1],
      [SHAPE_STRAIGHT, 3, 3, 0],
    ]);
    expect(p[0].tail && p[2].head).toBe(true);
    expect(dirAngle(1)).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('factory render: structure from the views (04 §3.3, §5.3)', () => {
  it('instances the onboarding chain, rusts the survey set and rebuilds only on topology changes', () => {
    const { f } = onboarded();
    const view = new FactoryView(new MaterialKit(), 'toon');
    view.bind(f);
    const spy = vi.spyOn(f, 'entities');
    view.update(frame(f));
    for (const k of ['headframe', 'smelter', 'bin', 'autoDrill', 'liftFoot']) expect(count(view, `factory-${k}`), k).toBe(1);
    expect(count(view, 'factory-liftHead')).toBe(0); // the top is the Rim: the Headframe's sheave takes over
    expect(count(view, 'factory-liftTie')).toBe(15);
    expect(count(view, 'factory-belt')).toBe(2);
    expect(count(view, 'factory-chevron')).toBe(2);
    expect(count(view, 'factory-sheave')).toBe(1);
    expect(inst(view, 'factory-smelter', 0)[1]).toBe(1); // rusted survey skin
    expect(inst(view, 'factory-autoDrill', 0)[1]).toBe(0);
    // The lift rails span the whole column, foot row 45 up to the Rim (y 0), in one piece per culling band.
    const bands = Math.ceil(ONBOARD.top / REGION);
    expect(count(view, 'factory-liftRail')).toBe(bands);
    const rails = mesh(view, 'factory-liftRail').instanceMatrix.array as Float32Array;
    const spans = Array.from({ length: bands }, (_, i) => [rails[i * 16 + 13], rails[i * 16 + 13] + rails[i * 16 + 5]]).sort((a, b) => a[0] - b[0]);
    expect(spans[0][0]).toBe(-ONBOARD.top);
    expect(spans[bands - 1][1]).toBe(0);
    for (let i = 1; i < bands; i++) expect(spans[i][0]).toBe(spans[i - 1][1]); // no gaps, no overlaps
    // The chain strands too, plus their climb from the shaft mouth to the Headframe's sheave.
    expect(count(view, 'factory-liftStrand')).toBe(bands + 1);
    const strands = mesh(view, 'factory-liftStrand').instanceMatrix.array as Float32Array;
    const tops = Array.from({ length: bands + 1 }, (_, i) => strands[i * 16 + 13] + strands[i * 16 + 5]);
    expect(Math.max(...tops)).toBeCloseTo(Models.SHEAVE_Y, 5);
    // The survey Smelter faces S (away from the Rim): local +x → world −z.
    const sm = mesh(view, 'factory-smelter').instanceMatrix.array as Float32Array;
    expect(sm[2]).toBeCloseTo(-1, 9);
    expect(translation(view, 'factory-smelter', 0)).toEqual([ONBOARD.column + 1, 0, -5]);
    view.update(frame(f));
    view.update(frame(f));
    expect(spy).toHaveBeenCalledTimes(1);
    f.paintBelts([{ x: 30, y: 6 }], 1, 0);
    view.update(frame(f));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(count(view, 'factory-belt')).toBe(3);
  });

  it('writes per-tick state: working, status LEDs and the bulldoze / selection tints', () => {
    const { f } = onboarded();
    const view = new FactoryView(new MaterialKit(), 'toon');
    ticks(f, 40);
    view.update(frame(f));
    const drill = inst(view, 'factory-autoDrill', 0);
    expect(drill[0]).toBe(1);
    expect(drill[3]).toBe(0);
    const smelter = f.entities().find((e) => e.kind === 'smelter');
    if (!smelter) throw new Error('no smelter');
    const build: BuildFrame = { plane: 'yard', cursor: { x: smelter.x, y: smelter.y }, preview: null, bulldoze: true, selectedId: null };
    view.update(frame(f, { build }));
    expect(inst(view, 'factory-smelter', 0)[2]).toBe(1);
    view.update(frame(f, { build: { ...build, bulldoze: false, selectedId: smelter.id } }));
    expect(inst(view, 'factory-smelter', 0)[2]).toBe(2);
    // Bulldozing a belt tints that tile only.
    view.update(frame(f, { build: { ...build, cursor: { x: ONBOARD.column, y: 3 } } }));
    const belts = mesh(view, 'factory-belt');
    const tints = Array.from({ length: belts.count }, (_, i) => inst(view, 'factory-belt', i)[2]);
    expect(tints.sort()).toEqual([0, 1]);
    expect(inst(view, 'factory-smelter', 0)[2]).toBe(0);
  });

  it('places belt items on the deck at x + dx·α_f, lift buckets on the up strand and spins the sheave', () => {
    const { f } = onboarded();
    const view = new FactoryView(new MaterialKit(), 'toon');
    // Run until an ore chunk rides the Headframe → Smelter belt (row 3, on the plateau deck).
    let onBelt = -1;
    for (let k = 0; k < 2400 && onBelt < 0; k++) {
      f.tick();
      view.update(frame(f));
      const chunks = mesh(view, 'factory-item-chunk');
      for (let i = 0; i < chunks.count; i++) {
        const [, y, z] = translation(view, 'factory-item-chunk', i);
        if (y > 0 && z < -3.2 && z > -3.6) onBelt = i;
      }
    }
    expect(onBelt).toBeGreaterThanOrEqual(0);
    const [, y0, z0] = translation(view, 'factory-item-chunk', onBelt);
    expect(y0).toBeCloseTo(Models.BELT_DECK_TOP, 1);
    view.update(frame(f, { alphaF: 0.5 }));
    const [, , z1] = translation(view, 'factory-item-chunk', onBelt);
    expect(z1).toBeLessThan(z0); // travelling S (−z), half a tick further
    expect(count(view, 'factory-bucket')).toBeGreaterThan(0);
    const before = (mesh(view, 'factory-sheave').instanceMatrix.array as Float32Array)[1];
    view.update(frame(f, { dt: 0.25 }));
    const after = (mesh(view, 'factory-sheave').instanceMatrix.array as Float32Array)[1];
    expect(after).not.toBeCloseTo(before, 3);
    // Out of the camera rect, nothing moving is placed.
    view.update(frame(f, { yardRect: null, mineRect: null }));
    expect(count(view, 'factory-item-chunk')).toBe(0);
    expect(count(view, 'factory-bucket')).toBe(0);
    expect(count(view, 'factory-smelter')).toBe(0);
  });

  it('draws ghost jobs as blueprints and the armed tool red when invalid', () => {
    const r = onboarded();
    const { f, grid } = r;
    carve(grid, ONBOARD.x0 + 2, ONBOARD.top - 1, ONBOARD.x0 + 8, ONBOARD.top - 1);
    f.tileChanged([]);
    const job = f.placeGhost({ kind: 'belt', x: ONBOARD.x0 + 3, y: ONBOARD.top - 1, dir: 0, length: 3 });
    expect(job.ok).toBe(true);
    const view = new FactoryView(new MaterialKit(), 'toon');
    view.update(frame(f));
    expect(count(view, 'factory-ghost-belt')).toBe(3);
    const g = mesh(view, 'factory-ghost-belt').geometry.getAttribute('hfGhost') as BufferAttribute;
    expect(g.getY(0)).toBe(GHOST_STYLE.JOB);
    const build: BuildFrame = { plane: 'yard', cursor: { x: 2, y: 2 }, preview: { kind: 'smelter', mk: 1, x: 2, y: 2, w: 2, h: 2, dir: 0, valid: false }, bulldoze: false, selectedId: null };
    view.update(frame(f, { build }));
    expect(count(view, 'factory-ghost-smelter')).toBe(1);
    const sg = mesh(view, 'factory-ghost-smelter');
    expect((sg.geometry.getAttribute('hfGhost') as BufferAttribute).getY(0)).toBe(GHOST_STYLE.INVALID);
    const c = sg.instanceColor?.array as Float32Array;
    expect(c[0]).toBeGreaterThan(c[2]); // red
    // A painted path previews belt tiles, corners included; jobs stay.
    view.update(frame(f, { build: { ...build, preview: { kind: 'belt', mk: 1, x: 4, y: 4, w: 1, h: 1, dir: 3, valid: true, path: [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 3 }] } } }));
    expect(count(view, 'factory-ghost-belt')).toBe(3 + 2);
    expect(count(view, 'factory-ghost-beltCorner')).toBe(1);
    expect(count(view, 'factory-ghost-smelter')).toBe(0);
    // The job being built pulses faster.
    view.update(frame(f, { ghostProgress: { id: (job as { ids: number[] }).ids[0], progress: 0.5 } }));
    expect((mesh(view, 'factory-ghost-belt').geometry.getAttribute('hfGhost') as BufferAttribute).getY(0)).toBe(GHOST_STYLE.ACTIVE);
  });

  it('highlights where an armed underground tool may go and shows status bubbles', () => {
    const r = onboarded();
    const { f, grid } = r;
    carve(grid, ONBOARD.x0 + 2, ONBOARD.top - 1, ONBOARD.x0 + 4, ONBOARD.top - 1);
    const view = new FactoryView(new MaterialKit(), 'toon');
    const mineBuild: BuildFrame = { plane: 'mine', cursor: { x: ONBOARD.x0 + 2, y: ONBOARD.top - 1 }, preview: { kind: 'belt', mk: 1, x: ONBOARD.x0 + 2, y: ONBOARD.top - 1, w: 1, h: 1, dir: 0, valid: true }, bulldoze: false, selectedId: null };
    view.update(frame(f, { build: mineBuild, mineRect: { plane: 'mine', x0: 15, y0: 40, x1: 30, y1: 50 } }));
    // Three carved tunnel cells on a solid floor (the shaft column has the lift mount).
    expect(count(view, 'factory-cell-highlight')).toBe(3);
    view.update(frame(f, { build: { ...mineBuild, preview: null } }));
    expect(count(view, 'factory-cell-highlight')).toBe(0);
    // The fresh survey Smelter has nothing to smelt: a "no input" bubble.
    expect(count(view, 'factory-bubbles')).toBeGreaterThanOrEqual(1);
  });

  it('shows the armed tool’s placement highlight before the first tap (BUILD-9)', () => {
    const r = onboarded();
    const { f, grid } = r;
    carve(grid, ONBOARD.x0 + 2, ONBOARD.top - 1, ONBOARD.x0 + 4, ONBOARD.top - 1);
    const view = new FactoryView(new MaterialKit(), 'toon');
    const mineRect: ViewRect = { plane: 'mine', x0: 15, y0: 40, x1: 30, y1: 50 };
    // A card armed, nothing tapped yet: no cursor, no preview, only the pinned BuildFrame.tool.
    const armed: BuildFrame = { plane: 'mine', cursor: null, preview: null, bulldoze: false, selectedId: null, tool: 'belt' };
    view.update(frame(f, { build: armed, mineRect }));
    expect(count(view, 'factory-cell-highlight')).toBe(3);
    // The first tap's preview names the same tool: the same cells.
    view.update(frame(f, { build: { ...armed, preview: { kind: 'belt', mk: 1, x: ONBOARD.x0 + 2, y: ONBOARD.top - 1, w: 1, h: 1, dir: 0, valid: true } }, mineRect }));
    expect(count(view, 'factory-cell-highlight')).toBe(3);
    // Disarmed (no tool), Bulldoze (tool null, bulldoze on) or the Yard: nothing to place, no highlight.
    for (const b of [{ ...armed, tool: null }, { ...armed, tool: null, bulldoze: true }, { ...armed, plane: 'yard' as const }]) {
      view.update(frame(f, { build: b, mineRect }));
      expect(count(view, 'factory-cell-highlight')).toBe(0);
    }
    // Arming the Auto-Drill marks the discovered lode's drill footprints (the survey drill already holds the lode).
    view.update(frame(f, { build: { ...armed, tool: 'autoDrill' }, mineRect }));
    expect(count(view, 'factory-cell-highlight') % 4).toBe(0);
  });

  it('tints a valid Smelter ghost coral and an invalid one magenta-crimson, striped, never by hue alone (BUILD-10)', () => {
    // sRGB hue (degrees) of a palette colour, and the circular distance between two.
    const hue = (hex: number): number => new Color(hex).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace).h * 360;
    const apart = (a: number, b: number): number => {
      const d = Math.abs(hue(a) - hue(b)) % 360;
      return Math.min(d, 360 - d);
    };
    // No ghost role tint sits within 30° of the invalid hue (the old #FF4D5E was 10° from Processing coral).
    for (const role of ['logistics', 'extraction', 'processing', 'furnace', 'assembly', 'power', 'storage', 'support'] as const) {
      expect(apart(INVALID_HEX, ROLE[role]), role).toBeGreaterThanOrEqual(30);
    }
    expect(apart(0xff4d5e, ROLE.processing)).toBeLessThan(30);
    const { f } = onboarded();
    const view = new FactoryView(new MaterialKit(), 'toon');
    const tint = (): number[] => Array.from((mesh(view, 'factory-ghost-smelter').instanceColor?.array as Float32Array).slice(0, 3));
    const style = (): number => (mesh(view, 'factory-ghost-smelter').geometry.getAttribute('hfGhost') as BufferAttribute).getY(0);
    const preview = { kind: 'smelter' as const, mk: 1, x: 2, y: 2, w: 2, h: 2, dir: 0 as const, valid: true };
    const build: BuildFrame = { plane: 'yard', cursor: { x: 2, y: 2 }, preview, bulldoze: false, selectedId: null };
    view.update(frame(f, { build }));
    const coral = new Color(ROLE.processing);
    expect(tint()).toEqual([coral.r, coral.g, coral.b].map((v) => Math.fround(v)));
    expect(style()).toBe(GHOST_STYLE.VALID);
    view.update(frame(f, { build: { ...build, preview: { ...preview, valid: false } } }));
    const bad = new Color(INVALID_HEX);
    expect(tint()).toEqual([bad.r, bad.g, bad.b].map((v) => Math.fround(v)));
    expect(style()).toBe(GHOST_STYLE.INVALID);
    // The invalid style is striped with ink at a CSS-sized period: 8 pt × the Toon DPR, whole texels in Pixel Lab.
    const body = mesh(view, 'factory-ghost-smelter').material as unknown as { fragmentShader: string; uniforms: Record<string, { value: number }> };
    expect(body.fragmentShader).toContain('/ uHatch');
    view.setGhostEdge(3, 750, 1334, 2);
    expect(body.uniforms.uHatch.value).toBe(GHOST_HATCH_PT * 2);
    view.setLook('pixel');
    view.setGhostEdge(1, 190, 336, 1.3);
    expect(body.uniforms.uHatch.value).toBe(10);
    expect(ghostHatchPx(0.2, true)).toBe(4);
  });

  it('draws the job the pod is held on stalled, striped in its role tint, not pulsing as built (PLAYER-6)', () => {
    const r = onboarded();
    const { f, grid } = r;
    carve(grid, ONBOARD.x0 + 2, ONBOARD.top - 1, ONBOARD.x0 + 8, ONBOARD.top - 1);
    f.tileChanged([]);
    const job = f.placeGhost({ kind: 'belt', x: ONBOARD.x0 + 3, y: ONBOARD.top - 1, dir: 0, length: 3 });
    const id = (job as { ids: number[] }).ids[0];
    const view = new FactoryView(new MaterialKit(), 'toon');
    const style = (): number => (mesh(view, 'factory-ghost-belt').geometry.getAttribute('hfGhost') as BufferAttribute).getY(0);
    view.update(frame(f, { ghostProgress: { id, progress: 0.5, blocked: null } }));
    expect(style()).toBe(GHOST_STYLE.ACTIVE);
    view.update(frame(f, { ghostProgress: { id, progress: 0, blocked: 'E_POD' } }));
    expect(style()).toBe(GHOST_STYLE.INVALID);
    const c = Array.from((mesh(view, 'factory-ghost-belt').instanceColor?.array as Float32Array).slice(0, 3));
    const logistics = new Color(ROLE.logistics);
    expect(c).toEqual([logistics.r, logistics.g, logistics.b].map((v) => Math.fround(v)));
    // The refusal clears (Pip stepped out): the count resumes and the job pulses again.
    view.update(frame(f, { ghostProgress: { id, progress: 1 / 60, blocked: null } }));
    expect(style()).toBe(GHOST_STYLE.ACTIVE);
  });

  it('marks jam heads under the Logistics overlay once they stay stopped (03 §4.10)', () => {
    const { f } = onboarded();
    expect(f.expandYard().ok).toBe(true);
    const bin = f.entities().find((e) => e.kind === 'bin');
    if (!bin) throw new Error('no bin');
    expect(f.stockpilePut([{ item: 'copperIngot', n: 20 }]).ok).toBe(true);
    expect(f.setUnloadFilter(bin.id, 'copperIngot').ok).toBe(true);
    // The Bin unloads onto a 2-tile belt that leads nowhere: its head jams.
    expect(f.paintBelts([{ x: ONBOARD.column, y: 9 }, { x: ONBOARD.column, y: 10 }], 1, 1).ok).toBe(true);
    ticks(f, 200);
    const view = new FactoryView(new MaterialKit(), 'toon');
    const build: BuildFrame = { plane: 'yard', cursor: null, preview: null, bulldoze: false, selectedId: null, overlay: 'logistics' };
    view.update(frame(f, { build: { ...build, overlay: null }, timeMs: 0 }));
    const base = count(view, 'factory-bubbles');
    view.update(frame(f, { build, timeMs: 100 }));
    expect(count(view, 'factory-bubbles')).toBe(base);
    view.update(frame(f, { build, timeMs: 800 }));
    expect(count(view, 'factory-bubbles')).toBe(base + 1);
    const glyphs = mesh(view, 'factory-bubbles').geometry.getAttribute('hfGlyph') as BufferAttribute;
    expect(glyphs.getX(base)).toBe(4);
    view.update(frame(f, { build: { ...build, overlay: null }, timeMs: 900 }));
    expect(count(view, 'factory-bubbles')).toBe(base);
  });

  it('picks the entity whose box the screen ray enters, per build plane', () => {
    const { f } = onboarded();
    const view = new FactoryView(new MaterialKit(), 'toon');
    view.update(frame(f));
    const layout = { width: 393, height: 852 };
    const o = { x: 0, y: 0, z: 0 };
    const d = { x: 0, y: 0, z: 0 };
    const id = (k: BuildingKind) => f.entities().find((e) => e.kind === k)?.id;
    const yardPose = buildPose({ plane: 'yard', cx: ONBOARD.column + 1, cy: 5, ppu: 39, yaw: 0 }, newPose());
    screenRay(yardPose, layout, layout.width / 2, layout.height / 2, o, d);
    expect(view.pick(o, d, 'yard')).toBe(id('smelter'));
    expect(view.pick(o, d, 'mine')).not.toBe(id('smelter'));
    const minePose = buildPose({ plane: 'mine', cx: ONBOARD.x0 + 1, cy: ONBOARD.top - 1, ppu: 47, yaw: 0 }, newPose());
    screenRay(minePose, layout, layout.width / 2, layout.height / 2, o, d);
    expect(view.pick(o, d, 'mine')).toBe(id('autoDrill'));
    screenRay(minePose, layout, layout.width / 2 - 47 * 1.5, layout.height / 2, o, d);
    expect(view.pick(o, d, 'mine')).toBe(id('lift'));
    screenRay(minePose, layout, layout.width / 2 + 47 * 6, layout.height / 2, o, d);
    expect(view.pick(o, d, 'mine')).toBeNull();
  });

  it('swaps look materials and scopes outlines (low tier: the selected piece only)', () => {
    const { f } = onboarded();
    const kit = new MaterialKit();
    const view = new FactoryView(kit, 'toon');
    view.setHulls(false, true);
    view.update(frame(f));
    const hull = mesh(view, 'factory-smelter-hull');
    expect(hull.visible).toBe(false);
    expect(kit.uniforms.uHfFactoryHullSel.value).toBe(1);
    const smelter = f.entities().find((e) => e.kind === 'smelter');
    view.update(frame(f, { build: { plane: 'yard', cursor: null, preview: null, bulldoze: false, selectedId: smelter?.id ?? null } }));
    expect(hull.visible).toBe(true);
    view.setLook('pixel');
    expect(hull.visible).toBe(false); // Pixel Lab outlines in its edge pass
    expect((mesh(view, 'factory-smelter').material as Material).name).toBe('hf-factory-pixel');
    view.setHulls(true, true);
    view.setLook('toon');
    expect(mesh(view, 'factory-bin-hull').visible).toBe(true);
    expect(kit.uniforms.uHfFactoryHullSel.value).toBe(0);
  });

  it('builds underground ghost jobs into real pieces when the pod completes them', () => {
    const r = onboarded();
    const { f, grid } = r;
    carve(grid, ONBOARD.x0 + 2, ONBOARD.top - 1, ONBOARD.x0 + 4, ONBOARD.top - 1);
    const job = f.placeGhost({ kind: 'belt', x: ONBOARD.x0 + 2, y: ONBOARD.top - 1, dir: 0, length: 3 });
    if (!job.ok) throw new Error(JSON.stringify(job));
    const view = new FactoryView(new MaterialKit(), 'toon');
    view.update(frame(f));
    expect(count(view, 'factory-ghost-belt')).toBe(3);
    expect(f.completeGhost(job.ids[0], POD_AWAY, new Cargo({ belt: 8 })).ok).toBe(true);
    view.update(frame(f));
    expect(count(view, 'factory-ghost-belt')).toBe(0);
    expect(count(view, 'factory-belt')).toBe(2 + 3);
    // Floor belts sit on the tunnel floor at z 0, flattened.
    const m = mesh(view, 'factory-belt');
    const ys = Array.from({ length: m.count }, (_, i) => translation(view, 'factory-belt', i)[1]);
    expect(ys.filter((y) => y === -ONBOARD.top)).toHaveLength(3);
    expect((m.instanceMatrix.array as Float32Array)[5 + 16 * ys.indexOf(-ONBOARD.top)]).toBeCloseTo(Models.MINE_BELT_SCALE_Y, 5);
  });
});

/** Instance origins and x-scale of a named mesh's drawn instances. */
function drawn(view: FactoryView, name: string): { x: number; y: number; z: number; sx: number }[] {
  const m = mesh(view, name);
  if (!m.visible) return [];
  const e = m.instanceMatrix.array as Float32Array;
  return Array.from({ length: m.count }, (_, i) => ({ x: e[i * 16 + 12], y: e[i * 16 + 13], z: e[i * 16 + 14], sx: e[i * 16] }));
}

/** Triangles the factory view draws now (instances × triangles per instance, hulls and twins included). */
function factoryTris(view: FactoryView): number {
  let n = 0;
  view.root.traverse((o) => {
    if (!(o instanceof InstancedMesh)) return;
    for (let p: import('three').Object3D | null = o; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry;
    n += o.count * ((g.index ? g.index.count : g.getAttribute('position').count) / 3);
  });
  return n;
}

/** A run of n built floor belts on mine row `row` from column x0 (carved, seen, completed by the pod). */
function mineBelts(r: ReturnType<typeof rig>, x0: number, row: number, n: number): void {
  carve(r.grid, x0, row, x0 + n - 1, row);
  r.f.tileChanged([]);
  const job = r.f.placeGhost({ kind: 'belt', x: x0, y: row, dir: 0, length: n });
  if (!job.ok) throw new Error(JSON.stringify(job));
  for (const id of job.ids) expect(r.f.completeGhost(id, POD_AWAY, new Cargo({ belt: 64 })).ok).toBe(true);
}

describe('factory render: culling to the camera (canon §3.14 triangle budgets)', () => {
  it('draws only the structure in view: a Yard view pays for no mine belts, ties or drills, a mine view only its rows', () => {
    const r = onboarded();
    const { f } = r;
    mineBelts(r, 4, 200, 10);
    mineBelts(r, 30, 400, 8);
    const view = new FactoryView(new MaterialKit(), 'toon');
    const all = { ...MINE_ALL, y1: 607 };
    view.update(frame(f, { mineRect: all }));
    expect(count(view, 'factory-belt')).toBe(2 + 10 + 8);
    // The Yard alone: its two belts, the buildings, and the lift's climb into the Headframe — nothing underground.
    view.update(frame(f, { mineRect: null }));
    expect(count(view, 'factory-belt')).toBe(2);
    expect(count(view, 'factory-chevron')).toBe(2);
    for (const k of ['liftTie', 'liftRail', 'liftFoot', 'autoDrill']) expect(count(view, `factory-${k}`), k).toBe(0);
    expect(drawn(view, 'factory-liftStrand').map((s) => s.y)).toEqual([0]);
    expect(count(view, 'factory-smelter')).toBe(1);
    // Deep in the mine: only the belts on those rows; no Yard building, no lift (rows 0–45), no drill.
    view.update(frame(f, { yardRect: null, mineRect: { plane: 'mine', x0: 0, y0: 195, x1: 20, y1: 205 } }));
    expect(count(view, 'factory-belt')).toBe(10);
    expect(drawn(view, 'factory-belt').every((b) => b.y === -201)).toBe(true);
    for (const k of ['smelter', 'headframe', 'liftTie', 'liftRail', 'autoDrill']) expect(count(view, `factory-${k}`), k).toBe(0);
    // Around the lift foot: the ties and rail pieces of those rows only.
    view.update(frame(f, { yardRect: null, mineRect: { plane: 'mine', x0: 10, y0: 38, x1: 30, y1: 47 } }));
    expect(count(view, 'factory-autoDrill')).toBe(1);
    const ties = drawn(view, 'factory-liftTie');
    expect(ties.length).toBeGreaterThan(0);
    expect(ties.length).toBeLessThan(8);
    expect(ties.every((t) => -t.y > 38 - REGION - 2 && -t.y < 48)).toBe(true);
    expect(count(view, 'factory-liftRail')).toBeLessThanOrEqual(4);
    // Per-tick state still reaches what is drawn: the drill works.
    ticks(f, 40);
    view.update(frame(f, { yardRect: null, mineRect: { plane: 'mine', x0: 10, y0: 38, x1: 30, y1: 47 } }));
    expect(inst(view, 'factory-autoDrill', 0)[0]).toBe(1);
    // Back to everything: the same instances, nothing lost or doubled.
    view.update(frame(f, { mineRect: all }));
    expect(count(view, 'factory-belt')).toBe(20);
    expect(count(view, 'factory-liftTie')).toBe(15);
  });

  it('files every piece under its anchor cell’s region, Yard bands before mine bands', () => {
    expect(regionKey('yard', 0, 0)).toBe(0);
    expect(regionKey('yard', REGION, 0)).toBe(1);
    expect(regionKey('yard', 0, REGION)).toBeGreaterThan(regionKey('yard', 47, REGION - 1));
    expect(regionKey('mine', 0, 0)).toBeGreaterThan(regionKey('yard', 47, 32));
    expect(regionKey('mine', 47, 607)).toBeGreaterThan(regionKey('mine', 0, 600));
  });

  it('keeps the canon fixture’s factory within the triangle budget in the Yard and Mine build views', () => {
    const { world } = benchWorld(7, () => performance.now());
    for (let i = 0; i < 1500; i++) {
      world.step(NO_INTENT, true);
      world.drainEvents();
    }
    const f = world.factory as FactoryApi;
    // The bench page's cameras (src/debug/benchPage.ts) on the SE and the iPhone 15, rects as the renderer makes them.
    for (const layout of [{ width: 375, height: 667 }, { width: 393, height: 852 }]) {
      for (const cam of [{ plane: 'yard', cx: 24, cy: 12, ppu: 39, yaw: 0 }, { plane: 'yard', cx: 24, cy: 12, ppu: 39, yaw: 1 }, { plane: 'mine', cx: 24, cy: 60, ppu: 47, yaw: 0 }] as const) {
        const pose = buildPose(cam, newPose());
        const yr: ViewRect = { plane: 'yard', x0: 0, y0: 0, x1: 0, y1: 0 };
        const mr: ViewRect = { plane: 'mine', x0: 0, y0: 0, x1: 0, y1: 0 };
        const fr: FactoryFrame = {
          ...frame(f, { grid: world.terrain, pose }),
          yardRect: planeViewRect(pose, layout, 'yard', 2, yr) ? yr : null,
          mineRect: planeViewRect(pose, layout, 'mine', 2, mr) ? mr : null,
          viewport: layout,
        };
        const view = new FactoryView(new MaterialKit(), 'toon');
        // Low tier: outlines on the selected piece only. The factory keeps under ¾ of the 60k frame.
        view.setHulls(false, true);
        view.update(fr);
        expect(factoryTris(view), `low ${cam.plane} ${cam.yaw} ${layout.width}`).toBeLessThan(45_000);
        // Mid tier: every piece outlined. Under ¾ of 150k.
        view.setHulls(true, true);
        view.update(fr);
        expect(factoryTris(view), `mid ${cam.plane} ${cam.yaw} ${layout.width}`).toBeLessThan(112_500);
      }
    }
  });

  it('draws a bucket only on the rows in view, and buckets climb into the Headframe up to its sheave (03 §8.6)', () => {
    const { f } = onboarded();
    const view = new FactoryView(new MaterialKit(), 'toon');
    const col = ONBOARD.column;
    let top = -Infinity;
    let above = 0;
    for (let k = 0; k < 2400; k++) {
      f.tick();
      view.update(frame(f, { alphaF: (k % 3) / 3 }));
      for (const b of drawn(view, 'factory-bucket')) {
        if (b.sx < 0) continue; // empties hang upside down
        top = Math.max(top, b.y);
        if (b.y > 0.5) above++;
      }
    }
    // Loaded buckets ride the −x strand from the foot all the way up, past the shaft mouth, to the sheave.
    expect(top).toBeGreaterThan(Models.SHEAVE_Y - 0.3);
    expect(top).toBeLessThanOrEqual(Models.SHEAVE_Y + 1e-6);
    expect(above).toBeGreaterThan(0);
    // Empties come down the +x strand from the sheave, inside the strand and forward of it, so the rock right of a
    // 1-wide shaft (cameras look from +x) does not hide them.
    const empties = drawn(view, 'factory-bucket').filter((b) => b.sx < 0);
    expect(empties.length).toBeGreaterThan(10);
    for (const b of empties) {
      expect(b.x).toBeGreaterThan(col + 0.5);
      expect(b.x).toBeLessThanOrEqual(col + 0.7);
      expect(b.z).toBeGreaterThan(Models.LIFT_Z);
    }
    expect(empties.some((b) => b.y > 0.5)).toBe(true); // under the Headframe too
    // Only buckets on the rows in view are placed (the sim fills whole lifts).
    view.update(frame(f, { yardRect: null, mineRect: { plane: 'mine', x0: 10, y0: 20, x1: 30, y1: 26 } }));
    const shown = drawn(view, 'factory-bucket');
    expect(shown.length).toBeGreaterThan(0);
    for (const b of shown) {
      expect(b.y).toBeLessThan(-20 + 0.6);
      expect(b.y).toBeGreaterThan(-27 - 0.6);
    }
    // The Yard alone still shows what climbs the Headframe's tower.
    view.update(frame(f, { mineRect: null }));
    for (const b of drawn(view, 'factory-bucket')) expect(b.y).toBeGreaterThan(-1.6);
  });
});

describe('factory render: build overlays (03 §4.3, §4.9, §4.10)', () => {
  it('outlines ghosts with a depth prepass and a crisp silhouette edge in the late pass', () => {
    const { f } = onboarded();
    const view = new FactoryView(new MaterialKit(), 'toon');
    const build: BuildFrame = { plane: 'yard', cursor: { x: 2, y: 2 }, preview: { kind: 'smelter', mk: 1, x: 2, y: 2, w: 2, h: 2, dir: 0, valid: false }, bulldoze: false, selectedId: null };
    view.update(frame(f, { build }));
    const body = mesh(view, 'factory-ghost-smelter');
    const depth = mesh(view, 'factory-ghost-smelter-depth');
    const edge = mesh(view, 'factory-ghost-smelter-edge');
    expect([depth.count, edge.count]).toEqual([body.count, body.count]);
    expect(body.count).toBe(1);
    // Prepass (depth only) → outline (inverted hull) → translucent body, all on the late layer.
    expect([depth.renderOrder, edge.renderOrder, body.renderOrder]).toEqual([7, 7.5, 8]);
    expect(depth.layers.mask).toBe(body.layers.mask);
    expect(edge.layers.mask).toBe(body.layers.mask);
    expect(body.layers.mask).toBe(1 << LAYER_LATE);
    const dm = depth.material as Material;
    expect([dm.colorWrite, dm.depthWrite]).toEqual([false, true]);
    expect((edge.material as Material).side).toBe(BackSide);
    expect((edge.material as Material).depthWrite).toBe(false);
    // The outline shares the instance data (the invalid style, the red tint) and has welded normals of its own.
    expect(edge.instanceMatrix).toBe(body.instanceMatrix);
    expect(edge.instanceColor).toBe(body.instanceColor);
    expect(edge.geometry.getAttribute('hfGhost')).toBe(body.geometry.getAttribute('hfGhost'));
    expect(edge.geometry.getAttribute('normal')).not.toBe(body.geometry.getAttribute('normal'));
    // The cursor draws before the prepass, so the ghost tints it instead of hiding it.
    let cursorOrder = -1;
    view.root.traverse((o) => {
      if (o.name === 'factory-cursor') cursorOrder = o.renderOrder;
    });
    expect(cursorOrder).toBeLessThan(depth.renderOrder);
    // Width: 1.5 CSS px × the render DPR in Toon, one low-res texel in Pixel Lab (set by the renderer).
    view.setGhostEdge(3, 750, 1334);
    const u = (edge.material as unknown as { uniforms: Record<string, { value: { x?: number; y?: number } | number }> }).uniforms;
    expect(u.uPx.value).toBe(3);
    expect(u.uRes.value).toMatchObject({ x: 750, y: 1334 });
  });

  it('fades a Yard building to a see-through copy while it hides the cursor or the selection (yaw 45°)', () => {
    const { f } = onboarded();
    const view = new FactoryView(new MaterialKit(), 'toon');
    const col = ONBOARD.column;
    const smelter = f.entities().find((e) => e.kind === 'smelter');
    if (!smelter) throw new Error('no smelter');
    expect([smelter.x, smelter.y]).toEqual([col, 4]);
    // The belt tile on row 6 sits right behind the Smelter seen from the default yaw (45°, pitch 55°).
    const build: BuildFrame = { plane: 'yard', cursor: { x: col, y: 6 }, preview: null, bulldoze: false, selectedId: null };
    view.update(frame(f, { build }));
    expect(inst(view, 'factory-smelter', 0)[2]).toBeGreaterThanOrEqual(INST_HIDDEN);
    expect(count(view, 'factory-xray-smelter')).toBe(1);
    const xg = mesh(view, 'factory-xray-smelter');
    expect((xg.geometry.getAttribute('hfGhost') as BufferAttribute).getY(0)).toBe(GHOST_STYLE.XRAY);
    expect((xg.geometry.getAttribute('hfGhost') as BufferAttribute).getX(0)).toBeCloseTo(0.4, 6);
    expect(xg.renderOrder).toBeGreaterThan(mesh(view, 'factory-ghost-belt').renderOrder);
    // A painted belt behind it does the same; so does the selected Bin behind it.
    view.update(frame(f, { build: { ...build, cursor: null, preview: { kind: 'belt', mk: 1, x: col - 1, y: 6, w: 1, h: 1, dir: 0, valid: true, path: [{ x: col - 2, y: 6 }, { x: col - 1, y: 6 }, { x: col, y: 6 }] } } }));
    expect(count(view, 'factory-xray-smelter')).toBe(1);
    // The cursor on open ground in front of everything: nothing fades, the Smelter is solid again.
    view.update(frame(f, { build: { ...build, cursor: { x: col + 6, y: 2 } } }));
    expect(count(view, 'factory-xray-smelter')).toBe(0);
    expect(inst(view, 'factory-smelter', 0)[2]).toBe(0);
    // The building under the cursor itself never fades, nor anything outside build mode.
    view.update(frame(f, { build: { ...build, cursor: { x: col, y: 4 } } }));
    expect(inst(view, 'factory-smelter', 0)[2]).toBeLessThan(INST_HIDDEN);
    view.update(frame(f, { build: null }));
    expect(count(view, 'factory-xray-smelter')).toBe(0);
  });

  it('sizes status bubbles to 28 pt on screen at every zoom, in whole texels in Pixel Lab (03 §4.10)', () => {
    const { f } = onboarded();
    const view = new FactoryView(new MaterialKit(), 'toon');
    const scale = (): number => {
      const e = mesh(view, 'factory-bubbles').instanceMatrix.array as Float32Array;
      return Math.hypot(e[0], e[1], e[2]);
    };
    for (const ppu of [36, 39, 41, 47, 64]) {
      const pose = buildPose({ plane: 'yard', cx: ONBOARD.column, cy: 5, ppu, yaw: 0 }, newPose());
      view.update(frame(f, { pose }));
      expect(count(view, 'factory-bubbles')).toBeGreaterThanOrEqual(1); // the fresh Smelter has no input
      expect(scale() * pose.ppu).toBeCloseTo(BUBBLE_PT, 4);
    }
    const pose = buildPose({ plane: 'yard', cx: ONBOARD.column, cy: 5, ppu: 39, yaw: 0 }, newPose());
    const texel = 4 / (39 * 3) + 0.003;
    view.update(frame(f, { pose, texel }));
    const texels = scale() / texel;
    expect(texels).toBeCloseTo(Math.round(texels), 4);
    expect(Math.abs(scale() * 39 - BUBBLE_PT)).toBeLessThan(texel * 39);
  });

  it('shares one status → glyph table: storage, Headframes and lifts never claim “no input” (03 §4.10)', () => {
    expect(statusGlyph('smelter', 'idle')).toBe(BUBBLE_GLYPH.NO_INPUT);
    expect(statusGlyph('assembler', 'idle')).toBe(BUBBLE_GLYPH.NO_INPUT);
    for (const k of ['bin', 'export', 'headframe', 'lift', 'autoDrill', 'router'] as const) expect(statusGlyph(k, 'idle'), k).toBe(-1);
    expect(statusGlyph('bin', 'blocked')).toBe(-1); // storage carries no bubble at all
    expect(statusGlyph('smelter', 'blocked')).toBe(BUBBLE_GLYPH.FULL);
    expect(statusGlyph('export', 'noOutput')).toBe(BUBBLE_GLYPH.DISCONNECTED);
    expect(statusGlyph('assembler', 'noRecipe')).toBe(BUBBLE_GLYPH.NO_RECIPE);
    expect(statusGlyph('smelter', 'working')).toBe(-1);
    for (const g of Object.values(BUBBLE_GLYPH)) expect(BUBBLE_TEXT[g]).toBeTruthy();
  });
});

describe('factory render: models and items (03 §8.4, §8.6; canon §3.1; 04 §5.9)', () => {
  const pieces: [string, () => import('three').BufferGeometry, number, number][] = [
    ['smelter', Models.smelterGeometry, 600, 1.6],
    ['assembler', Models.assemblerGeometry, 600, 1.6],
    ['bin', Models.binGeometry, 600, 1.6],
    ['export', Models.exportGeometry, 600, 1.6],
    ['headframe', Models.headframeGeometry, 600, 3],
    ['autoDrill', Models.autoDrillGeometry, 600, 1],
    ['router', Models.routerGeometry, 300, 0.6],
    ['belt', Models.beltStraightGeometry, 40, 0.2],
    ['beltCorner', Models.beltCornerGeometry, 50, 0.2],
    ['junction', Models.beltJunctionGeometry, 80, 0.2],
    ['chevron', Models.chevronGeometry, 8, 0.1],
  ];

  it('keeps every piece within its triangle cap, height and footprint, with part data on every vertex', () => {
    for (const [name, make, cap, top] of pieces) {
      const g = make();
      const pos = g.getAttribute('position');
      expect(pos.count / 3, name).toBeLessThanOrEqual(cap);
      g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!bb) throw new Error('no bounds');
      expect(bb.max.y, name).toBeLessThanOrEqual(top + 0.1);
      const half = name === 'router' || name.startsWith('belt') || name === 'junction' || name === 'chevron' ? 0.5 : 1;
      expect(bb.min.x, name).toBeGreaterThanOrEqual(-half - 0.01);
      expect(bb.max.x, name).toBeLessThanOrEqual(half + 0.01);
      expect(g.getAttribute('hfPart').count).toBe(pos.count);
      expect(g.getAttribute('color').count).toBe(pos.count);
    }
    // Occupants stay inside the pod layer (canon §3.1: −0.45…+0.45, ± a stud).
    const drill = Models.autoDrillGeometry();
    drill.computeBoundingBox();
    expect(drill.boundingBox?.max.z).toBeLessThanOrEqual(0.5);
  });

  it('tags rust decals, LEDs, furnace glow and chevrons for the factory shader', () => {
    const flagsOf = (g: import('three').BufferGeometry): Set<number> => {
      const a = g.getAttribute('hfPart');
      const s = new Set<number>();
      for (let i = 0; i < a.count; i++) s.add(a.getY(i));
      return s;
    };
    const smelter = [...flagsOf(Models.smelterGeometry())];
    expect(smelter.some((f) => f & PART_FLAG.RUST)).toBe(true);
    expect(smelter.some((f) => f & PART_FLAG.LED)).toBe(true);
    expect(smelter.some((f) => f & PART_FLAG.GLOW)).toBe(true);
    expect(smelter.every((f) => f & PART_FLAG.BREATHE)).toBe(true);
    const chev = Models.chevronGeometry().getAttribute('hfPart');
    const phases = new Set<number>();
    for (let i = 0; i < chev.count; i++) {
      expect(chev.getY(i) & PART_FLAG.CHEVRON).toBeTruthy();
      phases.add(chev.getZ(i));
    }
    expect([...phases].sort()).toEqual([0, 0.5]);
  });

  it('gives every item a shape family and the 03 §8.4 colours', () => {
    const table = buildItemTable();
    for (const d of ITEMS) expect(table.family[d.num], d.id).not.toBe(255);
    expect(itemLook(item('copperOre'))).toEqual({ shape: 'chunk', hex: ORES[1].base });
    expect(itemLook(item('spec3'))).toEqual({ shape: 'chunk', hex: ORES[2].base });
    expect(itemLook(item('copperIngot')).shape).toBe('ingot');
    expect(itemLook(item('gear'))).toEqual({ shape: 'gear', hex: 0xffffff });
    expect(itemLook(item('drillBit')).shape).toBe('bit');
    expect(itemLook(item('kit:autoDrill')).shape).toBe('crate');
    expect(new Set(table.shapes).size).toBe(table.shapes.length);
    for (const s of table.shapes) expect(Models.itemGeometry(s).getAttribute('position').count / 3, s).toBeLessThanOrEqual(100);
  });

  it('draws every bubble glyph as a 16 × 16 cell of the atlas', () => {
    const atlas = createGlyphAtlas();
    const glyphs = Object.keys(BUBBLE_GLYPH).length;
    const { width, height, data } = atlas.image as { width: number; height: number; data: Uint8Array };
    expect([width, height]).toEqual([16 * glyphs, 16]);
    for (let g = 0; g < glyphs; g++) {
      let lit = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (data[(y * width + g * 16 + x) * 4 + 3] > 0) lit++;
      expect(lit, `glyph ${g}`).toBeGreaterThan(20);
    }
  });

  it('compiles the factory variants into three r186 toon chunks in both looks', () => {
    const kit = new MaterialKit();
    for (const kind of ['factory', 'factoryHull'] as const) {
      for (const look of ['toon', 'pixel'] as const) {
        const m = createShadedMaterial(kind, look, kit.uniforms, { vertexColors: true });
        const shader = { vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms;
        m.onBeforeCompile(shader, null as unknown as WebGLRenderer);
        expect('HF_FACTORY' in (m.defines ?? {})).toBe(true);
        expect('HF_HULL' in (m.defines ?? {})).toBe(kind === 'factoryHull');
        expect(m.side === BackSide).toBe(kind === 'factoryHull');
        expect(shader.vertexShader).toContain('float hfDrop = 0.0;');
        expect(shader.vertexShader).toContain('attribute vec4 hfInst;');
        expect(shader.fragmentShader).toContain('hfLedColor(vHfInst.w)');
        expect(m.customProgramCacheKey()).toBe(`hf:${kind}:${look}`);
      }
    }
    expect(kit.factory('toon')).toBe(kit.factory('toon'));
    expect(kit.materialsFor('pixel')).toContain(kit.factory('pixel'));
  });
});
