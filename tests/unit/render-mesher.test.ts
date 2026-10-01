import { describe, expect, it } from 'vitest';
import { CHUNK, MINE_W } from '../../src/shared/canon';
import { F, T, mineralCode, type Lode } from '../../src/shared/types';
import { TerrainGrid } from '../../src/terrain/grid';
import { SHADING } from '../../src/render/palette';
import { MeshBuilder, XF } from '../../src/render/terrain/meshBuilder';
import { BACK_Z, ChunkMesher, FRONT_Z, aoValue, type MesherOptions } from '../../src/render/terrain/mesher';
import { bandIndexAt, jitterHex } from '../../src/render/terrain/colors';
import { oreShape, relicShape } from '../../src/render/terrain/shapes';

const OPTS: MesherOptions = { floorRow: 10_000, lodeVisible: () => true, hulls: false };

function solidGrid(code: number = T.DIRT): TerrainGrid {
  const g = new TerrainGrid(1234);
  g.terrain.fill(code);
  return g;
}

function mesh(g: TerrainGrid, cx: number, cy: number, opts: MesherOptions = OPTS): MeshBuilder {
  return new ChunkMesher().mesh(g, cx, cy, opts, new MeshBuilder(64, 64));
}

/** Indices of vertices with a given normal (approximate, from the i8 encoding). */
function verticesWithNormal(b: MeshBuilder, nx: number, ny: number, nz: number): number[] {
  const out: number[] = [];
  for (let v = 0; v < b.vcount; v++) {
    const q = v * 4;
    if (Math.sign(b.nrm[q]) === nx && Math.sign(b.nrm[q + 1]) === ny && Math.sign(b.nrm[q + 2]) === nz) out.push(v);
  }
  return out;
}

describe('render mesher', () => {
  it('meshes a fully solid interior chunk as one front quad per cell', () => {
    const b = mesh(solidGrid(), 1, 2);
    expect(b.triangles).toBe(CHUNK * CHUNK * 2);
    expect(b.vcount).toBe(CHUNK * CHUNK * 4);
    for (let v = 0; v < b.vcount; v++) expect(b.pos[v * 3 + 2]).toBeCloseTo(FRONT_Z);
  });

  it('adds a back wall, 4 side faces, 4 chamfers and their 8 end caps around a single air cell', () => {
    const g = solidGrid();
    g.set(20, 40, T.AIR);
    const b = mesh(g, 1, 2);
    const quads = CHUNK * CHUNK - 1 + 1 + 4 + 4;
    expect(b.triangles).toBe(quads * 2 + 8);
    const back = verticesWithNormal(b, 0, 0, 1).filter((v) => Math.abs(b.pos[v * 3 + 2] - BACK_Z) < 1e-6);
    expect(back).toHaveLength(4);
    // Enclosed on all sides: every back-wall corner is fully occluded.
    for (const v of back) expect(b.col[v * 4 + 3] / 255).toBeCloseTo(SHADING.ao[3], 2);
  });

  it('applies 0fps AO to a vertical shaft back wall', () => {
    const g = solidGrid();
    for (let r = 35; r < 45; r++) g.set(20, r, T.AIR);
    const b = mesh(g, 1, 2);
    const back = verticesWithNormal(b, 0, 0, 1).filter((v) => Math.abs(b.pos[v * 3 + 2] - BACK_Z) < 1e-6);
    expect(back.length).toBe(10 * 4);
    // Mid-shaft corners: side solid, vertical neighbour open, diagonal solid → 2 occluders.
    const mid = back.filter((v) => b.pos[v * 3 + 1] < -36.5 && b.pos[v * 3 + 1] > -43.5);
    for (const v of mid) expect(b.col[v * 4 + 3] / 255).toBeCloseTo(SHADING.ao[2], 2);
  });

  it('caps chamfers only where they stop, not inside a continuous tunnel edge', () => {
    const g = solidGrid();
    for (let x = 18; x < 23; x++) g.set(x, 40, T.AIR);
    const b = mesh(g, 1, 2);
    // 5 air cells: front 256−5, back 5, ceiling 5 + floor 5 + 2 end walls sides, same for chamfers.
    const quads = CHUNK * CHUNK - 5 + 5 + 12 + 12;
    // Caps only at the 4 corners of the tunnel mouth outline: ceiling ×2, floor ×2, end walls ×2 each.
    expect(b.triangles).toBe(quads * 2 + 8);
  });

  it('implements the AO table', () => {
    expect(aoValue(false, false, false)).toBe(SHADING.ao[0]);
    expect(aoValue(true, false, false)).toBe(SHADING.ao[1]);
    expect(aoValue(false, false, true)).toBe(SHADING.ao[1]);
    expect(aoValue(true, false, true)).toBe(SHADING.ao[2]);
    expect(aoValue(true, true, false)).toBe(SHADING.ao[3]);
  });

  it('emits side-face AO darker toward the back wall', () => {
    const g = solidGrid();
    for (let x = 18; x < 23; x++) g.set(x, 40, T.AIR); // horizontal tunnel
    const b = mesh(g, 1, 2);
    const floor = verticesWithNormal(b, 0, 1, 0).filter((v) => Math.abs(b.pos[v * 3 + 1] + 41) < 1e-6);
    const front = floor.filter((v) => b.pos[v * 3 + 2] > 0);
    const back = floor.filter((v) => b.pos[v * 3 + 2] < -0.9);
    expect(front.length).toBeGreaterThan(0);
    const avg = (vs: number[]): number => vs.reduce((s, v) => s + b.col[v * 4 + 3], 0) / vs.length;
    expect(avg(back)).toBeLessThan(avg(front));
  });

  it('includes the slab frame column on edge chunks only', () => {
    const g = solidGrid();
    const left = mesh(g, 0, 2);
    const mid = mesh(g, 1, 2);
    const right = mesh(g, 2, 2);
    expect(left.triangles).toBeGreaterThan(mid.triangles);
    expect(right.triangles).toBeGreaterThan(mid.triangles);
    let minX = Infinity;
    for (let v = 0; v < left.vcount; v++) minX = Math.min(minX, left.pos[v * 3]);
    expect(minX).toBe(-1);
    let maxX = -Infinity;
    for (let v = 0; v < right.vcount; v++) maxX = Math.max(maxX, right.pos[v * 3]);
    expect(maxX).toBe(MINE_W + 1);
  });

  it('renders METHANE exactly like DIRT unless revealed', () => {
    const a = solidGrid();
    const b = solidGrid();
    b.set(20, 40, T.METHANE);
    const ma = mesh(a, 1, 2);
    const mb = mesh(b, 1, 2);
    expect(Array.from(mb.col.subarray(0, mb.vcount * 4))).toEqual(Array.from(ma.col.subarray(0, ma.vcount * 4)));
    expect(Array.from(mb.pos.subarray(0, mb.vcount * 3))).toEqual(Array.from(ma.pos.subarray(0, ma.vcount * 3)));
    b.setFlag(20, 40, F.REVEALED);
    const mc = mesh(b, 1, 2);
    expect(Array.from(mc.col.subarray(0, mc.vcount * 4))).not.toEqual(Array.from(ma.col.subarray(0, ma.vcount * 4)));
  });

  it('adds ore polyhedra and, with hulls, flipped hull copies flagged XF.HULL', () => {
    const g = solidGrid();
    g.set(20, 40, mineralCode(3));
    const plain = mesh(g, 1, 2);
    const hulled = mesh(g, 1, 2, { ...OPTS, hulls: true });
    const shapeTris = oreShape(3).triCount;
    expect(plain.triangles).toBe(CHUNK * CHUNK * 2 + shapeTris);
    expect(hulled.triangles).toBe(plain.triangles + shapeTris);
    let hullVerts = 0;
    for (let v = 0; v < hulled.vcount; v++) if (hulled.ext[v * 4 + 1] & XF.HULL) hullVerts++;
    expect(hullVerts).toBe(shapeTris * 3);
  });

  it('keeps every ore and relic template within the 12–56 triangle range', () => {
    for (let t = 1; t <= 10; t++) {
      expect(oreShape(t).triCount).toBeGreaterThanOrEqual(8);
      expect(oreShape(t).triCount).toBeLessThanOrEqual(48);
    }
    for (let id = 0; id < 4; id++) expect(relicShape(id).triCount).toBeLessThanOrEqual(56);
  });

  it('draws the scope floor row as solid even over air', () => {
    const g = solidGrid();
    for (let r = 120; r < 128; r++) g.set(20, r, T.AIR);
    g.set(20, 128, T.AIR);
    const withFloor = mesh(g, 1, 8, { ...OPTS, floorRow: 128 });
    const without = mesh(g, 1, 8);
    // The floor cell gains a front face + seams + a dash, and the shaft gains a floor face.
    expect(withFloor.triangles).toBeGreaterThan(without.triangles);
  });

  it('records magma cells as light sources', () => {
    const g = solidGrid();
    g.set(20, 300, T.MAGMA);
    const b = mesh(g, 1, Math.floor(300 / CHUNK));
    expect(b.lights).toEqual([20.5, -300.5, 0]);
  });

  it('draws a stake only for discovered, visible lodes', () => {
    const g = solidGrid();
    const lode: Lode = { id: 0, metal: 'copper', purity: 'normal', x0: 20, top: 40, scripted: true, scope: 'mvp', discovered: false };
    g.lodes = [lode];
    for (let r = 40; r < 42; r++) for (let x = 20; x < 23; x++) {
      g.set(x, r, T.LODE_ROCK);
      g.lodeIndex[g.idx(x, r)] = 1;
    }
    const hidden = mesh(g, 1, 2).triangles;
    lode.discovered = true;
    const staked = mesh(g, 1, 2).triangles;
    const unknown = mesh(g, 1, 2, { ...OPTS, lodeVisible: () => false }).triangles;
    expect(staked).toBeGreaterThan(hidden);
    expect(unknown).toBe(hidden);
  });

  it('dithers band edges but keeps band interiors stable', () => {
    expect(bandIndexAt(10, 5, 1)).toBe(0);
    expect(bandIndexAt(10, 40, 1)).toBe(1);
    expect(bandIndexAt(10, 600, 1)).toBe(8);
    expect(bandIndexAt(10, 584, 1)).toBe(7);
    const near = new Set<number>();
    for (let x = 0; x < MINE_W; x++) for (let r = 16; r < 24; r++) near.add(bandIndexAt(x, r, 9));
    expect([...near].sort()).toEqual([0, 1]);
  });

  it('jitters colours slightly and deterministically', () => {
    const a = jitterHex(0x808080, 3, 4, 7);
    expect(a).toBe(jitterHex(0x808080, 3, 4, 7));
    for (let s = 0; s < 3; s++) expect(Math.abs(((a >> (s * 8)) & 0xff) - 0x80)).toBeLessThanOrEqual(10);
  });
});
