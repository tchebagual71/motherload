import { BufferAttribute, InstancedMesh, Matrix4, Vector3, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { RIM_BUILDINGS } from '../../src/shared/canon';
import { MAT_ROLES, countTriangles, listMeshes } from '../../src/render/models/kit';
import { createYardProps, headframeX0, isHeadframeColumn, surveyLayout } from '../../src/render/models/yard';

// Survey columns the generator can produce (canon §3.2: x0 − 1 or x0 + 3 beside the scripted lode, x 14–33).
const SURVEY_COLUMNS = Array.from({ length: 34 - 13 + 1 }, (_, i) => 13 + i).filter(isHeadframeColumn);

function maxYWithin(mesh: Mesh, x0: number, x1: number, z0: number, z1: number): number {
  const p = mesh.geometry.getAttribute('position') as BufferAttribute;
  let max = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) max = Math.max(max, p.getY(i));
  }
  return max;
}

describe('yard survey set and demo', () => {
  it('places the Headframe on {c, c+1}, or {c−1, c} when c+1 is invalid (02 §2.2)', () => {
    expect(headframeX0(14)).toBe(14);
    expect(headframeX0(29)).toBe(28);
    expect(headframeX0(9)).toBe(8);
    expect(headframeX0(34)).toBe(34);
    expect(headframeX0(47)).toBe(46);
  });

  it('keeps belts and buildings off the Rim buildings and inside the starting Yard for every survey column', () => {
    for (const c of SURVEY_COLUMNS) {
      const L = surveyLayout(c);
      const tiles = [...L.oreBelt, ...L.ingotBelt];
      for (const t of tiles) {
        expect(t.row).toBeGreaterThanOrEqual(1);
        expect(t.row).toBeLessThanOrEqual(8);
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x).toBeLessThan(48);
        if (t.row <= 3) expect(RIM_BUILDINGS.some((b) => t.x >= b.x0 && t.x <= b.x1), `c=${c} x=${t.x}`).toBe(false);
      }
      expect(L.hx0 === c || L.hx0 === c - 1).toBe(true);
      expect(L.side).not.toBe(0);
    }
  });

  it('meets the draw-call and triangle budgets with role-tagged, vertex-coloured meshes', () => {
    for (const c of SURVEY_COLUMNS) {
      const yard = createYardProps(c);
      const meshes = listMeshes(yard.root);
      expect(meshes.length).toBeLessThanOrEqual(10);
      expect(countTriangles(yard.root)).toBeLessThanOrEqual(6000);
      for (const m of meshes) {
        expect(MAT_ROLES).toContain(m.userData.mat);
        expect(m.geometry.getAttribute('color')).toBeDefined();
      }
    }
  });

  it('keeps the Headframe ≤ 3 and the Smelter and Bin ≤ 1.6 units tall (canon §3.1)', () => {
    const c = 17;
    const yard = createYardProps(c);
    const L = surveyLayout(c);
    const statics = ['yard-static', 'yard-steel', 'yard-lights', 'yard-rust'].map((n) => yard.root.getObjectByName(n) as Mesh);
    const top = (x0: number, x1: number, z0: number, z1: number) => Math.max(...statics.map((m) => maxYWithin(m, x0, x1, z0, z1)));
    expect(top(L.hx0, L.hx0 + 2, -3, 0)).toBeLessThanOrEqual(3 + 1e-4);
    expect(top(L.hx0, L.hx0 + 2, -6, -4)).toBeLessThanOrEqual(1.6 + 1e-4);
    expect(top(L.hx0, L.hx0 + 2, -9, -7)).toBeLessThanOrEqual(1.6 + 1e-4);
    const sheave = yard.root.getObjectByName('yard-sheave') as Mesh;
    sheave.geometry.computeBoundingSphere();
    expect(sheave.position.y + sheave.geometry.boundingSphere!.radius).toBeLessThanOrEqual(3);
  });

  it('scrolls chevrons, carries items and runs the bucket lift over time', () => {
    const yard = createYardProps(17);
    const read = (name: string, i: number) => {
      const m = yard.root.getObjectByName(name) as InstancedMesh;
      const mat = new Matrix4();
      m.getMatrixAt(i, mat);
      return new Vector3().setFromMatrixPosition(mat);
    };
    yard.update(0);
    const a = ['yard-belt-chevrons', 'yard-ore-items', 'yard-lift-buckets'].map((n) => read(n, 0));
    yard.update(400);
    const b = ['yard-belt-chevrons', 'yard-ore-items', 'yard-lift-buckets'].map((n) => read(n, 0));
    a.forEach((p, i) => expect(p.distanceTo(b[i])).toBeGreaterThan(0.1));
    const items = yard.root.getObjectByName('yard-ore-items') as InstancedMesh;
    expect(items.count).toBeGreaterThan(0);
    expect(items.count).toBeLessThanOrEqual(items.instanceMatrix.count);
    // Buckets stay in the survey column on the wall-mount layer.
    const buckets = yard.root.getObjectByName('yard-lift-buckets') as InstancedMesh;
    const m = new Matrix4();
    for (let i = 0; i < buckets.count; i++) {
      buckets.getMatrixAt(i, m);
      const p = new Vector3().setFromMatrixPosition(m);
      expect(p.x).toBeGreaterThan(17);
      expect(p.x).toBeLessThan(18);
      expect(p.z).toBeGreaterThan(-1);
      expect(p.z).toBeLessThan(-0.45);
    }
  });
});
