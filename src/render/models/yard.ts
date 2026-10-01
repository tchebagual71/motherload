// The Yard's starting props (canon §3.2 post-pass 5; 02 §2.2 survey set): a rusted Headframe over Dot's
// survey column at the Rim edge, a rusted Smelter (Yard rows 4–5) and Storage Bin (rows 7–8) on the same
// columns, plus the M0 belt/item render demo and lift stub (canon §5.5; 02 §3.8): a Belt Mk I loop
// carrying ore into the Smelter, an ingot belt into the Bin, and a back-wall bucket lift whose chain
// runs over the Headframe's sheave. Draw calls: 4 static + 1 sheave + 5 instanced = 10.
import { Color, Group, Matrix4, Quaternion, Vector3, type InstancedMesh, type Mesh } from 'three';
import { FACTORY_HZ, MINE_W, RIM_BUILDINGS } from '../../shared/canon';
import { ORES, ROLE, SPECIAL, SURFACE, UI } from '../palette';
import type { YardPropsModel } from './api';
import { BELT_DECK_TOP, BeltPath, chevronGeometry, type BeltDir, type BeltTileSpec } from './belt';
import {
  GeometryBuilder,
  at,
  box,
  chamferBox,
  cylinder,
  frustum,
  ico,
  lathe,
  mixHex,
  rock,
  roleInstanced,
  roleMesh,
  roundedBox,
  shadeHex,
  sphere,
  torus,
} from './kit';

const BODY = ROLE.buildingBody;
const DARK = ROLE.buildingTrim;
const FRAME = mixHex(ROLE.logistics, ROLE.rust, 0.3);
const RUST = ROLE.rust;

/** Headframe columns valid for a Headframe (02 §2.2). */
const HEADFRAME_COLUMNS: readonly (readonly [number, number])[] = [
  [5, 9],
  [14, 29],
  [34, 39],
  [44, 47],
];
export function isHeadframeColumn(c: number): boolean {
  return HEADFRAME_COLUMNS.some(([a, b]) => c >= a && c <= b);
}

/** Left column of the rusted Headframe over survey column c: {c, c+1}, or {c−1, c} if c+1 is invalid (02 §2.2). */
export function headframeX0(c: number): number {
  return isHeadframeColumn(c + 1) && c + 1 < MINE_W ? c : c - 1;
}

/** Bucket-lift stub length in rows (M0 demo; the real lift is placed by the player in the MVP). */
export const LIFT_STUB_ROWS = 12;
/** Wall-mount layer centre (canon §3.1: mounts sit at z −1.0…−0.45). */
const LIFT_Z = -0.75;
const SHEAVE_R = 0.28;
const SHEAVE_Y = 2.62;
/** Mk I bucket speed (02 §3.4): 40/3 factory ticks per row → 1.5 rows/s. Linear, like belts (03 §8.11). */
const LIFT_ROWS_PER_S = FACTORY_HZ / (40 / 3);
const BUCKET_SPACING = 1;
const SMOKE_PUFFS = 5;
const SMOKE_PERIOD_S = 3.5;

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

function yardRowsRect(x0: number, w: number, row0: number, rows: number): Rect {
  return { x0, x1: x0 + w, z0: -row0 - rows, z1: -row0 };
}

function overlaps(px: number, pz: number, r: Rect, pad: number): boolean {
  return px > r.x0 - pad && px < r.x1 + pad && pz > r.z0 - pad && pz < r.z1 + pad;
}

function rimColumnFree(x: number): boolean {
  return x >= 0 && x < MINE_W && !RIM_BUILDINGS.some((b) => x >= b.x0 && x <= b.x1);
}

export interface SurveyLayout {
  c: number;
  hx0: number;
  /** Side of the Headframe/Smelter the ore loop runs on (+1 right, −1 left, 0 = straight belt fallback). */
  side: -1 | 0 | 1;
  oreBelt: BeltTileSpec[];
  ingotBelt: BeltTileSpec[];
  occupied: Rect[];
}

/**
 * Ore loop: leaves the Headframe's side edge, turns down the Yard and back into the Smelter's side
 * (a U with two corners). If neither side is clear of Rim buildings, a straight belt on row 3.
 */
export function surveyLayout(surveyColumn: number): SurveyLayout {
  const c = Math.max(1, Math.min(MINE_W - 1, Math.round(surveyColumn)));
  const hx0 = Math.max(0, Math.min(MINE_W - 2, headframeX0(c)));
  let side: -1 | 0 | 1 = 0;
  if (rimColumnFree(hx0 + 2) && rimColumnFree(hx0 + 3)) side = 1;
  else if (rimColumnFree(hx0 - 1) && rimColumnFree(hx0 - 2)) side = -1;
  let oreBelt: BeltTileSpec[];
  if (side !== 0) {
    const xs = side > 0 ? hx0 + 2 : hx0 - 1;
    const away: BeltDir = side > 0 ? 'E' : 'W';
    const back: BeltDir = side > 0 ? 'W' : 'E';
    oreBelt = [
      { x: xs, row: 2, out: away },
      { x: xs + side, row: 2, out: 'N' },
      { x: xs + side, row: 3, out: 'N' },
      { x: xs + side, row: 4, out: back },
      { x: xs, row: 4, out: back },
    ];
  } else {
    oreBelt = [{ x: hx0, row: 3, out: 'N' }];
  }
  const ingotX = side < 0 ? hx0 : hx0 + 1;
  const ingotBelt: BeltTileSpec[] = [{ x: ingotX, row: 6, out: 'N' }];
  const occupied: Rect[] = [
    yardRowsRect(hx0, 2, 1, 2),
    yardRowsRect(hx0, 2, 4, 2),
    yardRowsRect(hx0, 2, 7, 2),
    ...[...oreBelt, ...ingotBelt].map((t) => yardRowsRect(t.x, 1, t.row, 1)),
    ...RIM_BUILDINGS.map((b) => yardRowsRect(b.x0, b.x1 - b.x0 + 1, 1, 3)),
  ];
  return { c, hx0, side, oreBelt, ingotBelt, occupied };
}

// ---------------------------------------------------------------------------------------------
// Static pieces
// ---------------------------------------------------------------------------------------------

interface Builders {
  solid: GeometryBuilder;
  metal: GeometryBuilder;
  decal: GeometryBuilder;
  glow: GeometryBuilder;
}

/** A rust patch hugging a face whose outward normal is ±x or ±z. */
function rustPatch(b: Builders, x: number, y: number, z: number, w: number, h: number, normal: 'x' | 'z', shade = 1): void {
  const color = shadeHex(RUST, shade);
  if (normal === 'z') b.decal.add(box(w, h, 0.03), color, at(x, y, z));
  else b.decal.add(box(0.03, h, w), color, at(x, y, z));
}

/** A beam between two points (square section). */
function beam(g: GeometryBuilder, color: number, a: Vector3, b: Vector3, size = 0.1): void {
  const d = new Vector3().subVectors(b, a);
  const len = d.length();
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
  const m = new Matrix4().compose(mid, q, new Vector3(1, 1, 1));
  g.add(chamferBox(size, len, size, Math.min(0.03, size * 0.3)), color, m);
}

function headframe(b: Builders, L: SurveyLayout): void {
  const x0 = L.hx0, x1 = L.hx0 + 2;
  const sx = L.c + 0.5;
  const frontZ = -1.15, backZ = -2.85, topY = 2.36;
  // Hoist house.
  const hz = -2.35;
  b.solid.add(chamferBox(1.84, 0.1, 1.04, 0.04), DARK, at(x0 + 1, 0.05, hz));
  b.solid.add(roundedBox(1.7, 0.72, 0.9, 0.1), BODY, at(x0 + 1, 0.46, hz), 0.18);
  b.solid.add(roundedBox(1.86, 0.12, 1.06, 0.05), ROLE.logistics, at(x0 + 1, 0.88, hz));
  b.solid.add(chamferBox(0.4, 0.5, 0.05, 0.02), DARK, at(x0 + 0.5, 0.35, hz + 0.46));
  b.glow.add(sphere(0.07, 8, 4), UI.amber, at(x0 + 1.55, 0.98, hz + 0.3));
  rustPatch(b, x0 + 1.25, 0.32, hz + 0.465, 0.42, 0.22, 'z');
  rustPatch(b, x0 + 1.86, 0.6, hz + 0.05, 0.36, 0.28, 'x', 0.85);
  // Legs: vertical fronts, raked backs, braces.
  for (const lx of [x0 + 0.15, x1 - 0.15]) {
    beam(b.metal, FRAME, new Vector3(lx, 0, frontZ), new Vector3(lx, topY, frontZ), 0.12);
    beam(b.metal, FRAME, new Vector3(lx, 0, backZ), new Vector3(lx, topY - 0.05, frontZ - 0.1), 0.11);
    beam(b.metal, FRAME, new Vector3(lx, 1.2, frontZ), new Vector3(lx, 1.2, backZ + 0.82), 0.08);
    b.metal.add(chamferBox(0.22, 0.08, 0.22, 0.03), DARK, at(lx, 0.04, frontZ));
    b.metal.add(chamferBox(0.22, 0.08, 0.22, 0.03), DARK, at(lx, 0.04, backZ));
    rustPatch(b, lx, 0.7, frontZ + 0.065, 0.1, 0.3, 'z', 0.9);
  }
  beam(b.metal, FRAME, new Vector3(x0 + 0.15, topY, frontZ), new Vector3(x1 - 0.15, topY, frontZ), 0.12);
  beam(b.metal, FRAME, new Vector3(x0 + 0.15, 1.2, frontZ), new Vector3(x1 - 0.15, 1.2, frontZ), 0.08);
  beam(b.metal, FRAME, new Vector3(x0 + 0.15, 0.3, frontZ), new Vector3(x1 - 0.15, 1.15, frontZ), 0.07);
  // Cantilever over the shaft carrying the sheave axle.
  for (const ax of [L.c + 0.06, L.c + 0.94]) {
    beam(b.metal, FRAME, new Vector3(ax, topY, frontZ), new Vector3(ax, topY, LIFT_Z - 0.15), 0.09);
    b.metal.add(chamferBox(0.12, 0.22, 0.14, 0.04), DARK, at(ax, SHEAVE_Y - 0.06, LIFT_Z));
  }
  b.metal.add(cylinder(0.05, 0.92, 6), DARK, at(sx, SHEAVE_Y, LIFT_Z, Math.PI / 2));
  b.glow.add(sphere(0.06, 8, 4), UI.amber, at(L.c + 0.94, topY + 0.12, frontZ));
}

function smelter(b: Builders, L: SurveyLayout): Vector3 {
  const cx = L.hx0 + 1, cz = -5;
  b.solid.add(chamferBox(1.9, 0.1, 1.9, 0.04), DARK, at(cx, 0.05, cz));
  b.solid.add(roundedBox(1.7, 0.85, 1.6, 0.14), BODY, at(cx, 0.1 + 0.425, cz), 0.2);
  b.solid.add(roundedBox(1.82, 0.14, 1.72, 0.06), ROLE.processing, at(cx, 1.02, cz));
  // Furnace mouth on the Rim-facing side.
  const face = cz + 0.8;
  b.solid.add(chamferBox(0.84, 0.58, 0.05, 0.02), DARK, at(cx - 0.3, 0.42, face + 0.02));
  b.glow.add(chamferBox(0.68, 0.42, 0.05, 0.02), ROLE.furnace, at(cx - 0.3, 0.4, face + 0.04));
  b.solid.add(chamferBox(0.7, 0.06, 0.06, 0.02), DARK, at(cx - 0.3, 0.4, face + 0.07));
  b.glow.add(sphere(0.05, 6, 3), ROLE.furnace, at(cx + 0.55, 0.75, face + 0.03));
  // Chimney (≤ 1.6 tall, canon §3.1).
  const chx = cx + 0.45, chz = cz - 0.35;
  b.metal.add(cylinder(0.17, 0.55, 8, 0.03), shadeHex(DARK, 1.15), at(chx, 1.28, chz));
  b.metal.add(cylinder(0.2, 0.08, 8, 0.02), ROLE.processing, at(chx, 1.54, chz));
  // Side intake where the ore loop arrives.
  if (L.side !== 0) {
    const ix = L.side > 0 ? cx + 0.86 : cx - 0.86;
    b.solid.add(chamferBox(0.12, 0.34, 0.5, 0.04), DARK, at(ix, BELT_DECK_TOP + 0.14, cz + 0.5));
  }
  rustPatch(b, cx + 0.5, 0.35, face + 0.005, 0.38, 0.24, 'z');
  rustPatch(b, cx - 0.86, 0.62, cz - 0.3, 0.42, 0.2, 'x', 0.85);
  rustPatch(b, chx, 1.18, chz + 0.175, 0.14, 0.16, 'z', 0.8);
  return new Vector3(chx, 1.6, chz);
}

function storageBin(b: Builders, L: SurveyLayout): void {
  const cx = L.hx0 + 1, cz = -8;
  b.solid.add(chamferBox(1.9, 0.1, 1.9, 0.04), DARK, at(cx, 0.05, cz));
  b.solid.add(
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
    at(cx, 0.1, cz),
    0.2,
  );
  b.solid.add(cylinder(0.83, 0.16, 8, 0.03), ROLE.storage, at(cx, 0.62, cz));
  b.solid.add(frustum(0.86, 0.3, 0.32, 8, Math.PI / 8), ROLE.storage, at(cx, 1.28, cz));
  b.metal.add(cylinder(0.22, 0.08, 8, 0.02), DARK, at(cx, 1.48, cz));
  // On the octagon's Rim-facing facet (z = 0.8·cos 22.5° ≈ 0.74, x within ±0.3).
  rustPatch(b, cx + 0.1, 0.35, cz + 0.755, 0.34, 0.26, 'z');
  rustPatch(b, cx - 0.15, 0.85, cz + 0.755, 0.24, 0.16, 'z', 0.85);
}

function liftStatic(b: Builders, L: SurveyLayout): void {
  const x = L.c;
  const yBot = -LIFT_STUB_ROWS + 0.5;
  const strandLen = SHEAVE_Y - yBot;
  for (const sx of [x + 0.5 - SHEAVE_R, x + 0.5 + SHEAVE_R]) {
    b.metal.add(chamferBox(0.05, strandLen, 0.05, 0.015), DARK, at(sx, (SHEAVE_Y + yBot) / 2, LIFT_Z - 0.12));
  }
  // Guide rails on the back wall, with a tie every three rows.
  for (const rx of [x + 0.07, x + 0.93]) b.metal.add(chamferBox(0.08, -yBot + 0.4, 0.08, 0.025), FRAME, at(rx, yBot / 2 - 0.2, -0.93));
  for (let r = 1; r < LIFT_STUB_ROWS; r += 3) b.metal.add(chamferBox(0.94, 0.07, 0.06, 0.02), FRAME, at(x + 0.5, -r - 0.5, -0.95));
  // Foot housing with the bottom sprocket.
  b.solid.add(roundedBox(0.92, 0.5, 0.42, 0.08), BODY, at(x + 0.5, yBot - 0.08, LIFT_Z - 0.03), 0.2);
  b.solid.add(chamferBox(0.94, 0.1, 0.44, 0.04), ROLE.logistics, at(x + 0.5, yBot + 0.2, LIFT_Z - 0.03));
  rustPatch(b, x + 0.3, yBot - 0.15, LIFT_Z + 0.19, 0.24, 0.18, 'z');
}

function rocksAndProps(b: Builders, L: SurveyLayout): void {
  const candidates: readonly [number, number, number][] = [
    [3.4, -6.6, 0.32], [8.6, -8.4, 0.24], [12.3, -7.2, 0.2], [17.6, -8.5, 0.3], [21.2, -5.6, 0.18],
    [25.4, -8.3, 0.34], [28.6, -6.1, 0.22], [35.5, -7.0, 0.28], [39.2, -8.6, 0.2], [45.6, -5.4, 0.3],
    [47.4, -8.4, 0.22], [0.6, -8.6, 0.26],
  ];
  let placed = 0;
  for (const [x, z, r] of candidates) {
    if (L.occupied.some((rect) => overlaps(x, z, rect, r + 0.15))) continue;
    const seed = Math.round(x * 31 + z * 7);
    b.solid.add(rock(r, seed), placed % 2 === 0 ? SURFACE.rockLit : SURFACE.rockDark, at(x, r * 0.45, z, 0, seed * 0.37, 0));
    if (placed % 3 === 0) b.solid.add(rock(r * 0.5, seed + 1), SURFACE.rockDark, at(x + r * 1.2, r * 0.22, z + r * 0.4));
    placed++;
  }
  // Rusted drums beside the Smelter on the side away from the ore loop.
  const xo = L.side >= 0 ? L.hx0 - 0.55 : L.hx0 + 2.55;
  if (xo > 0.4 && xo < MINE_W - 0.4) {
    for (const [dx, dz, tilt] of [
      [0, -5.4, 0],
      [0.08, -6.25, 0.12],
    ] as const) {
      b.solid.add(cylinder(0.2, 0.46, 8, 0.03), mixHex(UI.amber, RUST, 0.55), at(xo + dx, 0.23, dz, tilt, 0, 0));
      b.solid.add(cylinder(0.21, 0.05, 8), DARK, at(xo + dx, 0.36, dz, tilt, 0, 0));
      b.decal.add(box(0.03, 0.18, 0.16), RUST, at(xo + dx + 0.2, 0.18, dz));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Animated pieces
// ---------------------------------------------------------------------------------------------

/** Rough ore chunk (03 §8.4 "Lode ore: rough chunk"); tinted per instance. */
function oreChunkGeometry(): GeometryBuilder {
  return new GeometryBuilder().add(rock(0.13, 7, 0.3), 0xffffff, at(0, 0.11, 0));
}

/** Trapezoid ingot bar; tinted per instance. */
function ingotGeometry(): GeometryBuilder {
  return new GeometryBuilder().add(frustum(0.2, 0.13, 0.11, 4, Math.PI / 4), 0xffffff, at(0, 0.055, 0, 0, 0, 0, [1.25, 1, 0.75]));
}

function bucketGeometry(): GeometryBuilder {
  return new GeometryBuilder().add(frustum(0.13, 0.19, 0.2, 4, Math.PI / 4), ROLE.logistics, at(0, 0, 0));
}

function smokeGeometry(): GeometryBuilder {
  return new GeometryBuilder().add(ico(1, 0), mixHex(UI.cream, SPECIAL.hardrockChamfer, 0.35));
}

function sheaveGeometry(): GeometryBuilder {
  const g = new GeometryBuilder().add(torus(SHEAVE_R, 0.05, 4, 14), ROLE.logistics, at(0, 0, 0));
  for (let i = 0; i < 3; i++) g.add(box(SHEAVE_R * 2, 0.05, 0.05), FRAME, at(0, 0, 0, 0, 0, (i * Math.PI) / 3));
  g.add(cylinder(0.07, 0.12, 8), DARK, at(0, 0, 0, Math.PI / 2));
  return g;
}

/** Ore colours carried by the demo (Hematite, Copper, Cobalt — the lode metals of the first bands). */
const DEMO_ORES = [ORES[1].base, ORES[0].base, ORES[1].base, ORES[2].base, ORES[0].base] as const;

const _pos = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();
const _qz = new Quaternion();
const _s = new Vector3();
const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);
const _zAxis = new Vector3(0, 0, 1);

function setInstance(mesh: InstancedMesh, i: number, x: number, y: number, z: number, ry: number, rz: number, scale: number): void {
  _q.setFromAxisAngle(_up, ry);
  if (rz !== 0) _q.premultiply(_qz.setFromAxisAngle(_zAxis, rz));
  _s.set(scale, scale, scale);
  _pos.set(x, y, z);
  _m.compose(_pos, _q, _s);
  mesh.setMatrixAt(i, _m);
}

class YardProps implements YardPropsModel {
  readonly root = new Group();
  private readonly ore: BeltPath;
  private readonly ingot: BeltPath;
  private readonly chevrons: InstancedMesh;
  private readonly ores: InstancedMesh;
  private readonly ingots: InstancedMesh;
  private readonly buckets: InstancedMesh;
  private readonly smoke: InstancedMesh;
  private readonly sheave: Mesh;
  private readonly smokeOrigin: Vector3;
  private readonly liftX: number;
  private readonly liftBottom: number;
  private readonly loopLength: number;
  private readonly bucketCount: number;
  private readonly chevronCount: number;

  constructor(surveyColumn: number) {
    const L = surveyLayout(surveyColumn);
    this.root.name = 'yard-props';
    this.ore = new BeltPath(L.oreBelt);
    this.ingot = new BeltPath(L.ingotBelt);

    const b: Builders = { solid: new GeometryBuilder(), metal: new GeometryBuilder(), decal: new GeometryBuilder(), glow: new GeometryBuilder() };
    headframe(b, L);
    this.smokeOrigin = smelter(b, L);
    storageBin(b, L);
    liftStatic(b, L);
    this.ore.addGeometry(b.solid);
    this.ingot.addGeometry(b.solid);
    rocksAndProps(b, L);

    this.liftX = L.c + 0.5;
    this.liftBottom = -LIFT_STUB_ROWS + 0.5;
    this.loopLength = 2 * (SHEAVE_Y - this.liftBottom) + 2 * Math.PI * SHEAVE_R;
    this.bucketCount = Math.floor(this.loopLength / BUCKET_SPACING);
    this.chevronCount = 2 * (this.ore.length + this.ingot.length);
    const oreCapacity = this.ore.length + Math.ceil(this.bucketCount / 2);

    this.chevrons = roleInstanced(chevronGeometry().build(), 'solid', this.chevronCount, 'yard-belt-chevrons');
    this.ores = roleInstanced(oreChunkGeometry().build(), 'solid', oreCapacity, 'yard-ore-items', true);
    this.ingots = roleInstanced(ingotGeometry().build(), 'metal', this.ingot.length, 'yard-ingots', true);
    this.buckets = roleInstanced(bucketGeometry().build(), 'metal', this.bucketCount, 'yard-lift-buckets');
    this.smoke = roleInstanced(smokeGeometry().build(), 'solid', SMOKE_PUFFS, 'yard-smelter-smoke');
    this.sheave = roleMesh(sheaveGeometry().build(), 'metal', 'yard-sheave');
    this.sheave.position.set(this.liftX, SHEAVE_Y, LIFT_Z);

    this.paintItems();
    const statics = [
      roleMesh(b.solid.build(), 'solid', 'yard-static'),
      roleMesh(b.metal.build(), 'metal', 'yard-steel'),
      roleMesh(b.decal.build(), 'decal', 'yard-rust'),
      roleMesh(b.glow.build(), 'emissive', 'yard-lights'),
      this.chevrons,
      this.ores,
      this.ingots,
      this.buckets,
      this.smoke,
    ];
    // Only the sheave moves as an object; everything else animates per instance.
    for (const m of statics) m.matrixAutoUpdate = false;
    this.root.add(...statics, this.sheave);
    this.update(0);
  }

  private paintItems(): void {
    const c = new Color();
    for (let i = 0; i < this.ores.instanceMatrix.count; i++) this.ores.setColorAt(i, c.setHex(DEMO_ORES[i % DEMO_ORES.length]));
    for (let i = 0; i < this.ingots.instanceMatrix.count; i++) this.ingots.setColorAt(i, c.setHex(ORES[1].highlight));
    if (this.ores.instanceColor) this.ores.instanceColor.needsUpdate = true;
    if (this.ingots.instanceColor) this.ingots.instanceColor.needsUpdate = true;
  }

  update(timeMs: number): void {
    const t = timeMs / 1000;
    let chev = 0;
    chev = this.placeChevrons(this.ore, timeMs, chev);
    chev = this.placeChevrons(this.ingot, timeMs, chev);
    this.chevrons.count = chev;
    this.chevrons.instanceMatrix.needsUpdate = true;

    const bob = 0.01 * Math.sin(t * Math.PI * 2 * 4);
    let ore = this.placeItems(this.ore, this.ores, timeMs, 0, bob);
    ore = this.placeBuckets(t, ore);
    this.ores.count = ore;
    this.ores.instanceMatrix.needsUpdate = true;
    this.ingots.count = this.placeItems(this.ingot, this.ingots, timeMs, 0, bob);
    this.ingots.instanceMatrix.needsUpdate = true;

    this.sheave.rotation.z = (t * LIFT_ROWS_PER_S) / SHEAVE_R;
    this.placeSmoke(t);
  }

  private placeChevrons(path: BeltPath, timeMs: number, start: number): number {
    let n = start;
    for (let k = 0; k < path.length * 2; k++) {
      const s = path.phase(timeMs, k * 0.5 + 0.25);
      const edge = Math.min(s, path.length - s);
      path.sample(s, _pos, _dir);
      setInstance(this.chevrons, n++, _pos.x, BELT_DECK_TOP + 0.016, _pos.z, Math.atan2(-_dir.z, _dir.x), 0, Math.min(1, edge / 0.12));
    }
    return n;
  }

  private placeItems(path: BeltPath, mesh: InstancedMesh, timeMs: number, start: number, bob: number): number {
    let n = start;
    for (let k = 0; k < path.length; k++) {
      const s = path.phase(timeMs, k + 0.5);
      const edge = Math.min(s, path.length - s);
      path.sample(s, _pos, _dir);
      setInstance(mesh, n++, _pos.x, BELT_DECK_TOP + bob, _pos.z, Math.atan2(-_dir.z, _dir.x) + k * 1.3, 0, Math.min(1, edge / 0.2));
    }
    return n;
  }

  /** Buckets ride a loop: up the right strand, over the sheave, down the left, round the foot. */
  private placeBuckets(t: number, oreStart: number): number {
    const H = SHEAVE_Y - this.liftBottom;
    const arc = Math.PI * SHEAVE_R;
    let ore = oreStart;
    for (let i = 0; i < this.bucketCount; i++) {
      let s = (t * LIFT_ROWS_PER_S + i * BUCKET_SPACING) % this.loopLength;
      let x: number, y: number, rot: number;
      if (s < H) {
        x = this.liftX + SHEAVE_R;
        y = this.liftBottom + s;
        rot = 0;
      } else if ((s -= H) < arc) {
        const a = s / SHEAVE_R;
        x = this.liftX + SHEAVE_R * Math.cos(a);
        y = SHEAVE_Y + SHEAVE_R * Math.sin(a);
        rot = a;
      } else if ((s -= arc) < H) {
        x = this.liftX - SHEAVE_R;
        y = SHEAVE_Y - s;
        rot = Math.PI;
      } else {
        s -= H;
        const a = Math.PI + s / SHEAVE_R;
        x = this.liftX + SHEAVE_R * Math.cos(a);
        y = this.liftBottom + SHEAVE_R * Math.sin(a);
        rot = a;
      }
      // Hang the bucket outboard of the strand.
      const ox = SHEAVE_R * 0.2 * Math.cos(rot);
      const oy = SHEAVE_R * 0.2 * Math.sin(rot);
      setInstance(this.buckets, i, x + ox, y + oy, LIFT_Z, 0, rot, 1);
      if (rot === 0 && i % 2 === 0) setInstance(this.ores, ore++, x + ox, y + 0.02, LIFT_Z, i * 0.9, 0, 0.8);
    }
    this.buckets.count = this.bucketCount;
    this.buckets.instanceMatrix.needsUpdate = true;
    return ore;
  }

  private placeSmoke(t: number): void {
    const o = this.smokeOrigin;
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const p = (t / SMOKE_PERIOD_S + i / SMOKE_PUFFS) % 1;
      const grow = 0.08 + 0.2 * p;
      const fade = p > 0.7 ? (1 - p) / 0.3 : Math.min(1, p / 0.08);
      setInstance(this.smoke, i, o.x + 0.35 * p + 0.04 * Math.sin(t * 2 + i), o.y + 1.1 * p, o.z - 0.1 * p, 0, 0, grow * fade);
    }
    this.smoke.count = SMOKE_PUFFS;
    this.smoke.instanceMatrix.needsUpdate = true;
  }
}

/** Build the survey set + M0 belt/lift demo for Dot's survey column (canon §3.2 pass 5). */
export function createYardProps(surveyColumn: number): YardPropsModel {
  return new YardProps(surveyColumn);
}
