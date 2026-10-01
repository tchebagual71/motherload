// IndexedDB save store (canon §3.15; 04 §4.10–4.13). One database `holefactory` with channel-prefixed object
// stores (`<ch>.files`, `<ch>.slots`, `<ch>.kv`), so dev/prod/test never touch each other's saves.
//
// Each slot keeps two rotating copies (`slot1/a`, `slot1/b`) plus a last-known-good copy (`slot1/good`, promoted
// once a boot has run cleanly). A write always replaces the OLDER copy, so the previous save survives a torn or
// corrupt write. Every record carries its own seq, CRC-32 and length, so "latest" is simply the highest seq that
// verifies; the `slots` record mirrors {latest, seqA, seqB, lastGood, summary} for slot cards.
//
// Compression is recorded on the store record (deflated = deflate-raw of the whole file) rather than by
// rewriting the HFSV header, so the store never depends on the codec's header layout.
import { canCompress, deflateRaw, inflateRaw } from './compress';
import { crc32 } from './crc32';

export type CopyId = 'a' | 'b' | 'good';
export type WriteError = 'stale' | 'quota' | 'closed' | 'failed';
export type WriteOutcome = { ok: true; seq: number; copy: CopyId } | { ok: false; error: WriteError };

export interface FileRecord {
  seq: number;
  /** Wall-clock ms (app layer). */
  savedAt: number;
  deflated: boolean;
  /** CRC-32 and length of the UNCOMPRESSED bytes. */
  crc: number;
  len: number;
  data: Uint8Array;
}

export interface SaveSummary {
  deepestRow: number;
  cash: number;
  trips: number;
}

export interface SlotRecord {
  latest: CopyId | null;
  seqA: number;
  seqB: number;
  lastGood: number;
  savedAt: number;
  summary: SaveSummary | null;
}

export interface CopyInfo {
  copy: CopyId;
  seq: number;
  savedAt: number;
  deflated: boolean;
  len: number;
}

export type LoadOutcome<T> =
  | { kind: 'empty' }
  | { kind: 'damaged' }
  | {
      kind: 'loaded';
      value: T;
      copy: CopyId;
      seq: number;
      savedAt: number;
      /** A newer copy existed but failed to verify or decode. */
      fallback: boolean;
      /** How much older this copy is than the newest stored one (for the "n min older" toast). */
      olderByMs: number;
    };

export interface SaveStoreOptions {
  channel: string;
  slot?: number;
  idb?: IDBFactory;
  /** Wall clock for savedAt. */
  now?: () => number;
  dbName?: string;
}

export const DB_NAME = 'holefactory';
/** Canon §3.15 / 04 §4.9: an HFSV file is ≤ 1 MiB uncompressed. */
export const MAX_SAVE_BYTES = 1 << 20;
const ROTATING: readonly ('a' | 'b')[] = ['a', 'b'];

interface StoreNames {
  files: string;
  slots: string;
  kv: string;
}

function namesFor(channel: string): StoreNames {
  return { files: `${channel}.files`, slots: `${channel}.slots`, kv: `${channel}.kv` };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function hasStores(db: IDBDatabase, n: StoreNames): boolean {
  return db.objectStoreNames.contains(n.files) && db.objectStoreNames.contains(n.slots) && db.objectStoreNames.contains(n.kv);
}

function openDb(idb: IDBFactory, name: string, version: number | undefined, n: StoreNames): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? idb.open(name) : idb.open(name, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of [n.files, n.slots, n.kv]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => undefined; // Another tab holds an older version; it closes on versionchange.
  });
}

function isRecord(v: unknown): v is FileRecord {
  const r = v as FileRecord | undefined;
  return !!r && typeof r.seq === 'number' && typeof r.crc === 'number' && typeof r.len === 'number' && r.data instanceof Uint8Array;
}

function commit(tx: IDBTransaction): void {
  try {
    tx.commit?.();
  } catch {
    // Older engines auto-commit when the task ends.
  }
}

function errorKind(e: DOMException | null): WriteError {
  return e?.name === 'QuotaExceededError' ? 'quota' : 'failed';
}

export class SaveStore {
  readonly slot: number;
  private db: IDBDatabase | null = null;
  private readonly names: StoreNames;
  private readonly idb: IDBFactory;
  private readonly dbName: string;
  private readonly now: () => number;
  /** Seq held by each rotating copy as far as this connection knows (-1 = empty or unknown). */
  private readonly copySeq = { a: -1, b: -1 };
  private nextSeq = 1;
  private highestIssued = 0;
  private goodSeq = -1;
  private summary: SaveSummary | null = null;
  private reopening: Promise<void> | null = null;

  private constructor(opts: SaveStoreOptions, idb: IDBFactory) {
    this.slot = opts.slot ?? 1;
    this.names = namesFor(opts.channel);
    this.idb = idb;
    this.dbName = opts.dbName ?? DB_NAME;
    this.now = opts.now ?? Date.now;
  }

  /** Opens (or creates) the database and this channel's stores. Rejects when IndexedDB is unavailable. */
  static async open(opts: SaveStoreOptions): Promise<SaveStore> {
    const idb = opts.idb ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
    if (!idb) throw new Error('IndexedDB unavailable');
    const store = new SaveStore(opts, idb);
    await store.connect();
    await store.loadSeqs();
    return store;
  }

  get isOpen(): boolean {
    return this.db !== null;
  }

  // ---------------------------------------------------------------- reading

  /** Stored copies, newest first: rotating copies by seq, then the last-known-good copy. */
  async listCopies(): Promise<CopyInfo[]> {
    const records = await this.readRecords();
    const infos: CopyInfo[] = [];
    for (const copy of ROTATING) {
      const r = records[copy];
      if (r) infos.push({ copy, seq: r.seq, savedAt: r.savedAt, deflated: r.deflated, len: r.len });
    }
    infos.sort((x, y) => y.seq - x.seq);
    const g = records.good;
    if (g) infos.push({ copy: 'good', seq: g.seq, savedAt: g.savedAt, deflated: g.deflated, len: g.len });
    return infos;
  }

  /** The copy's uncompressed bytes if its length and CRC verify, else null. */
  async readVerified(copy: CopyId): Promise<Uint8Array | null> {
    const rec = (await this.readRecords())[copy];
    return rec ? verify(rec) : null;
  }

  /**
   * Load the newest copy that verifies AND decodes (04 §4.10 read path). `decode` throws on bad content
   * (bounds, invariants, too-new version); the next copy is tried.
   */
  async load<T>(decode: (bytes: Uint8Array) => T, exclude: readonly CopyId[] = []): Promise<LoadOutcome<T>> {
    const infos = await this.listCopies();
    if (infos.length === 0) return { kind: 'empty' };
    const newest = infos[0].savedAt;
    let skipped = false;
    for (const info of infos) {
      if (exclude.includes(info.copy)) {
        skipped = true;
        continue;
      }
      const bytes = await this.readVerified(info.copy);
      if (bytes) {
        try {
          const value = decode(bytes);
          return { kind: 'loaded', value, copy: info.copy, seq: info.seq, savedAt: info.savedAt, fallback: skipped, olderByMs: Math.max(0, newest - info.savedAt) };
        } catch {
          // Corrupt content behind a valid CRC: fall through to the older copy.
        }
      }
      skipped = true;
    }
    return { kind: 'damaged' };
  }

  // ---------------------------------------------------------------- writing

  /**
   * Critical path (canon §3.15): call inside the visibilitychange/pagehide/death handler. The CRC, the
   * transaction and both puts happen synchronously before this returns; the promise only reports completion.
   */
  writeCritical(bytes: Uint8Array, summary?: SaveSummary): Promise<WriteOutcome> {
    const seq = this.nextSeq++;
    if (summary) this.summary = summary;
    return this.issue({ seq, savedAt: this.now(), deflated: false, crc: crc32(bytes), len: bytes.length, data: bytes });
  }

  /** Routine / high-priority path: deflate-raw first; dropped as stale if a newer save was issued meanwhile. */
  async writeRoutine(bytes: Uint8Array, summary?: SaveSummary): Promise<WriteOutcome> {
    const seq = this.nextSeq++;
    const savedAt = this.now();
    const crc = crc32(bytes);
    let data = bytes;
    let deflated = false;
    if (canCompress()) {
      try {
        data = await deflateRaw(bytes);
        deflated = true;
      } catch {
        data = bytes;
      }
    }
    if (seq < this.highestIssued) return { ok: false, error: 'stale' };
    if (summary) this.summary = summary;
    return this.issue({ seq, savedAt, deflated, crc, len: bytes.length, data });
  }

  /** Copy a copy that just booted cleanly into the last-known-good record. */
  async promoteGood(copy: CopyId): Promise<boolean> {
    if (copy === 'good') return true;
    const db = await this.ready();
    if (!db) return false;
    const tx = db.transaction(this.names.files, 'readwrite');
    const files = tx.objectStore(this.names.files);
    const get = files.get(this.key(copy));
    let seq = -1;
    // Put from inside the success callback so the transaction is still active.
    get.onsuccess = () => {
      const rec: unknown = get.result;
      if (!isRecord(rec)) return;
      seq = rec.seq;
      files.put(rec, this.key('good'));
    };
    const ok = (await txDone(tx)) && seq >= 0;
    if (ok) this.goodSeq = seq;
    return ok;
  }

  // ---------------------------------------------------------------- key-value (settings mirror)

  async getKv<T>(key: string): Promise<T | undefined> {
    const db = await this.ready();
    if (!db) return undefined;
    return (await request(db.transaction(this.names.kv, 'readonly').objectStore(this.names.kv).get(key))) as T | undefined;
  }

  async putKv(key: string, value: unknown): Promise<boolean> {
    const db = await this.ready();
    if (!db) return false;
    const tx = db.transaction(this.names.kv, 'readwrite');
    tx.objectStore(this.names.kv).put(value, key);
    commit(tx);
    return txDone(tx);
  }

  async slotRecord(): Promise<SlotRecord | null> {
    const db = await this.ready();
    if (!db) return null;
    const v = await request(db.transaction(this.names.slots, 'readonly').objectStore(this.names.slots).get(this.slotKey()));
    return (v as SlotRecord | undefined) ?? null;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  // ---------------------------------------------------------------- internals

  private key(copy: CopyId): string {
    return `slot${this.slot}/${copy}`;
  }

  private slotKey(): string {
    return `slot${this.slot}`;
  }

  private async connect(): Promise<void> {
    let db = await openDb(this.idb, this.dbName, undefined, this.names);
    if (!hasStores(db, this.names)) {
      // A new channel on an existing database: one version bump adds its stores.
      const v = db.version + 1;
      db.close();
      db = await openDb(this.idb, this.dbName, v, this.names);
    }
    db.onversionchange = () => {
      // Let another tab upgrade, then reconnect so the critical path keeps an open connection.
      db.close();
      if (this.db === db) this.db = null;
      this.reopening ??= this.connect()
        .catch(() => undefined)
        .finally(() => {
          this.reopening = null;
        });
    };
    this.db = db;
  }

  private async ready(): Promise<IDBDatabase | null> {
    if (!this.db && this.reopening) await this.reopening;
    return this.db;
  }

  private async readRecords(): Promise<Partial<Record<CopyId, FileRecord>>> {
    const db = await this.ready();
    if (!db) return {};
    const store = db.transaction(this.names.files, 'readonly').objectStore(this.names.files);
    const [a, b, good] = await Promise.all((['a', 'b', 'good'] as const).map((c) => request(store.get(this.key(c)))));
    const out: Partial<Record<CopyId, FileRecord>> = {};
    if (isRecord(a)) out.a = a;
    if (isRecord(b)) out.b = b;
    if (isRecord(good)) out.good = good;
    return out;
  }

  private async loadSeqs(): Promise<void> {
    const records = await this.readRecords();
    for (const c of ROTATING) this.copySeq[c] = records[c]?.seq ?? -1;
    this.goodSeq = records.good?.seq ?? -1;
    const top = Math.max(this.copySeq.a, this.copySeq.b, this.goodSeq, 0);
    this.nextSeq = top + 1;
    this.highestIssued = top;
  }

  /** Older rotating copy (an unknown copy counts as oldest so it is rewritten first). */
  private target(): 'a' | 'b' {
    return this.copySeq.a <= this.copySeq.b ? 'a' : 'b';
  }

  private issue(rec: FileRecord): Promise<WriteOutcome> {
    const db = this.db;
    if (!db) return Promise.resolve({ ok: false, error: 'closed' });
    const copy = this.target();
    let tx: IDBTransaction;
    try {
      tx = db.transaction([this.names.files, this.names.slots], 'readwrite');
      tx.objectStore(this.names.files).put(rec, this.key(copy));
      this.copySeq[copy] = rec.seq;
      this.highestIssued = Math.max(this.highestIssued, rec.seq);
      tx.objectStore(this.names.slots).put(this.slotSnapshot(copy, rec.savedAt), this.slotKey());
    } catch (e) {
      return Promise.resolve({ ok: false, error: e instanceof DOMException ? errorKind(e) : 'closed' });
    }
    commit(tx);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve({ ok: true, seq: rec.seq, copy });
      const fail = (): void => {
        this.copySeq[copy] = -1;
        resolve({ ok: false, error: errorKind(tx.error) });
      };
      tx.onabort = fail;
    });
  }

  private slotSnapshot(latest: CopyId, savedAt: number): SlotRecord {
    return { latest, seqA: this.copySeq.a, seqB: this.copySeq.b, lastGood: this.goodSeq, savedAt, summary: this.summary };
  }
}

function txDone(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => resolve(false);
  });
}

async function verify(rec: FileRecord): Promise<Uint8Array | null> {
  if (rec.len > MAX_SAVE_BYTES) return null;
  let bytes = rec.data;
  if (rec.deflated) {
    try {
      bytes = await inflateRaw(rec.data);
    } catch {
      return null;
    }
  }
  return bytes.length === rec.len && crc32(bytes) === rec.crc ? bytes : null;
}
