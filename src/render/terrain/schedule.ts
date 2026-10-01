// Chunk residency and remesh scheduling (04 §5.2, canon §3.14). Pure: works on chunk indices only.
// - Resident = chunks intersecting the view (+1 chunk margin); others are evicted (their mesh pooled).
// - Remesh when TerrainGrid.chunkVersion moved, the chunk is new, or it was force-marked.
// - Never-meshed chunks inside the strict view are meshed immediately (no holes on boot/teleport);
//   otherwise ≤ `budget` per frame (nearest first) + ≤ `nearBudget` touching the pod's 3×3 or a blast.
import { CHUNK } from '../../shared/canon';
import { CHUNKS_X, CHUNKS_Y } from '../../terrain/grid';

export const CHUNK_COUNT = CHUNKS_X * CHUNKS_Y;
const NEVER = -1;

/** Cell-space rectangle [x0, x1) × [r0, r1). */
export interface CellRect {
  x0: number;
  x1: number;
  r0: number;
  r1: number;
}

export interface ChunkRect {
  cx0: number;
  cx1: number;
  cy0: number;
  cy1: number;
}

export function chunkRectOf(cells: CellRect, marginChunks: number, out: ChunkRect): ChunkRect {
  out.cx0 = Math.max(0, Math.floor(cells.x0 / CHUNK) - marginChunks);
  out.cx1 = Math.min(CHUNKS_X - 1, Math.floor((cells.x1 - 1) / CHUNK) + marginChunks);
  out.cy0 = Math.max(0, Math.floor(cells.r0 / CHUNK) - marginChunks);
  out.cy1 = Math.min(CHUNKS_Y - 1, Math.floor((cells.r1 - 1) / CHUNK) + marginChunks);
  return out;
}

function inRect(cx: number, cy: number, r: ChunkRect): boolean {
  return cx >= r.cx0 && cx <= r.cx1 && cy >= r.cy0 && cy <= r.cy1;
}

export interface SchedulePlan {
  /** Chunks to evict this frame. */
  readonly evict: number[];
  /** Chunks to (re)mesh this frame, in priority order. */
  readonly mesh: number[];
}

export class ChunkScheduler {
  /** Grid chunk version each resident chunk was meshed at (NEVER = not meshed). */
  readonly meshedVersion = new Int32Array(CHUNK_COUNT).fill(NEVER);
  readonly resident = new Uint8Array(CHUNK_COUNT);
  private readonly forced = new Uint8Array(CHUNK_COUNT);
  private readonly hot = new Uint8Array(CHUNK_COUNT);
  private readonly plan: SchedulePlan = { evict: [], mesh: [] };
  private readonly candidates: number[] = [];
  private readonly dist: Float64Array = new Float64Array(CHUNK_COUNT);
  private readonly strictRect: ChunkRect = { cx0: 0, cx1: 0, cy0: 0, cy1: 0 };
  private readonly keepRect: ChunkRect = { cx0: 0, cx1: 0, cy0: 0, cy1: 0 };
  private readonly byDistance = (a: number, b: number): number => this.dist[a] - this.dist[b];

  /** Force a remesh (e.g. a lode was discovered: no cell changed, but its stake must appear). */
  force(ci: number): void {
    if (ci >= 0 && ci < CHUNK_COUNT) this.forced[ci] = 1;
  }

  /** Forget all residency (new world or grid): everything visible is meshed from scratch. */
  reset(): void {
    this.resident.fill(0);
    this.meshedVersion.fill(NEVER);
    this.forced.fill(0);
  }

  /** Force every resident chunk (context restore, look/hull changes). */
  forceAll(): void {
    this.forced.fill(1);
  }

  /** Mark chunks covering a cell rect as near-pod priority for the next plan (blasts). */
  markHot(x0: number, r0: number, x1: number, r1: number): void {
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK));
    const cx1 = Math.min(CHUNKS_X - 1, Math.floor(x1 / CHUNK));
    const cy0 = Math.max(0, Math.floor(r0 / CHUNK));
    const cy1 = Math.min(CHUNKS_Y - 1, Math.floor(r1 / CHUNK));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.hot[cy * CHUNKS_X + cx] = 1;
  }

  /**
   * Decide evictions and remeshes. `view` is the strictly visible cell rect; `podX/podR` the pod's
   * cell (its 3×3 is near-pod priority). Call `meshed()` for each chunk actually meshed.
   */
  update(
    versions: Uint32Array,
    view: CellRect,
    podX: number,
    podR: number,
    budget: number,
    nearBudget: number,
  ): SchedulePlan {
    const plan = this.plan;
    plan.evict.length = 0;
    plan.mesh.length = 0;
    const strict = chunkRectOf(view, 0, this.strictRect);
    const keep = chunkRectOf(view, 1, this.keepRect);

    for (let ci = 0; ci < CHUNK_COUNT; ci++) {
      if (this.resident[ci] && !inRect(ci % CHUNKS_X, Math.floor(ci / CHUNKS_X), keep)) {
        this.resident[ci] = 0;
        this.meshedVersion[ci] = NEVER;
        plan.evict.push(ci);
      }
    }

    this.markHot(podX - 1, podR - 1, podX + 1, podR + 1);
    const cand = this.candidates;
    cand.length = 0;
    const vcx = (view.x0 + view.x1) / 2 / CHUNK;
    const vcy = (view.r0 + view.r1) / 2 / CHUNK;
    for (let cy = keep.cy0; cy <= keep.cy1; cy++) {
      for (let cx = keep.cx0; cx <= keep.cx1; cx++) {
        const ci = cy * CHUNKS_X + cx;
        this.resident[ci] = 1;
        const stale = this.meshedVersion[ci] === NEVER || this.meshedVersion[ci] !== (versions[ci] | 0) || this.forced[ci] === 1;
        if (!stale) continue;
        if (this.meshedVersion[ci] === NEVER && inRect(cx, cy, strict)) {
          plan.mesh.push(ci);
          continue;
        }
        const dx = cx + 0.5 - vcx;
        const dy = cy + 0.5 - vcy;
        this.dist[ci] = dx * dx + dy * dy;
        cand.push(ci);
      }
    }
    cand.sort(this.byDistance);
    let near = 0;
    let rest = 0;
    for (const ci of cand) {
      if (this.hot[ci] && near < nearBudget) {
        near++;
        plan.mesh.push(ci);
      } else if (rest < budget) {
        rest++;
        plan.mesh.push(ci);
      }
    }
    this.hot.fill(0);
    return plan;
  }

  /** Record that chunk `ci` now reflects grid version `version`. */
  meshed(ci: number, version: number): void {
    this.meshedVersion[ci] = version | 0;
    this.forced[ci] = 0;
  }
}
