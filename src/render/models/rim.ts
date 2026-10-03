// The four Rim services (canon §2.4; 03 §8.6): Pump House, Assay Office, Garage, Supply Shed. Each is
// a 4×3 building on Yard rows 1–3 (z ∈ [−4, −1]) at its Rim x range, ≤ 3 units tall (canon §3.1),
// with one big icon sign. Per building ≤ 4 meshes: static solid, static metal, lights, one animated part.
import { BufferAttribute, BufferGeometry, Color, Group, Shape, Vector3, type Mesh } from 'three';
import { RIM_BUILDINGS, type RimBuildingId } from '../../shared/canon';
import { ORES, POD, ROLE, UI } from '../palette';
import { ALL_PADS_ARMED, type MatRole, type RimBuildingsModel } from './api';
import {
  GeometryBuilder,
  at,
  bowl,
  capsule,
  chamferBox,
  cylinder,
  extrude,
  frustum,
  mixHex,
  roleMesh,
  roundedBox,
  shadeHex,
  sphere,
  torus,
} from './kit';

const BODY = ROLE.buildingBody;
const DARK = ROLE.buildingTrim;
const GOLD = ORES[3].base;
const WINDOW = mixHex(UI.plum, POD.visor, 0.35);
const BEACON = UI.danger;

/** Footprint: 4 wide (x0 .. x0 + 4), Yard rows 1–3 → z ∈ [−4, −1]; local origin at its ground centre. */
const FOOT_W = 4;
const FOOT_D = 3;
const FOOT_CZ = -2.5;
const PLINTH_H = 0.12;
const ROOF_H = 0.16;

interface Parts {
  solid: GeometryBuilder;
  metal: GeometryBuilder;
  glow: GeometryBuilder;
}

interface BuildingSpec {
  /** Local-space anchor above the sign. */
  anchor: readonly [number, number, number];
  /** Animated part: geometry relative to its pivot. */
  anim: { geometry: GeometryBuilder; role: MatRole; pivot: readonly [number, number, number] };
  /** Per-frame animation of the animated part and the lights. */
  animate(anim: Mesh, glow: Mesh, t: number): void;
}

/** Cream body on a plum plinth with a role-coloured roof slab; returns the roof top y. */
function shell(p: Parts, w: number, h: number, d: number, x: number, z: number, roof: number): number {
  p.solid.add(roundedBox(w + 0.14, PLINTH_H, d + 0.14, 0.05), DARK, at(x, PLINTH_H / 2, z));
  p.solid.add(roundedBox(w, h, d, 0.12), BODY, at(x, PLINTH_H + h / 2, z), 0.18);
  p.solid.add(roundedBox(w + 0.12, 0.06, d + 0.12, 0.03), DARK, at(x, PLINTH_H + h + 0.01, z));
  p.solid.add(roundedBox(w + 0.24, ROOF_H, d + 0.24, 0.07), roof, at(x, PLINTH_H + h + 0.04 + ROOF_H / 2, z));
  return PLINTH_H + h + 0.04 + ROOF_H;
}

/** Door with a frame on a +z façade at `zFace`. */
function door(p: Parts, x: number, w: number, h: number, zFace: number, color: number): void {
  p.solid.add(roundedBox(w + 0.12, h + 0.06, 0.06, 0.03), DARK, at(x, PLINTH_H + (h + 0.06) / 2, zFace + 0.02));
  p.solid.add(roundedBox(w, h, 0.06, 0.03), color, at(x, PLINTH_H + h / 2, zFace + 0.05));
}

// ---------------------------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------------------------

/** Fuel drop, tip up, about 0.62 tall, centred. */
function dropShape(): Shape {
  const r = 0.2;
  const cy = -0.1;
  const tipY = 0.31;
  const s = new Shape();
  s.moveTo(0, tipY);
  const a = Math.asin(r / (tipY - cy)); // half-angle of the tangent lines at the tip
  const tx = r * Math.cos(a);
  const ty = cy + r * Math.sin(a);
  s.lineTo(tx, ty);
  s.absarc(0, cy, r, a, Math.PI - a, true);
  s.lineTo(0, tipY);
  return s;
}

/** Gear with `teeth` teeth and a round hole. */
function gearShape(rOut: number, rIn: number, teeth: number, hole: number): Shape {
  const s = new Shape();
  const n = teeth * 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = i % 4 < 2 ? rOut : rIn;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  const h = new Shape();
  h.absarc(0, 0, hole, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------

function blink(t: number, hz: number): boolean {
  return (t * hz) % 1 < 0.5;
}

/** Pump House: kiosk, amber pump totem crowned by a spinning fuel-drop sign, two fuel tanks, a beacon. */
function pumpHouse(p: Parts): BuildingSpec {
  const amber = ROLE.furnace;
  const roofTop = shell(p, 2.0, 1.15, 2.0, -0.85, -0.35, amber);
  const face = -0.35 + 1.0;
  door(p, -1.3, 0.5, 0.8, face, DARK);
  p.solid.add(roundedBox(0.62, 0.42, 0.06, 0.04), WINDOW, at(-0.45, 0.78, face + 0.03));
  // Totem.
  const tx = 1.05, tz = 0.75;
  p.solid.add(roundedBox(0.66, 0.12, 0.6, 0.05), DARK, at(tx, 0.06, tz));
  p.solid.add(roundedBox(0.52, 1.9, 0.44, 0.13), amber, at(tx, 0.12 + 0.95, tz), 0.2);
  p.solid.add(roundedBox(0.36, 0.5, 0.06, 0.04), BODY, at(tx, 1.42, tz + 0.22));
  p.solid.add(roundedBox(0.2, 0.08, 0.04, 0.02), DARK, at(tx, 1.5, tz + 0.26));
  p.metal.add(torus(0.22, 0.04, 4, 8, Math.PI), DARK, at(tx + 0.27, 0.95, tz, 0, 0, -Math.PI / 2));
  p.metal.add(chamferBox(0.1, 0.22, 0.1, 0.03), DARK, at(tx + 0.27, 0.62, tz));
  p.metal.add(cylinder(0.05, 0.2, 6), DARK, at(tx, 2.11, tz));
  // Tanks on saddles behind the totem.
  for (const z of [-0.2, -0.95]) {
    p.solid.add(capsule(0.3, 1.5, 10, 2), BODY, at(0.95, 0.48, z, 0, 0, Math.PI / 2), 0.15);
    p.solid.add(cylinder(0.31, 0.12, 10), amber, at(0.95, 0.48, z, 0, 0, Math.PI / 2));
    for (const x of [0.5, 1.4]) p.metal.add(chamferBox(0.12, 0.26, 0.48, 0.03), DARK, at(x, 0.13, z));
  }
  // Beacon post on the kiosk roof.
  p.metal.add(cylinder(0.04, 0.16, 6), DARK, at(-1.55, roofTop + 0.08, 0.35));
  p.glow.add(sphere(0.1, 8, 4), BEACON, at(-1.55, roofTop + 0.22, 0.35));
  // Sign: a dark disc with the amber drop on both faces.
  const sign = new GeometryBuilder()
    .add(cylinder(0.4, 0.08, 14, 0.02), DARK, at(0, 0, 0, Math.PI / 2))
    .add(cylinder(0.33, 0.1, 14, 0.02), BODY, at(0, 0, 0, Math.PI / 2))
    .add(extrude(dropShape(), 0.16, 5), amber, at(0, 0, 0));
  return {
    anchor: [tx, 3.05, tz],
    anim: { geometry: sign, role: 'solid', pivot: [tx, 2.55, tz] },
    animate(anim, glow, t) {
      anim.rotation.y = t * 1.1;
      glow.visible = blink(t, 1);
    },
  };
}

/** Assay Office: gold roof, Dot's lit window, and a gold balance scale on the roof that gently rocks. */
function assayOffice(p: Parts): BuildingSpec {
  const z0 = -0.2;
  const roofTop = shell(p, 3.4, 1.35, 2.3, 0, z0, GOLD);
  const face = z0 + 1.15;
  door(p, -1.1, 0.55, 0.88, face, DARK);
  p.solid.add(sphere(0.04, 6, 3), GOLD, at(-0.92, 0.58, face + 0.1));
  // Dot's window: frame, warm glass, mullions, a small gold awning.
  p.solid.add(roundedBox(1.3, 0.8, 0.05, 0.03), DARK, at(0.55, 0.9, face + 0.02));
  p.glow.add(roundedBox(1.14, 0.64, 0.05, 0.03), ROLE.supportGlow, at(0.55, 0.9, face + 0.04));
  p.solid.add(chamferBox(0.06, 0.64, 0.06, 0.02), DARK, at(0.55, 0.9, face + 0.07));
  p.solid.add(chamferBox(1.14, 0.06, 0.06, 0.02), DARK, at(0.55, 0.9, face + 0.07));
  p.solid.add(roundedBox(1.4, 0.07, 0.36, 0.03), GOLD, at(0.55, 1.36, face + 0.16, 0.35, 0, 0));
  // Scale: post and foot are static; the beam with its pans rocks.
  const sx = 0, sz = 0.3;
  p.metal.add(cylinder(0.3, 0.1, 10, 0.03), GOLD, at(sx, roofTop + 0.05, sz));
  p.metal.add(cylinder(0.08, 0.92, 8), GOLD, at(sx, roofTop + 0.5, sz));
  const pivotY = roofTop + 0.98;
  const scale = new GeometryBuilder()
    .add(roundedBox(2.1, 0.13, 0.13, 0.06), GOLD, at(0, 0, 0))
    .add(sphere(0.11, 8, 4), DARK, at(0, 0.02, 0))
    .add(frustum(0.08, 0.02, 0.18, 6), GOLD, at(0, 0.17, 0));
  for (const side of [-1, 1]) {
    scale.add(cylinder(0.03, 0.4, 5), DARK, at(side * 0.95, -0.22, 0));
    scale.add(bowl(0.34, 0.12, 0.045, 10), GOLD, at(side * 0.95, -0.5, 0));
  }
  return {
    anchor: [sx, 3.0, sz],
    anim: { geometry: scale, role: 'metal', pivot: [sx, pivotY, sz] },
    animate(anim, _glow, t) {
      anim.rotation.z = 0.09 * Math.sin(t * 1.4);
    },
  };
}

/** Garage: teal roll-up door, gear sign, and a little mustard crane on the roof with a warning light. */
function garage(p: Parts): BuildingSpec {
  const teal = ROLE.assembly;
  const z0 = -0.15;
  const roofTop = shell(p, 3.6, 1.45, 2.5, 0, z0, teal);
  const face = z0 + 1.25;
  // Roll-up door with ribs.
  p.solid.add(roundedBox(2.12, 1.22, 0.06, 0.03), DARK, at(-0.45, PLINTH_H + 0.61, face + 0.02));
  p.solid.add(roundedBox(1.92, 1.1, 0.06, 0.03), teal, at(-0.45, PLINTH_H + 0.55, face + 0.05));
  const rib = shadeHex(teal, 0.78);
  for (let i = 0; i < 5; i++) p.solid.add(chamferBox(1.92, 0.06, 0.06, 0.02), rib, at(-0.45, PLINTH_H + 0.17 + i * 0.2, face + 0.09));
  // Gear sign beside the door.
  p.solid.add(cylinder(0.4, 0.06, 14, 0.02), DARK, at(1.2, 1.0, face + 0.03, Math.PI / 2));
  p.solid.add(extrude(gearShape(0.36, 0.28, 8, 0.1), 0.1, 6), teal, at(1.2, 1.0, face + 0.09));
  // Crane: static mast, swinging boom.
  const cx = 1.15, cz = -0.75;
  p.metal.add(roundedBox(0.3, 0.1, 0.3, 0.04), DARK, at(cx, roofTop + 0.05, cz));
  p.metal.add(roundedBox(0.14, 0.72, 0.14, 0.05), ROLE.logistics, at(cx, roofTop + 0.44, cz));
  const pivotY = roofTop + 0.82;
  p.metal.add(cylinder(0.035, 0.1, 6), DARK, at(cx, pivotY + 0.14, cz));
  p.glow.add(sphere(0.075, 8, 4), BEACON, at(cx, pivotY + 0.23, cz));
  const boom = new GeometryBuilder()
    .add(roundedBox(1.35, 0.11, 0.11, 0.05), ROLE.logistics, at(-0.5, 0, 0))
    .add(roundedBox(0.22, 0.2, 0.2, 0.06), DARK, at(0.25, -0.02, 0))
    .add(cylinder(0.025, 0.5, 5), DARK, at(-1.1, -0.27, 0))
    .add(torus(0.07, 0.025, 4, 8, Math.PI * 1.4), DARK, at(-1.1, -0.58, 0, 0, 0, Math.PI * 0.8));
  return {
    anchor: [1.2, 3.0, face],
    anim: { geometry: boom, role: 'solid', pivot: [cx, pivotY, cz] },
    animate(anim, glow, t) {
      anim.rotation.y = 0.25 + 0.55 * Math.sin(t * 0.35);
      glow.visible = blink(t, 1.25);
    },
  };
}

/** Supply Shed: gabled lilac shed, a stack of lilac crates, and a spinning crate sign on a post. */
function supplyShed(p: Parts): BuildingSpec {
  const lilac = ROLE.storage;
  const x0 = -0.8, z0 = -0.3, w = 2.2, d = 2.2, h = 1.15;
  p.solid.add(roundedBox(w + 0.14, PLINTH_H, d + 0.14, 0.05), DARK, at(x0, PLINTH_H / 2, z0));
  p.solid.add(roundedBox(w, h, d, 0.12), BODY, at(x0, PLINTH_H + h / 2, z0), 0.18);
  const eave = PLINTH_H + h;
  const gable = new Shape();
  gable.moveTo(-(d + 0.3) / 2, 0);
  gable.lineTo((d + 0.3) / 2, 0);
  gable.lineTo(0, 0.62);
  gable.closePath();
  p.solid.add(extrude(gable, w + 0.3, 1), lilac, at(x0, eave, z0, 0, Math.PI / 2, 0));
  p.solid.add(roundedBox(w + 0.36, 0.1, 0.12, 0.05), DARK, at(x0, eave + 0.62, z0));
  const face = z0 + d / 2;
  door(p, x0 - 0.15, 0.8, 0.85, face, shadeHex(lilac, 0.7));
  p.solid.add(chamferBox(0.06, 0.85, 0.06, 0.02), DARK, at(x0 - 0.15, PLINTH_H + 0.43, face + 0.09));
  p.metal.add(chamferBox(0.08, 0.08, 0.16, 0.03), DARK, at(x0 - 0.15, eave - 0.02, face + 0.06));
  p.glow.add(sphere(0.08, 8, 4), ROLE.supportGlow, at(x0 - 0.15, eave - 0.12, face + 0.13));
  // Crate stack.
  const crate = (x: number, y: number, z: number, ry: number): void => {
    const m = at(x, y, z, 0, ry, 0);
    p.solid.add(roundedBox(0.62, 0.62, 0.62, 0.07), lilac, m, 0.2);
    const slat = (dx: number, dy: number, rz: number, len: number): void => {
      const local = at(dx, dy, 0.32, 0, 0, rz);
      p.solid.add(chamferBox(len, 0.08, 0.05, 0.02), BODY, m.clone().multiply(local));
    };
    slat(0, 0, Math.PI / 4, 0.7);
    slat(0, 0, -Math.PI / 4, 0.7);
  };
  crate(0.95, PLINTH_H / 2 + 0.31, 0.65, 0.1);
  crate(1.55, PLINTH_H / 2 + 0.31, -0.2, -0.25);
  crate(1.25, PLINTH_H / 2 + 0.93, 0.3, -0.12);
  p.solid.add(roundedBox(1.5, PLINTH_H, 1.6, 0.05), DARK, at(1.25, PLINTH_H / 4, 0.2, 0, 0, 0, [1, 0.5, 1]));
  // Sign post.
  const px = 0.45, pz = 1.15;
  p.metal.add(cylinder(0.06, 2.0, 6), DARK, at(px, 1.0, pz));
  const sign = new GeometryBuilder()
    .add(roundedBox(0.78, 0.78, 0.1, 0.07), lilac, at(0, 0, 0))
    .add(roundedBox(0.6, 0.6, 0.12, 0.05), BODY, at(0, 0, 0))
    .add(roundedBox(0.44, 0.44, 0.14, 0.05), lilac, at(0, 0, 0))
    .add(chamferBox(0.56, 0.08, 0.16, 0.025), BODY, at(0, 0, 0, 0, 0, Math.PI / 4))
    .add(chamferBox(0.56, 0.08, 0.16, 0.025), BODY, at(0, 0, 0, 0, 0, -Math.PI / 4));
  return {
    anchor: [px, 3.0, pz],
    anim: { geometry: sign, role: 'solid', pivot: [px, 2.42, pz] },
    animate(anim, _glow, t) {
      anim.rotation.y = t * 0.9;
    },
  };
}

const BUILDERS: Record<RimBuildingId, (p: Parts) => BuildingSpec> = {
  pump: pumpHouse,
  assay: assayOffice,
  garage,
  shed: supplyShed,
};

interface LiveBuilding {
  anim: Mesh;
  glow: Mesh;
  spec: BuildingSpec;
}

// ---------------------------------------------------------------------------------------------
// Pad lights (03 §6.4: armed = lights pulse in the building colour; disarmed = dim)
// ---------------------------------------------------------------------------------------------

/** Building colour of each pad's lights (03 §8.6 signs: amber pump, gold scale, teal door, lilac crates). */
export const PAD_COLOURS: Record<RimBuildingId, number> = { pump: ROLE.furnace, assay: GOLD, garage: ROLE.assembly, shed: ROLE.storage };
const PAD_STUDS = 4;
/** Stud row between the building fronts (z = −1) and the pod lane, so a parked pod hides few of them. */
const PAD_STUD_Z = -0.84;
const PAD_POOL = { z: -0.25, rx: 2.15, rz: 0.72, y: 0.006, segments: 16 } as const;
/** Disarmed caps keep this share of their colour; armed pools breathe between PULSE_LOW and 1. */
const PAD_DIM = 0.2;
const PULSE_LOW = 0.35;
const PULSE_HZ = 0.8;
const POOL_GAIN = 0.55;
const POOL_STILL = 0.75;

/** Brightness of an armed pad's light pool at time t (s); a steady level when animation is off. */
export function padPulse(t: number, animate: boolean): number {
  if (!animate) return POOL_STILL;
  return PULSE_LOW + (1 - PULSE_LOW) * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * PULSE_HZ));
}

/**
 * The four pads' lamp caps (one emissive mesh, recoloured when the armed set changes) and soft light pools on
 * the paving (one additive mesh, recoloured every frame while a pad is armed). Housings are static metal.
 */
class PadLights {
  readonly root = new Group();
  private readonly caps: Mesh;
  private readonly pools: Mesh;
  private readonly capRanges: number[] = [];
  private readonly capBase: Float32Array;
  private readonly poolWeight: Float32Array;
  private readonly colours = RIM_BUILDINGS.map((b) => new Color(PAD_COLOURS[b.id]));
  private shownMask = -1;

  constructor() {
    this.root.name = 'rim-pad-lights';
    const housings = new GeometryBuilder();
    const caps = new GeometryBuilder();
    for (const b of RIM_BUILDINGS) {
      const start = caps.vertexCount;
      for (let i = 0; i < PAD_STUDS; i++) {
        const x = b.x0 + 0.5 + i;
        housings.add(cylinder(0.13, 0.05, 8, 0.015), DARK, at(x, 0.025, PAD_STUD_Z));
        caps.add(cylinder(0.08, 0.05, 8, 0.02), PAD_COLOURS[b.id], at(x, 0.045, PAD_STUD_Z));
      }
      this.capRanges.push(start, caps.vertexCount - start);
    }
    const housing = roleMesh(housings.build(), 'metal', 'rim-pad-housings');
    this.caps = roleMesh(caps.build(), 'emissive', 'rim-pad-caps');
    this.capBase = Float32Array.from((this.caps.geometry.getAttribute('color') as BufferAttribute).array as Float32Array);
    const pool = poolGeometry();
    this.poolWeight = pool.weight;
    this.pools = roleMesh(pool.geometry, 'flame', 'rim-pad-pools');
    for (const m of [housing, this.caps, this.pools]) {
      m.matrixAutoUpdate = false;
      m.userData.hfNoHull = true;
      m.raycast = (): void => undefined;
    }
    this.root.add(housing, this.caps, this.pools);
  }

  update(t: number, armed: number, animate: boolean): void {
    if (armed !== this.shownMask) this.paintCaps(armed);
    this.paintPools(armed, padPulse(t, animate));
  }

  private paintCaps(armed: number): void {
    this.shownMask = armed;
    const attr = this.caps.geometry.getAttribute('color') as BufferAttribute;
    const out = attr.array as Float32Array;
    for (let b = 0; b < RIM_BUILDINGS.length; b++) {
      const k = (armed >> b) & 1 ? 1 : PAD_DIM;
      const from = this.capRanges[b * 2] * 3;
      const to = from + this.capRanges[b * 2 + 1] * 3;
      for (let i = from; i < to; i++) out[i] = this.capBase[i] * k;
    }
    attr.needsUpdate = true;
  }

  private paintPools(armed: number, pulse: number): void {
    this.pools.visible = armed !== 0;
    if (!this.pools.visible) return;
    const attr = this.pools.geometry.getAttribute('color') as BufferAttribute;
    const out = attr.array as Float32Array;
    const perPad = this.poolWeight.length / RIM_BUILDINGS.length;
    for (let b = 0; b < RIM_BUILDINGS.length; b++) {
      const c = this.colours[b];
      const k = (armed >> b) & 1 ? pulse * POOL_GAIN : 0;
      for (let v = b * perPad; v < (b + 1) * perPad; v++) {
        const w = this.poolWeight[v] * k;
        out[v * 3] = c.r * w;
        out[v * 3 + 1] = c.g * w;
        out[v * 3 + 2] = c.b * w;
      }
    }
    attr.needsUpdate = true;
  }
}

/** One flat elliptical fan per pad on the paving: weight 1 at the centre, 0 at the rim (additive falloff). */
function poolGeometry(): { geometry: BufferGeometry; weight: Float32Array } {
  const n = PAD_POOL.segments;
  const verts = RIM_BUILDINGS.length * n * 3;
  const pos = new Float32Array(verts * 3);
  const weight = new Float32Array(verts);
  let v = 0;
  const put = (x: number, z: number, w: number): void => {
    pos[v * 3] = x;
    pos[v * 3 + 1] = PAD_POOL.y;
    pos[v * 3 + 2] = z;
    weight[v++] = w;
  };
  for (const b of RIM_BUILDINGS) {
    const cx = b.x0 + FOOT_W / 2;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      // Counter-clockwise seen from above (+y).
      put(cx, PAD_POOL.z, 1);
      put(cx + Math.cos(a1) * PAD_POOL.rx, PAD_POOL.z - Math.sin(a1) * PAD_POOL.rz, 0);
      put(cx + Math.cos(a0) * PAD_POOL.rx, PAD_POOL.z - Math.sin(a0) * PAD_POOL.rz, 0);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  const normal = new Float32Array(verts * 3);
  for (let i = 0; i < verts; i++) normal[i * 3 + 1] = 1;
  g.setAttribute('normal', new BufferAttribute(normal, 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(verts * 3), 3));
  g.computeBoundingSphere();
  return { geometry: g, weight };
}

function mesh(geometry: BufferGeometry, role: MatRole, name: string, id: RimBuildingId): Mesh {
  const m = roleMesh(geometry, role, name);
  m.userData.rimId = id;
  return m;
}

/** Build all four Rim buildings in world space. Groups and meshes carry `userData.rimId` for picking. */
export function createRimBuildings(): RimBuildingsModel {
  const root = new Group();
  root.name = 'rim-buildings';
  const signAnchors: Record<string, Vector3> = {};
  const live: LiveBuilding[] = [];
  const pads = new PadLights();
  root.add(pads.root);
  for (const b of RIM_BUILDINGS) {
    const parts: Parts = { solid: new GeometryBuilder(), metal: new GeometryBuilder(), glow: new GeometryBuilder() };
    const spec = BUILDERS[b.id](parts);
    const group = new Group();
    group.name = `rim-${b.id}`;
    group.userData.rimId = b.id;
    group.position.set(b.x0 + FOOT_W / 2, 0, FOOT_CZ);
    const anim = mesh(spec.anim.geometry.build(), spec.anim.role, `rim-${b.id}-sign`, b.id);
    anim.position.set(...spec.anim.pivot);
    const glow = mesh(parts.glow.build(), 'emissive', `rim-${b.id}-lights`, b.id);
    const statics = [mesh(parts.solid.build(), 'solid', `rim-${b.id}-body`, b.id), mesh(parts.metal.build(), 'metal', `rim-${b.id}-metal`, b.id), glow];
    for (const m of statics) m.matrixAutoUpdate = false;
    group.add(...statics, anim);
    group.updateMatrix();
    group.matrixAutoUpdate = false;
    root.add(group);
    const [ax, ay, az] = spec.anchor;
    signAnchors[b.id] = new Vector3(group.position.x + ax, ay, group.position.z + az);
    live.push({ anim, glow, spec });
  }
  return {
    root,
    signAnchors,
    update(timeMs: number, armed = ALL_PADS_ARMED, animate = true): void {
      const t = timeMs / 1000;
      if (animate) for (const b of live) b.spec.animate(b.anim, b.glow, t);
      pads.update(t, armed, animate);
    },
  };
}

/** Footprint of a Rim building in world x/z (exported for tests and the yard layout). */
export function rimFootprint(id: RimBuildingId): { x0: number; x1: number; z0: number; z1: number } {
  const b = RIM_BUILDINGS.find((r) => r.id === id);
  if (!b) throw new Error(`unknown Rim building ${id}`);
  return { x0: b.x0, x1: b.x0 + FOOT_W, z0: FOOT_CZ - FOOT_D / 2, z1: FOOT_CZ + FOOT_D / 2 };
}
