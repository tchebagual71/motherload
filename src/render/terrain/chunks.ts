// Pooled chunk meshes for the mine slab (04 §5.1–5.2): ≤ visible + 1 margin chunks resident, remeshed
// when TerrainGrid.chunkVersion moves (budgeted by ChunkScheduler), uploaded with update ranges.
import { BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3, type Color, type Material, type Vector4 } from 'three';
import { CHUNK } from '../../shared/canon';
import { CHUNKS_X, type TerrainGrid } from '../../terrain/grid';
import { LIGHT } from '../palette';
import { MeshBuilder } from './meshBuilder';
import { ChunkMesher, chunkCells, type MesherOptions } from './mesher';
import { ChunkScheduler, type CellRect } from './schedule';

const MAGMA_LIGHT_RADIUS = 2;

interface Slot {
  mesh: Mesh;
  geometry: BufferGeometry;
  ci: number;
  vcap: number;
  icap: number;
  lights: number[];
  glows: number[];
}

function nextPow2(n: number): number {
  let c = 1024;
  while (c < n) c *= 2;
  return c;
}

export class ChunkMeshes {
  readonly root = new Group();
  readonly planner = new ChunkScheduler();
  /** Meshes rebuilt during the last update (for perf counters). */
  lastMeshed = 0;
  private readonly slots: Slot[] = [];
  private readonly free: Slot[] = [];
  private readonly byChunk = new Map<number, Slot>();
  private readonly mesher = new ChunkMesher();
  private readonly builder = new MeshBuilder(8192, 16384);
  private material: Material;

  constructor(material: Material) {
    this.material = material;
    this.root.name = 'mine';
    this.root.matrixAutoUpdate = false;
    // One pooled mesh up front so the terrain program can be precompiled before any chunk exists.
    this.free.push(this.createSlot(1024, 2048));
  }

  setMaterial(m: Material): void {
    this.material = m;
    for (const s of this.slots) s.mesh.material = m;
  }

  /** All pooled meshes (resident or free), e.g. for precompiling. */
  get meshes(): readonly Mesh[] {
    return this.slots.map((s) => s.mesh);
  }

  get residentCount(): number {
    return this.byChunk.size;
  }

  /**
   * Evict, schedule and remesh. `view` = strictly visible cells; the pod's cell gets near-pod priority.
   * Returns the number of chunks meshed.
   */
  update(grid: TerrainGrid, view: CellRect, podX: number, podR: number, budget: number, nearBudget: number, opts: MesherOptions): number {
    const plan = this.planner.update(grid.chunkVersion, view, podX, podR, budget, nearBudget);
    for (const ci of plan.evict) this.release(ci);
    for (const ci of plan.mesh) {
      const version = grid.chunkVersion[ci];
      this.mesher.mesh(grid, ci % CHUNKS_X, Math.floor(ci / CHUNKS_X), opts, this.builder);
      this.upload(ci, this.builder);
      this.planner.meshed(ci, version);
    }
    this.lastMeshed = plan.mesh.length;
    return plan.mesh.length;
  }

  /** Force-remesh every chunk overlapping a cell rect (e.g. a lode's 3×2 when it is discovered). */
  forceCells(x0: number, r0: number, x1: number, r1: number): void {
    for (let cy = Math.floor(r0 / CHUNK); cy <= Math.floor(r1 / CHUNK); cy++) {
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) this.planner.force(cy * CHUNKS_X + cx);
    }
  }

  forceAll(): void {
    this.planner.forceAll();
  }

  /** Release every chunk (new world or grid); visible ones are remeshed immediately next update. */
  reset(): void {
    for (const ci of [...this.byChunk.keys()]) this.release(ci);
    this.planner.reset();
  }

  /** Mark chunks around a blast as near-pod priority. */
  markHot(x0: number, r0: number, x1: number, r1: number): void {
    this.planner.markHot(x0, r0, x1, r1);
  }

  /**
   * Fill up to `max` lamp slots with the Magma glows nearest to (px, py) (03 §8.8: Magma r 2).
   * `start` lamps are already used (e.g. the thrust flame). Returns the new lamp count.
   */
  collectLights(px: number, py: number, start: number, max: number, pos: Vector4[], col: Color[], magma: Color): number {
    if (start >= max) return start;
    let count = start;
    const reach = 14 * 14;
    for (const slot of this.byChunk.values()) {
      const l = slot.lights;
      for (let i = 0; i < l.length; i += 3) {
        const dx = l[i] - px;
        const dy = l[i + 1] - py;
        const d = dx * dx + dy * dy;
        if (d > reach) continue;
        // z holds the squared distance as a sort key (the shader ignores z).
        if (count < max) {
          pos[count].set(l[i], l[i + 1], d, MAGMA_LIGHT_RADIUS);
          col[count].copy(magma);
          count++;
          continue;
        }
        // Replace the farthest collected magma light if this one is nearer.
        let worst = start;
        for (let k = start + 1; k < count; k++) if (pos[k].z > pos[worst].z) worst = k;
        if (pos[worst].z > d) pos[worst].set(l[i], l[i + 1], d, MAGMA_LIGHT_RADIUS);
      }
    }
    return count;
  }

  /** Visit every glow source of resident chunks inside a cell rect (x, y, colour, emissive). */
  forEachGlow(view: CellRect, fn: (x: number, y: number, hex: number, emissive: number) => void): void {
    for (const slot of this.byChunk.values()) {
      const g = slot.glows;
      for (let i = 0; i < g.length; i += 4) {
        const x = g[i];
        const r = -g[i + 1];
        if (x < view.x0 - 1 || x > view.x1 + 1 || r < view.r0 - 1 || r > view.r1 + 1) continue;
        fn(x, g[i + 1], g[i + 2], g[i + 3]);
      }
    }
  }

  dispose(): void {
    for (const s of this.slots) s.geometry.dispose();
    this.slots.length = 0;
    this.free.length = 0;
    this.byChunk.clear();
  }

  private release(ci: number): void {
    const slot = this.byChunk.get(ci);
    if (!slot) return;
    this.byChunk.delete(ci);
    slot.ci = -1;
    slot.mesh.visible = false;
    slot.lights.length = 0;
    slot.glows.length = 0;
    this.free.push(slot);
  }

  private createSlot(vcap: number, icap: number): Slot {
    const geometry = this.createGeometry(vcap, icap);
    const mesh = new Mesh(geometry, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.name = 'chunk';
    this.root.add(mesh);
    const slot: Slot = { mesh, geometry, ci: -1, vcap, icap, lights: [], glows: [] };
    this.slots.push(slot);
    return slot;
  }

  private createGeometry(vcap: number, icap: number): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(vcap * 3), 3));
    g.setAttribute('normal', new BufferAttribute(new Int8Array(vcap * 4), 4, true));
    g.setAttribute('hfColor', new BufferAttribute(new Uint8Array(vcap * 4), 4, true));
    g.setAttribute('hfExtra', new BufferAttribute(new Uint8Array(vcap * 4), 4, true));
    g.setIndex(new BufferAttribute(new Uint32Array(icap), 1));
    g.boundingSphere = new Sphere(new Vector3(), 1);
    g.setDrawRange(0, 0);
    return g;
  }

  private acquire(ci: number, vcount: number, icount: number): Slot {
    let slot = this.byChunk.get(ci);
    if (!slot) {
      slot = this.free.pop() ?? this.createSlot(nextPow2(vcount), nextPow2(icount));
      slot.ci = ci;
      this.byChunk.set(ci, slot);
    }
    if (slot.vcap < vcount || slot.icap < icount) {
      // Grow: a new geometry frees the old GPU buffers on dispose.
      slot.geometry.dispose();
      slot.vcap = nextPow2(Math.max(vcount, slot.vcap));
      slot.icap = nextPow2(Math.max(icount, slot.icap));
      slot.geometry = this.createGeometry(slot.vcap, slot.icap);
      slot.mesh.geometry = slot.geometry;
    }
    return slot;
  }

  private upload(ci: number, b: MeshBuilder): void {
    const slot = this.acquire(ci, b.vcount, b.icount);
    const g = slot.geometry;
    copyInto(g.getAttribute('position') as BufferAttribute, b.pos, b.vcount * 3);
    copyInto(g.getAttribute('normal') as BufferAttribute, b.nrm, b.vcount * 4);
    copyInto(g.getAttribute('hfColor') as BufferAttribute, b.col, b.vcount * 4);
    copyInto(g.getAttribute('hfExtra') as BufferAttribute, b.ext, b.vcount * 4);
    copyInto(g.getIndex() as BufferAttribute, b.idx, b.icount);
    g.setDrawRange(0, b.icount);
    const { x0, x1, r0, r1 } = chunkCells(ci % CHUNKS_X, Math.floor(ci / CHUNKS_X));
    const sphere = g.boundingSphere as Sphere;
    sphere.center.set((x0 + x1) / 2, -(r0 + r1) / 2, 0);
    sphere.radius = Math.sqrt((x1 - x0 + 2) ** 2 + (r1 - r0 + 2) ** 2) / 2 + 1;
    slot.lights.length = 0;
    for (const v of b.lights) slot.lights.push(v);
    slot.glows.length = 0;
    for (const v of b.glows) slot.glows.push(v);
    slot.mesh.visible = b.icount > 0;
  }
}

/** A static BufferGeometry (same attribute layout as chunks) from a builder's contents. */
export function geometryFromBuilder(b: MeshBuilder): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(b.pos.slice(0, b.vcount * 3), 3));
  g.setAttribute('normal', new BufferAttribute(b.nrm.slice(0, b.vcount * 4), 4, true));
  g.setAttribute('hfColor', new BufferAttribute(b.col.slice(0, b.vcount * 4), 4, true));
  g.setAttribute('hfExtra', new BufferAttribute(b.ext.slice(0, b.vcount * 4), 4, true));
  g.setIndex(new BufferAttribute(b.idx.slice(0, b.icount), 1));
  g.computeBoundingSphere();
  return g;
}

function copyInto(attr: BufferAttribute, src: ArrayLike<number> & { subarray(a: number, b: number): ArrayLike<number> }, n: number): void {
  const dst = attr.array as Float32Array | Int8Array | Uint8Array | Uint32Array;
  dst.set(src.subarray(0, n) as never);
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n);
  attr.needsUpdate = true;
}

/** Light radius used for thrust-flame and magma lamps (03 §8.8), exported for the renderer. */
export const LAMP_RADII = { magma: MAGMA_LIGHT_RADIUS, thrust: 1.2, lamp: 3.5, bubble: LIGHT.bubbleRadius } as const;
