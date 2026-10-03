// Scope floor (INT-11) and remesh triggers (RENDER-4): the floor and everything below it render as a sealed band
// with the Co-op sign, and only flags the mesher reads bump chunk versions.
import { describe, expect, it } from 'vitest';
import { CHUNK, MINE_W, MVP_SEAL_ROW } from '../../src/shared/canon';
import { F, T, mineralCode } from '../../src/shared/types';
import { CHUNKS_X, MESH_FLAGS, TerrainGrid } from '../../src/terrain/grid';
import { revealAround } from '../../src/pod/sense';
import { generateWorld } from '../../src/terrain/generate';
import { MeshBuilder } from '../../src/render/terrain/meshBuilder';
import { ChunkMesher, FLOOR_SIGN_LINES, FRONT_Z, type MesherOptions } from '../../src/render/terrain/mesher';
import { GLYPH_ADVANCE, glyphRects, textWidthPx } from '../../src/render/terrain/signFont';

const OPTS: MesherOptions = { floorRow: MVP_SEAL_ROW, lodeVisible: () => true, hulls: false };

function solidGrid(code: number = T.DIRT): TerrainGrid {
  const g = new TerrainGrid(99);
  g.terrain.fill(code);
  return g;
}

function mesh(g: TerrainGrid, cx: number, cy: number, opts: MesherOptions = OPTS): MeshBuilder {
  return new ChunkMesher().mesh(g, cx, cy, opts, new MeshBuilder(64, 64));
}

function bytes(b: MeshBuilder): number[] {
  return [...b.pos.subarray(0, b.vcount * 3), ...b.col.subarray(0, b.vcount * 4), ...b.ext.subarray(0, b.vcount * 4)];
}

describe('scope floor (INT-11)', () => {
  const floorChunk = MVP_SEAL_ROW / CHUNK;

  it('draws nothing generated below the floor: ores, magma and caverns vanish into the sealed band', () => {
    const plain = solidGrid();
    const busy = solidGrid();
    for (let r = MVP_SEAL_ROW + 1; r < MVP_SEAL_ROW + CHUNK; r++) {
      busy.set(4, r, mineralCode(5));
      busy.set(9, r, T.MAGMA);
      busy.set(12, r, T.AIR);
    }
    const a = mesh(plain, 0, floorChunk);
    const b = mesh(busy, 0, floorChunk);
    expect(bytes(b)).toEqual(bytes(a));
    expect(b.lights).toEqual([]);
    expect(b.glows).toEqual([]);
  });

  it('meshes sealed rows as one merged front quad per chunk row plus seams', () => {
    const g = solidGrid();
    const below = mesh(g, 1, floorChunk + 1);
    // 16 rows × (front + course seam + 4 staggered joints) quads.
    expect(below.triangles).toBe(CHUNK * (1 + 1 + CHUNK / 4) * 2);
    for (let v = 0; v < below.vcount; v++) expect(below.pos[v * 3 + 2]).toBeGreaterThanOrEqual(FRONT_Z - 1e-6);
  });

  it('caps the floor with a hazard band and posts the Co-op sign every 8 columns under the 2,000-triangle cap', () => {
    const g = solidGrid();
    for (let x = 0; x < MINE_W; x++) g.set(x, MVP_SEAL_ROW - 1, T.AIR);
    for (let cx = 0; cx < CHUNKS_X; cx++) {
      const b = mesh(g, cx, floorChunk);
      expect(b.triangles).toBeLessThanOrEqual(2000);
    }
    const withSign = mesh(g, 0, floorChunk).triangles;
    // The same chunk without a floor is plain rock: the cap row adds its band, rivets and two signs.
    const rock = mesh(g, 0, floorChunk, { ...OPTS, floorRow: 10_000 }).triangles;
    expect(withSign).toBeGreaterThan(rock + 400);
  });

  it('closes a shaft dug down to the floor with the floor top face', () => {
    const g = solidGrid();
    for (let r = MVP_SEAL_ROW - 6; r < MVP_SEAL_ROW + 2; r++) g.set(20, r, T.AIR);
    const b = mesh(g, 1, floorChunk);
    let topFaces = 0;
    for (let v = 0; v < b.vcount; v++) if (b.nrm[v * 4 + 1] > 100 && Math.abs(b.pos[v * 3 + 1] + MVP_SEAL_ROW) < 1e-6) topFaces++;
    expect(topFaces).toBeGreaterThanOrEqual(4);
  });
});

describe('sign font', () => {
  it('covers every lit pixel of each sign glyph exactly once with greedy rectangles', () => {
    const rows = ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'];
    const rects = glyphRects(rows);
    const cover = new Uint8Array(35);
    for (let i = 0; i < rects.length; i += 4) {
      for (let y = rects[i + 1]; y < rects[i + 1] + rects[i + 3]; y++) for (let x = rects[i]; x < rects[i] + rects[i + 2]; x++) cover[y * 5 + x]++;
    }
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) expect(cover[y * 5 + x]).toBe(rows[y][x] === '#' ? 1 : 0);
    expect(rects.length / 4).toBeLessThan(12);
  });

  it('measures lines with one pixel of spacing between glyphs', () => {
    expect(textWidthPx('')).toBe(0);
    expect(textWidthPx('CO-OP')).toBe(5 * GLYPH_ADVANCE - 1);
    expect(Math.max(...FLOOR_SIGN_LINES.map(textWidthPx))).toBe(textWidthPx('DRILLING RIGHTS'));
  });
});

describe('remesh triggers (RENDER-4)', () => {
  it('leaves chunk versions alone when the pod charts fresh ground, but bumps them for revealed methane', () => {
    const g = generateWorld(7).grid;
    const before = Uint32Array.from(g.chunkVersion);
    const v0 = g.version;
    revealAround(g, 20, 60);
    g.markDug(20, 60);
    expect(Array.from(g.chunkVersion)).toEqual(Array.from(before));
    expect(g.version).toBeGreaterThan(v0);
    g.setFlag(20, 60, F.REVEALED);
    expect(Array.from(g.chunkVersion)).not.toEqual(Array.from(before));
  });

  it('meshes identically whatever SEEN, CHARTED and DUG say (only MESH_FLAGS feed the mesher)', () => {
    const g = generateWorld(11).grid;
    const cy = 3;
    const plain = bytes(mesh(g, 1, cy, { ...OPTS, floorRow: 10_000 }));
    for (let r = cy * CHUNK - 1; r <= (cy + 1) * CHUNK; r++) {
      for (let x = CHUNK - 1; x <= 2 * CHUNK; x++) g.setFlag(x, r, (F.SEEN | F.CHARTED | F.DUG) & ~MESH_FLAGS);
    }
    expect(bytes(mesh(g, 1, cy, { ...OPTS, floorRow: 10_000 }))).toEqual(plain);
  });
});
