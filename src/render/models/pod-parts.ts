// Pip's geometry: the fixed shell plus the per-line tier variants (03 §8.6: 3 geometry steps per line
// — t1–2, t3–5, t6–7 — and a per-tier trim band). Local frame: origin at the pod centre, +x = the
// facing direction, +y up, +z toward the camera. Pod box 0.86 × 0.78 × 0.8 (canon §3.1).
import type { BufferGeometry } from 'three';
import { Color } from 'three';
import { ORES, POD, ROLE } from '../palette';
import {
  GeometryBuilder,
  at,
  bowl,
  box,
  capsule,
  chamferBox,
  cylinder,
  frustum,
  lathe,
  mixHex,
  roundedBox,
  shadeHex,
  slab,
  sphere,
  torus,
  type PartArrays,
  type VertexColorFn,
} from './kit';

export type Step = 0 | 1 | 2;

/** Geometry step for a tier (03 §8.6): t1–2 → 0, t3–5 → 1, t6–7 → 2. */
export function tierStep(tier: number): Step {
  return tier <= 2 ? 0 : tier <= 5 ? 1 : 2;
}

/** Lines whose parts are merged into the body meshes (the drill has its own spinning mesh). */
export const BODY_LINES = ['hull', 'engine', 'tank', 'radiator', 'bay', 'scanner'] as const;
export type BodyLine = (typeof BODY_LINES)[number];

export interface PartSet {
  solid: PartArrays;
  metal: PartArrays;
  /** Trim band: painted with POD.trims[tier − 1] when composed. */
  trim: PartArrays;
}

const STEEL = POD.trims[0];
const DARK = ROLE.buildingTrim;
const ICE = ORES[5].highlight;

/** Bottom of the skids, i.e. the pod's contact plane (−POD_H / 2). */
export const POD_FLOOR_Y = -0.39;
/** Nozzle exit plane: flames hang from here. */
export const NOZZLE_EXIT_Y = -0.36;

// ---------------------------------------------------------------------------------------------
// Fixed shell
// ---------------------------------------------------------------------------------------------

export interface PodShell {
  solid: PartArrays;
  metal: PartArrays;
  visor: BufferGeometry;
  led: BufferGeometry;
}

export const LED_POS = { x: -0.14, y: 0.43, z: -0.2 } as const;

export function buildShell(): PodShell {
  const solid = new GeometryBuilder()
    .add(roundedBox(0.62, 0.54, 0.64, 0.2, 2), POD.body, at(0, 0.04, 0), 0.12)
    .add(chamferBox(0.2, 0.05, 0.24, 0.02), POD.accent, at(-0.06, 0.32, 0.02))
    .add(chamferBox(0.07, 0.1, 0.46, 0.03), POD.accent, at(0.305, -0.15, 0))
    // White sticker on the glass (03 §8.7: glass = flat teal + a white sticker).
    .add(box(0.09, 0.05, 0.02), POD.body, at(0.24, 0.19, 0.348));
  const metal = new GeometryBuilder()
    .add(chamferBox(0.54, 0.1, 0.5, 0.035), DARK, at(0, -0.24, 0))
    .add(chamferBox(0.74, 0.09, 0.12, 0.04), DARK, at(0, -0.345, 0.27))
    .add(chamferBox(0.74, 0.09, 0.12, 0.04), DARK, at(0, -0.345, -0.27))
    .add(cylinder(0.025, 0.12, 6), STEEL, at(LED_POS.x, 0.36, LED_POS.z));
  const visor = new GeometryBuilder().add(roundedBox(0.34, 0.2, 0.68, 0.08), POD.visor, at(0.16, 0.14, 0)).build();
  const led = new GeometryBuilder().add(sphere(0.045, 6, 3), POD.snifferLed, at(LED_POS.x, LED_POS.y, LED_POS.z)).build();
  return { solid: solid.toArrays(), metal: metal.toArrays(), visor, led };
}

// ---------------------------------------------------------------------------------------------
// Body lines
// ---------------------------------------------------------------------------------------------

interface Builders {
  solid: GeometryBuilder;
  metal: GeometryBuilder;
  trim: GeometryBuilder;
}

function builders(): Builders {
  return { solid: new GeometryBuilder(), metal: new GeometryBuilder(), trim: new GeometryBuilder() };
}

function finish(b: Builders): PartSet {
  return { solid: b.solid.toArrays(), metal: b.metal.toArrays(), trim: b.trim.toArrays() };
}

/** Flat round studs facing ±z. */
function rivets(g: GeometryBuilder, xs: readonly number[], ys: readonly number[], z: number): void {
  const stud = cylinder(0.032, 0.03, 6);
  for (const x of xs) for (const y of ys) g.add(stud, STEEL, at(x, y, z, Math.PI / 2));
}

/** Hull plates: tin can → bolted side plates → armoured plates with an emblem and shoulder caps. */
function hullPart(step: Step): PartSet {
  const b = builders();
  b.trim.add(slab(0.64, 0.66, 0.05, 0.2), 0xffffff, at(0, -0.165, 0));
  if (step === 0) {
    for (const z of [0.322, -0.322]) rivets(b.metal, [-0.2, 0.1], [-0.08, 0.02], z);
    return finish(b);
  }
  const w = step === 1 ? 0.44 : 0.5;
  const h = step === 1 ? 0.17 : 0.2;
  const plate = step === 1 ? ROLE.buildingBody : mixHex(ROLE.buildingBody, POD.trims[4], 0.35);
  for (const z of [0.335, -0.335]) {
    b.solid.add(chamferBox(w, h, 0.05, 0.022), plate, at(-0.03, -0.035, z));
    rivets(b.metal, [-0.03 - w / 2 + 0.05, -0.03 + w / 2 - 0.05], [-0.035 - h / 2 + 0.045, -0.035 + h / 2 - 0.045], z + Math.sign(z) * 0.03);
  }
  if (step === 2) {
    // Chevron emblem on the camera-side plate, and shoulder caps on the top edges.
    b.solid.add(box(0.16, 0.05, 0.03), POD.accent, at(-0.06, -0.01, 0.37, 0, 0, 0.6));
    b.solid.add(box(0.16, 0.05, 0.03), POD.accent, at(0.06, -0.01, 0.37, 0, 0, -0.6));
    for (const z of [0.29, -0.29]) b.solid.add(chamferBox(0.36, 0.07, 0.09, 0.03), plate, at(-0.08, 0.27, z));
  }
  return finish(b);
}

/** Nozzle bell pointing down; local top at y = 0, exit at y = −0.12. */
function nozzle(): BufferGeometry {
  return lathe(
    [
      [0, -0.07],
      [0.062, -0.12],
      [0.08, -0.12],
      [0.052, -0.035],
      [0.058, 0],
      [0, 0],
    ],
    8,
  );
}

/** Nozzle positions (x, z) per engine step: exhaust count 1 / 2 / 3. */
export const NOZZLES: readonly (readonly [number, number])[][] = [
  [[-0.18, 0]],
  [
    [-0.18, -0.12],
    [-0.18, 0.12],
  ],
  [
    [-0.19, -0.13],
    [-0.19, 0],
    [-0.19, 0.13],
  ],
];
const NOZZLE_TOP_Y = NOZZLE_EXIT_Y + 0.12;

function enginePart(step: Step): PartSet {
  const b = builders();
  const bell = nozzle();
  for (const [x, z] of NOZZLES[step]) {
    b.metal.add(bell, DARK, at(x, NOZZLE_TOP_Y, z));
    b.trim.add(cylinder(0.072, 0.04, 8), 0xffffff, at(x, NOZZLE_TOP_Y - 0.02, z));
  }
  if (step === 2) {
    // Twin side boosters on the big engines.
    for (const z of [0.3, -0.3]) b.solid.add(capsule(0.05, 0.2, 6), POD.accent, at(-0.22, -0.18, z, 0, 0, Math.PI / 2));
  }
  return finish(b);
}

const TANK_X = -0.35;

/** Back tank: canister → big strapped tank → twin cryo flasks. */
function tankPart(step: Step): PartSet {
  const b = builders();
  const alongZ = Math.PI / 2;
  if (step === 0) {
    b.solid.add(capsule(0.075, 0.26, 8), POD.accent, at(TANK_X, 0.1, 0, alongZ));
    b.metal.add(cylinder(0.03, 0.05, 6), STEEL, at(TANK_X, 0.1, 0.15, alongZ));
    b.trim.add(cylinder(0.083, 0.05, 8), 0xffffff, at(TANK_X, 0.1, 0, alongZ));
  } else if (step === 1) {
    b.solid.add(capsule(0.09, 0.46, 8), POD.accent, at(TANK_X - 0.01, 0.1, 0, alongZ));
    b.metal.add(cylinder(0.03, 0.07, 6), STEEL, at(TANK_X - 0.01, 0.2, 0.1));
    for (const z of [-0.12, 0.12]) b.trim.add(cylinder(0.098, 0.05, 8), 0xffffff, at(TANK_X - 0.01, 0.1, z, alongZ));
  } else {
    const icy: VertexColorFn = (_x, y, _z, out) => {
      out.setHex(y > 0.09 ? ICE : POD.body);
    };
    for (const z of [-0.14, 0.14]) {
      b.solid.add(capsule(0.075, 0.36, 8), icy, at(TANK_X, 0.07, z));
      b.trim.add(cylinder(0.083, 0.05, 8), 0xffffff, at(TANK_X, 0.02, z));
    }
  }
  return finish(b);
}

const RAD_X = -0.2;
const RAD_Z = 0.12;

/** Radiator: desk fan → three fins → five tall fins with an icy coolant loop. */
function radiatorPart(step: Step): PartSet {
  const b = builders();
  if (step === 0) {
    b.trim.add(chamferBox(0.12, 0.05, 0.12, 0.02), 0xffffff, at(RAD_X, 0.325, RAD_Z));
    b.metal.add(cylinder(0.08, 0.05, 8, 0.012), STEEL, at(RAD_X, 0.4, RAD_Z, 0, 0, Math.PI / 2));
    b.solid.add(sphere(0.035, 6, 2), POD.accent, at(RAD_X - 0.03, 0.4, RAD_Z));
    b.metal.add(chamferBox(0.05, 0.06, 0.05, 0.02), STEEL, at(RAD_X, 0.36, RAD_Z));
    return finish(b);
  }
  const fins = step === 1 ? 3 : 5;
  const h = step === 1 ? 0.1 : 0.13;
  const span = step === 1 ? 0.14 : 0.2;
  b.trim.add(chamferBox(span + 0.08, 0.05, 0.26, 0.02), 0xffffff, at(RAD_X, 0.325, RAD_Z));
  for (let i = 0; i < fins; i++) {
    const x = RAD_X - span / 2 + (span * i) / (fins - 1);
    b.metal.add(chamferBox(0.05, h, 0.22, 0.02), step === 2 ? mixHex(STEEL, ICE, 0.5) : STEEL, at(x, 0.35 + h / 2, RAD_Z));
  }
  if (step === 2) b.solid.add(torus(0.12, 0.026, 4, 10), ICE, at(RAD_X, 0.39, RAD_Z, 0, Math.PI / 2, 0, [1, 0.6, 1]));
  return finish(b);
}

const BAY_X = -0.36;

/** Cargo pod: canvas satchel → slatted crate → freight hold. */
function bayPart(step: Step): PartSet {
  const b = builders();
  if (step === 0) {
    b.solid.add(chamferBox(0.12, 0.15, 0.28, 0.045), ROLE.support, at(BAY_X + 0.005, -0.12, 0));
    b.solid.add(chamferBox(0.13, 0.06, 0.29, 0.025), shadeHex(ROLE.support, 0.8), at(BAY_X, -0.06, 0));
    b.trim.add(chamferBox(0.05, 0.07, 0.06, 0.02), 0xffffff, at(BAY_X - 0.06, -0.09, 0));
    return finish(b);
  }
  const w = step === 1 ? 0.14 : 0.16;
  const h = step === 1 ? 0.2 : 0.24;
  const d = step === 1 ? 0.46 : 0.6;
  b.solid.add(chamferBox(w, h, d, 0.04), ROLE.storage, at(BAY_X - 0.01, -0.13, 0), 0.15);
  const bands = step === 1 ? [-0.12, 0.12] : [-0.2, 0, 0.2];
  for (const z of bands) b.trim.add(chamferBox(w + 0.02, h + 0.02, 0.05, 0.02), 0xffffff, at(BAY_X - 0.01, -0.13, z));
  if (step === 2) b.metal.add(chamferBox(0.05, 0.05, 0.22, 0.02), DARK, at(BAY_X - 0.1, -0.06, 0));
  return finish(b);
}

const SCAN_X = 0.08;
const SCAN_Z = -0.12;

/** Scanner: tin-ear horn → dish on a mast → big dish with a lens. */
function scannerPart(step: Step): PartSet {
  const b = builders();
  if (step === 0) {
    b.trim.add(cylinder(0.045, 0.04, 8), 0xffffff, at(SCAN_X, 0.33, SCAN_Z));
    b.solid.add(frustum(0.03, 0.07, 0.12, 8), POD.accent, at(SCAN_X + 0.03, 0.39, SCAN_Z, 0, 0, -0.7));
    return finish(b);
  }
  const r = step === 1 ? 0.1 : 0.12;
  b.metal.add(cylinder(0.026, 0.07, 6), STEEL, at(SCAN_X, 0.355, SCAN_Z));
  b.trim.add(cylinder(0.045, 0.04, 8), 0xffffff, at(SCAN_X, 0.33, SCAN_Z));
  b.solid.add(bowl(r, 0.05, 0.025, 8), POD.body, at(SCAN_X + 0.02, 0.385, SCAN_Z, 0, 0, -0.6));
  if (step === 2) b.solid.add(sphere(0.035, 6, 3), POD.visor, at(SCAN_X + 0.04, 0.425, SCAN_Z));
  return finish(b);
}

const LINE_BUILDERS: Record<BodyLine, (step: Step) => PartSet> = {
  hull: hullPart,
  engine: enginePart,
  tank: tankPart,
  radiator: radiatorPart,
  bay: bayPart,
  scanner: scannerPart,
};

/** All three geometry steps for every body line, built once. */
export function buildLineParts(): Record<BodyLine, readonly [PartSet, PartSet, PartSet]> {
  const out = {} as Record<BodyLine, readonly [PartSet, PartSet, PartSet]>;
  for (const line of BODY_LINES) {
    const f = LINE_BUILDERS[line];
    out[line] = [f(0), f(1), f(2)];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Drill (own mesh: points along local −y from its base at y = 0, spins about y)
// ---------------------------------------------------------------------------------------------

export interface DrillVariant {
  geometry: BufferGeometry;
  /** Base → tip length. */
  length: number;
}

const DRILL_PROFILES: readonly (readonly (readonly [number, number])[])[] = [
  // Stub Bit / Corkscrew: a stubby cone.
  [
    [0, -0.28],
    [0.1, -0.09],
    [0.1, -0.06],
    [0, -0.06],
  ],
  // Twin Screw / Auger / Grinder: stepped auger flighting.
  [
    [0, -0.34],
    [0.06, -0.27],
    [0.1, -0.25],
    [0.075, -0.21],
    [0.12, -0.18],
    [0.095, -0.14],
    [0.13, -0.11],
    [0.11, -0.07],
    [0.11, -0.06],
    [0, -0.06],
  ],
  // Glasscutter / Starbore: a faceted crystal point.
  [
    [0, -0.38],
    [0.07, -0.27],
    [0.12, -0.15],
    [0.11, -0.06],
    [0, -0.06],
  ],
];

/** The drill bit for one tier: step shape + a trim-coloured collar. */
export function buildDrill(tier: number): DrillVariant {
  const step = tierStep(tier);
  const profile = DRILL_PROFILES[step];
  const tipY = profile[0][1];
  const color: VertexColorFn =
    step === 2
      ? (() => {
          const steel = new Color(STEEL);
          const gem = new Color(ORES[8].base);
          return (_x: number, y: number, _z: number, out: Color) => {
            out.copy(steel).lerp(gem, Math.max(0, Math.min(1, (y + 0.08) / (tipY + 0.08))));
          };
        })()
      : (_x, _y, _z, out) => {
          out.setHex(step === 0 ? STEEL : mixHex(STEEL, POD.body, 0.25));
        };
  const g = new GeometryBuilder()
    .add(cylinder(0.12, 0.06, 8, 0.015), POD.trims[Math.max(0, Math.min(6, tier - 1))], at(0, -0.03, 0))
    .add(lathe(profile, step === 2 ? 6 : 8, step === 2 ? Math.PI / 6 : 0), color);
  return { geometry: g.build(), length: -tipY };
}

// ---------------------------------------------------------------------------------------------
// Flames (own mesh, hung at NOZZLE_EXIT_Y and scaled in y by thrust)
// ---------------------------------------------------------------------------------------------

const FLAME_LEN = 0.42;

function flameColor(): VertexColorFn {
  const tip = new Color(POD.accent);
  const mid = new Color(POD.flame);
  const hot = new Color(ORES[3].highlight);
  return (_x, y, _z, out) => {
    const t = Math.max(0, Math.min(1, (y + FLAME_LEN) / FLAME_LEN));
    if (t < 0.5) out.copy(tip).lerp(mid, t * 2);
    else out.copy(mid).lerp(hot, (t - 0.5) * 2);
  };
}

/** Flame cones for one engine step, one per nozzle, relative to the exit plane. */
export function buildFlames(step: Step): BufferGeometry {
  const cone = lathe(
    [
      [0, -FLAME_LEN],
      [0.04, -FLAME_LEN * 0.7],
      [0.07, -FLAME_LEN * 0.35],
      [0.066, -0.06],
      [0.05, 0],
      [0, 0],
    ],
    6,
  );
  const color = flameColor();
  const g = new GeometryBuilder();
  for (const [x, z] of NOZZLES[step]) g.add(cone, color, at(x, 0, z));
  return g.build();
}
