// Look materials (canon D4/D5, 03 §8.7, §9; 04 §5.4–5.5). Models tag meshes with userData.mat ∈ MatRole
// and carry colour in the `color` attribute (linear, three convention); render-core swaps in shared
// per-look materials here. GLSL lives in ./materials/.
import { BufferAttribute, BufferGeometry, InstancedMesh, Mesh, type Material, type Object3D } from 'three';
import type { Look } from '../shared/types';
import type { MatRole } from './models/api';
import { createFlameMaterial, createShadedMaterial, type ShadedKind } from './materials/look';
import { createSkyMaterial } from './materials/passes';
import { createUniforms, type HfUniforms } from './materials/uniforms';

export type { HfUniforms } from './materials/uniforms';

/** Layer for opaque geometry (Pixel Lab pass 1, MRT). */
export const LAYER_MAIN = 0;
/** Layer for transparent/additive geometry (Pixel Lab pass 3, single attachment). */
export const LAYER_LATE = 1;

const ROLES: ReadonlySet<string> = new Set<MatRole>(['solid', 'metal', 'glass', 'emissive', 'flame', 'decal']);
const HULLED_ROLES: ReadonlySet<string> = new Set<MatRole>(['solid', 'metal', 'glass', 'emissive']);

export function isMatRole(x: unknown): x is MatRole {
  return typeof x === 'string' && ROLES.has(x);
}

/** Shared materials and uniforms for both looks. */
export class MaterialKit {
  readonly uniforms: HfUniforms = createUniforms();
  private readonly cache = new Map<string, Material>();

  terrain(look: Look): Material {
    return this.shaded('terrain', look, true);
  }

  hull(): Material {
    return this.shaded('hull', 'toon', true);
  }

  sky(look: Look): Material {
    const key = `sky:${look}`;
    let m = this.cache.get(key);
    if (!m) {
      m = createSkyMaterial(look);
      this.cache.set(key, m);
    }
    return m;
  }

  /** Material for a tagged model mesh; flat-colour variants are cached per colour. */
  role(look: Look, role: MatRole, vertexColors: boolean, color = 0xffffff): Material {
    if (role === 'flame') {
      const key = `flame:${vertexColors ? 'vc' : color}`;
      let m = this.cache.get(key);
      if (!m) {
        m = createFlameMaterial(vertexColors, color);
        this.cache.set(key, m);
      }
      return m;
    }
    return this.shaded(role, look, vertexColors, color);
  }

  /** Every material of a look (for precompiling). */
  materialsFor(look: Look): Material[] {
    const out: Material[] = [this.terrain(look), this.sky(look), this.hull()];
    for (const role of ROLES) out.push(this.role(look, role as MatRole, true));
    return out;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    this.uniforms.uHfAmbient.value.dispose();
  }

  private shaded(kind: ShadedKind, look: Look, vertexColors: boolean, color = 0xffffff): Material {
    const key = `${kind}:${look}:${vertexColors ? 'vc' : color.toString(16)}`;
    let m = this.cache.get(key);
    if (!m) {
      m = createShadedMaterial(kind, look, this.uniforms, { vertexColors, color });
      this.cache.set(key, m);
    }
    return m;
  }
}

let sharedKit: MaterialKit | null = null;

/** The process-wide kit used by applyLookMaterials and the renderer. */
export function getMaterialKit(): MaterialKit {
  sharedKit ??= new MaterialKit();
  return sharedKit;
}

/** Dispose the shared kit (renderer disposal / context rebuild). */
export function disposeMaterialKit(): void {
  sharedKit?.dispose();
  sharedKit = null;
}

interface TaggedData {
  mat?: unknown;
  /** Too small for an outline (lamp studs): addOutlineHulls skips it. */
  hfNoHull?: boolean;
  hfBaseHex?: number;
  hfHull?: boolean;
  hfHullOn?: boolean;
}

function baseHexOf(mesh: Mesh): number {
  const data = mesh.userData as TaggedData;
  if (data.hfBaseHex === undefined) {
    const m = mesh.material as Material & { color?: { getHex(): number } };
    data.hfBaseHex = !Array.isArray(m) && m.color ? m.color.getHex() : 0xffffff;
  }
  return data.hfBaseHex;
}

/**
 * Replace materials on meshes tagged `userData.mat` ∈ MatRole with the shared per-look materials, put
 * transparent ones on LAYER_LATE, and show outline hulls only in Toon (when enabled for their scope).
 */
export function applyLookMaterials(root: Object3D, look: Look, kit: MaterialKit = getMaterialKit()): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const data = o.userData as TaggedData;
    if (data.hfHull) {
      o.material = kit.hull();
      o.visible = look === 'toon' && data.hfHullOn !== false;
      return;
    }
    if (!isMatRole(data.mat)) return;
    const hasColor = o.geometry.getAttribute('color') !== undefined;
    const mat = kit.role(look, data.mat, hasColor, hasColor ? 0xffffff : baseHexOf(o));
    o.material = mat;
    o.layers.set(mat.transparent ? LAYER_LATE : LAYER_MAIN);
  });
}

/** Put every mesh under `root` on one layer (FX and overlays draw in Pixel Lab pass 3). */
export function setLayerDeep(root: Object3D, layer: number): void {
  root.traverse((o) => o.layers.set(layer));
}

// ---------------------------------------------------------------------------------------------
// Outline hulls (04 §5.5: inverted hull, 1.5 px × render scale, a second draw per mesh)
// ---------------------------------------------------------------------------------------------

/** Tag shared by hull meshes so scope toggles can find them. */
export type HullGroup = 'pod' | 'buildings';

/**
 * Add an inverted-hull child to every tagged, opaque, non-instanced mesh under `root`. Hull normals are
 * position-welded averages so flat-shaded parts expand without cracks at their corners.
 */
export function addOutlineHulls(root: Object3D, group: HullGroup, kit: MaterialKit = getMaterialKit()): Mesh[] {
  const targets: Mesh[] = [];
  root.traverse((o) => {
    const data = o.userData as TaggedData;
    if (o instanceof Mesh && !(o instanceof InstancedMesh) && HULLED_ROLES.has(String(data.mat)) && !data.hfNoHull) targets.push(o);
  });
  const hulls: Mesh[] = [];
  for (const mesh of targets) {
    const hull = new Mesh(hullFor(mesh.geometry), kit.hull());
    hull.name = `${mesh.name || 'mesh'}-hull`;
    const data = hull.userData as TaggedData & { hfHullGroup?: HullGroup };
    data.hfHull = true;
    data.hfHullGroup = group;
    hull.raycast = (): void => undefined;
    hull.frustumCulled = mesh.frustumCulled;
    mesh.add(hull);
    hulls.push(hull);
  }
  return hulls;
}

/** Enable/disable hulls of a group (outline scope per tier). Visibility also needs the Toon look. */
export function setHullsEnabled(root: Object3D, group: HullGroup, on: boolean, look: Look): void {
  root.traverse((o) => {
    const data = o.userData as TaggedData & { hfHullGroup?: HullGroup };
    if (!data.hfHull || data.hfHullGroup !== group) return;
    data.hfHullOn = on;
    o.visible = on && look === 'toon';
  });
}

const WELD = 1e4;
const hullCache = new WeakMap<BufferGeometry, BufferGeometry>();

/** Shared hull geometry per source geometry (models swap variants, e.g. the pod's drill bits). */
function hullFor(src: BufferGeometry): BufferGeometry {
  let h = hullCache.get(src);
  if (!h) {
    h = hullGeometry(src);
    hullCache.set(src, h);
  }
  return h;
}

/**
 * Keep a hull in step with its parent mesh (call per frame): follow geometry swaps, re-weld normals
 * when the source positions were rewritten in place (tier changes), mirror the draw range.
 */
export function syncHull(hull: Mesh): void {
  const src = hull.parent;
  if (!(src instanceof Mesh)) return;
  const g = src.geometry as BufferGeometry;
  const h = hullFor(g);
  const data = hull.userData as { hfVersion?: number };
  const pos = g.getAttribute('position') as BufferAttribute;
  if (hull.geometry !== h) {
    hull.geometry = h;
    data.hfVersion = pos.version;
  } else if (data.hfVersion !== pos.version) {
    if (data.hfVersion !== undefined) {
      const normal = h.getAttribute('normal') as BufferAttribute;
      weldNormals(g, normal.array as Float32Array);
      normal.needsUpdate = true;
    }
    data.hfVersion = pos.version;
  }
  h.drawRange.start = g.drawRange.start;
  h.drawRange.count = g.drawRange.count;
}

/** Geometry sharing position/colour/index with `src` plus smoothed (welded) normals. */
export function hullGeometry(src: BufferGeometry): BufferGeometry {
  const pos = src.getAttribute('position');
  const g = new BufferGeometry();
  g.setAttribute('position', pos);
  const color = src.getAttribute('color');
  if (color) g.setAttribute('color', color);
  const index = src.getIndex();
  if (index) g.setIndex(index);
  const normals = new Float32Array(pos.count * 3);
  weldNormals(src, normals);
  g.setAttribute('normal', new BufferAttribute(normals, 3));
  g.boundingSphere = src.boundingSphere;
  g.setDrawRange(src.drawRange.start, src.drawRange.count);
  return g;
}

/**
 * Position-welded vertex normals over the source's draw range. Each distinct face direction counts
 * once per welded vertex (a quad's two triangles must not outweigh its neighbours), so box corners
 * expand along the true diagonal.
 */
function weldNormals(src: BufferGeometry, out: Float32Array): void {
  const pos = src.getAttribute('position');
  const index = src.getIndex();
  const total = index ? index.count : pos.count;
  const start = Math.max(0, src.drawRange.start);
  const end = Math.min(total, start + (Number.isFinite(src.drawRange.count) ? src.drawRange.count : total));
  const keyOf = (i: number): string =>
    `${Math.round(pos.getX(i) * WELD)},${Math.round(pos.getY(i) * WELD)},${Math.round(pos.getZ(i) * WELD)}`;
  const dirs = new Map<string, number[]>();
  const vi = (k: number): number => (index ? index.getX(k) : k);
  for (let t = start; t + 2 < end; t += 3) {
    const a = vi(t), b = vi(t + 1), c = vi(t + 2);
    const ux = pos.getX(b) - pos.getX(a), uy = pos.getY(b) - pos.getY(a), uz = pos.getZ(b) - pos.getZ(a);
    const wx = pos.getX(c) - pos.getX(a), wy = pos.getY(c) - pos.getY(a), wz = pos.getZ(c) - pos.getZ(a);
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-12) continue;
    const fx = nx / l, fy = ny / l, fz = nz / l;
    for (const v of [a, b, c]) {
      const key = keyOf(v);
      let list = dirs.get(key);
      if (!list) dirs.set(key, (list = []));
      let seen = false;
      for (let k = 0; k < list.length && !seen; k += 3) seen = list[k] * fx + list[k + 1] * fy + list[k + 2] * fz > 0.999;
      if (!seen) list.push(fx, fy, fz);
    }
  }
  out.fill(0);
  for (let t = start; t < end; t++) {
    const i = vi(t);
    const list = dirs.get(keyOf(i));
    if (!list) continue;
    let sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < list.length; k += 3) {
      sx += list[k];
      sy += list[k + 1];
      sz += list[k + 2];
    }
    const l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    out[i * 3] = sx / l;
    out[i * 3 + 1] = sy / l;
    out[i * 3 + 2] = sz / l;
  }
}
