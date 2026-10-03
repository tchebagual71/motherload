// A 5×7 bitmap font for signs built from slab geometry (03 §8.12 MVP: the r320 temporary Seal's "Co-op drilling
// rights end here" sign). Glyphs become greedy-merged rectangles, so letters are lit, outlined and pixel-snapped
// like the rock around them in both looks, with no texture. Pure.
import type { MeshBuilder } from './meshBuilder';

export const GLYPH_W = 5;
export const GLYPH_H = 7;
/** Advance per character in font pixels (glyph + 1 px of spacing). */
export const GLYPH_ADVANCE = GLYPH_W + 1;

const GLYPHS: Record<string, readonly string[]> = {
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

/** Greedy rectangles [x, y, w, h] (font px, y down from the glyph top) covering a glyph's lit pixels. */
export function glyphRects(rows: readonly string[]): number[] {
  const lit = (x: number, y: number): boolean => rows[y][x] === '#';
  const used = new Uint8Array(GLYPH_W * GLYPH_H);
  const out: number[] = [];
  for (let y = 0; y < GLYPH_H; y++) {
    for (let x = 0; x < GLYPH_W; x++) {
      if (!lit(x, y) || used[y * GLYPH_W + x]) continue;
      let w = 1;
      while (x + w < GLYPH_W && lit(x + w, y) && !used[y * GLYPH_W + x + w]) w++;
      let h = 1;
      while (y + h < GLYPH_H && spanFree(lit, used, x, y + h, w)) h++;
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) used[(y + dy) * GLYPH_W + x + dx] = 1;
      out.push(x, y, w, h);
    }
  }
  return out;
}

function spanFree(lit: (x: number, y: number) => boolean, used: Uint8Array, x: number, y: number, w: number): boolean {
  for (let dx = 0; dx < w; dx++) if (!lit(x + dx, y) || used[y * GLYPH_W + x + dx]) return false;
  return true;
}

const RECTS = new Map<string, number[]>(Object.entries(GLYPHS).map(([ch, rows]) => [ch, glyphRects(rows)]));

/** Width of a line in font px (no trailing spacing). */
export function textWidthPx(text: string): number {
  return text.length === 0 ? 0 : text.length * GLYPH_ADVANCE - 1;
}

/**
 * Emit `text` as front-facing quads with the builder's current colour/extra: top-left at (left, top) in world
 * units, `px` world units per font pixel, at depth z. Unknown characters render as spaces.
 */
export function emitText(out: MeshBuilder, text: string, left: number, top: number, px: number, z: number): void {
  out.normal(0, 0, 1);
  for (let i = 0; i < text.length; i++) {
    const rects = RECTS.get(text[i].toUpperCase());
    if (!rects) continue;
    const gx = left + i * GLYPH_ADVANCE * px;
    for (let k = 0; k < rects.length; k += 4) {
      const x0 = gx + rects[k] * px;
      const x1 = x0 + rects[k + 2] * px;
      const y0 = top - rects[k + 1] * px;
      const y1 = y0 - rects[k + 3] * px;
      out.quad(x0, y1, z, x1, y1, z, x1, y0, z, x0, y0, z);
    }
  }
}
