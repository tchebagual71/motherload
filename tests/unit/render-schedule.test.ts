import { describe, expect, it } from 'vitest';
import { T } from '../../src/shared/types';
import { CHUNKS_X, TerrainGrid } from '../../src/terrain/grid';
import { ChunkScheduler, chunkRectOf, type CellRect } from '../../src/render/terrain/schedule';

const VIEW: CellRect = { x0: 10, x1: 30, r0: 40, r1: 60 }; // chunks cx 0..1, cy 2..3

function dirtGrid(): TerrainGrid {
  const g = new TerrainGrid(1);
  g.terrain.fill(T.DIRT);
  return g;
}

function meshAll(s: ChunkScheduler, g: TerrainGrid, plan: { mesh: number[] }): void {
  for (const ci of plan.mesh) s.meshed(ci, g.chunkVersion[ci]);
}

describe('render chunk scheduler', () => {
  it('maps a view to chunks with margin', () => {
    const r = chunkRectOf(VIEW, 1, { cx0: 0, cx1: 0, cy0: 0, cy1: 0 });
    expect(r).toEqual({ cx0: 0, cx1: 2, cy0: 1, cy1: 4 });
  });

  it('meshes all strictly visible chunks on the first frame regardless of budget', () => {
    const g = new TerrainGrid(1);
    const s = new ChunkScheduler();
    const plan = s.update(g.chunkVersion, VIEW, 20, 50, 0, 0);
    // Strict view: cx 0..1 × cy 2..3 = 4 chunks, all mandatory.
    expect(plan.mesh.slice().sort((a, b) => a - b)).toEqual([2 * CHUNKS_X, 2 * CHUNKS_X + 1, 3 * CHUNKS_X, 3 * CHUNKS_X + 1]);
  });

  it('prefetches margin chunks within the budget, nearest first', () => {
    const g = new TerrainGrid(1);
    const s = new ChunkScheduler();
    meshAll(s, g, s.update(g.chunkVersion, VIEW, 20, 50, 0, 0));
    const plan = s.update(g.chunkVersion, VIEW, 20, 50, 2, 0);
    expect(plan.mesh).toHaveLength(2);
    meshAll(s, g, plan);
    let total = 6;
    for (let i = 0; i < 10; i++) {
      const p = s.update(g.chunkVersion, VIEW, 20, 50, 2, 0);
      total += p.mesh.length;
      meshAll(s, g, p);
    }
    expect(total).toBe(3 * 4); // keep rect: 3 × 4 chunks
  });

  it('remeshes only chunks whose version moved, near-pod first', () => {
    const g = dirtGrid();
    const s = new ChunkScheduler();
    for (let i = 0; i < 10; i++) meshAll(s, g, s.update(g.chunkVersion, VIEW, 20, 50, 2, 4));
    expect(s.update(g.chunkVersion, VIEW, 20, 50, 2, 4).mesh).toHaveLength(0);
    g.set(20, 50, T.AIR); // interior of chunk (1, 3)
    g.set(2, 70, T.AIR); // chunk (0, 4), margin
    const plan = s.update(g.chunkVersion, VIEW, 20, 50, 0, 4);
    expect(plan.mesh).toEqual([3 * CHUNKS_X + 1]);
    meshAll(s, g, plan);
    const later = s.update(g.chunkVersion, VIEW, 20, 50, 1, 4);
    expect(later.mesh).toEqual([4 * CHUNKS_X]);
  });

  it('evicts chunks that leave the keep rect and forces remesh on demand', () => {
    const g = new TerrainGrid(1);
    const s = new ChunkScheduler();
    for (let i = 0; i < 10; i++) meshAll(s, g, s.update(g.chunkVersion, VIEW, 20, 50, 2, 4));
    const far: CellRect = { x0: 10, x1: 30, r0: 400, r1: 420 };
    const plan = s.update(g.chunkVersion, far, 20, 410, 2, 4);
    expect(plan.evict.length).toBe(12);
    meshAll(s, g, plan);
    s.force(25 * CHUNKS_X + 1);
    const p2 = s.update(g.chunkVersion, far, 20, 410, 0, 0);
    expect(p2.mesh).not.toContain(25 * CHUNKS_X + 1);
    const p3 = s.update(g.chunkVersion, far, 20, 410, 12, 0);
    expect(p3.mesh).toContain(25 * CHUNKS_X + 1);
  });

  it('remeshes everything visible right away after a reset (new world)', () => {
    const g = dirtGrid();
    const s = new ChunkScheduler();
    for (let i = 0; i < 10; i++) meshAll(s, g, s.update(g.chunkVersion, VIEW, 20, 50, 2, 4));
    s.reset();
    expect(s.update(g.chunkVersion, VIEW, 20, 50, 0, 0).mesh).toHaveLength(4);
  });

  it('gives blast chunks the near-pod allowance', () => {
    const g = dirtGrid();
    const s = new ChunkScheduler();
    for (let i = 0; i < 10; i++) meshAll(s, g, s.update(g.chunkVersion, VIEW, 20, 50, 2, 4));
    g.set(2, 70, T.AIR);
    s.markHot(1, 69, 3, 71);
    expect(s.update(g.chunkVersion, VIEW, 20, 50, 0, 4).mesh).toEqual([4 * CHUNKS_X]);
  });
});
