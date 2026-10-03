// Chunk mesher for the mine slab (04 §5.2, 03 §8.3–8.5, 8.9). Pure: reads a grid, writes a MeshBuilder.
// Geometry per 16×16 chunk: front faces at z = +0.5 (one quad per cell: per-cell colour jitter and AO
// rule out greedy merging), exposed top/bottom/side faces over z −1.0…+0.5 with a 0.04 chamfer on the
// front edge, a back wall at z = −1.0 behind AIR cells below row 0, ore/relic polyhedra (+ merged
// inverted hulls), lode veins and stakes, Seal seams, the scope floor (a sealed band with its Co-op signs;
// nothing generated below it shows) and the slab frame.
import { CHUNK, MINE_H, MINE_W } from '../../shared/canon';
import { hash32 } from '../../shared/rng';
import { F, T, mineralTierOf, relicIdOf, type Lode } from '../../shared/types';
import { LODE_ORE_TIER, ORES, RELIC_COLOURS, ROLE, SHADING, SPECIAL, STRATA, SURFACE, UI } from '../palette';
import { bandIndexAt, jitterHex, mixHex, scaleHex } from './colors';
import { MeshBuilder, XF } from './meshBuilder';
import { SLOT_BASE, SLOT_HIGHLIGHT, SLOT_SPARKLE, oreShape, relicShape, type ShapeTemplate } from './shapes';
import { GLYPH_H, emitText, textWidthPx } from './signFont';

export const FRONT_Z = 0.5;
export const BACK_Z = -1.0;
export const CHAMFER = 0.04;
const CHAMFER_LIGHTEN = 1.08;
const BACK_WALL_K = 0.75;
/** Decals sit just proud of the front face. */
const DECAL_Z = FRONT_Z + 0.006;
const ORE_Z = FRONT_Z + 0.004;
const BOULDER_INSET = 0.14;
const BOULDER_RISE = 0.1;
const TURF_STRIP = 0.22;
/** Internal code for the scope floor and every row below it (drawn as a sealed band, impassable; INT-11). */
export const FLOOR_CODE = 255;
/** The temporary Seal's sign (03 §8.12 MVP), one line per entry, every 8 columns along the floor. */
export const FLOOR_SIGN_LINES = ['CO-OP', 'DRILLING', 'RIGHTS', 'END HERE'] as const;
/** Narrow 4-line plates every 6 columns: one always fits whole on the SE's ~8-column view (03 §1.1). */
const SIGN = { every: 6, first: 1, inset: 0.2, top: 0.36, pad: 0.17, px: 0.058, lineGap: 3, emissive: 0.12 } as const;
const SIGN_WIDTH = Math.max(...FLOOR_SIGN_LINES.map(textWidthPx)) * SIGN.px + 2 * SIGN.pad;
const HAZARD = { top: 0.05, bottom: 0.3, stripe: 0.25 } as const;
const SEAL_JOINT_EVERY = 4;
const MAGMA_EMISSIVE = 2.0;
/** Relics glow faintly (03 §8.4 emissive 0.2). */
const RELIC_GLOW = 0.2;
const LIGHT_MAGMA = 0;

const STONE = 0x4d4754;
const STONE_SIDE = 0x3a3346;
const BRASS = 0xc8963e;
const SEAL_SIDE = 0x120e17;
const HEART_SIDE = 0x1d1724;
const HEART_GREEN = 0x7cffb0;
const HEART_BRASS = 0xe8c27a;
const UNKNOWN_VEIN = 0x8e8796;
const KEROGEN = 0x6b5a4a;

/** What the mesher needs from a TerrainGrid (kept minimal so tests can use tiny fakes). */
export interface MeshSource {
  readonly seed: number;
  get(x: number, r: number): number;
  hasFlag(x: number, r: number, f: number): boolean;
  lodeAt(x: number, r: number): Lode | null;
}

export interface MesherOptions {
  /** Scope floor overlay row (MINE_H or more = none). */
  floorRow: number;
  /** Whether a lode shows as itself (else an Unknown seam). */
  lodeVisible(lode: Lode): boolean;
  /** Emit merged Toon hulls for ores and relics. */
  hulls: boolean;
}

const AO = SHADING.ao;

/** 0fps vertex AO: both sides occluded → darkest; else count of occluders (03 §8.9). */
export function aoValue(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return AO[3];
  return AO[(side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0)];
}

/** Chunk bounds in cells: [x0, x1) × [r0, r1). */
export function chunkCells(cx: number, cy: number): { x0: number; x1: number; r0: number; r1: number } {
  const x0 = cx * CHUNK;
  const r0 = cy * CHUNK;
  return { x0, x1: Math.min(MINE_W, x0 + CHUNK), r0, r1: Math.min(MINE_H, r0 + CHUNK) };
}

interface CellStyle {
  front: number;
  side: number;
  emissive: number;
  flags: number;
  chamfer: boolean;
}

/** Stateless per call; one instance can mesh any number of chunks. */
export class ChunkMesher {
  private src!: MeshSource;
  private opts!: MesherOptions;
  private out!: MeshBuilder;
  private seed = 0;
  private readonly style: CellStyle = { front: 0, side: 0, emissive: 0, flags: 0, chamfer: true };

  mesh(src: MeshSource, cx: number, cy: number, opts: MesherOptions, out: MeshBuilder): MeshBuilder {
    this.src = src;
    this.opts = opts;
    this.out = out;
    this.seed = src.seed;
    out.reset();
    const { x0, x1, r0, r1 } = chunkCells(cx, cy);
    const xa = x0 === 0 ? -1 : x0;
    const xb = x1 === MINE_W ? MINE_W + 1 : x1;
    for (let r = r0; r < r1; r++) {
      if (r > opts.floorRow) {
        this.sealedRow(r, x0, x1);
        continue;
      }
      for (let x = xa; x < xb; x++) {
        if (x < 0 || x >= MINE_W) this.frameCell(x, r);
        else if (this.code(x, r) === T.AIR) this.backWall(x, r);
        else this.solidCell(x, r);
      }
    }
    return out;
  }

  // ---- occupancy -------------------------------------------------------------------------------

  /** Terrain as rendered: at and below the scope floor everything reads as the sealed band (04 §4.1 scopeView). */
  private code(x: number, r: number): number {
    if (r >= this.opts.floorRow && r < MINE_H && x >= 0 && x < MINE_W) return FLOOR_CODE;
    return this.src.get(x, r);
  }
  private solid(x: number, r: number): boolean {
    return this.code(x, r) !== T.AIR;
  }
  /** The back layer (z < −1) is rock everywhere below the Rim. */
  private behind(r: number): boolean {
    return r >= 0;
  }

  // ---- cells -----------------------------------------------------------------------------------

  private backWall(x: number, r: number): void {
    if (r < 0) return;
    const stratum = STRATA[bandIndexAt(x, r, this.seed)];
    const hex = jitterHex(scaleHex(stratum.back, BACK_WALL_K), x, r, this.seed);
    const yt = -r;
    const yb = -r - 1;
    const sl = this.solid(x - 1, r), sr = this.solid(x + 1, r), su = this.solid(x, r - 1), sd = this.solid(x, r + 1);
    const a0 = aoValue(sl, sd, this.solid(x - 1, r + 1));
    const a1 = aoValue(sr, sd, this.solid(x + 1, r + 1));
    const a2 = aoValue(sr, su, this.solid(x + 1, r - 1));
    const a3 = aoValue(sl, su, this.solid(x - 1, r - 1));
    this.out.normal(0, 0, 1).color(hex).extra(0);
    this.out.quad(x, yb, BACK_Z, x + 1, yb, BACK_Z, x + 1, yt, BACK_Z, x, yt, BACK_Z, a0, a1, a2, a3);
  }

  private solidCell(x: number, r: number): void {
    const code = this.code(x, r);
    const st = this.cellStyle(x, r, code);
    const exL = !this.solid(x - 1, r);
    const exR = !this.solid(x + 1, r);
    const exU = !this.solid(x, r - 1);
    const exD = !this.solid(x, r + 1);
    if (code === T.HARDROCK) this.boulderFront(x, r, st);
    else this.chamferedFront(x, r, st, exL, exR, exU, exD);
    const zf = st.chamfer ? FRONT_Z - CHAMFER : FRONT_Z;
    const topHex = r === 0 ? this.rimTop(code) : code === FLOOR_CODE ? STONE : st.side;
    if (exL) this.sideFace(x, r, -1, zf, st.side, st);
    if (exR) this.sideFace(x, r, 1, zf, st.side, st);
    if (exU) this.topFace(x, r, zf, topHex, st);
    if (exD) this.bottomFace(x, r, zf, st.side, st);
    this.decorate(x, r, code);
  }

  /**
   * A row inside the sealed band below the scope floor: never exposed (every neighbour is sealed), so one merged
   * front quad per chunk row with a course seam and staggered joints, plus the frame columns.
   */
  private sealedRow(r: number, x0: number, x1: number): void {
    if (x0 === 0) this.frameCell(-1, r);
    if (x1 === MINE_W) this.frameCell(MINE_W, r);
    const yt = -r;
    const yb = -r - 1;
    const shade = 0.9 + 0.1 * ((hash32(this.seed, 0x5ea1, r) & 0xff) / 255);
    const o = this.out.normal(0, 0, 1).color(scaleHex(SPECIAL.seal, shade)).extra(0);
    o.quad(x0, yb, FRONT_Z, x1, yb, FRONT_Z, x1, yt, FRONT_Z, x0, yt, FRONT_Z);
    o.color(SPECIAL.sealSeam).extra(0.05);
    o.quad(x0, yt - 0.06, DECAL_Z, x1, yt - 0.06, DECAL_Z, x1, yt, DECAL_Z, x0, yt, DECAL_Z);
    const phase = (r % 2) * (SEAL_JOINT_EVERY / 2);
    for (let x = x0; x < x1; x++) {
      if ((x - phase + SEAL_JOINT_EVERY) % SEAL_JOINT_EVERY !== 0) continue;
      o.quad(x, yb, DECAL_Z, x + 0.06, yb, DECAL_Z, x + 0.06, yt - 0.06, DECAL_Z, x, yt - 0.06, DECAL_Z);
    }
  }

  /** Slab frame columns x = −1 and x = 48: cut stone with a brass specimen-case trim (03 §8.5). */
  private frameCell(x: number, r: number): void {
    if (r < 0) return;
    const st = this.style;
    st.front = jitterHex(STONE, x, r, this.seed);
    st.side = STONE_SIDE;
    st.emissive = 0;
    st.flags = 0;
    st.chamfer = true;
    const inner: -1 | 1 = x < 0 ? 1 : -1;
    const outer: -1 | 1 = x < 0 ? -1 : 1;
    const exIn = !this.solid(x + inner, r);
    const exU = r === 0;
    this.chamferedFront(x, r, st, inner < 0 && exIn, inner > 0 && exIn, exU, false);
    const zf = FRONT_Z - CHAMFER;
    if (exIn) this.sideFace(x, r, inner, zf, st.side, st);
    if (exU) this.topFace(x, r, zf, STONE, st);
    // Outer face, full depth, always visible from the side.
    this.sideFace(x, r, outer, FRONT_Z, STONE_SIDE, st, false);
    const edge = x < 0 ? x + 1 : x;
    const t0 = x < 0 ? edge - 0.16 : edge + 0.04;
    const t1 = x < 0 ? edge - 0.04 : edge + 0.16;
    this.out.normal(0, 0, 1).color(BRASS).extra(0.05);
    this.out.quad(t0, -r - 1, DECAL_Z, t1, -r - 1, DECAL_Z, t1, -r, DECAL_Z, t0, -r, DECAL_Z);
  }

  /** Row 0 tops are the Rim road: paving under the pads, asphalt elsewhere (03 §8.2, §8.5). */
  private rimTop(code: number): number {
    return code === T.PAVED ? SURFACE.rimPaving : SURFACE.rimAsphalt;
  }

  private cellStyle(x: number, r: number, code: number): CellStyle {
    const st = this.style;
    st.emissive = 0;
    st.flags = 0;
    st.chamfer = true;
    if (code === FLOOR_CODE || code === T.SEAL) {
      st.front = jitterHex(SPECIAL.seal, x, r, this.seed);
      st.side = SEAL_SIDE;
      return st;
    }
    if (code === T.HEARTSTONE) {
      st.front = jitterHex(SPECIAL.heartstone, x, r, this.seed);
      st.side = HEART_SIDE;
      return st;
    }
    if (code === T.HARDROCK) {
      st.front = jitterHex(SPECIAL.hardrock, x, r, this.seed);
      st.side = SPECIAL.hardrockDark;
      st.chamfer = false;
      return st;
    }
    if (code === T.MAGMA) {
      st.front = SPECIAL.magmaMid;
      st.side = SPECIAL.magmaCrust;
      st.emissive = MAGMA_EMISSIVE;
      st.flags = XF.MAGMA;
      return st;
    }
    const stratum = STRATA[bandIndexAt(x, r, this.seed)];
    let front = stratum.front;
    let side = stratum.side;
    if (code === T.LODE_ROCK) {
      front = scaleHex(front, 0.85);
      side = scaleHex(side, 0.85);
    } else if (code === T.METHANE && this.src.hasFlag(x, r, F.REVEALED)) {
      // Revealed methane: 20% shimmer tint (03 §8.4); unrevealed it is exactly DIRT.
      front = mixHex(front, SPECIAL.methaneRevealed, 0.2);
    }
    st.front = jitterHex(front, x, r, this.seed);
    st.side = jitterHex(side, x, r, this.seed);
    return st;
  }

  // ---- faces -----------------------------------------------------------------------------------

  /** Front face inset by the chamfer on exposed edges, plus mitred chamfer quads (8% lighter). */
  private chamferedFront(x: number, r: number, st: CellStyle, exL: boolean, exR: boolean, exU: boolean, exD: boolean): void {
    const o = this.out;
    const c = CHAMFER;
    const yt = -r;
    const yb = -r - 1;
    const cl = exL ? c : 0, cr = exR ? c : 0, ct = exU ? c : 0, cb = exD ? c : 0;
    o.normal(0, 0, 1).color(st.front).extra(st.emissive, st.flags);
    o.quad(x + cl, yb + cb, FRONT_Z, x + 1 - cr, yb + cb, FRONT_Z, x + 1 - cr, yt - ct, FRONT_Z, x + cl, yt - ct, FRONT_Z);
    const zc = FRONT_Z - c;
    const hex = scaleHex(st.front, CHAMFER_LIGHTEN);
    o.color(hex);
    if (exL) o.normal(-1, 0, 1).quad(x, yb, zc, x + c, yb + cb, FRONT_Z, x + c, yt - ct, FRONT_Z, x, yt, zc);
    if (exR) o.normal(1, 0, 1).quad(x + 1 - c, yb + cb, FRONT_Z, x + 1, yb, zc, x + 1, yt, zc, x + 1 - c, yt - ct, FRONT_Z);
    if (exU) o.normal(0, 1, 1).quad(x + cl, yt - c, FRONT_Z, x + 1 - cr, yt - c, FRONT_Z, x + 1, yt, zc, x, yt, zc);
    if (exD) o.normal(0, -1, 1).quad(x, yb, zc, x + 1, yb, zc, x + 1 - cr, yb + c, FRONT_Z, x + cl, yb + c, FRONT_Z);
    // Close chamfer ends that stop against a neighbour without the same chamfer (else pinholes).
    o.color(st.side);
    if (exL && !exU && !this.continues(x, r - 1, x - 1, r - 1)) this.cap(x, yt, zc, x + c, yt, FRONT_Z, x, yt, FRONT_Z, 0, 1, 0);
    if (exL && !exD && !this.continues(x, r + 1, x - 1, r + 1)) this.cap(x, yb, zc, x + c, yb, FRONT_Z, x, yb, FRONT_Z, 0, -1, 0);
    if (exR && !exU && !this.continues(x, r - 1, x + 1, r - 1)) this.cap(x + 1, yt, zc, x + 1 - c, yt, FRONT_Z, x + 1, yt, FRONT_Z, 0, 1, 0);
    if (exR && !exD && !this.continues(x, r + 1, x + 1, r + 1)) this.cap(x + 1, yb, zc, x + 1 - c, yb, FRONT_Z, x + 1, yb, FRONT_Z, 0, -1, 0);
    if (exU && !exL && !this.continues(x - 1, r, x - 1, r - 1)) this.cap(x, yt, zc, x, yt - c, FRONT_Z, x, yt, FRONT_Z, -1, 0, 0);
    if (exU && !exR && !this.continues(x + 1, r, x + 1, r - 1)) this.cap(x + 1, yt, zc, x + 1, yt - c, FRONT_Z, x + 1, yt, FRONT_Z, 1, 0, 0);
    if (exD && !exL && !this.continues(x - 1, r, x - 1, r + 1)) this.cap(x, yb, zc, x, yb + c, FRONT_Z, x, yb, FRONT_Z, -1, 0, 0);
    if (exD && !exR && !this.continues(x + 1, r, x + 1, r + 1)) this.cap(x + 1, yb, zc, x + 1, yb + c, FRONT_Z, x + 1, yb, FRONT_Z, 1, 0, 0);
  }

  /** Does solid neighbour (nx, nr) carry the same chamfer, i.e. is its cell across that edge open? */
  private continues(nx: number, nr: number, ax: number, ar: number): boolean {
    const code = this.code(nx, nr);
    const chamfered = nx < 0 || nx >= MINE_W ? nr === 0 && ar < 0 : code !== T.HARDROCK;
    return chamfered && !this.solid(ax, ar);
  }

  /** One end-cap triangle, wound to face (nx, ny, nz). */
  private cap(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, nx: number, ny: number, nz: number): void {
    const o = this.out.normal(nx, ny, nz);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    const a = o.vertex(ax, ay, az);
    const b = o.vertex(bx, by, bz);
    const d = o.vertex(cx, cy, cz);
    if (dot >= 0) o.tri(a, b, d);
    else o.tri(a, d, b);
  }

  /** Hardrock: chamfered boulder standing proud of the face (03 §8.5). */
  private boulderFront(x: number, r: number, st: CellStyle): void {
    const o = this.out;
    const b = BOULDER_INSET;
    const zh = FRONT_Z + BOULDER_RISE;
    const yt = -r;
    const yb = -r - 1;
    const lit = r >= STRATA[4].top ? SPECIAL.hardrockChamferDeep : SPECIAL.hardrockChamfer;
    const dark = SPECIAL.hardrockDark;
    o.normal(0, 0, 1).color(st.front).extra(0);
    o.quad(x + b, yb + b, zh, x + 1 - b, yb + b, zh, x + 1 - b, yt - b, zh, x + b, yt - b, zh);
    o.normal(0, b, BOULDER_RISE).color(lit).quad(x + b, yt - b, zh, x + 1 - b, yt - b, zh, x + 1, yt, FRONT_Z, x, yt, FRONT_Z);
    o.normal(-b, 0, BOULDER_RISE).quad(x, yb, FRONT_Z, x + b, yb + b, zh, x + b, yt - b, zh, x, yt, FRONT_Z);
    o.normal(0, -b, BOULDER_RISE).color(dark).quad(x, yb, FRONT_Z, x + 1, yb, FRONT_Z, x + 1 - b, yb + b, zh, x + b, yb + b, zh);
    o.normal(b, 0, BOULDER_RISE).quad(x + 1 - b, yb + b, zh, x + 1, yb, FRONT_Z, x + 1, yt, FRONT_Z, x + 1 - b, yt - b, zh);
  }

  /** Side face toward an open neighbour at x + dir, spanning z ∈ [BACK_Z, zf], with AO. */
  private sideFace(x: number, r: number, dir: -1 | 1, zf: number, hex: number, st: CellStyle, ao = true): void {
    const nx = x + dir;
    const up = ao && this.solid(nx, r - 1);
    const down = ao && this.solid(nx, r + 1);
    const bh = ao && this.behind(r);
    const aBF = aoValue(down, false, false);
    const aBB = aoValue(down, bh, ao && this.behind(r + 1));
    const aTB = aoValue(up, bh, ao && this.behind(r - 1));
    const aTF = aoValue(up, false, false);
    const yt = -r;
    const yb = -r - 1;
    const o = this.out.normal(dir, 0, 0).color(hex).extra(st.emissive, st.flags);
    if (dir > 0) {
      const px = x + 1;
      o.quad(px, yb, zf, px, yb, BACK_Z, px, yt, BACK_Z, px, yt, zf, aBF, aBB, aTB, aTF);
    } else {
      o.quad(x, yb, BACK_Z, x, yb, zf, x, yt, zf, x, yt, BACK_Z, aBB, aBF, aTF, aTB);
    }
  }

  private topFace(x: number, r: number, zf: number, hex: number, st: CellStyle): void {
    const left = this.solid(x - 1, r - 1);
    const right = this.solid(x + 1, r - 1);
    const bh = this.behind(r - 1);
    const yt = -r;
    this.out.normal(0, 1, 0).color(hex).extra(st.emissive, st.flags);
    this.out.quad(
      x, yt, zf, x + 1, yt, zf, x + 1, yt, BACK_Z, x, yt, BACK_Z,
      aoValue(left, false, false), aoValue(right, false, false), aoValue(right, bh, bh), aoValue(left, bh, bh),
    );
  }

  private bottomFace(x: number, r: number, zf: number, hex: number, st: CellStyle): void {
    const left = this.solid(x - 1, r + 1);
    const right = this.solid(x + 1, r + 1);
    const bh = this.behind(r + 1);
    const yb = -r - 1;
    this.out.normal(0, -1, 0).color(hex).extra(st.emissive, st.flags);
    this.out.quad(
      x, yb, BACK_Z, x + 1, yb, BACK_Z, x + 1, yb, zf, x, yb, zf,
      aoValue(left, bh, bh), aoValue(right, bh, bh), aoValue(right, false, false), aoValue(left, false, false),
    );
  }

  // ---- decorations -------------------------------------------------------------------------------

  private decorate(x: number, r: number, code: number): void {
    const tier = mineralTierOf(code);
    if (tier > 0) return this.ore(x, r, tier);
    const relic = relicIdOf(code);
    if (relic >= 0) return this.relic(x, r, relic);
    switch (code) {
      case T.TURF:
      case T.PAVED:
        if (r === 0) this.turfStrip(x, code);
        return;
      case T.MAGMA:
        this.out.lights.push(x + 0.5, -r - 0.5, LIGHT_MAGMA);
        return;
      case T.LODE_ROCK:
        this.lode(x, r);
        return;
      case T.SEAL:
        this.sealSeams(x, r);
        return;
      case FLOOR_CODE:
        this.floorCap(x, r);
        return;
      case T.HEARTSTONE:
        this.heartFleck(x, r);
        return;
    }
  }

  private turfStrip(x: number, code: number): void {
    const hex = code === T.PAVED ? scaleHex(SURFACE.rimPaving, 0.82) : SPECIAL.turf;
    const ex0 = !this.solid(x - 1, 0) ? CHAMFER : 0;
    const ex1 = !this.solid(x + 1, 0) ? CHAMFER : 0;
    const z = FRONT_Z + 0.003;
    this.out.normal(0, 0, 1).color(jitterHex(hex, x, 0, this.seed)).extra(0);
    this.out.quad(x + ex0, -TURF_STRIP, z, x + 1 - ex1, -TURF_STRIP, z, x + 1 - ex1, -CHAMFER, z, x + ex0, -CHAMFER, z);
  }

  private ore(x: number, r: number, tier: number): void {
    const spec = ORES[tier - 1];
    const h = hash32(this.seed, 0x0e, x, r);
    const flags = tier === 6 ? XF.PULSE : tier === 10 ? XF.ECHO : 0;
    const sparkleFlags = tier === 4 || tier === 9 ? XF.TWINKLE : flags;
    COLOURS[SLOT_BASE] = spec.base;
    COLOURS[SLOT_HIGHLIGHT] = spec.highlight;
    COLOURS[SLOT_SPARKLE] = 0xffffff;
    EMISSIVE[SLOT_BASE] = spec.emissive;
    EMISSIVE[SLOT_HIGHLIGHT] = Math.min(2.5, spec.emissive + 0.12);
    EMISSIVE[SLOT_SPARKLE] = 1.0;
    FLAGS[SLOT_BASE] = flags;
    FLAGS[SLOT_HIGHLIGHT] = tier === 9 ? XF.TWINKLE : flags;
    FLAGS[SLOT_SPARKLE] = sparkleFlags;
    this.placeShape(oreShape(tier), x, r, h);
    if (spec.emissive > 0) this.out.glows.push(x + 0.5, -r - 0.5, spec.highlight, spec.emissive);
  }

  private relic(x: number, r: number, id: number): void {
    const base = RELIC_COLOURS[id];
    COLOURS[SLOT_BASE] = base;
    COLOURS[SLOT_HIGHLIGHT] = id === 1 ? scaleHex(base, 0.7) : id === 2 ? 0x2b1e2f : scaleHex(base, 1.25);
    COLOURS[SLOT_SPARKLE] = 0xffffff;
    EMISSIVE[SLOT_BASE] = 0.2;
    EMISSIVE[SLOT_HIGHLIGHT] = id === 2 ? 0.6 : 0.2;
    EMISSIVE[SLOT_SPARKLE] = 1;
    FLAGS[SLOT_BASE] = 0;
    FLAGS[SLOT_HIGHLIGHT] = 0;
    FLAGS[SLOT_SPARKLE] = 0;
    this.placeShape(relicShape(id), x, r, hash32(this.seed, 0x7e, x, r));
    this.out.glows.push(x + 0.5, -r - 0.5, base, RELIC_GLOW);
  }

  /** Place a template on the cell's front face with a small seeded rotation/scale/offset. */
  private placeShape(t: ShapeTemplate, x: number, r: number, h: number): void {
    const rot = ((h & 0xff) / 255 - 0.5) * 0.7;
    const scale = 0.95 + (((h >>> 8) & 0xff) / 255) * 0.15;
    const ox = (((h >>> 16) & 0xff) / 255 - 0.5) * 0.1;
    const oy = (((h >>> 24) & 0xff) / 255 - 0.5) * 0.1;
    emitShape(this.out, t, x + 0.5 + ox, -r - 0.5 + oy, ORE_Z, rot, scale, h & 0xff, this.opts.hulls);
  }

  /**
   * The 3×2 lode block (03 §8.5), emitted once from its top-left cell: a dark seam round the block so it reads as
   * one slab, ore-coloured veins (emissive 0.3) studded with metal nuggets, and a riveted claim stake once
   * discovered. Unknown seams (v1 lodes before v1) keep grey veins with no nuggets and no stake.
   */
  private lode(x: number, r: number): void {
    const lode = this.src.lodeAt(x, r);
    if (!lode || lode.x0 !== x || lode.top !== r) return;
    const visible = this.opts.lodeVisible(lode);
    const tier = LODE_ORE_TIER[lode.metal];
    const ore = visible && tier > 0 ? ORES[tier - 1] : null;
    const hex = !visible ? UNKNOWN_VEIN : ore ? ore.base : KEROGEN;
    this.lodeOutline(x, r);
    const o = this.out.normal(0, 0, 1).color(hex).extra(visible ? 0.3 : 0);
    const h = hash32(this.seed, 0x10de, lode.id);
    const pts = LODE_PTS;
    for (let i = 0; i <= LODE_VEIN_N; i++) {
      pts[i * 2] = 0.08 + (2.84 * i) / LODE_VEIN_N;
      pts[i * 2 + 1] = 0.35 + ((hash32(h, i) & 0xffff) / 65535) * 1.3;
    }
    for (let i = 0; i < LODE_VEIN_N; i++) veinSegment(o, x, r, pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3]);
    const bi = 1 + (h % 3);
    const bx = pts[bi * 2];
    const by = pts[bi * 2 + 1];
    veinSegment(o, x, r, bx, by, bx + 0.35, by < 1 ? 1.85 : 0.15);
    if (ore) this.nuggets(x, r, ore.base, ore.highlight, Math.max(0.3, ore.emissive));
    if (visible && lode.discovered) this.stake(x + 1.5, -r - 1);
  }

  /** Dark seam along the 3×2 block's edges, just proud of the face. */
  private lodeOutline(x: number, r: number): void {
    const stratum = STRATA[bandIndexAt(x, r, this.seed)];
    const o = this.out.normal(0, 0, 1).color(scaleHex(stratum.back, 0.7)).extra(0);
    const w = LODE_EDGE;
    const x1 = x + 3;
    const yt = -r;
    const yb = -r - 2;
    const z = DECAL_Z + 0.001;
    o.quad(x, yt - w, z, x1, yt - w, z, x1, yt, z, x, yt, z);
    o.quad(x, yb, z, x1, yb, z, x1, yb + w, z, x, yb + w, z);
    o.quad(x, yb + w, z, x + w, yb + w, z, x + w, yt - w, z, x, yt - w, z);
    o.quad(x1 - w, yb + w, z, x1, yb + w, z, x1, yt - w, z, x1 - w, yt - w, z);
  }

  /** Metal nuggets on the vein's knots (03 §8.4 lode ore: rough chunks in the ore colour). */
  private nuggets(x: number, r: number, base: number, highlight: number, emissive: number): void {
    const o = this.out;
    for (let i = 1; i < LODE_VEIN_N; i += 2) {
      const cx = x + LODE_PTS[i * 2];
      const cy = -r - LODE_PTS[i * 2 + 1];
      const s = 0.1;
      o.color(base).extra(emissive).box(cx - s, cy - s, FRONT_Z, cx + s, cy + s, FRONT_Z + 0.09, scaleHex(base, 0.7));
      o.color(highlight).extra(emissive + 0.1).box(cx - s * 0.45, cy, FRONT_Z + 0.09, cx + s * 0.15, cy + s * 0.6, FRONT_Z + 0.11);
    }
  }

  /** Brass post with a riveted mustard claim plate (03 §8.5). */
  private stake(cx: number, cy: number): void {
    const o = this.out.extra(0.15);
    o.color(BRASS).box(cx - 0.06, cy - 0.45, FRONT_Z, cx + 0.06, cy + 0.2, FRONT_Z + 0.14, scaleHex(BRASS, 0.7));
    o.color(ROLE.logistics).box(cx - 0.3, cy + 0.08, FRONT_Z + 0.12, cx + 0.3, cy + 0.46, FRONT_Z + 0.2, scaleHex(ROLE.logistics, 0.7));
    o.color(ROLE.buildingTrim);
    for (const [rx, ry] of STAKE_RIVETS) o.box(cx + rx - 0.035, cy + ry - 0.035, FRONT_Z + 0.2, cx + rx + 0.035, cy + ry + 0.035, FRONT_Z + 0.23);
  }

  private sealSeams(x: number, r: number): void {
    const o = this.out.normal(0, 0, 1).color(SPECIAL.sealSeam).extra(0.05);
    const yt = -r;
    const yb = -r - 1;
    o.quad(x, yb, DECAL_Z, x + 0.06, yb, DECAL_Z, x + 0.06, yt, DECAL_Z, x, yt, DECAL_Z);
    const ym = yb + 0.47;
    o.quad(x, ym, DECAL_Z, x + 1, ym, DECAL_Z, x + 1, ym + 0.06, DECAL_Z, x, ym + 0.06, DECAL_Z);
  }

  /**
   * The scope floor's top row (03 §8.12 MVP temporary Seal): Seal seams, a hazard band along the top edge, a
   * rivet per cell, and the Co-op sign every SIGN.every columns.
   */
  private floorCap(x: number, r: number): void {
    this.sealSeams(x, r);
    const yt = -r;
    const z = DECAL_Z + 0.002;
    const o = this.out.normal(0, 0, 1).color(UI.ink).extra(0);
    const y0 = yt - HAZARD.bottom;
    const y1 = yt - HAZARD.top;
    o.quad(x, y0, DECAL_Z + 0.001, x + 1, y0, DECAL_Z + 0.001, x + 1, y1, DECAL_Z + 0.001, x, y1, DECAL_Z + 0.001);
    o.color(UI.amber).extra(0.3);
    const w = HAZARD.stripe;
    for (const off of [0, 0.5]) o.quad(x + off, y0, z, x + off + w, y0, z, x + off + 2 * w, y1, z, x + off + w, y1, z);
    o.color(BRASS).extra(0.05).box(x + 0.44, yt - 0.7, FRONT_Z, x + 0.56, yt - 0.58, FRONT_Z + 0.04, scaleHex(BRASS, 0.7));
    if (x % SIGN.every === SIGN.first) this.floorSign(x + SIGN.inset, yt - SIGN.top);
  }

  /** A cream plank on a brass frame, bolted to the seal, with the Co-op notice in the 5×7 sign font. */
  private floorSign(left: number, top: number): void {
    const lines = FLOOR_SIGN_LINES;
    const linePx = GLYPH_H + SIGN.lineGap;
    const textH = (lines.length * linePx - SIGN.lineGap) * SIGN.px;
    const right = left + SIGN_WIDTH;
    const bottom = top - textH - 2 * SIGN.pad;
    const o = this.out;
    o.color(BRASS).extra(0.05).box(left - 0.06, bottom - 0.06, FRONT_Z, right + 0.06, top + 0.06, FRONT_Z + 0.05, scaleHex(BRASS, 0.7));
    o.color(ROLE.buildingBody).extra(SIGN.emissive).box(left, bottom, FRONT_Z, right, top, FRONT_Z + 0.08, scaleHex(ROLE.buildingBody, 0.75));
    o.color(ROLE.buildingTrim).extra(0);
    for (const [bx, by] of [[left + 0.12, top - 0.12], [right - 0.12, top - 0.12], [left + 0.12, bottom + 0.12], [right - 0.12, bottom + 0.12]]) {
      o.box(bx - 0.04, by - 0.04, FRONT_Z + 0.08, bx + 0.04, by + 0.04, FRONT_Z + 0.1);
    }
    o.color(UI.ink).extra(0);
    for (let i = 0; i < lines.length; i++) {
      const w = textWidthPx(lines[i]) * SIGN.px;
      emitText(o, lines[i], left + (SIGN_WIDTH - w) / 2, top - SIGN.pad - i * linePx * SIGN.px, SIGN.px, FRONT_Z + 0.085);
    }
  }

  private heartFleck(x: number, r: number): void {
    const h = hash32(this.seed, 0x4ea7, x, r);
    if ((h & 0xff) > 46) return;
    const green = ((h >>> 8) & 1) === 1;
    const cx = x + 0.25 + ((h >>> 9) & 0xff) / 510;
    const cy = -r - 0.25 - ((h >>> 17) & 0xff) / 510;
    const s = 0.09;
    this.out.normal(0, 0, 1).color(green ? HEART_GREEN : HEART_BRASS).extra(green ? 0.6 : 0.2);
    this.out.quad(cx, cy - s, DECAL_Z, cx + s, cy, DECAL_Z, cx, cy + s, DECAL_Z, cx - s, cy, DECAL_Z);
  }
}

const COLOURS = [0, 0, 0];
const EMISSIVE = [0, 0, 0];
const FLAGS = [0, 0, 0];

/** Width of a lode vein strip (≥ 0.05 per 03 §8.1). */
const VEIN_W = 0.12;
const LODE_VEIN_N = 5;
/** Vein knots in lode-local units (x right, y down from the block top), reused per lode. */
const LODE_PTS = new Float64Array((LODE_VEIN_N + 1) * 2);
const LODE_EDGE = 0.06;
/** Claim plate rivets relative to the stake's (cx, cy). */
const STAKE_RIVETS: readonly (readonly [number, number])[] = [
  [-0.22, 0.38],
  [0.22, 0.38],
  [-0.22, 0.16],
  [0.22, 0.16],
];

function veinSegment(o: MeshBuilder, x0: number, top: number, ax: number, ay: number, bx: number, by: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = (-dy / l) * VEIN_W * 0.5;
  const py = (dx / l) * VEIN_W * 0.5;
  const z = DECAL_Z + 0.004;
  // Lode-local y grows downward; world y = −top − ly.
  const wx = (lx: number): number => x0 + lx;
  const wy = (ly: number): number => -top - ly;
  // Local y is flipped into world y, so this order is CCW seen from +z.
  o.quad(wx(ax - px), wy(ay - py), z, wx(ax + px), wy(ay + py), z, wx(bx + px), wy(by + py), z, wx(bx - px), wy(by - py), z);
}

/**
 * Append a template rotated about z by `rot`, scaled, at (px, py, pz), using the COLOURS/EMISSIVE/FLAGS
 * slot tables. With `hulls`, also append the inverted hull (flipped winding, radial normals, XF.HULL).
 */
function emitShape(o: MeshBuilder, t: ShapeTemplate, px: number, py: number, pz: number, rot: number, s: number, phase: number, hulls: boolean): void {
  const c = Math.cos(rot) * s;
  const n = Math.sin(rot) * s;
  const tris = t.tris;
  const ccx = px + (t.cx * c - t.cy * n);
  const ccy = py + (t.cx * n + t.cy * c);
  const ccz = pz + t.cz * s;
  for (let pass = 0; pass < (hulls ? 2 : 1); pass++) {
    const hull = pass === 1;
    for (let i = 0; i < t.triCount; i++) {
      const k = i * 9;
      const ax = px + tris[k] * c - tris[k + 1] * n, ay = py + tris[k] * n + tris[k + 1] * c, az = pz + tris[k + 2] * s;
      const bx = px + tris[k + 3] * c - tris[k + 4] * n, by = py + tris[k + 3] * n + tris[k + 4] * c, bz = pz + tris[k + 5] * s;
      const cx = px + tris[k + 6] * c - tris[k + 7] * n, cy = py + tris[k + 6] * n + tris[k + 7] * c, cz = pz + tris[k + 8] * s;
      const slot = t.slots[i];
      if (!hull) {
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        o.normal(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx).color(COLOURS[slot]).extra(EMISSIVE[slot], FLAGS[slot], phase);
        const a = o.vertex(ax, ay, az);
        const b = o.vertex(bx, by, bz);
        const d = o.vertex(cx, cy, cz);
        o.tri(a, b, d);
      } else {
        o.color(COLOURS[SLOT_BASE]).extra(0, XF.HULL, phase);
        const a = o.normal(ax - ccx, ay - ccy, az - ccz).vertex(ax, ay, az);
        const b = o.normal(bx - ccx, by - ccy, bz - ccz).vertex(bx, by, bz);
        const d = o.normal(cx - ccx, cy - ccy, cz - ccz).vertex(cx, cy, cz);
        o.tri(a, d, b);
      }
    }
  }
}
