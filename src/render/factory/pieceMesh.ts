// Instanced factory pieces (04 §5.3): one InstancedMesh per piece kind with a per-instance `hfInst` vec4 and an
// optional outline-hull twin that shares the instance buffers. Instances are written straight into the typed
// arrays (no Matrix4 per instance, no per-frame allocation); capacity doubles on demand.
import { BufferGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, type Material } from 'three';
import { hullGeometry } from '../materials';

export interface PieceMeshOptions {
  capacity?: number;
  /** Per-instance colour (items, ghosts). */
  colors?: boolean;
  /** Extra per-instance float attributes: name → item size (ghost style). */
  extra?: Readonly<Record<string, number>>;
}

/** A geometry that shares `base`'s vertex attributes (so several meshes can carry their own instance data). */
function shareGeometry(base: BufferGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
  if (base.index) g.setIndex(base.index);
  g.boundingBox = base.boundingBox;
  g.boundingSphere = base.boundingSphere;
  return g;
}

export class PieceMesh {
  readonly mesh: InstancedMesh;
  /** Outline hull (Toon), or null. */
  readonly hull: InstancedMesh | null;
  count = 0;
  /** Opaque per-instance reference (entity view, belt cell key …), parallel to the instances. */
  readonly refs: unknown[] = [];
  private capacity: number;
  private inst: InstancedBufferAttribute;
  private readonly extras = new Map<string, InstancedBufferAttribute>();
  private readonly geometry: BufferGeometry;
  private readonly hullGeom: BufferGeometry | null;

  constructor(
    readonly name: string,
    base: BufferGeometry,
    material: Material,
    hullMaterial: Material | null,
    opts: PieceMeshOptions = {},
  ) {
    this.capacity = Math.max(1, opts.capacity ?? 16);
    this.geometry = shareGeometry(base);
    this.inst = this.newAttr(4);
    this.geometry.setAttribute('hfInst', this.inst);
    for (const [k, size] of Object.entries(opts.extra ?? {})) {
      const a = this.newAttr(size);
      this.extras.set(k, a);
      this.geometry.setAttribute(k, a);
    }
    this.mesh = new InstancedMesh(this.geometry, material, this.capacity);
    this.mesh.name = name;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    if (opts.colors) {
      this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3);
      this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    }
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    if (hullMaterial) {
      this.hullGeom = hullGeometry(base);
      this.hullGeom.setAttribute('hfPart', base.getAttribute('hfPart'));
      this.hullGeom.setAttribute('hfInst', this.inst);
      const h = new InstancedMesh(this.hullGeom, hullMaterial, this.capacity);
      h.name = `${name}-hull`;
      h.instanceMatrix = this.mesh.instanceMatrix;
      h.frustumCulled = false;
      h.matrixAutoUpdate = false;
      h.count = 0;
      h.visible = false;
      (h.userData as { hfFactoryHull?: boolean }).hfFactoryHull = true;
      h.raycast = (): void => undefined;
      this.mesh.add(h);
      this.hull = h;
    } else {
      this.hullGeom = null;
      this.hull = null;
    }
  }

  private newAttr(size: number): InstancedBufferAttribute {
    const a = new InstancedBufferAttribute(new Float32Array(this.capacity * size), size);
    a.setUsage(DynamicDrawUsage);
    return a;
  }

  reset(): void {
    this.count = 0;
    this.refs.length = 0;
  }

  /** Make room for n instances (doubling; keeps what is written). */
  ensure(n: number): void {
    if (n <= this.capacity) return;
    let cap = this.capacity;
    while (cap < n) cap *= 2;
    this.capacity = cap;
    const grow = (a: InstancedBufferAttribute): InstancedBufferAttribute => {
      const b = new InstancedBufferAttribute(new Float32Array(cap * a.itemSize), a.itemSize);
      (b.array as Float32Array).set(a.array as Float32Array);
      b.setUsage(DynamicDrawUsage);
      return b;
    };
    this.mesh.instanceMatrix = grow(this.mesh.instanceMatrix);
    if (this.mesh.instanceColor) this.mesh.instanceColor = grow(this.mesh.instanceColor);
    this.inst = grow(this.inst);
    this.geometry.setAttribute('hfInst', this.inst);
    for (const [k, a] of this.extras) {
      const b = grow(a);
      this.extras.set(k, b);
      this.geometry.setAttribute(k, b);
    }
    if (this.hull && this.hullGeom) {
      this.hull.instanceMatrix = this.mesh.instanceMatrix;
      this.hullGeom.setAttribute('hfInst', this.inst);
    }
  }

  /** Append an instance: translate (x, y, z) · rotate about y by ry · scale (sx, sy, sz). Returns its index. */
  push(x: number, y: number, z: number, ry: number, sx = 1, sy = 1, sz = 1, ref: unknown = null): number {
    const i = this.count;
    this.ensure(i + 1);
    this.count++;
    this.refs[i] = ref;
    this.setTRS(i, x, y, z, ry, sx, sy, sz);
    this.setInst(i, 0, 0, 0, 0);
    return i;
  }

  setTRS(i: number, x: number, y: number, z: number, ry: number, sx = 1, sy = 1, sz = 1): void {
    const e = this.mesh.instanceMatrix.array as Float32Array;
    const o = i * 16;
    const c = Math.cos(ry), s = Math.sin(ry);
    e[o] = c * sx; e[o + 1] = 0; e[o + 2] = -s * sx; e[o + 3] = 0;
    e[o + 4] = 0; e[o + 5] = sy; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = s * sz; e[o + 9] = 0; e[o + 10] = c * sz; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
  }

  /** Translate · rotate about z (sheaves) · uniform scale. */
  setTRZ(i: number, x: number, y: number, z: number, rz: number, s = 1): void {
    const e = this.mesh.instanceMatrix.array as Float32Array;
    const o = i * 16;
    const c = Math.cos(rz) * s, sn = Math.sin(rz) * s;
    e[o] = c; e[o + 1] = sn; e[o + 2] = 0; e[o + 3] = 0;
    e[o + 4] = -sn; e[o + 5] = c; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = 0; e[o + 9] = 0; e[o + 10] = s; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
  }

  /** Columns (right, up, dir) × s at (x, y, z): a camera-facing billboard. */
  setBasis(i: number, x: number, y: number, z: number, r: { x: number; y: number; z: number }, u: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, s: number): void {
    const e = this.mesh.instanceMatrix.array as Float32Array;
    const o = i * 16;
    e[o] = r.x * s; e[o + 1] = r.y * s; e[o + 2] = r.z * s; e[o + 3] = 0;
    e[o + 4] = u.x * s; e[o + 5] = u.y * s; e[o + 6] = u.z * s; e[o + 7] = 0;
    e[o + 8] = d.x * s; e[o + 9] = d.y * s; e[o + 10] = d.z * s; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
  }

  setInst(i: number, a: number, b: number, c: number, d: number): void {
    const v = this.inst.array as Float32Array;
    const o = i * 4;
    v[o] = a;
    v[o + 1] = b;
    v[o + 2] = c;
    v[o + 3] = d;
  }

  /** hfInst.z (tint) of instance i. */
  setTint(i: number, tint: number): void {
    (this.inst.array as Float32Array)[i * 4 + 2] = tint;
  }

  setColor(i: number, r: number, g: number, b: number): void {
    const c = this.mesh.instanceColor;
    if (!c) return;
    const v = c.array as Float32Array;
    v[i * 3] = r;
    v[i * 3 + 1] = g;
    v[i * 3 + 2] = b;
  }

  setExtra(name: string, i: number, a: number, b = 0, c = 0, d = 0): void {
    const attr = this.extras.get(name);
    if (!attr) return;
    const v = attr.array as Float32Array;
    const o = i * attr.itemSize;
    v[o] = a;
    if (attr.itemSize > 1) v[o + 1] = b;
    if (attr.itemSize > 2) v[o + 2] = c;
    if (attr.itemSize > 3) v[o + 3] = d;
  }

  /** Upload what changed this frame and show the mesh only when it has instances. */
  commit(matrices = true, inst = true): void {
    const n = this.count;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      if (matrices) markRange(this.mesh.instanceMatrix, n * 16);
      if (inst) markRange(this.inst, n * 4);
      if (this.mesh.instanceColor) markRange(this.mesh.instanceColor, n * 3);
      for (const a of this.extras.values()) markRange(a, n * a.itemSize);
    }
    if (this.hull) {
      this.hull.count = n;
    }
  }

  /** Upload hfInst only (per-tick state, tints). */
  commitInst(): void {
    if (this.count > 0) markRange(this.inst, this.count * 4);
  }

  set material(m: Material) {
    this.mesh.material = m;
  }

  setHullMaterial(m: Material): void {
    if (this.hull) this.hull.material = m;
  }

  dispose(): void {
    this.mesh.dispose();
    this.hull?.dispose();
    this.geometry.dispose();
    this.hullGeom?.dispose();
  }
}

function markRange(attr: InstancedBufferAttribute, len: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, len);
  attr.needsUpdate = true;
}
