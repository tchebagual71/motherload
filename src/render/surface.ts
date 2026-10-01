// Surface diorama (canon §3.1, 03 §8.2): the Yard plateau (48 × rows at z ∈ [−(1+rows), −1]) with
// unbuildable margins and cliff edges, painted chevrons on the four Rim pads, and the painted sky
// backdrop (mesas and the desert live in its shader). Geometry uses the terrain vertex layout.
import { BufferAttribute, BufferGeometry, Group, Mesh, type Material } from 'three';
import { MINE_W, RIM_BUILDINGS, YARD_D_START } from '../shared/canon';
import { ROLE, STRATA, SURFACE } from './palette';
import { jitterHex, mixHex, scaleHex } from './terrain/colors';
import { geometryFromBuilder } from './terrain/chunks';
import { MeshBuilder } from './terrain/meshBuilder';
import { FRONT_Z } from './terrain/mesher';

const MARGIN = 6;
const BACK_STRIP = 3;
/** Cliffs fall to here, fading into the backdrop's painted ground. */
const CLIFF_Y = -6;
const CUT_DEPTH = 24;
const SEED = 0x5eed;
/** Yard tiles carry half the slab's per-cell jitter so the build grid stays calm. */
const YARD_JITTER = 0.5;

export class Surface {
  readonly root = new Group();
  /** Fullscreen far-depth backdrop (its shader maps screen → a camera-facing plane). */
  readonly sky: Mesh;
  private plateau: Mesh | null = null;
  private material: Material;
  private rows = 0;

  constructor(terrainMaterial: Material, skyMaterial: Material, yardRows = YARD_D_START) {
    this.material = terrainMaterial;
    this.root.name = 'surface';
    const tri = new BufferGeometry();
    tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.sky = new Mesh(tri, skyMaterial);
    this.sky.name = 'sky';
    this.sky.frustumCulled = false;
    this.sky.matrixAutoUpdate = false;
    this.sky.renderOrder = -100;
    this.root.add(this.sky);
    this.setYardRows(yardRows);
  }

  /** Rebuild the plateau for a Yard depth (8 at start, +8 per expansion; canon §3.1). */
  setYardRows(rows: number): void {
    if (rows === this.rows) return;
    this.rows = rows;
    if (this.plateau) {
      this.plateau.geometry.dispose();
      this.root.remove(this.plateau);
    }
    this.plateau = new Mesh(geometryFromBuilder(buildPlateau(rows)), this.material);
    this.plateau.name = 'yard-plateau';
    this.plateau.matrixAutoUpdate = false;
    this.root.add(this.plateau);
  }

  setMaterials(terrain: Material, sky: Material): void {
    this.material = terrain;
    if (this.plateau) this.plateau.material = terrain;
    this.sky.material = sky;
  }

  dispose(): void {
    this.plateau?.geometry.dispose();
    this.sky.geometry.dispose();
  }
}

export function plateauBackZ(rows: number): number {
  return -(1 + rows + BACK_STRIP);
}

/** Horizontal quad at height y; corners given in any order around the shape are wound CCW from +y. */
function flatQuad(o: MeshBuilder, y: number, xs: readonly number[], zs: readonly number[]): void {
  // Signed area in the (x, −z) plane; CCW seen from +y means positive.
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += xs[i] * -zs[j] - xs[j] * -zs[i];
  }
  const order = area >= 0 ? [0, 1, 2, 3] : [3, 2, 1, 0];
  o.normal(0, 1, 0);
  o.quad(
    xs[order[0]], y, zs[order[0]], xs[order[1]], y, zs[order[1]],
    xs[order[2]], y, zs[order[2]], xs[order[3]], y, zs[order[3]],
  );
}

function tile(o: MeshBuilder, x0: number, z0: number, x1: number, z1: number, hex: number): void {
  o.color(hex).extra(0);
  flatQuad(o, 0, [x0, x1, x1, x0], [z1, z1, z0, z0]);
}

/** Plateau tops (Yard checker + margins), outer cliffs and the cut faces beside the slab. */
export function buildPlateau(rows: number): MeshBuilder {
  const o = new MeshBuilder(4096, 8192);
  const zBack = plateauBackZ(rows);
  const xL = -MARGIN;
  const xR = MINE_W + MARGIN;
  // Yard tiles: subtle checker of ground.top / topAlt with per-tile jitter.
  for (let z = -1 - rows; z < -1; z++) {
    for (let x = 0; x < MINE_W; x++) {
      const base = (x + z) & 1 ? SURFACE.groundTop : SURFACE.groundTopAlt;
      tile(o, x, z, x + 1, z + 1, jitterHex(base, x, z, SEED, YARD_JITTER));
    }
  }
  // Margins and back strip (unbuildable ground), slightly darker.
  const margin = scaleHex(SURFACE.groundTopAlt, 0.93);
  for (let z = zBack; z < -1; z++) {
    for (let x = xL; x < xR; x++) {
      const inYard = x >= 0 && x < MINE_W && z >= -1 - rows;
      if (!inYard) tile(o, x, z, x + 1, z + 1, jitterHex(margin, x, z, SEED, YARD_JITTER));
    }
  }
  for (let x = xL; x < xR; x++) {
    if (x >= -1 && x <= MINE_W) continue; // the slab frame and Rim own this strip
    tile(o, x, -1, x + 1, FRONT_Z, jitterHex(margin, x, 7, SEED));
  }
  // Cliffs: right (+x), left (−x), back (−z); lit at the lip, fading into the dust at the foot.
  for (let z = zBack; z < FRONT_Z; z += 1) {
    const z1 = Math.min(FRONT_Z, z + 1);
    cliffQuad(o, [xR, CLIFF_Y, z1], [xR, CLIFF_Y, z], [xR, 0, z], [xR, 0, z1], [1, 0, 0], Math.floor(z));
    cliffQuad(o, [xL, CLIFF_Y, z], [xL, CLIFF_Y, z1], [xL, 0, z1], [xL, 0, z], [-1, 0, 0], Math.floor(z) + 500);
  }
  for (let x = xL; x < xR; x++) {
    cliffQuad(o, [x + 1, CLIFF_Y, zBack], [x, CLIFF_Y, zBack], [x, 0, zBack], [x + 1, 0, zBack], [0, 0, -1], x + 900);
  }
  // Cut faces at z = +0.5 beside the slab frame, banded like the mine strata.
  for (const [a, b] of [[xL, -1], [MINE_W + 1, xR]] as const) {
    for (let r = 0; r < CUT_DEPTH; r++) {
      const s = STRATA[r < STRATA[1].top ? 0 : 1];
      const hex = jitterHex(scaleHex(s.front, 0.92), a, r, SEED);
      o.normal(0, 0, 1).color(hex).extra(0);
      o.quad(a, -r - 1, FRONT_Z, b, -r - 1, FRONT_Z, b, -r, FRONT_Z, a, -r, FRONT_Z);
    }
    o.normal(0, 0, 1).color(SURFACE.groundTop);
    o.quad(a, -0.22, FRONT_Z + 0.003, b, -0.22, FRONT_Z + 0.003, b, 0, FRONT_Z + 0.003, a, 0, FRONT_Z + 0.003);
  }
  padChevrons(o);
  return o;
}

type P3 = readonly [number, number, number];

/** Cliff quad: bottom edge (a, b) in the dust colour, top edge (c, d) in ground.side, jittered. */
function cliffQuad(o: MeshBuilder, a: P3, b: P3, c: P3, d: P3, n: P3, salt: number): void {
  const top = jitterHex(SURFACE.groundSide, salt, 3, SEED, YARD_JITTER);
  const foot = mixHex(SURFACE.rockDark, SURFACE.dust, 0.5);
  o.normal(n[0], n[1], n[2]).extra(0);
  const ia = o.color(foot).vertex(a[0], a[1], a[2]);
  const ib = o.vertex(b[0], b[1], b[2]);
  const ic = o.color(top).vertex(c[0], c[1], c[2]);
  const id = o.vertex(d[0], d[1], d[2]);
  o.quadIdx(ia, ib, ic, id);
}

/** Two mustard chevrons on each Rim pad, pointing at the building (03 §8.5). */
function padChevrons(o: MeshBuilder): void {
  const y = 0.006;
  const w = 0.2;
  o.color(ROLE.logistics).extra(0.1);
  for (const b of RIM_BUILDINGS) {
    const cx = (b.x0 + b.x1 + 1) / 2;
    for (const zApex of [-0.75, -0.2]) {
      const zArm = zApex + 0.5;
      for (const side of [-1, 1]) {
        const ax = cx, bx = cx + side * 1.1;
        flatQuad(o, y, [ax, bx, bx, ax], [zApex, zArm, zArm + w, zApex + w]);
      }
    }
  }
}
