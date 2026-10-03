import { BackSide, InstancedMesh, ShaderLib, type BufferAttribute, type InstancedBufferAttribute, type Material, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ITEMS, item } from '../../src/factory/items';
import type { BuildingKind, FactoryApi, ViewRect } from '../../src/factory/api';
import { MaterialKit } from '../../src/render/materials';
import { PART_FLAG } from '../../src/render/materials/glsl';
import { createShadedMaterial } from '../../src/render/materials/look';
import { ORES } from '../../src/render/palette';
import { SHAPE_CORNER, SHAPE_JUNCTION, SHAPE_STRAIGHT, beltTiles, pathTiles } from '../../src/render/factory/belts';
import { buildItemTable, itemLook } from '../../src/render/factory/itemLooks';
import * as Models from '../../src/render/factory/models';
import { BUBBLE_GLYPH, GHOST_STYLE, createGlyphAtlas } from '../../src/render/factory/overlayMaterials';
import { buildPose, newPose, screenRay } from '../../src/render/factory/projection';
import { FactoryView, dirAngle, type FactoryFrame } from '../../src/render/factory/view';
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
    for (const k of ['headframe', 'smelter', 'bin', 'autoDrill', 'liftRail', 'liftFoot', 'liftStrand']) expect(count(view, `factory-${k}`), k).toBe(1);
    expect(count(view, 'factory-liftHead')).toBe(0); // the top is the Rim: the Headframe's sheave takes over
    expect(count(view, 'factory-liftTie')).toBe(15);
    expect(count(view, 'factory-belt')).toBe(2);
    expect(count(view, 'factory-chevron')).toBe(2);
    expect(count(view, 'factory-sheave')).toBe(1);
    expect(inst(view, 'factory-smelter', 0)[1]).toBe(1); // rusted survey skin
    expect(inst(view, 'factory-autoDrill', 0)[1]).toBe(0);
    // The lift rails span the whole column: foot row 45 up to the Rim (y 0).
    const rails = mesh(view, 'factory-liftRail').instanceMatrix.array as Float32Array;
    expect(rails[5]).toBe(ONBOARD.top);
    expect(rails[13]).toBe(-ONBOARD.top);
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
