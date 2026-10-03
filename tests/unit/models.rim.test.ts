import { Box3, BufferAttribute, Vector3, type Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { RIM_BUILDINGS } from '../../src/shared/canon';
import { MAT_ROLES, countTriangles, listMeshes } from '../../src/render/models/kit';
import { ALL_PADS_ARMED } from '../../src/render/models/api';
import { PAD_COLOURS, createRimBuildings, padPulse, rimFootprint } from '../../src/render/models/rim';

function worldBounds(root: Object3D): Box3 {
  root.updateMatrixWorld(true);
  const box = new Box3();
  const v = new Vector3();
  for (const m of listMeshes(root)) {
    const p = m.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
  }
  return box;
}

describe('Rim buildings', () => {
  const rim = createRimBuildings();
  const buildings = rim.root.children.filter((g) => g.userData.rimId !== undefined);

  it('builds the four services, each ≤ 4 role-tagged, vertex-coloured meshes and ≤ 2,500 triangles', () => {
    expect(buildings).toHaveLength(4);
    for (const group of buildings) {
      const meshes = listMeshes(group);
      expect(meshes.length).toBeLessThanOrEqual(4);
      for (const m of meshes) {
        expect(MAT_ROLES).toContain(m.userData.mat);
        expect(m.geometry.getAttribute('color')).toBeDefined();
        expect(m.userData.rimId).toBe(group.userData.rimId);
      }
      expect(countTriangles(group)).toBeLessThanOrEqual(2500);
    }
  });

  it('keeps each building on its 4×3 footprint on Yard rows 1–3 and ≤ 3 units tall (canon §2.4, §3.1)', () => {
    for (const b of RIM_BUILDINGS) {
      const group = rim.root.children.find((g) => g.userData.rimId === b.id)!;
      for (let t = 0; t < 4000; t += 500) rim.update(t);
      const box = worldBounds(group);
      const f = rimFootprint(b.id);
      expect(f.x1 - f.x0).toBe(4);
      expect(f.z1 - f.z0).toBe(3);
      expect(box.min.x).toBeGreaterThanOrEqual(f.x0 - 0.1);
      expect(box.max.x).toBeLessThanOrEqual(f.x1 + 0.1);
      expect(box.min.z).toBeGreaterThanOrEqual(-4.1);
      expect(box.max.z).toBeLessThanOrEqual(-1 + 0.05);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(box.max.y).toBeLessThanOrEqual(3 + 1e-4);
    }
  });

  it('exposes a sign anchor above each building', () => {
    for (const b of RIM_BUILDINGS) {
      const a = rim.signAnchors[b.id];
      expect(a).toBeInstanceOf(Vector3);
      expect(a.x).toBeGreaterThanOrEqual(b.x0);
      expect(a.x).toBeLessThanOrEqual(b.x1 + 1);
      expect(a.y).toBeGreaterThan(2.5);
      expect(a.z).toBeLessThan(-1);
    }
  });

  it('animates signs and blinks lights', () => {
    const signs = buildings.map((g) => g.getObjectByName(`rim-${g.userData.rimId}-sign`) as Mesh);
    rim.update(0);
    const before = signs.map((s) => s.rotation.clone());
    rim.update(1300);
    signs.forEach((s, i) => expect(s.rotation.equals(before[i])).toBe(false));
    const beacon = rim.root.getObjectByName('rim-pump-lights')!;
    const seen = new Set<boolean>();
    for (let t = 0; t < 2000; t += 100) {
      rim.update(t);
      seen.add(beacon.visible);
    }
    expect(seen.size).toBe(2);
  });

  it('pulses armed pads in the building colour and dims disarmed ones (03 §6.4)', () => {
    const caps = rim.root.getObjectByName('rim-pad-caps') as Mesh;
    const pools = rim.root.getObjectByName('rim-pad-pools') as Mesh;
    const capColours = (): Float32Array => (caps.geometry.getAttribute('color') as BufferAttribute).array as Float32Array;
    rim.update(0, ALL_PADS_ARMED);
    const lit = Float32Array.from(capColours());
    const pumpOnly = 1 << RIM_BUILDINGS.findIndex((b) => b.id === 'pump');
    rim.update(0, pumpOnly);
    const dimmed = capColours();
    const perPad = lit.length / RIM_BUILDINGS.length;
    const sum = (a: Float32Array, pad: number): number => a.subarray(pad * perPad, (pad + 1) * perPad).reduce((s, v) => s + v, 0);
    for (let pad = 0; pad < RIM_BUILDINGS.length; pad++) {
      if (1 << pad === pumpOnly) expect(sum(dimmed, pad)).toBeCloseTo(sum(lit, pad), 4);
      else expect(sum(dimmed, pad)).toBeLessThan(sum(lit, pad) * 0.3);
    }
    expect(pools.visible).toBe(true);
    rim.update(0, 0);
    expect(pools.visible).toBe(false);
    expect(Object.keys(PAD_COLOURS).sort()).toEqual(RIM_BUILDINGS.map((b) => b.id).sort());
  });

  it('breathes the pad pools while animating and holds them steady in battery mode', () => {
    const levels = new Set<number>();
    for (let t = 0; t < 2; t += 0.1) levels.add(Math.round(padPulse(t, true) * 100));
    expect(levels.size).toBeGreaterThan(5);
    expect(padPulse(0.3, false)).toBe(padPulse(1.7, false));
    const sign = buildings[0].getObjectByName(`rim-${buildings[0].userData.rimId}-sign`) as Mesh;
    rim.update(0, ALL_PADS_ARMED, false);
    const held = sign.rotation.clone();
    rim.update(900, ALL_PADS_ARMED, false);
    expect(sign.rotation.equals(held)).toBe(true);
  });
});
