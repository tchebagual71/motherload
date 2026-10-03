// IndexedDB save store (canon §3.15; 04 §4.10–4.13). One database `holefactory` with channel-prefixed object
// stores (`<ch>.files`, `<ch>.slots`, `<ch>.kv`), so dev/prod/test never touch each other's saves.
//
// Each slot keeps two rotating copies (`slot1/a`, `slot1/b`) plus a last-known-good copy (`slot1/good`, promoted
// once a boot has run cleanly). A write always replaces the OLDER copy, so the previous save survives a torn or
// corrupt write. Every record carries its own seq, CRC-32 and length, so "latest" is simply the highest seq that
// verifies; the `slots` record mirrors {latest, seqA, seqB, lastGood, summary} for slot cards.
//
// A copy this build can never load (an M0 test save, a newer version; save/legacy.ts) is moved out of the rotation
// to a kept key (`slot1/kept/…`) before anything is written, so it is never overwritten and can still be exported
// (04 §4.11).
//
// Compression is recorded on the store record (deflated = deflate-raw of the whole file) rather than by
// rewriting the HFSV header, so the store never depends on the codec's header layout.
//
// The connection is kept open for the critical path. When it dies (another tab's upgrade, or the browser closing
// it: WebKit's storage process recycled while the PWA was backgrounded, site data cleared), the store reconnects;
// meanwhile writes report 'closed' (the scheduler retries soon) and the compressed path waits for the reconnect.
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

/** A kept copy (moved out of the rotation by keep()), by its store key. */
export interface KeptInfo {
  key: string;
  seq: number;
  savedAt: number;
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

/** What a thrown or abort error means for a write, and whether the connection itself is gone. */
function classify(e: unknown): { error: WriteError; lost: boolean } {
  const name = e instanceof DOMException ? e.name : null;
  // A closing connection, or a forced close aborting our transaction (we never abort our own): transient, the
  // retry lands on the reconnected one.
  if (name === 'InvalidStateError' || name === 'AbortError') return { error: 'closed', lost: true };
  // WebKit's "Connection to Indexed Database server lost": reconnect, and tell the player in case it persists.
  if (name === 'UnknownError') return { error: 'failed', lost: true };
  return { error: name === 'QuotaExceededError' ? 'quota' : 'failed', lost: false };
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
  /** The last reconnect failed: writes report 'failed' (the player is told) while the next attempt runs. */
  private reopenFailed = false;
  /** close() was called: never reconnect. */
  private closedByOwner = false;

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

  /** Kept copies, newest first. */
  async keptCopies(): Promise<KeptInfo[]> {
    const db = await this.ready();
    if (!db) return [];
    const all = await request(db.transaction(this.names.files, 'readonly').objectStore(this.names.files).getAllKeys());
    const keys = all.map(String).filter((k) => k.startsWith(this.keptPrefix()));
    const store = db.transaction(this.names.files, 'readonly').objectStore(this.names.files);
    const values: unknown[] = await Promise.all(keys.map((k) => request(store.get(k))));
    const out: KeptInfo[] = [];
    values.forEach((v, i) => {
      if (isRecord(v)) out.push({ key: keys[i], seq: v.seq, savedAt: v.savedAt, len: v.len });
    });
    return out.sort((x, y) => y.savedAt - x.savedAt || y.seq - x.seq);
  }

  /** A kept copy's uncompressed bytes if its length and CRC verify, else null. */
  async readKept(key: string): Promise<Uint8Array | null> {
    const db = await this.ready();
    if (!db || !key.startsWith(this.keptPrefix())) return null;
    const rec: unknown = await request(db.transaction(this.names.files, 'readonly').objectStore(this.names.files).get(key));
    return isRecord(rec) ? verify(rec) : null;
  }

  // ---------------------------------------------------------------- writing

  /**
   * Move copies this build cannot load out of the rotation to kept keys, in one transaction (04 §4.11: they are
   * never overwritten). Call before the first write. False when the move did not commit: the copies are still in
   * the rotation, so nothing may be written over them.
   */
  async keep(copies: readonly CopyId[]): Promise<boolean> {
    if (copies.length === 0) return true;
    const db = await this.ready();
    if (!db) return false;
    let tx: IDBTransaction;
    try {
      tx = db.transaction(this.names.files, 'readwrite');
      const files = tx.objectStore(this.names.files);
      for (const copy of copies) {
        const get = files.get(this.key(copy));
        // Put and delete from inside the success callback so the transaction is still active.
        get.onsuccess = () => {
          const rec: unknown = get.result;
          if (!isRecord(rec)) return;
          files.put(rec, `${this.keptPrefix()}${copy}-${rec.seq}-${rec.savedAt}`);
          files.delete(this.key(copy));
        };
      }
    } catch (e) {
      if (classify(e).lost) this.lost(db);
      return false;
    }
    if (!(await txDone(tx))) return false;
    for (const copy of copies) {
      if (copy === 'good') this.goodSeq = -1;
      else this.copySeq[copy] = -1;
    }
    return true;
  }

  /**
   * Critical path (canon §3.15): call inside the visibilitychange/pagehide/death handler. The CRC, the
   * transaction and both puts happen synchronously before this returns; the promise only reports completion.
   */
  writeCritical(bytes: Uint8Array, summary?: SaveSummary): Promise<WriteOutcome> {
    const seq = this.nextSeq++;
    if (summary) this.summary = summary;
    return this.issue({ seq, savedAt: this.now(), deflated: false, crc: crc32(bytes), len: bytes.length, data: bytes });
  }

  /**
   * Routine / high-priority path: deflate-raw first; dropped as stale if a newer save was issued meanwhile.
   * Unlike the critical path it may wait, so it waits for a reconnect in progress.
   */
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
    if (!this.db) {
      this.startReopen();
      await this.ready();
    }
    if (seq < this.highestIssued) return { ok: false, error: 'stale' };
    if (summary) this.summary = summary;
    return this.issue({ seq, savedAt, deflated, crc, len: bytes.length, data });
  }

  /**
   * Copy the save that just booted cleanly (`copy` as it was when loaded, `seq`) into the last-known-good record.
   * Refused when that copy has been rewritten since (two saves rotate back onto it): the newer bytes never booted.
   */
  async promoteGood(copy: CopyId, seq: number): Promise<boolean> {
    if (copy === 'good') return true;
    const db = await this.ready();
    if (!db) return false;
    let tx: IDBTransaction;
    let promoted = false;
    try {
      tx = db.transaction(this.names.files, 'readwrite');
      const files = tx.objectStore(this.names.files);
      const get = files.get(this.key(copy));
      // Put from inside the success callback so the transaction is still active.
      get.onsuccess = () => {
        const rec: unknown = get.result;
        if (!isRecord(rec) || rec.seq !== seq) return;
        promoted = true;
        files.put(rec, this.key('good'));
      };
    } catch (e) {
      if (classify(e).lost) this.lost(db);
      return false;
    }
    const ok = (await txDone(tx)) && promoted;
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
    this.closedByOwner = true;
    this.db?.close();
    this.db = null;
  }

  // ---------------------------------------------------------------- internals

  private key(copy: CopyId): string {
    return `slot${this.slot}/${copy}`;
  }

  private keptPrefix(): string {
    return `slot${this.slot}/kept/`;
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
      this.lost(db);
    };
    // Fired only for an abnormal close: the browser dropped the connection (backend lost, data cleared).
    db.onclose = () => this.lost(db);
    if (this.closedByOwner) {
      db.close();
      return;
    }
    this.db = db;
  }

  /** `db` is dead: forget it (unless it was already replaced) and reconnect. */
  private lost(db: IDBDatabase): void {
    if (this.db !== db && this.db !== null) return;
    try {
      db.close();
    } catch {
      // Already closed.
    }
    this.db = null;
    this.startReopen();
  }

  private startReopen(): void {
    if (this.closedByOwner || this.reopening) return;
    this.reopening = this.connect()
      .then(() => {
        this.reopenFailed = false;
      })
      .catch(() => {
        this.reopenFailed = true;
      })
      .finally(() => {
        this.reopening = null;
      });
  }

  /** No connection: 'closed' while it reconnects (silent; retried soon), 'failed' once a reconnect has failed. */
  private unavailable(): WriteOutcome {
    const error: WriteError = this.reopenFailed && !this.closedByOwner ? 'failed' : 'closed';
    this.startReopen();
    return { ok: false, error };
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
    if (!db) return Promise.resolve(this.unavailable());
    const copy = this.target();
    let tx: IDBTransaction;
    try {
      tx = db.transaction([this.names.files, this.names.slots], 'readwrite');
      tx.objectStore(this.names.files).put(rec, this.key(copy));
      this.copySeq[copy] = rec.seq;
      this.highestIssued = Math.max(this.highestIssued, rec.seq);
      tx.objectStore(this.names.slots).put(this.slotSnapshot(copy, rec.savedAt), this.slotKey());
    } catch (e) {
      // The connection may have died under us before (or without) its close event.
      const c = e instanceof DOMException ? classify(e) : { error: 'closed' as const, lost: false };
      if (c.lost) this.lost(db);
      return Promise.resolve({ ok: false, error: c.error });
    }
    commit(tx);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve({ ok: true, seq: rec.seq, copy });
      const fail = (): void => {
        this.copySeq[copy] = -1;
        const c = classify(tx.error);
        if (c.lost) this.lost(db);
        resolve({ ok: false, error: c.error });
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
