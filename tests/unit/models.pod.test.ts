import { Box3, BufferAttribute, Mesh, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { LINES, POD_D, POD_H, POD_W, type Line } from '../../src/shared/canon';
import type { PodVisualState } from '../../src/render/models/api';
import { MAT_ROLES, countTriangles, listMeshes } from '../../src/render/models/kit';
import { createPodModel } from '../../src/render/models/pod';
import { tierStep } from '../../src/render/models/pod-parts';

function tiers(t: number, overrides: Partial<Record<Line, number>> = {}): Record<Line, number> {
  const out = {} as Record<Line, number>;
  for (const l of LINES) out[l] = overrides[l] ?? t;
  return out;
}

function state(patch: Partial<PodVisualState> = {}): PodVisualState {
  return {
    x: 10,
    y: POD_H / 2,
    facing: 1,
    thrust: 0,
    digging: false,
    digDir: null,
    grounded: true,
    vx: 0,
    vy: 0,
    tiers: tiers(1),
    timeMs: 0,
    fastFall: false,
    ...patch,
  };
}

function byName(root: Object3D, name: string): Mesh {
  const m = root.getObjectByName(name);
  if (!(m instanceof Mesh)) throw new Error(`missing ${name}`);
  return m;
}

/** World-space bounds over the drawn vertices of visible meshes. */
function drawnBounds(root: Object3D): Box3 {
  root.updateMatrixWorld(true);
  const box = new Box3();
  const v = new Vector3();
  for (const m of listMeshes(root)) {
    if (!m.visible) continue;
    const p = m.geometry.getAttribute('position') as BufferAttribute;
    const n = Math.min(p.count, m.geometry.drawRange.count);
    for (let i = 0; i < n; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
  }
  return box;
}

describe('Pip pod model', () => {
  it('tags every mesh with a role and vertex colours, within the mesh budget', () => {
    const pod = createPodModel();
    const meshes = listMeshes(pod.root);
    expect(meshes.length).toBeLessThanOrEqual(8);
    for (const m of meshes) {
      expect(MAT_ROLES).toContain(m.userData.mat);
      expect(m.geometry.getAttribute('color')).toBeDefined();
    }
  });

  it('stays within 3,000 triangles at every tier', () => {
    const pod = createPodModel();
    for (let t = 1; t <= 7; t++) {
      pod.update(state({ tiers: tiers(t), timeMs: t * 16, thrust: 1 }));
      expect(countTriangles(pod.root)).toBeLessThanOrEqual(3000);
    }
  });

  it('fits the 0.86 × 0.78 × 0.8 pod box at rest at every tier (antenna, fan and dish may poke out a little)', () => {
    for (let t = 1; t <= 7; t++) {
      const pod = createPodModel();
      pod.update(state({ x: 0, y: 0, tiers: tiers(t) }));
      const b = drawnBounds(pod.root);
      expect(b.max.x - b.min.x).toBeLessThanOrEqual(POD_W + 0.06);
      expect(b.max.z - b.min.z).toBeLessThanOrEqual(POD_D + 0.02);
      expect(b.min.y).toBeGreaterThanOrEqual(-POD_H / 2 - 0.03);
      expect(b.max.y).toBeLessThanOrEqual(POD_H / 2 + 0.11);
    }
  });

  it('switches drill, flame and body variants per geometry step, and trims per tier', () => {
    const pod = createPodModel();
    const drill = byName(pod.root, 'pod-drill');
    const flame = byName(pod.root, 'pod-flame');
    const body = byName(pod.root, 'pod-body');
    const metal = byName(pod.root, 'pod-metal');
    const snapshot = () => ({
      drill: drill.geometry.uuid,
      flame: flame.geometry.uuid,
      body: body.geometry.drawRange.count,
      metal: metal.geometry.drawRange.count,
    });
    pod.update(state({ tiers: tiers(1) }));
    const t1 = snapshot();
    pod.update(state({ tiers: tiers(3), timeMs: 16 }));
    const t3 = snapshot();
    pod.update(state({ tiers: tiers(6), timeMs: 32 }));
    const t6 = snapshot();
    for (const k of ['drill', 'flame', 'body', 'metal'] as const) {
      expect(t3[k]).not.toEqual(t1[k]);
      expect(t6[k]).not.toEqual(t3[k]);
    }
    // Every body line changes the composed geometry when it crosses a step.
    for (const line of ['hull', 'engine', 'tank', 'radiator', 'bay', 'scanner'] as const) {
      pod.update(state({ tiers: tiers(1), timeMs: 48 }));
      const before = snapshot();
      pod.update(state({ tiers: tiers(1, { [line]: 6 }), timeMs: 64 }));
      const after = snapshot();
      expect(after.body !== before.body || after.metal !== before.metal, line).toBe(true);
    }
    // t1 → t2 keeps geometry but repaints the drill collar (steel → copper).
    pod.update(state({ tiers: tiers(1), timeMs: 80 }));
    const d1 = drill.geometry;
    pod.update(state({ tiers: tiers(2), timeMs: 96 }));
    expect(tierStep(1)).toBe(tierStep(2));
    expect(drill.geometry).not.toBe(d1);
    expect(drill.geometry.getAttribute('position').count).toBe(d1.getAttribute('position').count);
  });

  it('never reallocates its buffers when tiers or tint change', () => {
    const pod = createPodModel();
    const body = byName(pod.root, 'pod-body');
    const arrays = ['position', 'normal', 'color'].map((a) => body.geometry.getAttribute(a).array);
    const geometry = body.geometry;
    for (let i = 0; i < 50; i++) pod.update(state({ tiers: tiers((i % 7) + 1), fastFall: i % 3 === 0, timeMs: i * 16 }));
    expect(body.geometry).toBe(geometry);
    ['position', 'normal', 'color'].forEach((a, i) => expect(body.geometry.getAttribute(a).array).toBe(arrays[i]));
  });

  it('tints amber on fast falls', () => {
    const pod = createPodModel();
    const color = byName(pod.root, 'pod-body').geometry.getAttribute('color') as BufferAttribute;
    pod.update(state());
    const before = [color.getX(0), color.getY(0), color.getZ(0)];
    pod.update(state({ fastFall: true, grounded: false, timeMs: 16 }));
    const after = [color.getX(0), color.getY(0), color.getZ(0)];
    expect(after).not.toEqual(before);
    expect(after[2]).toBeLessThan(before[2]); // amber pulls blue down
    pod.update(state({ fastFall: false, timeMs: 32 }));
    expect([color.getX(0), color.getY(0), color.getZ(0)]).toEqual(before);
  });

  it('points and spins the drill where it digs, mirrored by facing', () => {
    const pod = createPodModel();
    const drill = byName(pod.root, 'pod-drill');
    const tipWorld = () => {
      pod.root.updateMatrixWorld(true);
      const g = drill.geometry;
      g.computeBoundingBox();
      return new Vector3(0, g.boundingBox!.min.y, 0).applyMatrix4(drill.matrixWorld);
    };
    let t = 0;
    for (let i = 0; i < 40; i++) pod.update(state({ x: 0, y: 0, digging: true, digDir: 'right', timeMs: (t += 16) }));
    expect(tipWorld().x).toBeGreaterThan(0.5);
    const spinA = drill.rotation.y;
    pod.update(state({ x: 0, y: 0, digging: true, digDir: 'right', timeMs: (t += 16) }));
    expect(drill.rotation.y).not.toBeCloseTo(spinA, 5);
    for (let i = 0; i < 40; i++) pod.update(state({ x: 0, y: 0, facing: -1, digging: true, digDir: 'left', timeMs: (t += 16) }));
    expect(tipWorld().x).toBeLessThan(-0.5);
    for (let i = 0; i < 40; i++) pod.update(state({ x: 0, y: 0, digging: true, digDir: 'down', timeMs: (t += 16) }));
    const tip = tipWorld();
    expect(tip.y).toBeLessThan(-POD_H / 2 - 0.1);
    expect(Math.abs(tip.x)).toBeLessThan(0.2);
  });

  it('animates flame with thrust, lean with vx, landing squash and the LED blink', () => {
    const pod = createPodModel();
    const flame = byName(pod.root, 'pod-flame');
    pod.update(state());
    expect(flame.visible).toBe(false);
    pod.update(state({ thrust: 1, timeMs: 16 }));
    expect(flame.visible).toBe(true);
    const tall = flame.scale.y;
    pod.update(state({ thrust: 0.3, timeMs: 32 }));
    expect(flame.scale.y).toBeLessThan(tall);

    let t = 100;
    for (let i = 0; i < 60; i++) pod.update(state({ vx: 4.5, grounded: false, timeMs: (t += 16) }));
    const lean = pod.root.children[0].rotation.z;
    expect(lean).toBeLessThan(-0.1);
    expect(lean).toBeGreaterThan(-(8 * Math.PI) / 180 - 1e-6);

    pod.update(state({ grounded: false, vy: -8, timeMs: (t += 16) }));
    pod.update(state({ grounded: true, timeMs: (t += 16) }));
    const squash = pod.root.children[0].children[0].scale;
    expect(squash.y).toBeLessThan(0.95);
    expect(squash.x).toBeGreaterThan(1.05);

    const led = byName(pod.root, 'pod-led');
    const seen = new Set<boolean>();
    for (let i = 0; i < 20; i++) {
      pod.update(state({ timeMs: 2000 + i * 60 }));
      seen.add(led.visible);
    }
    expect(seen.size).toBe(2);
  });

  it('flips with facing', () => {
    const pod = createPodModel();
    let t = 0;
    for (let i = 0; i < 30; i++) pod.update(state({ facing: -1, timeMs: (t += 16) }));
    const facing = pod.root.children[0].children[0].children[0];
    expect(facing.scale.x).toBeLessThan(-0.9);
  });
});
