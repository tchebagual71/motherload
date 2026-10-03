// The mine cell grid (48 × 608). PURE MODULE.
// Coordinates: column x ∈ [0, MINE_W), row r ∈ [0, MINE_H). Row 0 is the turf row directly under the Rim.
// World units: cell (x, r) spans x..x+1 horizontally and y = -(r+1)..-r vertically (y up, y = 0 at the Rim surface).
import { CHUNK, MINE_H, MINE_W } from '../shared/canon';
import { F, T, type Lode, type TerrainCode } from '../shared/types';

export const CHUNKS_X = Math.ceil(MINE_W / CHUNK); // 3
export const CHUNKS_Y = Math.ceil(MINE_H / CHUNK); // 38

/**
 * Cell flags the chunk mesher reads (render/terrain/mesher.ts: revealed methane tint). Only these bump
 * chunkVersion; SEEN/CHARTED/DUG feed the map and the sim, and a remesh would rebuild identical geometry.
 */
export const MESH_FLAGS = F.REVEALED;

export class TerrainGrid {
  readonly w = MINE_W;
  readonly h = MINE_H;
  readonly terrain: Uint8Array;
  readonly flags: Uint8Array;
  /** Factory mount id per cell (0 = none). Written only by the factory via World. */
  readonly mount: Uint16Array;
  /** Factory occupant id per cell (0 = none). Occupants block the pod. */
  readonly occupant: Uint16Array;
  lodes: Lode[] = [];
  /** Per-cell lode id + 1 (0 = not lode rock). */
  readonly lodeIndex: Uint8Array;
  /** Bumped per chunk whenever a cell in it changes; renderers remesh chunks whose version moved. */
  readonly chunkVersion: Uint32Array;
  /** Monotonic counter of all changes (cheap "anything changed?" check). */
  version = 0;
  seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const n = MINE_W * MINE_H;
    this.terrain = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    this.mount = new Uint16Array(n);
    this.occupant = new Uint16Array(n);
    this.lodeIndex = new Uint8Array(n);
    this.chunkVersion = new Uint32Array(CHUNKS_X * CHUNKS_Y);
  }

  inBounds(x: number, r: number): boolean {
    return x >= 0 && x < MINE_W && r >= 0 && r < MINE_H;
  }
  idx(x: number, r: number): number {
    return r * MINE_W + x;
  }
  /** Out-of-bounds columns/rows below the mine are an indestructible frame (HEARTSTONE); above row 0 is sky (AIR). */
  get(x: number, r: number): TerrainCode {
    if (r < 0) return T.AIR;
    if (x < 0 || x >= MINE_W || r >= MINE_H) return T.HEARTSTONE;
    return this.terrain[r * MINE_W + x];
  }
  set(x: number, r: number, code: TerrainCode): void {
    if (!this.inBounds(x, r)) return;
    const i = r * MINE_W + x;
    if (this.terrain[i] === code) return;
    this.terrain[i] = code;
    this.touch(x, r);
  }
  hasFlag(x: number, r: number, f: number): boolean {
    if (!this.inBounds(x, r)) return false;
    return (this.flags[r * MINE_W + x] & f) !== 0;
  }
  setFlag(x: number, r: number, f: number, on = true): void {
    if (!this.inBounds(x, r)) return;
    const i = r * MINE_W + x;
    const before = this.flags[i];
    const after = on ? before | f : before & ~f;
    if (after === before) return;
    this.flags[i] = after;
    if ((before ^ after) & MESH_FLAGS) this.touch(x, r);
    else this.version++;
  }
  lodeAt(x: number, r: number): Lode | null {
    if (!this.inBounds(x, r)) return null;
    const k = this.lodeIndex[r * MINE_W + x];
    return k ? this.lodes[k - 1] : null;
  }
  /** Mark a chunk (and neighbours if on an edge, for AO/bevels) dirty. */
  touch(x: number, r: number): void {
    this.version++;
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(r / CHUNK);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const nr = r + dy;
        const ncx = Math.floor(nx / CHUNK);
        const ncy = Math.floor(nr / CHUNK);
        if ((ncx !== cx || ncy !== cy || (dx === 0 && dy === 0)) && ncx >= 0 && ncx < CHUNKS_X && ncy >= 0 && ncy < CHUNKS_Y) {
          this.chunkVersion[ncy * CHUNKS_X + ncx]++;
        }
      }
    }
  }
  /** Is cell excavated or open air below the Rim (where underground ghosts may go)? */
  isOpen(x: number, r: number): boolean {
    return this.get(x, r) === T.AIR;
  }
  markDug(x: number, r: number): void {
    this.setFlag(x, r, F.DUG, true);
  }
}
