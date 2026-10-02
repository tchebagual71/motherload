// Procedural low-poly kit for the toy models (03 §8.1, §8.6): rounded primitives, flat shading,
// vertex colours from the palette, and one placeholder material per MatRole. render-core swaps the
// materials per look (applyLookMaterials), so models carry their colour only in the 'color' attribute.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  ExtrudeGeometry,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Shape,
  Sphere,
  TorusGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { hash32 } from '../../shared/rng';
import type { MatRole } from './api';

export const MAT_ROLES: readonly MatRole[] = ['solid', 'metal', 'glass', 'emissive', 'flame', 'decal'];

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------

const placeholders = new Map<MatRole, Material>();

/**
 * Shared placeholder material per role. Lit roles use Lambert; 'emissive' and 'flame' are unlit so
 * they still glow underground before render-core installs the look materials.
 */
export function placeholderMaterial(role: MatRole): Material {
  let m = placeholders.get(role);
  if (!m) {
    m = createPlaceholder(role);
    m.name = `placeholder-${role}`;
    placeholders.set(role, m);
  }
  return m;
}

function createPlaceholder(role: MatRole): Material {
  switch (role) {
    case 'emissive':
    case 'flame':
      return new MeshBasicMaterial({ vertexColors: true });
    case 'decal':
      return new MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    default:
      return new MeshLambertMaterial({ vertexColors: true });
  }
}

/** A Mesh tagged with its material role (the contract render-core relies on). */
export function roleMesh(geometry: BufferGeometry, role: MatRole, name: string): Mesh {
  const mesh = new Mesh(geometry, placeholderMaterial(role));
  mesh.name = name;
  mesh.userData.mat = role;
  return mesh;
}

/** A dynamic InstancedMesh tagged with its role; `count` starts at 0. Optional per-instance colour. */
export function roleInstanced(geometry: BufferGeometry, role: MatRole, capacity: number, name: string, instanceColors = false): InstancedMesh {
  const mesh = new InstancedMesh(geometry, placeholderMaterial(role), capacity);
  mesh.name = name;
  mesh.userData.mat = role;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  if (instanceColors) {
    const colors = new Float32Array(capacity * 3).fill(1);
    mesh.instanceColor = new InstancedBufferAttribute(colors, 3);
    mesh.instanceColor.setUsage(DynamicDrawUsage);
  }
  mesh.count = 0;
  // Instances move every frame; a cached bounding sphere would cull them wrongly.
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// Colour helpers (inputs are palette hex values; outputs are linear working-space colours)
// ---------------------------------------------------------------------------------------------

/** Mix two palette colours in sRGB space (t = 0 → a). */
export function mixHex(a: number, b: number, t: number): number {
  const ch = (shift: number): number => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * t) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Scale a palette colour's value (k < 1 darkens). */
export function shadeHex(hex: number, k: number): number {
  const ch = (shift: number): number => Math.max(0, Math.min(255, Math.round(((hex >> shift) & 0xff) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Per-vertex colour from the vertex's position in the primitive's local space. */
export type VertexColorFn = (x: number, y: number, z: number, out: Color) => void;
export type ColorSpec = number | VertexColorFn;

/** Vertical gradient over a local y range (e.g. flames: hot at the nozzle, orange at the tip). */
export function gradientY(bottomHex: number, topHex: number, y0: number, y1: number): VertexColorFn {
  const a = new Color(bottomHex);
  const b = new Color(topHex);
  return (_x, y, _z, out) => {
    const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
    out.copy(a).lerp(b, t);
  };
}

// ---------------------------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------------------------

const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

/** Build-time transform: translate, rotate (XYZ Euler, radians), scale (uniform or per axis). */
export function at(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s: number | readonly [number, number, number] = 1): Matrix4 {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  return new Matrix4().compose(_p, _q, _s);
}

// ---------------------------------------------------------------------------------------------
// Primitives (all return closed, outward-wound geometry; normals are recomputed flat by the builder)
// ---------------------------------------------------------------------------------------------

const EPS = 1e-6;

function positionsGeometry(positions: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return g;
}

function dedupeSorted(xs: number[]): number[] {
  const out: number[] = [];
  for (const x of xs) if (out.length === 0 || Math.abs(x - out[out.length - 1]) > EPS) out.push(x);
  return out;
}

/**
 * Rounded box: each face is a grid whose border rows are bent onto the corner spheres.
 * seg 1 → 2 bevel facets per edge (108 tris); seg 2 → 4 facets (300 tris). `r` is clamped to the half extents.
 */
export function roundedBox(w: number, h: number, d: number, r: number, seg: 1 | 2 = 1): BufferGeometry {
  const half = [w / 2, h / 2, d / 2];
  const rad = Math.max(0, Math.min(r, half[0], half[1], half[2]));
  const core = half.map((v) => v - rad);
  const t = Math.tan(Math.PI / 8);
  const coords = half.map((hv, i) =>
    dedupeSorted(seg === 2 ? [-hv, -(core[i] + rad * t), -core[i], core[i], core[i] + rad * t, hv] : [-hv, -core[i], core[i], hv]),
  );
  const out: number[] = [];
  const q = [0, 0, 0];
  const map = (axis: number, sign: number, u: number, cu: number, v: number, cv: number): [number, number, number] => {
    q[axis] = sign * half[axis];
    q[u] = cu;
    q[v] = cv;
    const c0 = Math.max(-core[0], Math.min(core[0], q[0]));
    const c1 = Math.max(-core[1], Math.min(core[1], q[1]));
    const c2 = Math.max(-core[2], Math.min(core[2], q[2]));
    const dx = q[0] - c0, dy = q[1] - c1, dz = q[2] - c2;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < EPS) return [q[0], q[1], q[2]];
    const k = rad / len;
    return [c0 + dx * k, c1 + dy * k, c2 + dz * k];
  };
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (const sign of [-1, 1]) {
      const cu = coords[u], cv = coords[v];
      for (let i = 0; i < cu.length - 1; i++) {
        for (let j = 0; j < cv.length - 1; j++) {
          const a = map(axis, sign, u, cu[i], v, cv[j]);
          const b = map(axis, sign, u, cu[i + 1], v, cv[j]);
          const c = map(axis, sign, u, cu[i + 1], v, cv[j + 1]);
          const e = map(axis, sign, u, cu[i], v, cv[j + 1]);
          pushOutward(out, a, b, c);
          pushOutward(out, a, c, e);
        }
      }
    }
  }
  return positionsGeometry(out);
}

/** Plain box (12 tris) for flat paint-like details: chevrons, rust decals, slats. */
export function box(w: number, h: number, d: number): BufferGeometry {
  return new BoxGeometry(w, h, d);
}

/**
 * Chamfered box: 6 faces, 12 edge bevels, 8 corner triangles (44 tris). The cheap toy box for small
 * parts (slats, ribs, beams) where a rounded box would waste triangles.
 */
export function chamferBox(w: number, h: number, d: number, c: number): BufferGeometry {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const k = Math.max(EPS, Math.min(c, hx * 0.95, hy * 0.95, hz * 0.95));
  // Corner (sx, sy, sz) owns three points: on its x face, y face and z face.
  const X = (sx: number, sy: number, sz: number): number[] => [sx * hx, sy * (hy - k), sz * (hz - k)];
  const Y = (sx: number, sy: number, sz: number): number[] => [sx * (hx - k), sy * hy, sz * (hz - k)];
  const Z = (sx: number, sy: number, sz: number): number[] => [sx * (hx - k), sy * (hy - k), sz * hz];
  const out: number[] = [];
  const quad = (a: number[], b: number[], cc: number[], dd: number[]): void => {
    pushOutward(out, a, b, cc);
    pushOutward(out, a, cc, dd);
  };
  const S = [-1, 1];
  for (const s of S) {
    quad(X(s, -1, -1), X(s, 1, -1), X(s, 1, 1), X(s, -1, 1));
    quad(Y(-1, s, -1), Y(1, s, -1), Y(1, s, 1), Y(-1, s, 1));
    quad(Z(-1, -1, s), Z(1, -1, s), Z(1, 1, s), Z(-1, 1, s));
  }
  for (const a of S) {
    for (const b of S) {
      quad(X(a, b, -1), X(a, b, 1), Y(a, b, 1), Y(a, b, -1));
      quad(X(a, -1, b), X(a, 1, b), Z(a, 1, b), Z(a, -1, b));
      quad(Y(-1, a, b), Y(1, a, b), Z(1, a, b), Z(-1, a, b));
    }
  }
  for (const sx of S) for (const sy of S) for (const sz of S) pushOutward(out, X(sx, sy, sz), Y(sx, sy, sz), Z(sx, sy, sz));
  return positionsGeometry(out);
}

/** Push a triangle of a convex solid centred on the origin, flipped if needed so it faces outward. */
function pushOutward(out: number[], a: number[], b: number[], c: number[]): void {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * nx + ny * ny + nz * nz < 1e-14) return;
  const cx = a[0] + b[0] + c[0], cy = a[1] + b[1] + c[1], cz = a[2] + b[2] + c[2];
  if (nx * cx + ny * cy + nz * cz >= 0) out.push(...a, ...b, ...c);
  else out.push(...a, ...c, ...b);
}

/**
 * Surface of revolution about +y. `profile` is [radius, y] pairs walked along the OUTER surface from
 * bottom to top (a closed solid starts and ends on the axis, r = 0). `phase` rotates the seam.
 */
export function lathe(profile: ReadonlyArray<readonly [number, number]>, segments: number, phase = 0): BufferGeometry {
  const out: number[] = [];
  const pt = (r: number, y: number, a: number): number[] => [r * Math.sin(a), y, r * Math.cos(a)];
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    if (Math.abs(r0 - r1) < EPS && Math.abs(y0 - y1) < EPS) continue;
    for (let j = 0; j < segments; j++) {
      const a0 = phase + (j / segments) * Math.PI * 2;
      const a1 = phase + ((j + 1) / segments) * Math.PI * 2;
      const A = pt(r0, y0, a0), B = pt(r0, y0, a1), C = pt(r1, y1, a0), D = pt(r1, y1, a1);
      if (r0 > EPS) out.push(...A, ...B, ...C);
      if (r1 > EPS) out.push(...B, ...D, ...C);
    }
  }
  return positionsGeometry(out);
}

/** Closed cylinder about y, centred, with an optional chamfer on both rims. */
export function cylinder(r: number, h: number, segments = 8, chamfer = 0): BufferGeometry {
  const c = Math.min(chamfer, r * 0.5, h * 0.5);
  return lathe(
    [
      [0, -h / 2],
      [r - c, -h / 2],
      [r, -h / 2 + c],
      [r, h / 2 - c],
      [r - c, h / 2],
      [0, h / 2],
    ],
    segments,
  );
}

/** Frustum about y, centred: bottom radius r0, top radius r1. */
export function frustum(r0: number, r1: number, h: number, segments = 8, phase = 0): BufferGeometry {
  return lathe(
    [
      [0, -h / 2],
      [r0, -h / 2],
      [r1, h / 2],
      [0, h / 2],
    ],
    segments,
    phase,
  );
}

/** Capsule about y: total length `len` (incl. caps), radius r. */
export function capsule(r: number, len: number, segments = 8, rings = 2): BufferGeometry {
  const body = Math.max(0, len / 2 - r);
  const profile: [number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const a = (i / rings) * (Math.PI / 2);
    profile.push([r * Math.sin(a), -body - r * Math.cos(a)]);
  }
  for (let i = 0; i <= rings; i++) {
    const a = (i / rings) * (Math.PI / 2);
    profile.push([r * Math.cos(a), body + r * Math.sin(a)]);
  }
  return lathe(profile, segments);
}

/** Low-poly sphere (lat/long). */
export function sphere(r: number, segments = 8, rings = 4): BufferGeometry {
  const profile: [number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const a = (i / rings) * Math.PI;
    profile.push([r * Math.sin(a), -r * Math.cos(a)]);
  }
  return lathe(profile, segments);
}

/** Shallow solid bowl / dish opening upward: outer radius r, height h, wall thickness t. */
export function bowl(r: number, h: number, t: number, segments = 8): BufferGeometry {
  return lathe(
    [
      [0, 0],
      [r * 0.55, 0],
      [r, h],
      [r - t, h],
      [(r - t) * 0.5, t],
      [0, t],
    ],
    segments,
  );
}

export function ico(r: number, detail = 0): BufferGeometry {
  return new IcosahedronGeometry(r, detail);
}

/** Icosahedron with a deterministic per-vertex jitter (shared corners move together, so it stays closed). */
export function rock(r: number, seed: number, rough = 0.22): BufferGeometry {
  const g = new IcosahedronGeometry(r, 0);
  const pos = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const h = hash32(seed, Math.round(x * 1000), Math.round(y * 1000), Math.round(z * 1000));
    const k = 1 - rough + ((h & 0xffff) / 0xffff) * rough * 1.6;
    pos.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  return g;
}

export function torus(R: number, r: number, radialSegments = 4, tubularSegments = 10, arc = Math.PI * 2): BufferGeometry {
  return new TorusGeometry(R, r, radialSegments, tubularSegments, arc);
}

/** Flat extruded icon, centred on z (depth along z). */
export function extrude(shape: Shape, depth: number, curveSegments = 6): BufferGeometry {
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Rounded rectangle in the xy plane, centred. */
export function roundedRectShape(w: number, h: number, r: number): Shape {
  const rr = Math.min(r, w / 2 - EPS, h / 2 - EPS);
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  const s = new Shape();
  s.moveTo(x0 + rr, y0);
  s.lineTo(x1 - rr, y0);
  s.absarc(x1 - rr, y0 + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - rr);
  s.absarc(x1 - rr, y1 - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x0 + rr, y1);
  s.absarc(x0 + rr, y1 - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + rr);
  s.absarc(x0 + rr, y0 + rr, rr, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Horizontal slab (w along x, d along z, h tall, centred) whose vertical corners are rounded by r. */
export function slab(w: number, d: number, h: number, r: number, curveSegments = 3): BufferGeometry {
  const g = extrude(roundedRectShape(w, d, r), h, curveSegments);
  g.rotateX(-Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Builder: merges transformed, coloured primitives into one flat-shaded non-indexed geometry
// ---------------------------------------------------------------------------------------------

export interface PartArrays {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Vertex count. */
  count: number;
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _n = new Vector3();
const _col = new Color();

export class GeometryBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /**
   * Add a primitive. `ao` darkens toward the primitive's local bottom (0 = off, 0.2 = 20% at the base).
   * Mirroring matrices are handled (winding is flipped back).
   */
  add(src: BufferGeometry, color: ColorSpec, matrix?: Matrix4, ao = 0): this {
    const pos = src.getAttribute('position') as BufferAttribute;
    const index = src.getIndex();
    const n = index ? index.count : pos.count;
    let minY = Infinity, maxY = -Infinity;
    if (ao > 0) {
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const flip = matrix ? matrix.determinant() < 0 : false;
    const flat = typeof color === 'number' ? new Color(color) : null;
    const tri = [_a, _b, _c];
    const rgb = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let t = 0; t + 2 < n; t += 3) {
      for (let k = 0; k < 3; k++) {
        const slot = flip && k > 0 ? 3 - k : k;
        const vi = index ? index.getX(t + k) : t + k;
        const v = tri[slot];
        v.fromBufferAttribute(pos, vi);
        if (flat) _col.copy(flat);
        else (color as VertexColorFn)(v.x, v.y, v.z, _col);
        if (ao > 0 && maxY > minY) _col.multiplyScalar(1 - ao * (1 - (v.y - minY) / (maxY - minY)));
        rgb[slot * 3] = _col.r;
        rgb[slot * 3 + 1] = _col.g;
        rgb[slot * 3 + 2] = _col.b;
        if (matrix) v.applyMatrix4(matrix);
      }
      _n.subVectors(_b, _a).cross(_d.subVectors(_c, _a));
      const len = _n.length();
      if (len < 1e-10) continue;
      _n.divideScalar(len);
      for (let k = 0; k < 3; k++) {
        const v = tri[k];
        this.pos.push(v.x, v.y, v.z);
        this.nor.push(_n.x, _n.y, _n.z);
        this.col.push(rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]);
      }
    }
    return this;
  }

  /** Append everything from another builder. */
  merge(other: GeometryBuilder): this {
    for (const v of other.pos) this.pos.push(v);
    for (const v of other.nor) this.nor.push(v);
    for (const v of other.col) this.col.push(v);
    return this;
  }

  toArrays(): PartArrays {
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nor),
      color: new Float32Array(this.col),
      count: this.pos.length / 3,
    };
  }

  build(): BufferGeometry {
    return geometryFromArrays(this.toArrays());
  }
}

export function geometryFromArrays(a: PartArrays): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(a.position, 3));
  g.setAttribute('normal', new BufferAttribute(a.normal, 3));
  g.setAttribute('color', new BufferAttribute(a.color, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * A fixed-capacity geometry rebuilt from pre-built parts (pod tier variants). Rebuilding copies into
 * the existing attribute arrays, so swapping variants never allocates. `retint()` repaints only the
 * colours of the tintable parts, leaving positions and normals (and their versions) untouched.
 */
export class ComposedGeometry {
  readonly geometry: BufferGeometry;
  private readonly position: BufferAttribute;
  private readonly normal: BufferAttribute;
  private readonly color: BufferAttribute;
  private n = 0;
  /** Parts added with append() since begin(), and where each starts (vertices), for retint(). */
  private readonly tintable: PartArrays[] = [];
  private readonly tintableAt: number[] = [];

  constructor(readonly capacity: number, boundsRadius: number) {
    this.position = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.normal = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.color = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('normal', this.normal);
    this.geometry.setAttribute('color', this.color);
    this.geometry.boundingSphere = new Sphere(new Vector3(), boundsRadius);
    this.geometry.setDrawRange(0, 0);
  }

  get vertexCount(): number {
    return this.n;
  }

  begin(): void {
    this.n = 0;
    this.tintable.length = 0;
    this.tintableAt.length = 0;
  }

  /** Copy a part; colours are lerped toward `tint` by `tintK` (0 = untouched). */
  append(src: PartArrays, tint: Color | null = null, tintK = 0): void {
    const o = this.n * 3;
    const len = src.count * 3;
    if (this.n + src.count > this.capacity) throw new Error('ComposedGeometry capacity exceeded');
    (this.position.array as Float32Array).set(src.position.subarray(0, len), o);
    (this.normal.array as Float32Array).set(src.normal.subarray(0, len), o);
    this.writeColors(src, this.n, tint, tintK);
    this.tintable.push(src);
    this.tintableAt.push(this.n);
    this.n += src.count;
  }

  /** Copy a part's shape, painting every vertex one colour (trim bands; not affected by retint). */
  appendSolidColor(src: PartArrays, c: Color): void {
    const o = this.n * 3;
    const len = src.count * 3;
    if (this.n + src.count > this.capacity) throw new Error('ComposedGeometry capacity exceeded');
    (this.position.array as Float32Array).set(src.position.subarray(0, len), o);
    (this.normal.array as Float32Array).set(src.normal.subarray(0, len), o);
    const dst = this.color.array as Float32Array;
    for (let i = 0; i < len; i += 3) {
      dst[o + i] = c.r;
      dst[o + i + 1] = c.g;
      dst[o + i + 2] = c.b;
    }
    this.n += src.count;
  }

  end(): void {
    for (const attr of [this.position, this.normal, this.color]) markRange(attr, this.n * 3);
    this.geometry.setDrawRange(0, this.n);
  }

  /**
   * Re-tint every part added with append() since begin() (e.g. the pod's fast-fall amber): rewrites
   * and uploads the colours only, so outline hulls (keyed on the position version) need no re-weld.
   */
  retint(tint: Color | null, tintK = 0): void {
    for (let i = 0; i < this.tintable.length; i++) this.writeColors(this.tintable[i], this.tintableAt[i], tint, tintK);
    markRange(this.color, this.n * 3);
  }

  private writeColors(src: PartArrays, at: number, tint: Color | null, tintK: number): void {
    const o = at * 3;
    const len = src.count * 3;
    const dst = this.color.array as Float32Array;
    if (tint && tintK > 0) {
      for (let i = 0; i < len; i += 3) {
        dst[o + i] = src.color[i] + (tint.r - src.color[i]) * tintK;
        dst[o + i + 1] = src.color[i + 1] + (tint.g - src.color[i + 1]) * tintK;
        dst[o + i + 2] = src.color[i + 2] + (tint.b - src.color[i + 2]) * tintK;
      }
    } else {
      dst.set(src.color.subarray(0, len), o);
    }
  }
}

function markRange(attr: BufferAttribute, len: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, len);
  attr.needsUpdate = true;
}

// ---------------------------------------------------------------------------------------------
// Inspection helpers (tests, preview, debug overlay)
// ---------------------------------------------------------------------------------------------

/** Triangles drawn by one mesh at full instance capacity (respects drawRange). */
export function meshTriangles(mesh: Mesh): number {
  const g = mesh.geometry;
  const base = g.index ? g.index.count : (g.getAttribute('position') as BufferAttribute).count;
  const drawn = Math.min(base, g.drawRange.count === Infinity ? base : g.drawRange.count);
  const tris = Math.floor(drawn / 3);
  return mesh instanceof InstancedMesh ? tris * mesh.instanceMatrix.count : tris;
}

export function countTriangles(root: Object3D): number {
  let total = 0;
  root.traverse((o) => {
    if ((o as Mesh).isMesh) total += meshTriangles(o as Mesh);
  });
  return total;
}

export function listMeshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}
