// Fixed-capacity item buffers: FIFO rings, storage runs and lift queues (04 §4.5–4.6). PURE MODULE.

/** FIFO of item nums (machine outputs, drill output, Headframe, Export queue). */
export class ItemRing {
  private readonly buf: Uint16Array;
  private head = 0;
  n = 0;

  constructor(readonly cap: number) {
    this.buf = new Uint16Array(cap);
  }
  push(item: number): boolean {
    if (this.n >= this.cap) return false;
    this.buf[(this.head + this.n) % this.cap] = item;
    this.n++;
    return true;
  }
  peek(): number {
    return this.n > 0 ? this.buf[this.head] : 0;
  }
  shift(): number {
    const v = this.buf[this.head];
    this.head = (this.head + 1) % this.cap;
    this.n--;
    return v;
  }
  at(i: number): number {
    return this.buf[(this.head + i) % this.cap];
  }
  clear(): void {
    this.head = 0;
    this.n = 0;
  }
}

/** Mixed storage as sorted (item, count) runs, ≤ 32 per storage (04 §4.6). */
export class Inv {
  static readonly MAX_RUNS = 32;
  readonly items = new Uint16Array(Inv.MAX_RUNS);
  readonly counts = new Uint32Array(Inv.MAX_RUNS);
  runs = 0;
  total = 0;

  constructor(readonly cap: number) {}

  private find(item: number): number {
    for (let i = 0; i < this.runs; i++) if (this.items[i] === item) return i;
    return -1;
  }
  count(item: number): number {
    const i = this.find(item);
    return i < 0 ? 0 : this.counts[i];
  }
  /** Room for `n` of `item` (capacity and run limit). */
  fits(item: number, n: number): boolean {
    return this.total + n <= this.cap && (this.runs < Inv.MAX_RUNS || this.find(item) >= 0);
  }
  add(item: number, n: number): void {
    let i = this.find(item);
    if (i < 0) {
      i = this.runs;
      while (i > 0 && this.items[i - 1] > item) {
        this.items[i] = this.items[i - 1];
        this.counts[i] = this.counts[i - 1];
        i--;
      }
      this.items[i] = item;
      this.counts[i] = 0;
      this.runs++;
    }
    this.counts[i] += n;
    this.total += n;
  }
  /** Remove up to n; returns how many were removed. */
  remove(item: number, n: number): number {
    const i = this.find(item);
    if (i < 0) return 0;
    const k = Math.min(n, this.counts[i]);
    this.counts[i] -= k;
    this.total -= k;
    if (this.counts[i] === 0) {
      for (let j = i; j < this.runs - 1; j++) {
        this.items[j] = this.items[j + 1];
        this.counts[j] = this.counts[j + 1];
      }
      this.runs--;
    }
    return k;
  }
}

/** Lift / chute FIFO of (item, entry clock) (02 §10.6). Grows by doubling; capacity ⌈rate × transit⌉ + 2 suffices. */
export class LiftQueue {
  item: Uint16Array;
  entry: Float64Array;
  head = 0;
  n = 0;

  constructor(cap: number) {
    this.item = new Uint16Array(cap);
    this.entry = new Float64Array(cap);
  }
  push(item: number, clock: number): void {
    if (this.n === this.item.length) this.grow();
    const p = (this.head + this.n) % this.item.length;
    this.item[p] = item;
    this.entry[p] = clock;
    this.n++;
  }
  headItem(): number {
    return this.item[this.head];
  }
  headEntry(): number {
    return this.entry[this.head];
  }
  shift(): number {
    const v = this.item[this.head];
    this.head = (this.head + 1) % this.item.length;
    this.n--;
    return v;
  }
  itemAt(i: number): number {
    return this.item[(this.head + i) % this.item.length];
  }
  entryAt(i: number): number {
    return this.entry[(this.head + i) % this.item.length];
  }
  clear(): void {
    this.head = 0;
    this.n = 0;
  }
  private grow(): void {
    const cap = this.item.length * 2;
    const item = new Uint16Array(cap);
    const entry = new Float64Array(cap);
    for (let i = 0; i < this.n; i++) {
      item[i] = this.itemAt(i);
      entry[i] = this.entryAt(i);
    }
    this.item = item;
    this.entry = entry;
    this.head = 0;
  }
}
