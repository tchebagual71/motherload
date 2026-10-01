// Little-endian byte writer/reader for the HFSV format (04 §4.9). PURE MODULE.
// The writer is reused between saves (critical saves must stay ≤ 4 ms on low devices, canon §3.15);
// the reader bounds-checks every access and throws SaveError instead of reading past its window.
import { SaveError } from './errors';

export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  length = 0;

  constructor(capacity = 1 << 17) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  reset(): void {
    this.length = 0;
  }

  private ensure(n: number): void {
    const need = this.length + n;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v;
  }
  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
  }
  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
  }
  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.length, v, true);
    this.length += 8;
  }
  bool(v: boolean): void {
    this.u8(v ? 1 : 0);
  }
  bytes(src: Uint8Array): void {
    this.ensure(src.length);
    this.buf.set(src, this.length);
    this.length += src.length;
  }
  /** Four ASCII characters (magic, section tags). */
  ascii4(s: string): void {
    for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i) & 0x7f);
  }
  /** u16 length + UTF-16 code units: exact for any JS string, no text encoder needed. */
  str(s: string): void {
    this.u16(s.length);
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
  }

  /** Reserve a u32 length slot; returns its offset for `endLength`. */
  beginLength(): number {
    const at = this.length;
    this.u32(0);
    return at;
  }
  endLength(at: number): void {
    this.view.setUint32(at, this.length - at - 4, true);
  }

  /** Live view of the written bytes (valid until the next write). */
  view8(): Uint8Array {
    return this.buf.subarray(0, this.length);
  }
  /** Owned copy of the written bytes. */
  toBytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export class ByteReader {
  private readonly src: Uint8Array;
  private readonly view: DataView;
  private readonly end: number;
  pos: number;

  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    this.src = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = start;
    this.end = end;
  }

  get remaining(): number {
    return this.end - this.pos;
  }

  private need(n: number, what: string): void {
    if (n > this.end - this.pos) throw new SaveError('truncated', `Save ends inside ${what}`);
  }

  u8(what = 'a byte'): number {
    this.need(1, what);
    return this.src[this.pos++];
  }
  u16(what = 'a u16'): number {
    this.need(2, what);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(what = 'a u32'): number {
    this.need(4, what);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(what = 'an f64'): number {
    this.need(8, what);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  bool(what: string): boolean {
    return this.int(this.u8(what), 0, 1, what) === 1;
  }
  /** View of the next n bytes (no copy). */
  bytes(n: number, what: string): Uint8Array {
    this.need(n, what);
    const out = this.src.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  ascii4(what: string): string {
    this.need(4, what);
    let s = '';
    for (let i = 0; i < 4; i++) s += String.fromCharCode(this.src[this.pos++]);
    return s;
  }
  str(what: string, maxLen: number): string {
    const n = this.int(this.u16(what), 0, maxLen, `${what} length`);
    this.need(n * 2, what);
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.view.getUint16(this.pos + i * 2, true));
    this.pos += n * 2;
    return s;
  }

  // ---- bounds helpers (throw SaveError 'bounds') ----

  int(v: number, min: number, max: number, what: string): number {
    if (!Number.isInteger(v) || v < min || v > max) throw new SaveError('bounds', `${what} out of range: ${v}`);
    return v;
  }
  finite(min: number, max: number, what: string): number {
    const v = this.f64(what);
    if (!Number.isFinite(v) || v < min || v > max) throw new SaveError('bounds', `${what} out of range: ${v}`);
    return v;
  }
  /** An f64 that must hold a whole number in [min, max]. */
  whole(min: number, max: number, what: string): number {
    return this.int(this.f64(what), min, max, what);
  }
  oneOf<T>(values: readonly T[], what: string): T {
    const i = this.u8(what);
    if (i >= values.length) throw new SaveError('bounds', `${what} out of range: ${i}`);
    return values[i];
  }
}
