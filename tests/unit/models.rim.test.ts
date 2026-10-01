import { Box3, BufferAttribute, Vector3, type Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { RIM_BUILDINGS } from '../../src/shared/canon';
import { MAT_ROLES, countTriangles, listMeshes } from '../../src/render/models/kit';
import { createRimBuildings, rimFootprint } from '../../src/render/models/rim';

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

  it('builds the four services, each ≤ 4 role-tagged, vertex-coloured meshes and ≤ 2,500 triangles', () => {
    expect(rim.root.children).toHaveLength(4);
    for (const group of rim.root.children) {
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
    const signs = rim.root.children.map((g) => g.getObjectByName(`rim-${g.userData.rimId}-sign`) as Mesh);
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
});
