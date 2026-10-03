// Procedural factory pieces (03 §8.1, §8.4, §8.6–8.7, §8.11; canon §3.1 heights): toy-proportion buildings,
// belt decks and chevrons, lift parts and items, built from the shared kit primitives with vertex colours plus a
// per-vertex `hfPart` attribute (emissive, flags, chevron phase) the factory material reads (materials/glsl.ts).
//
// Local frames. Yard pieces: origin at the footprint centre on the plateau (y = 0), +x is the output (facing)
// edge, the instance rotates about y. Mine pieces: origin at the footprint centre on the occupant mid-plane
// (z = 0) — Auto-Drill — or at the bottom-centre of a cell (lift parts, floor belts, Routers).
import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { ORES, ROLE, SPECIAL, UI } from '../palette';
import { PART_FLAG } from '../materials/glsl';
import {
  GeometryBuilder,
  at,
  box,
  capsule,
  chamferBox,
  cylinder,
  frustum,
  ico,
  lathe,
  mixHex,
  rock,
  roundedBox,
  shadeHex,
  sphere,
  torus,
  type ColorSpec,
} from '../models/kit';

const BODY = ROLE.buildingBody;
const TRIM = ROLE.buildingTrim;
const MUSTARD = ROLE.logistics;
const FRAME = mixHex(ROLE.logistics, ROLE.rust, 0.18);
const STEEL = SPECIAL.hardrockChamfer;
const RUST = ROLE.rust;

/** Belt deck top above its floor (Yard plateau or tunnel floor). */
export const BELT_DECK_TOP = 0.13;
/** Underground floor belts are this much flatter (a floor mount the pod drives over; canon §3.1). */
export const MINE_BELT_SCALE_Y = 0.7;
/** Wall-mount layer centre (canon §3.1: z −1.0…−0.45). */
export const LIFT_Z = -0.75;
/** Strand half-spacing = sheave radius: loaded buckets ride up the −x strand, empties down the +x one. */
export const SHEAVE_R = 0.28;
/** Sheave axle height and its z (over the shaft mouth) in the Headframe's local frame. */
export const SHEAVE_Y = 2.62;
export const HEADFRAME_SHEAVE_Z = 1.25;
/** Chimney top of the Smelter, local (smoke origin). */
export const SMELTER_CHIMNEY: readonly [number, number, number] = [0.42, 1.6, -0.42];

// ---------------------------------------------------------------------------------------------
// Builder with per-vertex part data
// ---------------------------------------------------------------------------------------------

export interface PartOpts {
  /** Darken toward the primitive's local bottom (kit AO). */
  ao?: number;
  /** Emissive 0..1 (GLOW parts: the idle level). */
  em?: number;
  /** PART_FLAG bits. */
  flags?: number;
  /** Chevron phase (tiles). */
  phase?: number;
}

interface Segment {
  key: string;
  em: number;
  flags: number;
  phase: number;
  g: GeometryBuilder;
}

/** Merges coloured primitives into one geometry with position, normal, color and hfPart (vec4). */
export class PartBuilder {
  private readonly segs: Segment[] = [];

  /** `baseFlags` are OR'ed into every primitive (e.g. BREATHE for a whole machine). */
  constructor(private readonly baseFlags = 0) {}

  add(src: BufferGeometry, color: ColorSpec, matrix?: Matrix4, opts: PartOpts = {}): this {
    const em = opts.em ?? 0;
    const flags = (opts.flags ?? 0) | this.baseFlags;
    const phase = opts.phase ?? 0;
    const key = `${em}|${flags}|${phase}`;
    let seg = this.segs.find((s) => s.key === key);
    if (!seg) {
      seg = { key, em, flags, phase, g: new GeometryBuilder() };
      this.segs.push(seg);
    }
    seg.g.add(src, color, matrix, opts.ao ?? 0);
    src.dispose();
    return this;
  }

  get vertexCount(): number {
    let n = 0;
    for (const s of this.segs) n += s.g.vertexCount;
    return n;
  }

  build(): BufferGeometry {
    const parts = this.segs.map((s) => ({ s, a: s.g.toArrays() }));
    const n = parts.reduce((k, p) => k + p.a.count, 0);
    const position = new Float32Array(n * 3);
    const normal = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const part = new Float32Array(n * 4);
    let o = 0;
    for (const { s, a } of parts) {
      position.set(a.position, o * 3);
      normal.set(a.normal, o * 3);
      color.set(a.color, o * 3);
      for (let i = 0; i < a.count; i++) {
        const k = (o + i) * 4;
        part[k] = s.em;
        part[k + 1] = s.flags;
        part[k + 2] = s.phase;
      }
      o += a.count;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(position, 3));
    g.setAttribute('normal', new BufferAttribute(normal, 3));
    g.setAttribute('color', new BufferAttribute(color, 3));
    g.setAttribute('hfPart', new BufferAttribute(part, 4));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const DECAL = PART_FLAG.NOHULL;
const RUSTED = PART_FLAG.RUST | PART_FLAG.NOHULL;
const LED = PART_FLAG.LED | PART_FLAG.NOHULL;
const METAL = PART_FLAG.METAL;

/** A rust patch hugging a face whose outward normal is ±x or ±z (the survey set's skin). */
function rust(b: PartBuilder, x: number, y: number, z: number, w: number, h: number, normal: 'x' | 'z', shade = 1): void {
  const c = shadeHex(RUST, shade);
  if (normal === 'z') b.add(box(w, h, 0.024), c, at(x, y, z), { flags: RUSTED });
  else b.add(box(0.024, h, w), c, at(x, y, z), { flags: RUSTED });
}

/** A square-section beam between two points. */
function beam(b: PartBuilder, color: number, a: Vector3, c: Vector3, size: number, flags = METAL): void {
  const d = new Vector3().subVectors(c, a);
  const len = d.length();
  const mid = new Vector3().addVectors(a, c).multiplyScalar(0.5);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
  b.add(box(size, len, size), color, new Matrix4().compose(mid, q, new Vector3(1, 1, 1)), { flags });
}

/** Status LED stud. */
function led(b: PartBuilder, x: number, y: number, z: number): void {
  b.add(sphere(0.055, 6, 3), 0xffffff, at(x, y, z), { flags: LED });
}

/** Plum plinth + cream body + plum lip + role roof (03 §8.6); returns the roof top. */
function shell(b: PartBuilder, w: number, h: number, d: number, x: number, z: number, roof: number): number {
  b.add(chamferBox(w + 0.16, 0.1, d + 0.16, 0.04), TRIM, at(x, 0.05, z));
  b.add(roundedBox(w, h, d, 0.12), BODY, at(x, 0.1 + h / 2, z), { ao: 0.2 });
  b.add(box(w + 0.08, 0.05, d + 0.08), TRIM, at(x, 0.1 + h + 0.015, z));
  b.add(roundedBox(w + 0.14, 0.14, d + 0.14, 0.06), roof, at(x, 0.1 + h + 0.1, z));
  return 0.1 + h + 0.17;
}

/** Mustard output lip on the +x (facing) edge: where a machine's output belt starts (02 §2.2). */
function outputLip(b: PartBuilder, xFace: number, y = 0.24): void {
  b.add(box(0.1, 0.3, 0.56), TRIM, at(xFace, y, 0));
  b.add(chamferBox(0.16, 0.07, 0.6, 0.025), MUSTARD, at(xFace + 0.04, y + 0.17, 0));
  b.add(box(0.03, 0.2, 0.42), mixHex(TRIM, 0x000000, 0.35), at(xFace + 0.055, y - 0.02, 0), { flags: DECAL });
}

// ---------------------------------------------------------------------------------------------
// Belts (03 §8.6–8.7: mustard rails on a plum deck, chevrons #FFE9A8)
// ---------------------------------------------------------------------------------------------

function deckRail(b: PartBuilder, x: number, z: number, ry: number, len = 1.0): void {
  b.add(box(len, 0.16, 0.1), MUSTARD, at(x, 0.1, z, 0, ry, 0));
}

/** Straight tile travelling +x. */
export function beltStraightGeometry(): BufferGeometry {
  const b = new PartBuilder();
  b.add(box(1.0, 0.1, 0.8), ROLE.logisticsDeck, at(0, BELT_DECK_TOP - 0.05, 0));
  deckRail(b, 0, -0.43, 0);
  deckRail(b, 0, 0.43, 0);
  return b.build();
}

/**
 * Corner tile, open on its −x (entry) and −z (exit) edges, rails on +x and +z with a post at the inner corner.
 * A clockwise turn uses it rotated to the entry direction; an anticlockwise one rotated one step further.
 */
export function beltCornerGeometry(): BufferGeometry {
  const b = new PartBuilder();
  b.add(box(1.0, 0.1, 1.0), ROLE.logisticsDeck, at(0, BELT_DECK_TOP - 0.05, 0));
  deckRail(b, 0.45, 0, Math.PI / 2);
  deckRail(b, 0, 0.45, 0);
  b.add(box(0.13, 0.19, 0.13), MUSTARD, at(-0.44, 0.1, -0.44));
  return b.build();
}

/** Junction: a straight crossing (02 §2.1), open on all four edges with corner posts. */
export function beltJunctionGeometry(): BufferGeometry {
  const b = new PartBuilder();
  b.add(box(1.0, 0.1, 1.0), ROLE.logisticsDeck, at(0, BELT_DECK_TOP - 0.05, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(box(0.16, 0.19, 0.16), MUSTARD, at(sx * 0.42, 0.1, sz * 0.42));
  b.add(box(0.5, 0.012, 0.5), shadeHex(ROLE.logisticsDeck, 1.25), at(0, BELT_DECK_TOP + 0.004, 0), { flags: DECAL });
  return b.build();
}

/** Two chevrons a half tile apart, scrolled by the shader (local centre on the deck, pointing +x); flat quads. */
export function chevronGeometry(): BufferGeometry {
  const b = new PartBuilder();
  for (const phase of [0, 0.5]) {
    for (const side of [-1, 1]) {
      b.add(flatQuad(0.24, 0.07), ROLE.chevron, at(-0.02, 0, side * 0.08, 0, side * 0.62, 0), { flags: PART_FLAG.CHEVRON | DECAL, phase, em: 0.15 });
    }
  }
  return b.build();
}

/** An up-facing quad (w along x, d along z), centred. */
function flatQuad(w: number, d: number): BufferGeometry {
  const x = w / 2, z = d / 2;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-x, 0, z, x, 0, z, x, 0, -z, -x, 0, z, x, 0, -z, -x, 0, -z]), 3));
  return g;
}
/** Chevron height above the floor. */
export const CHEVRON_Y = BELT_DECK_TOP + 0.016;

// ---------------------------------------------------------------------------------------------
// Logistics buildings
// ---------------------------------------------------------------------------------------------

/** Router 1×1 (both planes): a mustard hub with four port nubs. */
export function routerGeometry(): BufferGeometry {
  const b = new PartBuilder();
  b.add(chamferBox(0.92, 0.1, 0.92, 0.04), ROLE.logisticsDeck, at(0, 0.05, 0));
  b.add(roundedBox(0.62, 0.3, 0.62, 0.09), MUSTARD, at(0, 0.25, 0), { ao: 0.2 });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    b.add(box(0.16, 0.12, 0.22), TRIM, at(Math.cos(a) * 0.36, 0.17, -Math.sin(a) * 0.36, 0, a, 0));
  }
  b.add(cylinder(0.17, 0.07, 8), TRIM, at(0, 0.43, 0));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    b.add(box(0.2, 0.02, 0.06), ROLE.chevron, at(Math.cos(a) * 0.17, 0.41, -Math.sin(a) * 0.17, 0, a, 0), { flags: DECAL });
  }
  return b.build();
}

/** Headframe 2×2 on Yard rows 1–2 (02 §2.2): tower, hoist house and the cantilever over the shaft (≤ 3 tall). */
export function headframeGeometry(): BufferGeometry {
  const b = new PartBuilder();
  const frontZ = 0.85, backZ = -0.85, topY = 2.36, hz = -0.35;
  // Hoist house.
  b.add(chamferBox(1.84, 0.1, 1.04, 0.04), TRIM, at(0, 0.05, hz));
  b.add(roundedBox(1.7, 0.72, 0.9, 0.1), BODY, at(0, 0.46, hz), { ao: 0.18 });
  b.add(chamferBox(1.86, 0.12, 1.06, 0.04), MUSTARD, at(0, 0.88, hz));
  b.add(box(0.4, 0.5, 0.05), TRIM, at(-0.5, 0.35, hz + 0.46));
  b.add(sphere(0.07, 6, 3), UI.amber, at(0.55, 0.98, hz + 0.3), { em: 1 });
  led(b, 0.62, 0.62, hz + 0.465);
  rust(b, 0.25, 0.32, hz + 0.465, 0.42, 0.22, 'z');
  rust(b, 0.862, 0.6, hz + 0.05, 0.36, 0.28, 'x', 0.85);
  // Legs: vertical fronts, raked backs, braces.
  for (const lx of [-0.85, 0.85]) {
    beam(b, FRAME, new Vector3(lx, 0, frontZ), new Vector3(lx, topY, frontZ), 0.12);
    beam(b, FRAME, new Vector3(lx, 0, backZ), new Vector3(lx, topY - 0.05, frontZ - 0.1), 0.11);
    beam(b, FRAME, new Vector3(lx, 1.2, frontZ), new Vector3(lx, 1.2, backZ + 0.82), 0.08);
    b.add(box(0.22, 0.08, 0.22), TRIM, at(lx, 0.04, frontZ));
    b.add(box(0.22, 0.08, 0.22), TRIM, at(lx, 0.04, backZ));
    rust(b, lx, 0.7, frontZ + 0.072, 0.1, 0.3, 'z', 0.9);
    rust(b, lx, 1.75, frontZ + 0.072, 0.1, 0.22, 'z', 0.75);
  }
  beam(b, FRAME, new Vector3(-0.85, topY, frontZ), new Vector3(0.85, topY, frontZ), 0.12);
  beam(b, FRAME, new Vector3(-0.85, 1.2, frontZ), new Vector3(0.85, 1.2, frontZ), 0.08);
  beam(b, FRAME, new Vector3(-0.85, 0.3, frontZ), new Vector3(0.85, 1.15, frontZ), 0.07);
  // Cantilever over the shaft mouth (both columns: the sheave rides the axle over whichever holds the lift).
  for (const ax of [-0.94, 0.94]) {
    beam(b, FRAME, new Vector3(ax, topY, frontZ), new Vector3(ax, topY, HEADFRAME_SHEAVE_Z + 0.1), 0.09);
    b.add(box(0.12, 0.24, 0.16), TRIM, at(ax, SHEAVE_Y - 0.06, HEADFRAME_SHEAVE_Z));
  }
  b.add(cylinder(0.05, 1.9, 6), TRIM, at(0, SHEAVE_Y, HEADFRAME_SHEAVE_Z, 0, 0, Math.PI / 2), { flags: METAL });
  b.add(sphere(0.06, 6, 3), UI.amber, at(0.94, topY + 0.12, frontZ), { em: 1 });
  return b.build();
}

/** Sheave wheel (rotates about z) for the Headframe; local origin at its axle. */
export function sheaveGeometry(): BufferGeometry {
  const b = new PartBuilder();
  b.add(torus(SHEAVE_R, 0.05, 4, 12), MUSTARD, at(0, 0, 0), { flags: METAL });
  for (let i = 0; i < 3; i++) b.add(box(SHEAVE_R * 2, 0.05, 0.05), FRAME, at(0, 0, 0, 0, 0, (i * Math.PI) / 3));
  b.add(cylinder(0.07, 0.12, 8), TRIM, at(0, 0, 0, Math.PI / 2));
  return b.build();
}

// ---------------------------------------------------------------------------------------------
// Processing, assembly, storage and market (2×2 Yard)
// ---------------------------------------------------------------------------------------------

/** Smelter (coral roof; furnace #FFB238 glows while working; chimney ≤ 1.6). Output on +x. */
export function smelterGeometry(): BufferGeometry {
  const b = new PartBuilder(PART_FLAG.BREATHE);
  b.add(chamferBox(1.9, 0.1, 1.9, 0.04), TRIM, at(0, 0.05, 0));
  b.add(roundedBox(1.7, 0.85, 1.6, 0.14), BODY, at(0, 0.525, 0), { ao: 0.2 });
  b.add(roundedBox(1.82, 0.14, 1.72, 0.06), ROLE.processing, at(0, 1.02, 0));
  // Furnace mouth on the back (−x) face, opposite the output.
  const fx = -0.85;
  b.add(box(0.06, 0.58, 0.84), TRIM, at(fx - 0.02, 0.42, 0.25));
  b.add(chamferBox(0.05, 0.42, 0.68, 0.02), ROLE.furnace, at(fx - 0.04, 0.4, 0.25), { flags: PART_FLAG.GLOW, em: 0.28 });
  b.add(box(0.06, 0.06, 0.72), TRIM, at(fx - 0.07, 0.4, 0.25));
  b.add(sphere(0.05, 6, 3), ROLE.furnace, at(fx - 0.03, 0.78, -0.45), { flags: PART_FLAG.GLOW, em: 0.3 });
  // Chimney.
  const [cx, , cz] = SMELTER_CHIMNEY;
  b.add(cylinder(0.17, 0.55, 8), shadeHex(TRIM, 1.15), at(cx, 1.28, cz), { flags: METAL });
  b.add(cylinder(0.2, 0.08, 8), ROLE.processing, at(cx, 1.54, cz));
  outputLip(b, 0.86);
  led(b, 0.4, 0.78, 0.81);
  rust(b, -0.4, 0.35, 0.812, 0.38, 0.24, 'z');
  rust(b, fx - 0.012, 0.75, -0.45, 0.32, 0.18, 'x', 0.85);
  rust(b, cx, 1.18, cz + 0.182, 0.14, 0.16, 'z', 0.8);
  return b.build();
}

/** Assembler (teal roof; a two-joint arm on the roof). Output on +x. */
export function assemblerGeometry(): BufferGeometry {
  const b = new PartBuilder(PART_FLAG.BREATHE);
  const top = shell(b, 1.68, 0.72, 1.6, 0, 0, ROLE.assembly);
  // Window band on the Rim-facing side and a teal hatch at the back.
  b.add(chamferBox(1.0, 0.24, 0.05, 0.02), mixHex(UI.plum, ROLE.assembly, 0.4), at(-0.15, 0.55, 0.81), { flags: PART_FLAG.GLOW, em: 0.12 });
  b.add(box(0.05, 0.42, 0.6), ROLE.assembly, at(-0.86, 0.38, 0));
  // Roof arm.
  b.add(cylinder(0.2, 0.1, 8), TRIM, at(-0.25, top + 0.05, -0.1), { flags: METAL });
  b.add(chamferBox(0.13, 0.5, 0.13, 0.04), ROLE.assembly, at(-0.12, top + 0.3, -0.1, 0, 0, -0.5));
  b.add(sphere(0.09, 6, 3), TRIM, at(0.0, top + 0.52, -0.1), { flags: METAL });
  b.add(box(0.11, 0.42, 0.11), ROLE.assembly, at(0.17, top + 0.42, -0.1, 0, 0, 1.0));
  b.add(box(0.16, 0.06, 0.2), TRIM, at(0.33, top + 0.3, -0.1), { flags: METAL });
  outputLip(b, 0.85);
  led(b, 0.5, 0.75, 0.81);
  rust(b, 0.45, 0.3, 0.812, 0.32, 0.2, 'z');
  rust(b, -0.852, 0.72, -0.5, 0.3, 0.18, 'x', 0.85);
  return b.build();
}

/** Storage Bin (lilac octagonal silo; the +x hatch is its unload port, 02 §2.2). */
export function binGeometry(): BufferGeometry {
  const b = new PartBuilder();
  b.add(chamferBox(1.9, 0.1, 1.9, 0.04), TRIM, at(0, 0.05, 0));
  b.add(
    lathe(
      [
        [0, 0],
        [0.72, 0],
        [0.8, 0.08],
        [0.8, 0.95],
        [0.72, 1.02],
        [0, 1.02],
      ],
      8,
      Math.PI / 8,
    ),
    BODY,
    at(0, 0.1, 0),
    { ao: 0.2 },
  );
  b.add(cylinder(0.83, 0.16, 8, 0.03), ROLE.storage, at(0, 0.62, 0));
  b.add(frustum(0.86, 0.3, 0.32, 8, Math.PI / 8), ROLE.storage, at(0, 1.28, 0));
  b.add(cylinder(0.22, 0.08, 8, 0.02), TRIM, at(0, 1.48, 0), { flags: METAL });
  // Unload hatch.
  b.add(chamferBox(0.12, 0.36, 0.5, 0.03), TRIM, at(0.8, 0.32, 0));
  b.add(chamferBox(0.06, 0.26, 0.4, 0.02), ROLE.storage, at(0.86, 0.32, 0));
  led(b, 0.55, 0.9, 0.56);
  rust(b, 0.1, 0.35, 0.762, 0.34, 0.26, 'z');
  rust(b, -0.15, 0.85, 0.762, 0.24, 0.16, 'z', 0.85);
  return b.build();
}

/** Export Terminal (lilac; inputs on every edge, sells at 90%): a booth, a gold coin sign and a crate stack. */
export function exportGeometry(): BufferGeometry {
  const b = new PartBuilder(PART_FLAG.BREATHE);
  b.add(chamferBox(1.92, 0.12, 1.92, 0.04), TRIM, at(0, 0.06, 0));
  b.add(box(1.6, 0.012, 0.16), MUSTARD, at(0, 0.126, 0.72), { flags: DECAL });
  // Booth at the back-left.
  b.add(roundedBox(1.1, 0.72, 0.9, 0.1), BODY, at(-0.35, 0.48, -0.4), { ao: 0.18 });
  b.add(roundedBox(1.26, 0.13, 1.06, 0.05), ROLE.storage, at(-0.35, 0.9, -0.4));
  b.add(chamferBox(0.5, 0.26, 0.05, 0.02), mixHex(UI.plum, ROLE.storage, 0.35), at(-0.35, 0.58, 0.06), { flags: PART_FLAG.GLOW, em: 0.12 });
  // Intake hopper in the middle of the pad.
  b.add(frustum(0.2, 0.36, 0.3, 8), MUSTARD, at(0.35, 0.3, 0.3));
  b.add(cylinder(0.2, 0.1, 8), TRIM, at(0.35, 0.18, 0.3));
  // Crate stack.
  const crate = mixHex(ROLE.storage, BODY, 0.45);
  b.add(chamferBox(0.42, 0.36, 0.42, 0.04), crate, at(0.55, 0.3, -0.45));
  b.add(box(0.38, 0.32, 0.38), BODY, at(0.6, 0.64, -0.5, 0, 0.35, 0));
  b.add(box(0.36, 0.3, 0.36), crate, at(0.1, 0.27, -0.6, 0, -0.2, 0));
  // Coin sign on a post (gold, ≤ 1.6).
  b.add(cylinder(0.04, 0.85, 6), TRIM, at(-0.72, 0.55, 0.62), { flags: METAL });
  b.add(cylinder(0.27, 0.07, 10), ORES[3].base, at(-0.72, 1.2, 0.62, Math.PI / 2, Math.PI / 4, 0), { flags: METAL, em: 0.15 });
  b.add(cylinder(0.17, 0.08, 10), shadeHex(ORES[3].base, 0.8), at(-0.72, 1.2, 0.62, Math.PI / 2, Math.PI / 4, 0));
  led(b, 0.1, 0.78, 0.06);
  rust(b, -0.6, 0.35, 0.062, 0.3, 0.2, 'z');
  return b.build();
}

// ---------------------------------------------------------------------------------------------
// Underground: Auto-Drill and Bucket Lift parts
// ---------------------------------------------------------------------------------------------

/** Auto-Drill 2×2 (orange roof): body above the lode, legs to the skid; origin at the footprint centre (y −1 = lode top). */
export function autoDrillGeometry(): BufferGeometry {
  const b = new PartBuilder(PART_FLAG.BREATHE);
  b.add(chamferBox(1.9, 0.12, 0.82, 0.04), TRIM, at(0, -0.94, 0));
  for (const sx of [-0.78, 0.78]) {
    for (const sz of [-0.28, 0.28]) b.add(box(0.1, 0.92, 0.1), STEEL, at(sx, -0.48, sz), { flags: METAL });
  }
  b.add(roundedBox(1.6, 0.72, 0.8, 0.12), BODY, at(0, 0.34, 0), { ao: 0.2 });
  b.add(roundedBox(1.72, 0.13, 0.9, 0.05), ROLE.extraction, at(0, 0.77, 0));
  b.add(cylinder(0.17, 0.16, 8), TRIM, at(0.5, 0.91, 0), { flags: METAL });
  b.add(chamferBox(0.7, 0.34, 0.06, 0.025), TRIM, at(-0.3, 0.36, 0.41));
  b.add(box(0.56, 0.08, 0.02), ROLE.extraction, at(-0.3, 0.42, 0.445), { flags: DECAL });
  b.add(cylinder(0.24, 0.14, 8), TRIM, at(0, -0.08, 0), { flags: METAL });
  // Hazard stripes on the skid front.
  for (let i = -2; i <= 2; i++) b.add(box(0.1, 0.1, 0.02), ROLE.extraction, at(i * 0.34, -0.94, 0.415, 0, 0, 0.6), { flags: DECAL });
  led(b, 0.55, 0.46, 0.42);
  rust(b, 0.35, 0.18, 0.412, 0.3, 0.2, 'z');
  return b.build();
}

/** The drill's auger (spins about y): a steel cone with two flights; origin at its top. */
export function drillBitGeometry(): BufferGeometry {
  const b = new PartBuilder();
  b.add(frustum(0.15, 0.025, 0.8, 6), STEEL, at(0, -0.4, 0), { flags: METAL });
  for (let i = 0; i < 3; i++) b.add(box(0.36 - i * 0.08, 0.04, 0.05), MUSTARD, at(0, -0.18 - i * 0.2, 0, 0, i * 1.2, 0.25));
  return b.build();
}

/** Two guide rails on the back wall, unit tall from y = 0 (scaled to the column). */
export function liftRailGeometry(): BufferGeometry {
  const b = new PartBuilder();
  for (const rx of [-0.43, 0.43]) b.add(box(0.08, 1, 0.08), FRAME, at(rx, 0.5, -0.93), { flags: METAL });
  return b.build();
}

/** A rail tie (every 3 rows). */
export function liftTieGeometry(): BufferGeometry {
  const b = new PartBuilder();
  b.add(chamferBox(0.94, 0.07, 0.06, 0.02), FRAME, at(0, 0, -0.95));
  return b.build();
}

/** The two chain strands at ±SHEAVE_R, unit tall from y = 0. */
export function liftStrandGeometry(): BufferGeometry {
  const b = new PartBuilder();
  for (const sx of [-SHEAVE_R, SHEAVE_R]) b.add(box(0.045, 1, 0.045), TRIM, at(sx, 0.5, LIFT_Z - 0.09), { flags: DECAL | METAL });
  return b.build();
}

/** Lift foot housing at the foot cell (origin at the cell's bottom centre). */
export function liftFootGeometry(): BufferGeometry {
  const b = new PartBuilder();
  b.add(roundedBox(0.92, 0.46, 0.44, 0.08), BODY, at(0, 0.23, LIFT_Z - 0.03), { ao: 0.2 });
  b.add(chamferBox(0.94, 0.1, 0.46, 0.04), MUSTARD, at(0, 0.48, LIFT_Z - 0.03));
  b.add(cylinder(0.2, 0.08, 8), TRIM, at(0, 0.56, LIFT_Z + 0.02, Math.PI / 2), { flags: METAL });
  b.add(chamferBox(0.5, 0.2, 0.05, 0.02), TRIM, at(-0.12, 0.2, LIFT_Z + 0.2));
  led(b, 0.3, 0.3, LIFT_Z + 0.2);
  rust(b, 0.25, 0.14, LIFT_Z + 0.202, 0.2, 0.14, 'z');
  return b.build();
}

/** Head pulley of an underground lift top (origin at the top cell's bottom centre). */
export function liftHeadGeometry(): BufferGeometry {
  const b = new PartBuilder();
  b.add(roundedBox(0.84, 0.24, 0.4, 0.07), BODY, at(0, 0.84, LIFT_Z - 0.05), { ao: 0.15 });
  b.add(chamferBox(0.86, 0.07, 0.42, 0.03), MUSTARD, at(0, 0.98, LIFT_Z - 0.05));
  b.add(torus(SHEAVE_R, 0.045, 4, 10), MUSTARD, at(0, 0.66, LIFT_Z), { flags: METAL });
  return b.build();
}

/** A Mk I bucket (mustard), origin at its centre. */
export function bucketGeometry(): BufferGeometry {
  const b = new PartBuilder();
  b.add(frustum(0.12, 0.17, 0.18, 4, Math.PI / 4), MUSTARD, at(0, 0, 0), { flags: METAL });
  b.add(box(0.36, 0.035, 0.035), TRIM, at(0, 0.1, 0));
  return b.build();
}

/** Smelter smoke puff (unit icosahedron, scaled per instance). */
export function smokeGeometry(): BufferGeometry {
  return new PartBuilder().add(ico(1, 0), mixHex(UI.cream, SPECIAL.hardrockChamfer, 0.35), at(0, 0, 0)).build();
}

// ---------------------------------------------------------------------------------------------
// Items (03 §8.4): origin at the item's bottom centre on the deck
// ---------------------------------------------------------------------------------------------

export type ItemShape =
  | 'chunk'
  | 'ingot'
  | 'gem'
  | 'crate'
  | 'gear'
  | 'wire'
  | 'plate'
  | 'coil'
  | 'motor'
  | 'circuit'
  | 'bit'
  | 'vessel'
  | 'core';

/** Shapes tinted per instance (white geometry × item colour); parts carry their own cream + trim colours. */
export const TINTED_SHAPES: ReadonlySet<ItemShape> = new Set<ItemShape>(['chunk', 'ingot', 'gem', 'crate']);

/** A star prism (gear teeth) centred on the origin, axis y: a lathe can't alternate radii, so triangles directly. */
function star(points: number, rOut: number, rIn: number, h: number): BufferGeometry {
  const pos: number[] = [];
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const r0 = i % 2 === 0 ? rOut : rIn;
    const r1 = (i + 1) % 2 === 0 ? rOut : rIn;
    const p0 = [Math.cos(a0) * r0, Math.sin(a0) * r0];
    const p1 = [Math.cos(a1) * r1, Math.sin(a1) * r1];
    pos.push(0, h / 2, 0, p1[0], h / 2, p1[1], p0[0], h / 2, p0[1]);
    pos.push(0, -h / 2, 0, p0[0], -h / 2, p0[1], p1[0], -h / 2, p1[1]);
    pos.push(p0[0], -h / 2, p0[1], p0[0], h / 2, p0[1], p1[0], h / 2, p1[1]);
    pos.push(p0[0], -h / 2, p0[1], p1[0], h / 2, p1[1], p1[0], -h / 2, p1[1]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
}

export function itemGeometry(shape: ItemShape): BufferGeometry {
  const b = new PartBuilder();
  switch (shape) {
    case 'chunk':
      b.add(rock(0.13, 7, 0.3), 0xffffff, at(0, 0.11, 0));
      break;
    case 'ingot':
      b.add(frustum(0.2, 0.13, 0.11, 4, Math.PI / 4), 0xffffff, at(0, 0.055, 0, 0, 0, 0, [1.25, 1, 0.75]), { flags: METAL });
      break;
    case 'gem':
      b.add(
        lathe(
          [
            [0, 0],
            [0.12, 0.12],
            [0, 0.28],
          ],
          4,
        ),
        0xffffff,
        at(0, 0.01, 0),
        { em: 0.25, flags: METAL },
      );
      break;
    case 'crate':
      b.add(chamferBox(0.26, 0.22, 0.26, 0.03), 0xffffff, at(0, 0.11, 0));
      break;
    case 'gear':
      b.add(star(6, 0.15, 0.11, 0.07), BODY, at(0, 0.04, 0));
      b.add(cylinder(0.05, 0.09, 6), TRIM, at(0, 0.045, 0), { flags: METAL });
      break;
    case 'wire':
      b.add(cylinder(0.09, 0.2, 8), ORES[1].base, at(0, 0.12, 0, 0, 0, Math.PI / 2), { flags: METAL });
      for (const sx of [-0.11, 0.11]) b.add(cylinder(0.12, 0.03, 6), BODY, at(sx, 0.12, 0, 0, 0, Math.PI / 2));
      break;
    case 'plate':
      b.add(box(0.3, 0.05, 0.22), BODY, at(0, 0.03, 0));
      for (const sx of [-0.11, 0.11]) for (const sz of [-0.07, 0.07]) b.add(box(0.035, 0.03, 0.035), TRIM, at(sx, 0.065, sz), { flags: METAL });
      break;
    case 'coil':
      b.add(cylinder(0.06, 0.24, 6), BODY, at(0, 0.12, 0));
      for (let i = 0; i < 2; i++) b.add(torus(0.09, 0.028, 3, 6), ROLE.assembly, at(0, 0.07 + i * 0.09, 0, Math.PI / 2 + 0.25, 0, 0), { flags: METAL });
      break;
    case 'motor':
      b.add(cylinder(0.11, 0.18, 8), BODY, at(0, 0.11, 0, 0, 0, Math.PI / 2));
      b.add(cylinder(0.115, 0.05, 8), ROLE.assembly, at(0.03, 0.11, 0, 0, 0, Math.PI / 2));
      b.add(cylinder(0.025, 0.12, 4), STEEL, at(0.14, 0.11, 0, 0, 0, Math.PI / 2), { flags: METAL });
      break;
    case 'circuit':
      b.add(box(0.28, 0.04, 0.22), mixHex(ROLE.assembly, UI.plum, 0.35), at(0, 0.03, 0));
      b.add(box(0.12, 0.05, 0.1), TRIM, at(0, 0.07, 0));
      for (const sx of [-0.1, 0.1]) b.add(box(0.03, 0.02, 0.16), ORES[3].base, at(sx, 0.06, 0), { flags: METAL });
      break;
    case 'bit':
      b.add(frustum(0.1, 0.0, 0.26, 6), STEEL, at(0, 0.13, 0, 0, 0, Math.PI / 2), { flags: METAL });
      b.add(cylinder(0.07, 0.06, 6), ROLE.extraction, at(-0.15, 0.13, 0, 0, 0, Math.PI / 2));
      break;
    case 'vessel':
      b.add(capsule(0.09, 0.3, 6, 2), BODY, at(0, 0.1, 0, 0, 0, Math.PI / 2));
      b.add(cylinder(0.095, 0.05, 6), ROLE.power, at(0, 0.1, 0, 0, 0, Math.PI / 2));
      break;
    case 'core':
      b.add(chamferBox(0.2, 0.2, 0.2, 0.03), ORES[5].base, at(0, 0.1, 0), { em: 0.8 });
      break;
  }
  return b.build();
}
