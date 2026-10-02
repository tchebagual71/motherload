// Little-endian section writer/reader for factory saves and the FNV-1a state hash (02 §10.9). PURE MODULE.
// The factory owns its own codec helpers: 04 §2.2 forbids importing save/.

export class FactoryLoadError extends Error {
  constructor(message: string) {
    super(`factory save: ${message}`);
    this.name = 'FactoryLoadError';
  }
}

export class Writer {
  private buf = new Uint8Array(1 << 12);
  private view = new DataView(this.buf.buffer);
  length = 0;

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
  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.length, v, true);
    this.length += 2;
  }
  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
  }
  /** Safe integers (Q16 clocks and credits) as f64: exact below 2^53. */
  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.length, v, true);
    this.length += 8;
  }
  tag(s: string): void {
    for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i));
  }
  /** Reserve a u32 length; returns its offset for `end`. */
  begin(): number {
    const at = this.length;
    this.u32(0);
    return at;
  }
  end(at: number): void {
    this.view.setUint32(at, this.length - at - 4, true);
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export class Reader {
  private readonly view: DataView;
  pos: number;
  readonly end: number;

  constructor(
    readonly buf: Uint8Array,
    start = 0,
    end = buf.length,
  ) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.pos = start;
    this.end = end;
  }
  private need(n: number): void {
    if (this.pos + n > this.end) throw new FactoryLoadError(`truncated at byte ${this.pos}`);
  }
  u8(): number {
    this.need(1);
    return this.buf[this.pos++];
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** A safe non-negative integer stored as f64. */
  int(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    if (!Number.isSafeInteger(v)) throw new FactoryLoadError(`bad integer at byte ${this.pos - 8}`);
    return v;
  }
  tag(): string {
    this.need(4);
    let s = '';
    for (let i = 0; i < 4; i++) s += String.fromCharCode(this.buf[this.pos++]);
    return s;
  }
  /** Read a value and require it in [lo, hi]. */
  range(v: number, lo: number, hi: number, what: string): number {
    if (v < lo || v > hi) throw new FactoryLoadError(`${what} ${v} outside ${lo}..${hi}`);
    return v;
  }
  done(): boolean {
    return this.pos >= this.end;
  }
}

/** FNV-1a 32 over `bytes`, continuing from `h`. */
export function fnv1a(bytes: Uint8Array, h = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
