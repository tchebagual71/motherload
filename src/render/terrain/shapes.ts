// Ore and relic silhouettes (03 §8.4): 12–48-triangle polyhedra, one per mineral tier and relic.
// Templates are built once in a cell-local frame (x right, y up, z toward the camera), normalised so
// their back sits on z = 0 (they stand proud of the slab face, so Toon hulls stay visible).
// Pure (no three).

/** Colour slots per triangle: base, highlight, sparkle. */
export const SLOT_BASE = 0;
export const SLOT_HIGHLIGHT = 1;
export const SLOT_SPARKLE = 2;

export interface ShapeTemplate {
  /** 9 floats per triangle (a, b, c), outward CCW winding. */
  readonly tris: Float32Array;
  /** Colour slot per triangle. */
  readonly slots: Uint8Array;
  /** Centre used for hull expansion directions. */
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly triCount: number;
}

type V3 = [number, number, number];

interface Xf {
  t?: V3;
  r?: V3;
  s?: V3 | number;
}

/** Collects triangles while building a template. */
class ShapeBuilder {
  readonly pos: number[] = [];
  readonly slots: number[] = [];

  tri(a: V3, b: V3, c: V3, slot: number): void {
    this.pos.push(...a, ...b, ...c);
    this.slots.push(slot);
  }

  /** Convex polyhedron from vertices and CCW faces (fans), transformed. */
  poly(verts: V3[], faces: number[][], xf: Xf, slotOf: (face: number) => number = () => SLOT_BASE): void {
    const v = verts.map((p) => transform(p, xf));
    faces.forEach((f, fi) => {
      for (let i = 1; i + 1 < f.length; i++) this.tri(v[f[0]], v[f[i]], v[f[i + 1]], slotOf(fi));
    });
  }

  build(): ShapeTemplate {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.pos.length; i += 3) {
      minX = Math.min(minX, this.pos[i]); maxX = Math.max(maxX, this.pos[i]);
      minY = Math.min(minY, this.pos[i + 1]); maxY = Math.max(maxY, this.pos[i + 1]);
      minZ = Math.min(minZ, this.pos[i + 2]); maxZ = Math.max(maxZ, this.pos[i + 2]);
    }
    const tris = new Float32Array(this.pos.length);
    for (let i = 0; i < this.pos.length; i += 3) {
      tris[i] = this.pos[i];
      tris[i + 1] = this.pos[i + 1];
      tris[i + 2] = this.pos[i + 2] - minZ;
    }
    return {
      tris,
      slots: Uint8Array.from(this.slots),
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      cz: (maxZ - minZ) / 2,
      triCount: this.slots.length,
    };
  }
}

function transform(p: V3, xf: Xf): V3 {
  const s = xf.s === undefined ? [1, 1, 1] : typeof xf.s === 'number' ? [xf.s, xf.s, xf.s] : xf.s;
  let x = p[0] * s[0], y = p[1] * s[1], z = p[2] * s[2];
  const r = xf.r ?? [0, 0, 0];
  // Rotate X, then Y, then Z.
  let c = Math.cos(r[0]), n = Math.sin(r[0]);
  [y, z] = [y * c - z * n, y * n + z * c];
  c = Math.cos(r[1]); n = Math.sin(r[1]);
  [x, z] = [x * c + z * n, -x * n + z * c];
  c = Math.cos(r[2]); n = Math.sin(r[2]);
  [x, y] = [x * c - y * n, x * n + y * c];
  const t = xf.t ?? [0, 0, 0];
  return [x + t[0], y + t[1], z + t[2]];
}

// ---------------------------------------------------------------------------------------------
// Primitives (unit-ish, centred on the origin)
// ---------------------------------------------------------------------------------------------

const BOX_V: V3[] = [
  [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
];
const BOX_F = [
  [4, 5, 6, 7], // +z
  [1, 0, 3, 2], // -z
  [5, 1, 2, 6], // +x
  [0, 4, 7, 3], // -x
  [7, 6, 2, 3], // +y
  [0, 1, 5, 4], // -y
];
const BOX_TOP_FACE = 4;

/** n-gon prism along y (axis), radius 0.5, height 1; faces: sides, top (+y), bottom (−y). */
function prismY(n: number, phase = 0): { v: V3[]; f: number[][] } {
  const v: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    v.push([Math.cos(a) * 0.5, -0.5, -Math.sin(a) * 0.5]);
  }
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    v.push([Math.cos(a) * 0.5, 0.5, -Math.sin(a) * 0.5]);
  }
  const f: number[][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    f.push([i, j, n + j, n + i]);
  }
  f.push(Array.from({ length: n }, (_, i) => n + i)); // top, CCW seen from +y
  f.push(Array.from({ length: n }, (_, i) => n - 1 - i)); // bottom
  return { v, f };
}

/** Bipyramid along y: ring of n at y = 0 (radius 0.5), apexes at +top and −bottom. */
function bipyramidY(n: number, top: number, bottom: number, phase = 0): { v: V3[]; f: number[][] } {
  const v: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    v.push([Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5]);
  }
  v.push([0, top, 0], [0, -bottom, 0]);
  const f: number[][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    f.push([i, j, n]);
    f.push([j, i, n + 1]);
  }
  return { v, f };
}

/** Prism with pyramid caps along y (crystal / capsule rod): radius 0.5, body 1, caps `cap` long. */
function cappedPrismY(n: number, cap: number, phase = 0): { v: V3[]; f: number[][] } {
  const { v, f } = prismY(n, phase);
  const sides = f.slice(0, n);
  v.push([0, 0.5 + cap, 0], [0, -0.5 - cap, 0]);
  const top = 2 * n;
  const bot = 2 * n + 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sides.push([n + i, n + j, top]);
    sides.push([j, i, bot]);
  }
  return { v, f: sides };
}

// ---------------------------------------------------------------------------------------------
// Ores (tier 1..10) and relics (id 0..3)
// ---------------------------------------------------------------------------------------------

function hematite(): ShapeTemplate {
  const b = new ShapeBuilder();
  const top = (f: number): number => (f === BOX_TOP_FACE ? SLOT_HIGHLIGHT : SLOT_BASE);
  b.poly(BOX_V, BOX_F, { s: 0.3, r: [0.35, 0.55, 0.2], t: [-0.13, -0.08, 0] }, top);
  b.poly(BOX_V, BOX_F, { s: 0.26, r: [-0.25, 0.35, 0.6], t: [0.15, -0.11, 0.02] }, top);
  b.poly(BOX_V, BOX_F, { s: 0.23, r: [0.5, -0.4, 0.1], t: [0.01, 0.15, 0.04] }, top);
  return b.build();
}

function copper(): ShapeTemplate {
  const b = new ShapeBuilder();
  const { v, f } = bipyramidY(6, 0.42, 0.4, 0.3);
  const upper = (fi: number): number => (fi % 2 === 0 && fi < 6 ? SLOT_HIGHLIGHT : SLOT_BASE);
  b.poly(v, f, { s: [0.42, 0.42, 0.34], r: [0.4, 0, 0.35], t: [-0.1, -0.06, 0] }, upper);
  b.poly(v, f, { s: [0.32, 0.34, 0.28], r: [0.3, 0.5, -0.4], t: [0.17, 0.11, 0] }, upper);
  return b.build();
}

function cobalt(): ShapeTemplate {
  const b = new ShapeBuilder();
  const rh: V3[] = [[0, -0.5, -0.5], [0.5, 0, -0.5], [0, 0.5, -0.5], [-0.5, 0, -0.5], [0, -0.5, 0.5], [0.5, 0, 0.5], [0, 0.5, 0.5], [-0.5, 0, 0.5]];
  const rf = [[4, 5, 6, 7], [3, 2, 1, 0], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const face = (fi: number): number => (fi === 0 ? SLOT_HIGHLIGHT : SLOT_BASE);
  b.poly(rh, rf, { s: [0.42, 0.3, 0.07], r: [0.5, -0.3, 0.5], t: [-0.12, 0.02, 0.05] }, face);
  b.poly(rh, rf, { s: [0.38, 0.26, 0.07], r: [0.3, 0.4, -0.6], t: [0.13, 0.08, 0.02] }, face);
  b.poly(rh, rf, { s: [0.34, 0.24, 0.07], r: [-0.4, 0.2, 1.2], t: [0.02, -0.16, 0.04] }, face);
  return b.build();
}

function gold(): ShapeTemplate {
  const b = new ShapeBuilder();
  const { v, f } = bipyramidY(6, 0.38, 0.36, 0.2);
  b.poly(v, f, { s: [0.56, 0.44, 0.42], r: [0.45, 0.2, 0.15], t: [-0.03, -0.04, 0] }, (fi) => (fi < 4 ? SLOT_HIGHLIGHT : SLOT_BASE));
  sparkle(b, 0.2, 0.17, 0.26, 0.13);
  return b.build();
}

/** Flat 4-point star facing +z (8 triangles). */
function sparkle(b: ShapeBuilder, x: number, y: number, z: number, r: number): void {
  const inner = r * 0.28;
  const pts: V3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
    const rad = i % 2 === 0 ? r : inner;
    pts.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad, z]);
  }
  const c: V3 = [x, y, z + 0.01];
  for (let i = 0; i < 8; i++) b.tri(c, pts[i], pts[(i + 1) % 8], SLOT_SPARKLE);
}

function iridium(): ShapeTemplate {
  const b = new ShapeBuilder();
  const { v, f } = prismY(6, Math.PI / 6);
  const cap = (fi: number): number => (fi === 6 ? SLOT_HIGHLIGHT : SLOT_BASE);
  b.poly(v, f, { s: [0.32, 0.3, 0.32], r: [0.5, 0.3, -0.35], t: [-0.09, -0.05, 0] }, cap);
  b.poly(v, f, { s: [0.26, 0.24, 0.26], r: [0.2, -0.4, 0.6], t: [0.15, 0.1, 0] }, cap);
  return b.build();
}

function thorium(): ShapeTemplate {
  const b = new ShapeBuilder();
  const { v, f } = cappedPrismY(6, 0.35);
  const tip = (fi: number): number => (fi >= 6 && fi % 2 === 0 ? SLOT_HIGHLIGHT : SLOT_BASE);
  b.poly(v, f, { s: [0.15, 0.48, 0.15], r: [0.3, 0, 0.75], t: [0, 0, 0] }, tip);
  b.poly(v, f, { s: [0.15, 0.48, 0.15], r: [0.3, 0, -0.75], t: [0, 0, 0.02] }, tip);
  return b.build();
}

function peridot(): ShapeTemplate {
  const b = new ShapeBuilder();
  const n = 6;
  const v: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    v.push([Math.cos(a) * 0.24, -0.06, -Math.sin(a) * 0.24]);
  }
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    v.push([Math.cos(a) * 0.15, 0.12, -Math.sin(a) * 0.15]);
  }
  v.push([0, 0.36, 0], [0, -0.3, 0]);
  const f: number[][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    f.push([i, j, n + i]);
    f.push([j, n + j, n + i]);
    f.push([n + i, n + j, 2 * n]);
    f.push([j, i, 2 * n + 1]);
  }
  b.poly(v, f, { s: [1.05, 1.05, 0.75], r: [0.35, 0, -0.2] }, (fi) => (fi % 3 === 1 ? SLOT_HIGHLIGHT : SLOT_BASE));
  return b.build();
}

function fireOpal(): ShapeTemplate {
  const b = new ShapeBuilder();
  const n = 6;
  const v: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    v.push([Math.cos(a) * 0.32, Math.sin(a) * 0.25, 0]);
  }
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    v.push([Math.cos(a) * 0.24, Math.sin(a) * 0.18, 0.15]);
  }
  v.push([0, 0, 0.23]);
  const f: number[][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    f.push([i, j, n + i]);
    f.push([j, n + j, n + i]);
    f.push([n + i, n + j, 2 * n]);
  }
  f.push(Array.from({ length: n }, (_, i) => n - 1 - i));
  b.poly(v, f, { r: [0.25, 0, 0.1] }, (fi) => (fi === 2 || fi === 7 || fi === 13 ? SLOT_HIGHLIGHT : SLOT_BASE));
  return b.build();
}

function diamond(): ShapeTemplate {
  const b = new ShapeBuilder();
  const v: V3[] = [[0.5, 0, 0], [-0.5, 0, 0], [0, 0.5, 0], [0, -0.5, 0], [0, 0, 0.5], [0, 0, -0.5]];
  const f = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  b.poly(v, f, { s: [0.62, 0.66, 0.5], r: [0.35, 0.45, 0.1] }, (fi) => (fi % 2 === 0 ? SLOT_HIGHLIGHT : SLOT_BASE));
  return b.build();
}

function echoQuartz(): ShapeTemplate {
  const b = new ShapeBuilder();
  const { v, f } = cappedPrismY(6, 0.45);
  const tip = (fi: number): number => (fi >= 6 && fi % 2 === 0 ? SLOT_HIGHLIGHT : SLOT_BASE);
  b.poly(v, f, { s: [0.2, 0.42, 0.2], r: [0.3, 0.2, 0.25], t: [-0.08, 0.02, 0] }, tip);
  b.poly(v, f, { s: [0.17, 0.32, 0.17], r: [0.3, -0.3, -0.45], t: [0.12, -0.04, 0.02] }, tip);
  return b.build();
}

function fossilShell(): ShapeTemplate {
  const b = new ShapeBuilder();
  const disc = prismY(8);
  b.poly(disc.v, disc.f, { s: [0.62, 0.14, 0.62], r: [Math.PI / 2, 0, 0] }, (fi) => (fi === 8 ? SLOT_HIGHLIGHT : SLOT_BASE));
  const coil = prismY(6);
  b.poly(coil.v, coil.f, { s: [0.32, 0.1, 0.32], r: [Math.PI / 2, 0, 0.3], t: [0.06, 0.05, 0.1] }, () => SLOT_HIGHLIGHT);
  return b.build();
}

function strongbox(): ShapeTemplate {
  const b = new ShapeBuilder();
  b.poly(BOX_V, BOX_F, { s: [0.52, 0.36, 0.3], r: [0.15, 0.2, 0] }, () => SLOT_BASE);
  b.poly(BOX_V, BOX_F, { s: [0.55, 0.08, 0.33], r: [0.15, 0.2, 0], t: [0, 0.06, 0.005] }, () => SLOT_HIGHLIGHT);
  return b.build();
}

function recorder(): ShapeTemplate {
  const b = new ShapeBuilder();
  b.poly(BOX_V, BOX_F, { s: [0.44, 0.32, 0.28], r: [0.15, -0.2, 0] }, () => SLOT_BASE);
  b.poly(BOX_V, BOX_F, { s: [0.2, 0.12, 0.04], r: [0.15, -0.2, 0], t: [-0.06, 0.02, 0.15] }, () => SLOT_HIGHLIGHT);
  b.poly(BOX_V, BOX_F, { s: [0.05, 0.26, 0.05], r: [0.15, -0.2, -0.3], t: [0.17, 0.22, 0] }, () => SLOT_HIGHLIGHT);
  return b.build();
}

function sigilTablet(): ShapeTemplate {
  const b = new ShapeBuilder();
  b.poly(BOX_V, BOX_F, { s: [0.44, 0.52, 0.12], r: [0.25, 0.15, 0.08] }, () => SLOT_BASE);
  b.poly(BOX_V, BOX_F, { s: [0.2, 0.24, 0.04], r: [0.25, 0.15, 0.08], t: [0, 0.01, 0.07] }, () => SLOT_HIGHLIGHT);
  return b.build();
}

const ORE_BUILDERS: readonly (() => ShapeTemplate)[] = [
  hematite, copper, cobalt, gold, iridium, thorium, peridot, fireOpal, diamond, echoQuartz,
];
const RELIC_BUILDERS: readonly (() => ShapeTemplate)[] = [fossilShell, strongbox, recorder, sigilTablet];

let oreCache: ShapeTemplate[] | null = null;
let relicCache: ShapeTemplate[] | null = null;

/** Template for mineral tier 1..10. */
export function oreShape(tier: number): ShapeTemplate {
  oreCache ??= ORE_BUILDERS.map((f) => f());
  return oreCache[Math.max(1, Math.min(10, tier)) - 1];
}

/** Template for relic id 0..3. */
export function relicShape(id: number): ShapeTemplate {
  relicCache ??= RELIC_BUILDERS.map((f) => f());
  return relicCache[Math.max(0, Math.min(3, id))];
}
