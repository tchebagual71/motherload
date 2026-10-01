// Belt Mk I paths on the Yard (02 §2.1, 03 §8.6–8.7): mustard rails on a plum deck, chevrons that
// scroll at the constant 1 tile/s (canon §3.11), items riding the centre line. A path is a chain of
// 1×1 tiles; corners turn on a quarter arc so items and chevrons stay continuous.
import type { Vector3 } from 'three';
import { BELT_SPEED_TILES_PER_S } from '../../shared/canon';
import { ROLE } from '../palette';
import { GeometryBuilder, at, box, chamferBox } from './kit';

/** Travel direction on the Yard plane: E +x, W −x, N −z (away from the Rim), S +z (toward it). */
export type BeltDir = 'E' | 'W' | 'N' | 'S';
const DIR: Record<BeltDir, readonly [number, number]> = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] };

export interface BeltTileSpec {
  /** Yard column (tile spans x .. x + 1). */
  x: number;
  /** Yard row k ≥ 1 (tile spans z ∈ [−1−k, −k]). */
  row: number;
  /** Direction items leave this tile. */
  out: BeltDir;
}

interface Tile {
  cx: number;
  cz: number;
  inX: number;
  inZ: number;
  outX: number;
  outZ: number;
  corner: boolean;
}

export const BELT_DECK_TOP = 0.13;

export class BeltPath {
  private readonly tiles: Tile[];
  /** Length in tiles (each tile takes 1 s at Mk I speed, straight or corner). */
  readonly length: number;

  constructor(specs: readonly BeltTileSpec[]) {
    if (specs.length === 0) throw new Error('BeltPath needs at least one tile');
    this.tiles = specs.map((s, i) => {
      const [outX, outZ] = DIR[s.out];
      const [inX, inZ] = DIR[i === 0 ? s.out : specs[i - 1].out];
      return { cx: s.x + 0.5, cz: -s.row - 0.5, inX, inZ, outX, outZ, corner: inX !== outX || inZ !== outZ };
    });
    this.length = this.tiles.length;
  }

  /** Point on the centre line at distance s ∈ [0, length) tiles (y = 0), and the unit travel direction. */
  sample(s: number, pos: Vector3, dir: Vector3): void {
    const clamped = Math.max(0, Math.min(this.length - 1e-6, s));
    const i = Math.floor(clamped);
    const f = clamped - i;
    const t = this.tiles[i];
    if (!t.corner) {
      pos.set(t.cx + t.outX * (f - 0.5), 0, t.cz + t.outZ * (f - 0.5));
      dir.set(t.outX, 0, t.outZ);
      return;
    }
    // Quarter arc around the tile corner shared by the entry and exit edges, radius 0.5.
    const kx = t.cx + 0.5 * (t.outX - t.inX);
    const kz = t.cz + 0.5 * (t.outZ - t.inZ);
    const a = f * (Math.PI / 2);
    const c = Math.cos(a), sn = Math.sin(a);
    pos.set(kx + 0.5 * (-t.outX * c + t.inX * sn), 0, kz + 0.5 * (-t.outZ * c + t.inZ * sn));
    dir.set(t.outX * sn + t.inX * c, 0, t.outZ * sn + t.inZ * c).normalize();
  }

  /** Distance travelled along the path after `timeMs` at belt speed, wrapped with `offset`. */
  phase(timeMs: number, offset: number): number {
    const s = ((timeMs / 1000) * BELT_SPEED_TILES_PER_S + offset) % this.length;
    return s < 0 ? s + this.length : s;
  }

  /** Static deck + rails into `solid` (merged with the caller's other static geometry). */
  addGeometry(solid: GeometryBuilder): void {
    const deck = ROLE.logisticsDeck;
    const rail = ROLE.logistics;
    for (const t of this.tiles) {
      if (!t.corner) {
        const along = t.outX !== 0;
        const ry = along ? 0 : Math.PI / 2;
        solid.add(box(1.0, 0.1, 0.8), deck, at(t.cx, BELT_DECK_TOP - 0.05, t.cz, 0, ry, 0));
        for (const side of [-1, 1]) {
          const ox = along ? 0 : side * 0.43;
          const oz = along ? side * 0.43 : 0;
          solid.add(chamferBox(1.0, 0.16, 0.1, 0.035), rail, at(t.cx + ox, 0.1, t.cz + oz, 0, ry, 0));
        }
        continue;
      }
      solid.add(box(1.0, 0.1, 1.0), deck, at(t.cx, BELT_DECK_TOP - 0.05, t.cz));
      // Rails on the two outer edges (opposite the entry and the exit) and a post at the inner corner.
      solid.add(chamferBox(1.0, 0.16, 0.1, 0.035), rail, at(t.cx + t.inX * 0.45, 0.1, t.cz + t.inZ * 0.45, 0, t.inX !== 0 ? Math.PI / 2 : 0, 0));
      solid.add(chamferBox(1.0, 0.16, 0.1, 0.035), rail, at(t.cx - t.outX * 0.45, 0.1, t.cz - t.outZ * 0.45, 0, t.outX !== 0 ? Math.PI / 2 : 0, 0));
      const kx = t.cx + 0.5 * (t.outX - t.inX), kz = t.cz + 0.5 * (t.outZ - t.inZ);
      solid.add(chamferBox(0.12, 0.18, 0.12, 0.04), rail, at(kx - 0.06 * (t.outX - t.inX), 0.1, kz - 0.06 * (t.outZ - t.inZ)));
    }
  }
}

/** A flat chevron pointing +x, lying on the deck (local origin at its centre). */
export function chevronGeometry(): GeometryBuilder {
  const g = new GeometryBuilder();
  for (const side of [-1, 1]) g.add(box(0.24, 0.03, 0.07), ROLE.chevron, at(-0.02, 0, side * 0.08, 0, side * 0.62, 0));
  return g;
}
