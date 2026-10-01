import { BufferAttribute, BufferGeometry, Color, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import {
  ComposedGeometry,
  GeometryBuilder,
  MAT_ROLES,
  at,
  bowl,
  capsule,
  chamferBox,
  cylinder,
  frustum,
  meshTriangles,
  roleInstanced,
  roleMesh,
  roundedBox,
  slab,
  sphere,
} from '../../src/render/models/kit';

/** Signed volume of a closed triangle soup: positive iff faces wind outward. */
function signedVolume(g: BufferGeometry): number {
  const p = g.getAttribute('position') as BufferAttribute;
  const idx = g.getIndex();
  const n = idx ? idx.count : p.count;
  let v = 0;
  for (let t = 0; t < n; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
    const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a);
    const bx = p.getX(b), by = p.getY(b), bz = p.getZ(b);
    const cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

function tris(g: BufferGeometry): number {
  const p = g.getAttribute('position') as BufferAttribute;
  return (g.getIndex()?.count ?? p.count) / 3;
}

describe('models kit primitives', () => {
  it('rounded boxes are closed, outward and close to their box volume', () => {
    const g1 = roundedBox(1, 0.6, 0.8, 0.1, 1);
    const g2 = roundedBox(1, 0.6, 0.8, 0.1, 2);
    expect(tris(g1)).toBe(108);
    expect(tris(g2)).toBe(300);
    for (const g of [g1, g2]) {
      const v = signedVolume(g);
      expect(v).toBeGreaterThan(0.48 * 0.9);
      expect(v).toBeLessThan(0.48);
    }
  });

  it('chamfer boxes are 44 outward triangles', () => {
    const g = chamferBox(0.5, 0.4, 0.3, 0.05);
    expect(tris(g)).toBe(44);
    expect(signedVolume(g)).toBeGreaterThan(0.06 * 0.9);
    expect(signedVolume(g)).toBeLessThan(0.06);
  });

  it('lathe solids wind outward with sensible volume', () => {
    const r = 0.3, h = 0.5;
    const cyl = signedVolume(cylinder(r, h, 12));
    expect(cyl).toBeGreaterThan(Math.PI * r * r * h * 0.9);
    expect(cyl).toBeLessThan(Math.PI * r * r * h);
    expect(signedVolume(frustum(0.2, 0.1, 0.4, 8))).toBeGreaterThan(0);
    expect(signedVolume(capsule(0.1, 0.5, 8))).toBeGreaterThan(0);
    expect(signedVolume(sphere(0.2, 8, 4))).toBeGreaterThan(0);
    expect(signedVolume(bowl(0.3, 0.1, 0.03, 8))).toBeGreaterThan(0);
    expect(signedVolume(slab(0.6, 0.6, 0.05, 0.15))).toBeGreaterThan(0);
  });
});

describe('GeometryBuilder', () => {
  it('emits flat unit normals and a colour attribute', () => {
    const g = new GeometryBuilder().add(roundedBox(1, 1, 1, 0.2), 0xff0000).add(cylinder(0.2, 1), 0x00ff00, at(2, 0, 0)).build();
    const n = g.getAttribute('normal') as BufferAttribute;
    const c = g.getAttribute('color') as BufferAttribute;
    expect(c).toBeDefined();
    expect(c.count).toBe(n.count);
    for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
    const red = new Color(0xff0000);
    expect(c.getX(0)).toBeCloseTo(red.r, 5);
  });

  it('keeps outward winding through mirroring transforms', () => {
    const g = new GeometryBuilder().add(roundedBox(1, 0.5, 0.5, 0.1), 0xffffff, at(0, 0, 0, 0, 0, 0, [-1, 1, 1])).build();
    expect(signedVolume(g)).toBeGreaterThan(0);
  });

  it('darkens toward the base with ao', () => {
    const g = new GeometryBuilder().add(roundedBox(1, 1, 1, 0.1), 0xffffff, undefined, 0.3).build();
    const p = g.getAttribute('position') as BufferAttribute;
    const c = g.getAttribute('color') as BufferAttribute;
    let low = 1, high = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < -0.49) low = Math.min(low, c.getX(i));
      if (p.getY(i) > 0.49) high = Math.max(high, c.getX(i));
    }
    expect(low).toBeCloseTo(0.7, 2);
    expect(high).toBeCloseTo(1, 5);
  });
});

describe('ComposedGeometry', () => {
  it('rebuilds in place within capacity and recolours trims', () => {
    const a = new GeometryBuilder().add(chamferBox(1, 1, 1, 0.1), 0xffffff).toArrays();
    const b = new GeometryBuilder().add(cylinder(0.3, 1, 6), 0xffffff).toArrays();
    const comp = new ComposedGeometry(a.count + b.count, 2);
    const arr = comp.geometry.getAttribute('position').array;
    comp.begin();
    comp.append(a);
    comp.appendSolidColor(b, new Color(0x0000ff));
    comp.end();
    expect(comp.geometry.drawRange.count).toBe(a.count + b.count);
    const col = comp.geometry.getAttribute('color') as BufferAttribute;
    expect(col.getZ(a.count)).toBeCloseTo(1, 5);
    expect(col.getX(a.count)).toBeCloseTo(0, 5);
    comp.begin();
    comp.append(b);
    comp.end();
    expect(comp.geometry.drawRange.count).toBe(b.count);
    expect(comp.geometry.getAttribute('position').array).toBe(arr);
    comp.begin();
    comp.append(a);
    expect(() => comp.append(a)).toThrow();
  });
});

describe('role meshes', () => {
  it('tags meshes and instanced meshes with their role and shares placeholder materials', () => {
    const g = new GeometryBuilder().add(chamferBox(1, 1, 1, 0.1), 0xffffff).build();
    for (const role of MAT_ROLES) {
      const m = roleMesh(g, role, `m-${role}`);
      expect(m.userData.mat).toBe(role);
      expect(roleMesh(g, role, 'again').material).toBe(m.material);
    }
    const inst = roleInstanced(g, 'solid', 10, 'inst', true);
    expect(inst.userData.mat).toBe('solid');
    expect(inst.count).toBe(0);
    expect(meshTriangles(inst)).toBe(44 * 10);
    expect(meshTriangles(new Mesh(g))).toBe(44);
  });
});
