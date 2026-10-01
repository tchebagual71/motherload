// Growable vertex/index buffers for terrain and slab geometry (04 §5.2 vertex layout, 24 B):
// position f32×3, normal i8×4, colour u8×4 (sRGB rgb, alpha = AO), extra u8×4.
// Pure (no three) so the mesher can be unit-tested in Node.

/** Bits of extra.y (`hfExtra.y × 255` in the shader). */
export const XF = {
  /** Merged inverted-hull vertex (Toon outline); collapsed in Pixel Lab. */
  HULL: 1,
  /** Animated Magma surface. */
  MAGMA: 2,
  /** Emissive pulse at 0.8 Hz (Thorium). */
  PULSE: 4,
  /** Echo ring flash every 3 s (Echo Quartz). */
  ECHO: 8,
  /** Twinkle (Gold sparkle, Diamond prism). */
  TWINKLE: 16,
} as const;

/** Emissive is stored ×100 in extra.x, so it covers 0..2.55 (Magma 1.5–2.5, 03 §8.5). */
export const EMISSIVE_SCALE = 100;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export class MeshBuilder {
  pos: Float32Array;
  nrm: Int8Array;
  col: Uint8Array;
  ext: Uint8Array;
  idx: Uint32Array;
  vcount = 0;
  icount = 0;
  /** Light sources found while meshing: x, y, kind (0 = Magma). */
  readonly lights: number[] = [];
  /** Glow halos for emissive ores/relics: x, y, colour (0xRRGGBB), emissive. */
  readonly glows: number[] = [];

  // Current vertex state.
  private nx = 0;
  private ny = 0;
  private nz = 127;
  private cr = 255;
  private cg = 255;
  private cb = 255;
  private e0 = 0;
  private e1 = 0;
  private e2 = 0;
  private e3 = 0;

  constructor(vertexCapacity = 4096, indexCapacity = 8192) {
    this.pos = new Float32Array(vertexCapacity * 3);
    this.nrm = new Int8Array(vertexCapacity * 4);
    this.col = new Uint8Array(vertexCapacity * 4);
    this.ext = new Uint8Array(vertexCapacity * 4);
    this.idx = new Uint32Array(indexCapacity);
  }

  reset(): void {
    this.vcount = 0;
    this.icount = 0;
    this.lights.length = 0;
    this.glows.length = 0;
  }

  get triangles(): number {
    return this.icount / 3;
  }

  /** Set the normal for following vertices (need not be normalised). */
  normal(x: number, y: number, z: number): this {
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    this.nx = Math.round((x / l) * 127);
    this.ny = Math.round((y / l) * 127);
    this.nz = Math.round((z / l) * 127);
    return this;
  }

  /** Set the sRGB colour (0xRRGGBB) for following vertices. */
  color(hex: number): this {
    this.cr = (hex >> 16) & 0xff;
    this.cg = (hex >> 8) & 0xff;
    this.cb = hex & 0xff;
    return this;
  }

  /** Emissive (0..2.55), flag bits (XF), phase byte. */
  extra(emissive: number, flags = 0, phase = 0): this {
    this.e0 = Math.max(0, Math.min(255, Math.round(emissive * EMISSIVE_SCALE)));
    this.e1 = flags & 0xff;
    this.e2 = phase & 0xff;
    this.e3 = 0;
    return this;
  }

  /** Append a vertex with the current normal/colour/extra and AO in [0, 1]; returns its index. */
  vertex(x: number, y: number, z: number, ao = 1): number {
    if (this.vcount + 1 > this.pos.length / 3) this.growVertices(this.vcount + 1);
    const v = this.vcount++;
    const p = v * 3;
    this.pos[p] = x;
    this.pos[p + 1] = y;
    this.pos[p + 2] = z;
    const q = v * 4;
    this.nrm[q] = this.nx;
    this.nrm[q + 1] = this.ny;
    this.nrm[q + 2] = this.nz;
    this.nrm[q + 3] = 0;
    this.col[q] = this.cr;
    this.col[q + 1] = this.cg;
    this.col[q + 2] = this.cb;
    this.col[q + 3] = Math.max(0, Math.min(255, Math.round(ao * 255)));
    this.ext[q] = this.e0;
    this.ext[q + 1] = this.e1;
    this.ext[q + 2] = this.e2;
    this.ext[q + 3] = this.e3;
    return v;
  }

  tri(a: number, b: number, c: number): void {
    if (this.icount + 3 > this.idx.length) this.growIndices(this.icount + 3);
    this.idx[this.icount++] = a;
    this.idx[this.icount++] = b;
    this.idx[this.icount++] = c;
  }

  /**
   * Quad from 4 vertices in CCW order (seen from the front). AO-aware split (0fps): the diagonal
   * joins the brighter pair so interpolation doesn't smear a dark corner across the face.
   */
  quadIdx(a: number, b: number, c: number, d: number, aoA = 1, aoB = 1, aoC = 1, aoD = 1): void {
    if (aoA + aoC < aoB + aoD) {
      this.tri(b, c, d);
      this.tri(b, d, a);
    } else {
      this.tri(a, b, c);
      this.tri(a, c, d);
    }
  }

  /** Quad from 4 positions (CCW) with per-corner AO, current normal/colour/extra. */
  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    aoA = 1, aoB = 1, aoC = 1, aoD = 1,
  ): void {
    const a = this.vertex(ax, ay, az, aoA);
    const b = this.vertex(bx, by, bz, aoB);
    const c = this.vertex(cx, cy, cz, aoC);
    const d = this.vertex(dx, dy, dz, aoD);
    this.quadIdx(a, b, c, d, aoA, aoB, aoC, aoD);
  }

  /** Axis-aligned box (outward winding) with the current colour/extra. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, sideHex?: number): void {
    const front = this.cr << 16 | this.cg << 8 | this.cb;
    const side = sideHex ?? front;
    this.normal(0, 0, 1).color(front).quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1);
    this.normal(0, 1, 0).quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0);
    this.normal(0, -1, 0).color(side).quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1);
    this.normal(1, 0, 0).quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1);
    this.normal(-1, 0, 0).quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0);
    this.normal(0, 0, -1).quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0);
    this.color(front);
  }

  private growVertices(min: number): void {
    const cap = nextCapacity(this.pos.length / 3, min);
    this.pos = grow(this.pos, cap * 3, Float32Array);
    this.nrm = grow(this.nrm, cap * 4, Int8Array);
    this.col = grow(this.col, cap * 4, Uint8Array);
    this.ext = grow(this.ext, cap * 4, Uint8Array);
  }

  private growIndices(min: number): void {
    this.idx = grow(this.idx, nextCapacity(this.idx.length, min), Uint32Array);
  }
}

function nextCapacity(current: number, min: number): number {
  let c = Math.max(16, current);
  while (c < min) c *= 2;
  return c;
}

type TypedCtor<T> = new (n: number) => T;
function grow<T extends Float32Array | Int8Array | Uint8Array | Uint32Array>(src: T, n: number, Ctor: TypedCtor<T>): T {
  const out = new Ctor(n);
  out.set(src as never);
  return out;
}
