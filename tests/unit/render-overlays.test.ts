// Render overlays from the MVP review leftovers: the access chevrons over the scripted lode's dig (PLAYER-3; 03 §4.6,
// 01 §2.5), the build ring chip and its stalled state (PLAYER-6; 03 §3.5) and the output colour-space encode every
// custom shader needs on production Toon's direct canvas (BUILD-10: coral and the old invalid red both drew pure red).
import { InstancedMesh, Matrix4, Mesh, ShaderMaterial, Vector2, Vector3, type Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CHUNK } from '../../src/shared/canon';
import { T, type Lode } from '../../src/shared/types';
import type { EntityView, FactoryApi, GhostView } from '../../src/factory/api';
import { ACCESS_MAX, AccessChevrons, accessColumn, accessLastRow, accessRows, accessStamp, drillOnLode, type AccessWorld } from '../../src/render/accessChevrons';
import { FactoryView } from '../../src/render/factory/view';
import { OreGlows } from '../../src/render/glows';
import { MaterialKit } from '../../src/render/materials';
import { BUILD_RING_SIZE, Overlays } from '../../src/render/overlay';
import { World } from '../../src/world/world';
import { makeGrid } from './factory.helpers';

/** A fresh MVP claim (seed 7: the scripted Copper lode at x0 27, top r46; Dot's shaft in column 26). */
function claim(): { w: World; lode: Lode } {
  const w = new World({ seed: 7, scope: 'mvp' });
  const lode = w.terrain.lodes.find((l) => l.id === w.meta.scriptedLodeId);
  if (!lode) throw new Error('no scripted lode');
  return { w, lode };
}

function named(root: Object3D, name: string): Mesh {
  let m: Mesh | null = null;
  root.traverse((o) => {
    if (o instanceof Mesh && o.name === name) m = o;
  });
  if (!m) throw new Error(`no mesh ${name}`);
  return m;
}

/** World positions of the drawn chevrons (instance translations). */
function marks(ac: AccessChevrons): { x: number; y: number; z: number }[] {
  const mesh = named(ac.root, 'access-chevron-marks') as InstancedMesh;
  const out: { x: number; y: number; z: number }[] = [];
  const m = new Matrix4();
  const v = new Vector3();
  for (let i = 0; i < ac.count; i++) {
    mesh.getMatrixAt(i, m);
    v.setFromMatrixPosition(m);
    out.push({ x: v.x, y: v.y, z: v.z });
  }
  return out;
}

describe('access chevrons (PLAYER-3; 03 §4.6, 01 §2.5)', () => {
  it('marks the access column x0 + 1 from the Rim down to the drill footprint’s top row: 45 digs above an r46 lode', () => {
    const { w, lode } = claim();
    expect([lode.x0, lode.top]).toEqual([27, 46]);
    expect(accessColumn(lode)).toBe(28);
    expect(accessLastRow(lode)).toBe(44);
    // The drill footprint (02 §2.4) holds the access column on either side of Dot's shaft.
    const drill = w.factory!.surveyPlan().drill;
    expect(accessColumn(lode)).toBeGreaterThanOrEqual(drill.x);
    expect(accessColumn(lode)).toBeLessThanOrEqual(drill.x + 1);
    expect(drill.y).toBe(accessLastRow(lode));
    // Through solid rock that is 45 digs, rows 0–44; cavern cells already open are skipped.
    const solid = makeGrid();
    expect(accessRows(solid, { x0: 20, top: 46 }, [])).toEqual(Array.from({ length: 45 }, (_, r) => r));
    for (const r of [3, 9, 10]) solid.set(21, r, T.AIR);
    expect(accessRows(solid, { x0: 20, top: 46 }, [])).toHaveLength(42);
    expect(accessRows(solid, { x0: 20, top: 46 }, [])).not.toContain(9);
  });

  it('draws nothing until the scripted lode is discovered, then a chevron on every still-solid cell and the Rim post', () => {
    const { w, lode } = claim();
    const ac = new AccessChevrons();
    ac.update(w, 0, true);
    expect(ac.count).toBe(0);
    expect(ac.post.visible).toBe(false);
    w.factory!.discoverLode(lode.id, true);
    ac.update(w, 0, true);
    const rows = accessRows(w.terrain, lode, []);
    expect(rows.length).toBeGreaterThan(20); // seed 7 crosses a few caverns on the way down
    expect(ac.count).toBe(rows.length);
    expect(ac.post.visible).toBe(true);
    const at = marks(ac);
    expect(at.map((p) => p.x)).toEqual(rows.map(() => 28.5));
    expect(at.map((p) => p.y)).toEqual(rows.map((r) => -(r + 0.5)));
    expect(at.every((p) => p.z === 0.5)).toBe(true);
    expect(rows[0]).toBe(0);
    expect(rows.at(-1)).toBeLessThanOrEqual(accessLastRow(lode));
    // The post stands on the Rim at the mouth, beside the pod's path down the column.
    expect(ac.post.position.y).toBe(0);
    expect(Math.abs(ac.post.position.x - 28.5)).toBeLessThan(1);
    expect(Math.abs(ac.post.position.x - 28.5)).toBeGreaterThan(0.45);
    // One instanced draw on the late layer, never more than its capacity.
    expect(named(ac.root, 'access-chevron-marks').layers.mask).toBe(1 << 1);
    expect(ACCESS_MAX).toBeGreaterThanOrEqual(45);
  });

  it('drops each chevron as its cell is dug and rebuilds only when the column’s chunks change', () => {
    const { w, lode } = claim();
    w.factory!.discoverLode(lode.id, true);
    const ac = new AccessChevrons();
    ac.update(w, 0, true);
    const spy = vi.spyOn(InstancedMesh.prototype, 'setMatrixAt');
    // Frames with nothing changed, or a change that is not a mesh change (SEEN), rebuild nothing.
    ac.update(w, 16, true);
    w.terrain.setFlag(28, 10, 1);
    ac.update(w, 32, true);
    expect(spy).not.toHaveBeenCalled();
    // A cell far from the column (another chunk) moves no stamp.
    const stamp = accessStamp(w.terrain, lode);
    w.terrain.set(2, 100, T.AIR);
    expect(accessStamp(w.terrain, lode)).toBe(stamp);
    // Pip digs the first three solid cells of the column.
    const rows = accessRows(w.terrain, lode, []);
    for (const r of rows.slice(0, 3)) w.terrain.set(28, r, T.AIR);
    expect(accessStamp(w.terrain, lode)).toBeGreaterThan(stamp);
    ac.update(w, 48, true);
    expect(ac.count).toBe(rows.length - 3);
    expect(marks(ac)[0].y).toBe(-(rows[3] + 0.5));
    expect(spy).toHaveBeenCalledTimes(rows.length - 3);
    spy.mockRestore();
    // Dug through to the drill site: chevrons and post go.
    for (let r = 3; r <= 44; r++) w.terrain.set(28, r, T.AIR);
    ac.update(w, 64, true);
    expect(ac.count).toBe(0);
    expect(ac.post.visible).toBe(false);
    // The stamp spans exactly the chunks the dig rows cover.
    expect(Math.floor(44 / CHUNK)).toBe(2);
  });

  it('stops once a drill stands (or waits as a ghost) on the lode: the dig has nothing left to lead to', () => {
    const { lode } = claim();
    const drill = (kind: string, x: number, y: number): EntityView & GhostView => ({ kind, plane: 'mine', x, y, w: 2, h: 2 }) as unknown as EntityView & GhostView;
    const fake = (ents: EntityView[], ghosts: GhostView[]): Pick<FactoryApi, 'entities' | 'ghosts'> => ({ entities: () => ents, ghosts: () => ghosts });
    expect(drillOnLode(fake([], []), lode)).toBe(false);
    expect(drillOnLode(fake([drill('autoDrill', 27, 44)], []), lode)).toBe(true);
    expect(drillOnLode(fake([], [drill('autoDrill', 28, 44)]), lode)).toBe(true);
    expect(drillOnLode(fake([drill('autoDrill', 10, 44)], [drill('lift', 26, 0)]), lode)).toBe(false);
    // In the view: the chevrons go when the factory's structure gains the drill ghost.
    const { w } = claim();
    w.factory!.discoverLode(lode.id, true);
    let ghosts: GhostView[] = [];
    let topo = 1;
    const f = new Proxy(w.factory!, {
      get: (t, k) => (k === 'ghosts' ? () => ghosts : k === 'topologyVersion' ? topo : Reflect.get(t, k)),
    });
    const world: AccessWorld = { terrain: w.terrain, meta: w.meta, factory: f };
    const ac = new AccessChevrons();
    ac.update(world, 0, true);
    expect(ac.count).toBe(accessRows(w.terrain, lode, []).length);
    ghosts = [drill('autoDrill', 27, 44)];
    topo = 2;
    ac.update(world, 16, true);
    expect(ac.count).toBe(0);
    expect(ac.post.visible).toBe(false);
  });

  it('pulses at 1 Hz down the column, holds still with reduced motion and steps the pulse in Pixel Lab', () => {
    const { w, lode } = claim();
    w.factory!.discoverLode(lode.id, true);
    const ac = new AccessChevrons();
    const mat = named(ac.root, 'access-chevron-marks').material as ShaderMaterial;
    ac.update(w, 2500, true);
    expect(mat.uniforms.uPulse.value).toBe(1);
    expect(mat.uniforms.uTime.value).toBeCloseTo(2.5, 6);
    expect(mat.fragmentShader).toContain('sin(6.28318 * (uTime * 1.0 - vRow');
    ac.update(w, 2516, false);
    expect(mat.uniforms.uPulse.value).toBe(0);
    expect(mat.uniforms.uSteps.value).toBe(0);
    ac.setLook('pixel');
    expect(mat.uniforms.uSteps.value).toBe(3);
    ac.setLook('toon');
    expect(mat.uniforms.uSteps.value).toBe(0);
    // Screen-aligned (a down arrow at any camera angle), lifted off the face toward the camera.
    expect(mat.vertexShader).toContain('mv.xyz += position');
  });

  it('hides without a factory (M0 scope) and compiles behind the loader', () => {
    const { w, lode } = claim();
    lode.discovered = true;
    const ac = new AccessChevrons();
    ac.update({ terrain: w.terrain, meta: w.meta, factory: null }, 0, true);
    expect(ac.count).toBe(0);
    ac.setCompileVisible(true);
    expect(named(ac.root, 'access-chevron-marks').visible).toBe(true);
    expect(ac.post.visible).toBe(true);
    ac.setCompileVisible(false);
    expect(named(ac.root, 'access-chevron-marks').visible).toBe(false);
    expect(ac.post.visible).toBe(false);
  });
});

describe('build ring chip (PLAYER-6; 03 §3.5, canon §4.8)', () => {
  it('sweeps with the hold beside the pod, draws stalled while the job is refused, and hides with no job', () => {
    const o = new Overlays();
    o.updateBuildRing(null, 10.5, -20);
    expect(o.buildRingState).toBeNull();
    o.updateBuildRing({ progress: 0.4, blocked: null }, 10.5, -20);
    expect(o.buildRingState).toEqual({ stalled: false, progress: 0.4 });
    const ring = named(o.root, 'build-ring');
    // Up and to the right of the pod, clear of its hull (half a tile) and in front of the slab.
    expect(ring.position.x - BUILD_RING_SIZE / 2).toBeGreaterThan(10.5 + 0.4);
    expect(ring.position.y).toBeGreaterThan(-20);
    expect(ring.position.z).toBeGreaterThan(0.5);
    // Refused (E_POD): no sweep, the stalled look instead of a ring that keeps filling and failing.
    o.updateBuildRing({ progress: 0.98, blocked: 'E_POD' }, 10.5, -20);
    expect(o.buildRingState).toEqual({ stalled: true, progress: 0 });
    const fs = (ring.material as ShaderMaterial).fragmentShader;
    expect(fs).toContain('uStalled > 0.5');
    expect(fs).toContain('fract(t * 10.0)');
    // The refusal clears: the sweep is back.
    o.updateBuildRing({ progress: 1 / 60, blocked: null }, 10.5, -20);
    expect(o.buildRingState?.stalled).toBe(false);
  });
});

describe('custom shaders encode their output colour space (production Toon draws to the sRGB canvas)', () => {
  it('ends every colour-writing ShaderMaterial of the overlays, ghosts, bubbles, glows, chevrons and sky in the encode', () => {
    const kit = new MaterialKit();
    const roots: Object3D[] = [new FactoryView(kit, 'toon').root, new Overlays().root, new AccessChevrons().root];
    const mats: ShaderMaterial[] = [];
    for (const root of roots) {
      root.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m instanceof ShaderMaterial && m.colorWrite) mats.push(m);
      });
    }
    for (const look of ['toon', 'pixel'] as const) {
      mats.push(new OreGlows(look, { value: new Vector2() }).mesh.material as ShaderMaterial);
      mats.push(kit.sky(look) as ShaderMaterial);
    }
    const names = new Set(mats.map((m) => m.name));
    for (const n of ['hf-ghost', 'hf-ghost-outline', 'hf-bubble', 'hf-arming-ring', 'hf-build-ring', 'hf-access-chevron', 'hf-glow-toon', 'hf-sky-toon']) expect(names, n).toContain(n);
    for (const m of mats) expect(/#include <colorspace_fragment>|linearToOutputTexel\(/.test(m.fragmentShader), m.name).toBe(true);
  });
});
