// Instanced factory pieces (04 §5.3): one InstancedMesh per piece kind with a per-instance `hfInst` vec4 and
// optional twins (outline hull, depth prepass) that share the instance buffers. Instances are written straight
// into typed arrays (no Matrix4 per instance, no per-frame allocation); capacity doubles on demand.
//
// Culled meshes (the structure; canon §3.14 triangle budgets) file every instance under a cell-region key.
// commit() sorts the instances by key, so each region is one contiguous slice; cull() then draws only the regions
// in view by copying their slices to the front of the GPU buffers. The copy runs only when the visible set or the
// data changes (a camera crossing a region edge, a topology rebuild, a factory tick's state), so a mesh never pays
// vertex or fragment work for instances off screen.
import { BufferGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, type Material } from 'three';
import { hullGeometry } from '../materials';

export interface PieceMeshOptions {
  capacity?: number;
  /** Per-instance colour (items, ghosts). */
  colors?: boolean;
  /** Extra per-instance float attributes: name → item size (ghost style). */
  extra?: Readonly<Record<string, number>>;
  /** Number of region keys (0 … regions − 1) of a culled mesh; 0 or absent = every instance is drawn. */
  regions?: number;
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

/** One per-instance stream: what push/set* write (`data`) and the GPU attribute drawn from (the same array unless culled). */
interface Channel {
  readonly name: string;
  readonly size: number;
  data: Float32Array;
  attr: InstancedBufferAttribute;
}

interface Twin {
  readonly mesh: InstancedMesh;
  /** Own geometry (an outline hull) whose instance attributes must follow the channels; null = the piece's geometry. */
  readonly geometry: BufferGeometry | null;
}

function newAttr(data: Float32Array, size: number): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(data, size);
  a.setUsage(DynamicDrawUsage);
  return a;
}

export class PieceMesh {
  readonly mesh: InstancedMesh;
  /** Outline hull (Toon), or null. */
  readonly hull: InstancedMesh | null;
  /** Instances written. A culled mesh draws only those in view (mesh.count). */
  count = 0;
  /** Opaque per-instance reference (entity view, belt cell key …), parallel to the instances. */
  readonly refs: unknown[] = [];
  /** Culled meshes: the region key push() files the next instance under. */
  region = 0;
  private capacity: number;
  private readonly regionCount: number;
  private readonly mat: Channel;
  private readonly inst: Channel;
  private readonly color: Channel | null;
  private readonly extras = new Map<string, Channel>();
  private readonly channels: Channel[] = [];
  private readonly geometry: BufferGeometry;
  private readonly twins: Twin[] = [];
  private readonly base: BufferGeometry;
  // Region culling.
  private keys: Int32Array;
  private readonly regionStart: Int32Array;
  private slices = new Int32Array(16);
  private nextSlices = new Int32Array(16);
  private sliceCount = 0;
  /** The GPU copy no longer matches the data (rebuilt or never drawn). */
  private stale = true;
  private order = new Int32Array(0);
  private scratch = new Float32Array(0);
  private readonly refScratch: unknown[] = [];

  constructor(
    readonly name: string,
    base: BufferGeometry,
    material: Material,
    hullMaterial: Material | null,
    opts: PieceMeshOptions = {},
  ) {
    this.capacity = Math.max(1, opts.capacity ?? 16);
    this.regionCount = Math.max(0, Math.floor(opts.regions ?? 0));
    this.base = base;
    this.geometry = shareGeometry(base);
    this.mesh = new InstancedMesh(this.geometry, material, this.capacity);
    this.mesh.name = name;
    this.mat = this.channel('instanceMatrix', 16);
    this.inst = this.channel('hfInst', 4);
    this.color = opts.colors ? this.channel('instanceColor', 3, 1) : null;
    for (const [k, size] of Object.entries(opts.extra ?? {})) this.extras.set(k, this.channel(k, size));
    this.keys = new Int32Array(this.regionCount > 0 ? this.capacity : 0);
    this.regionStart = new Int32Array(this.regionCount + 1);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.bind();
    this.hull = hullMaterial ? this.addTwin(`${name}-hull`, hullMaterial, true) : null;
    if (this.hull) (this.hull.userData as { hfFactoryHull?: boolean }).hfFactoryHull = true;
  }

  /** A culled mesh draws only the regions cull() names. */
  get culled(): boolean {
    return this.regionCount > 0;
  }

  private channel(name: string, size: number, fill = 0): Channel {
    const data = new Float32Array(this.capacity * size);
    if (fill !== 0) data.fill(fill);
    const draw = this.regionCount > 0 ? new Float32Array(this.capacity * size).fill(fill) : data;
    const ch: Channel = { name, size, data, attr: newAttr(draw, size) };
    this.channels.push(ch);
    return ch;
  }

  /** Point the meshes and geometries at the current channel attributes. */
  private bind(): void {
    this.mesh.instanceMatrix = this.mat.attr;
    if (this.color) this.mesh.instanceColor = this.color.attr;
    this.geometry.setAttribute('hfInst', this.inst.attr);
    for (const [k, ch] of this.extras) this.geometry.setAttribute(k, ch.attr);
    for (const t of this.twins) {
      t.mesh.instanceMatrix = this.mat.attr;
      if (this.color) t.mesh.instanceColor = this.color.attr;
      if (t.geometry) {
        t.geometry.setAttribute('hfInst', this.inst.attr);
        for (const [k, ch] of this.extras) t.geometry.setAttribute(k, ch.attr);
      }
    }
  }

  /**
   * Another draw of the same instances, as a child of the mesh (hidden with it): an outline hull (`hull`: welded
   * normals, own geometry) or a second pass over the piece's own geometry (a depth prepass).
   */
  addTwin(name: string, material: Material, hull: boolean): InstancedMesh {
    let geometry: BufferGeometry | null = null;
    if (hull) {
      geometry = hullGeometry(this.base);
      const part = this.base.getAttribute('hfPart');
      if (part) geometry.setAttribute('hfPart', part);
    }
    const t = new InstancedMesh(geometry ?? this.geometry, material, this.capacity);
    t.name = name;
    t.frustumCulled = false;
    t.matrixAutoUpdate = false;
    t.count = this.mesh.count;
    t.layers.mask = this.mesh.layers.mask;
    t.raycast = (): void => undefined;
    this.mesh.add(t);
    this.twins.push({ mesh: t, geometry });
    this.bind();
    return t;
  }

  /** Twin meshes follow the piece's layer (Pixel Lab pass split). */
  setLayer(layer: number): void {
    this.mesh.layers.set(layer);
    for (const t of this.twins) t.mesh.layers.set(layer);
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
    for (const ch of this.channels) {
      const data = new Float32Array(cap * ch.size);
      data.set(ch.data);
      if (this.culled) {
        const draw = new Float32Array(cap * ch.size);
        draw.set(ch.attr.array as Float32Array);
        ch.attr = newAttr(draw, ch.size);
        ch.data = data;
      } else {
        ch.data = data;
        ch.attr = newAttr(data, ch.size);
      }
    }
    if (this.culled) {
      const keys = new Int32Array(cap);
      keys.set(this.keys);
      this.keys = keys;
    }
    this.bind();
  }

  /** Append an instance: translate (x, y, z) · rotate about y by ry · scale (sx, sy, sz). Returns its index. */
  push(x: number, y: number, z: number, ry: number, sx = 1, sy = 1, sz = 1, ref: unknown = null): number {
    const i = this.count;
    this.ensure(i + 1);
    this.count++;
    this.refs[i] = ref;
    if (this.culled) this.keys[i] = Math.max(0, Math.min(this.regionCount - 1, this.region | 0));
    this.setTRS(i, x, y, z, ry, sx, sy, sz);
    this.setInst(i, 0, 0, 0, 0);
    return i;
  }

  setTRS(i: number, x: number, y: number, z: number, ry: number, sx = 1, sy = 1, sz = 1): void {
    const e = this.mat.data;
    const o = i * 16;
    const c = Math.cos(ry), s = Math.sin(ry);
    e[o] = c * sx; e[o + 1] = 0; e[o + 2] = -s * sx; e[o + 3] = 0;
    e[o + 4] = 0; e[o + 5] = sy; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = s * sz; e[o + 9] = 0; e[o + 10] = c * sz; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
  }

  /** Translate · rotate about z (sheaves) · uniform scale. */
  setTRZ(i: number, x: number, y: number, z: number, rz: number, s = 1): void {
    const e = this.mat.data;
    const o = i * 16;
    const c = Math.cos(rz) * s, sn = Math.sin(rz) * s;
    e[o] = c; e[o + 1] = sn; e[o + 2] = 0; e[o + 3] = 0;
    e[o + 4] = -sn; e[o + 5] = c; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = 0; e[o + 9] = 0; e[o + 10] = s; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
  }

  /** Columns (right, up, dir) × s at (x, y, z): a camera-facing billboard. */
  setBasis(i: number, x: number, y: number, z: number, r: { x: number; y: number; z: number }, u: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, s: number): void {
    const e = this.mat.data;
    const o = i * 16;
    e[o] = r.x * s; e[o + 1] = r.y * s; e[o + 2] = r.z * s; e[o + 3] = 0;
    e[o + 4] = u.x * s; e[o + 5] = u.y * s; e[o + 6] = u.z * s; e[o + 7] = 0;
    e[o + 8] = d.x * s; e[o + 9] = d.y * s; e[o + 10] = d.z * s; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
  }

  setInst(i: number, a: number, b: number, c: number, d: number): void {
    const v = this.inst.data;
    const o = i * 4;
    v[o] = a;
    v[o + 1] = b;
    v[o + 2] = c;
    v[o + 3] = d;
  }

  /** hfInst.z (tint) of instance i. */
  setTint(i: number, tint: number): void {
    this.inst.data[i * 4 + 2] = tint;
  }

  /** hfInst of instance i (written data, not the drawn copy). */
  instAt(i: number, k: number): number {
    return this.inst.data[i * 4 + k];
  }

  /** Translation of instance i (written data). */
  originOf(i: number, axis: 0 | 1 | 2): number {
    return this.mat.data[i * 16 + 12 + axis];
  }

  setColor(i: number, r: number, g: number, b: number): void {
    const c = this.color;
    if (!c) return;
    const v = c.data;
    v[i * 3] = r;
    v[i * 3 + 1] = g;
    v[i * 3 + 2] = b;
  }

  setExtra(name: string, i: number, a: number, b = 0, c = 0, d = 0): void {
    const ch = this.extras.get(name);
    if (!ch) return;
    const v = ch.data;
    const o = i * ch.size;
    v[o] = a;
    if (ch.size > 1) v[o + 1] = b;
    if (ch.size > 2) v[o + 2] = c;
    if (ch.size > 3) v[o + 3] = d;
  }

  /**
   * Upload what changed this frame and show the mesh only when it has instances. A culled mesh instead sorts its
   * instances by region and waits for cull() to pick the visible ones.
   */
  commit(matrices = true, inst = true): void {
    if (this.culled) {
      this.sortRegions();
      this.stale = true;
      this.sliceCount = 0;
      this.setDrawn(0);
      return;
    }
    const n = this.count;
    this.setDrawn(n);
    if (n > 0) {
      if (matrices) markRange(this.mat.attr, n * 16);
      if (inst) markRange(this.inst.attr, n * 4);
      if (this.color) markRange(this.color.attr, n * 3);
      for (const ch of this.extras.values()) markRange(ch.attr, n * ch.size);
    }
  }

  /** Upload hfInst only (per-tick state, tints). */
  commitInst(): void {
    if (this.culled) {
      if (!this.stale && this.mesh.count > 0) markRange(this.inst.attr, this.copyDrawn(this.inst) * 4);
      return;
    }
    if (this.count > 0) markRange(this.inst.attr, this.count * 4);
  }

  /**
   * Draw only the instances filed under the region-key ranges [ranges[2k], ranges[2k + 1]) for k < n, given in
   * ascending, non-overlapping order. The GPU copy is redone only when the visible slices or the data changed.
   */
  cull(ranges: ArrayLike<number>, n: number): void {
    if (!this.culled) return;
    if (this.nextSlices.length < n * 2) {
      this.nextSlices = new Int32Array(n * 2);
      const s = new Int32Array(n * 2);
      s.set(this.slices.subarray(0, Math.min(this.slices.length, s.length)));
      this.slices = s;
    }
    const next = this.nextSlices;
    const start = this.regionStart;
    const top = this.regionCount;
    let m = 0;
    for (let r = 0; r < n; r++) {
      const k0 = Math.max(0, Math.min(top, ranges[2 * r]));
      const k1 = Math.max(k0, Math.min(top, ranges[2 * r + 1]));
      const s = start[k0], e = start[k1];
      if (e <= s) continue;
      if (m > 0 && next[2 * m - 1] === s) next[2 * m - 1] = e;
      else {
        next[2 * m] = s;
        next[2 * m + 1] = e;
        m++;
      }
    }
    let same = !this.stale && m === this.sliceCount;
    for (let k = 0; same && k < 2 * m; k++) same = next[k] === this.slices[k];
    if (same) return;
    this.nextSlices = this.slices;
    this.slices = next;
    this.sliceCount = m;
    this.stale = false;
    let drawn = 0;
    for (const ch of this.channels) {
      drawn = this.copyDrawn(ch);
      if (drawn > 0) markRange(ch.attr, drawn * ch.size);
    }
    this.setDrawn(drawn);
  }

  /** Draw every written instance (a culled mesh, ignoring regions: compile passes and tests). */
  cullAll(): void {
    const all = this.allRange;
    all[1] = this.regionCount;
    this.cull(all, 1);
  }
  private readonly allRange = new Int32Array(2);

  /** Instances drawn now. */
  get drawn(): number {
    return this.mesh.count;
  }

  private setDrawn(n: number): void {
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    for (const t of this.twins) t.mesh.count = n;
  }

  /** Copy the drawn slices of a channel to the front of its GPU array; returns the instances copied. */
  private copyDrawn(ch: Channel): number {
    const out = ch.attr.array as Float32Array;
    const src = ch.data;
    const z = ch.size;
    let o = 0;
    for (let k = 0; k < this.sliceCount; k++) {
      const e = this.slices[2 * k + 1] * z;
      for (let j = this.slices[2 * k] * z; j < e; j++) out[o++] = src[j];
    }
    return o / z;
  }

  /** Stable counting sort of the written instances by region key (topology rebuilds only). */
  private sortRegions(): void {
    const n = this.count;
    const R = this.regionCount;
    const start = this.regionStart;
    const keys = this.keys;
    start.fill(0);
    for (let i = 0; i < n; i++) start[keys[i] + 1]++;
    for (let k = 0; k < R; k++) start[k + 1] += start[k];
    if (this.order.length < n) this.order = new Int32Array(this.capacity);
    const order = this.order;
    // order[dest] = source index; `at` is each region's next free slot.
    if (this.atScratch.length < R) this.atScratch = new Int32Array(R);
    const at = this.atScratch;
    for (let k = 0; k < R; k++) at[k] = start[k];
    let sorted = true;
    for (let i = 0; i < n; i++) {
      const d = at[keys[i]]++;
      order[d] = i;
      if (d !== i) sorted = false;
    }
    if (sorted) return;
    for (const ch of this.channels) this.gather(ch.data, ch.size, n);
    const refs = this.refScratch;
    refs.length = n;
    for (let d = 0; d < n; d++) refs[d] = this.refs[order[d]];
    for (let d = 0; d < n; d++) this.refs[d] = refs[d];
    refs.length = 0;
    // Keys follow the instances (ascending by construction).
    let d = 0;
    for (let k = 0; k < R; k++) for (let e = start[k + 1]; d < e; d++) keys[d] = k;
  }
  private atScratch = new Int32Array(0);

  private gather(data: Float32Array, z: number, n: number): void {
    if (this.scratch.length < n * z) this.scratch = new Float32Array(this.capacity * 16);
    const tmp = this.scratch;
    const order = this.order;
    for (let d = 0; d < n; d++) {
      const s = order[d] * z;
      const o = d * z;
      for (let j = 0; j < z; j++) tmp[o + j] = data[s + j];
    }
    for (let j = 0; j < n * z; j++) data[j] = tmp[j];
  }

  set material(m: Material) {
    this.mesh.material = m;
  }

  setHullMaterial(m: Material): void {
    if (this.hull) this.hull.material = m;
  }

  dispose(): void {
    this.mesh.dispose();
    for (const t of this.twins) {
      t.mesh.dispose();
      t.geometry?.dispose();
    }
    this.geometry.dispose();
  }
}

function markRange(attr: InstancedBufferAttribute, len: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, len);
  attr.needsUpdate = true;
}
