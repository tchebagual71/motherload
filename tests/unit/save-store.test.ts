import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../../src/save/crc32';
import { deflateRaw, inflateRaw } from '../../src/save/compress';
import { SaveStore, type FileRecord } from '../../src/save/store';

function bytes(n: number, seed = 1): Uint8Array {
  const b = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    b[i] = i % 7 === 0 ? x >>> 24 : 0; // compressible but not trivial
  }
  return b;
}

async function open(idb: IDBFactory, channel = 'test', clock = { t: 1_000 }) {
  return SaveStore.open({ channel, idb, now: () => clock.t });
}

/** Overwrite one stored record in place (simulates a torn or bit-rotted copy). */
async function tamper(idb: IDBFactory, channel: string, key: string, mutate: (r: FileRecord) => void): Promise<void> {
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const req = idb.open('holefactory');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(`${channel}.files`, 'readwrite');
    const store = tx.objectStore(`${channel}.files`);
    const get = store.get(key);
    get.onsuccess = () => {
      const r = get.result as FileRecord;
      mutate(r);
      store.put(r, key);
    };
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

describe('crc32 and deflate-raw', () => {
  it('matches the CRC-32 check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('round-trips deflate-raw', async () => {
    const b = bytes(50_000);
    const z = await deflateRaw(b);
    expect(z.length).toBeLessThan(b.length);
    expect(await inflateRaw(z)).toEqual(b);
  });
});

describe('SaveStore (canon §3.15; 04 §4.10)', () => {
  it('starts empty', async () => {
    const s = await open(new IDBFactory());
    expect(await s.listCopies()).toEqual([]);
    expect((await s.load((b) => b)).kind).toBe('empty');
  });

  it('a critical save is raw, verified and loadable', async () => {
    const s = await open(new IDBFactory());
    const b = bytes(4_096);
    const o = await s.writeCritical(b, { deepestRow: 3, cash: 20, trips: 0 });
    expect(o).toMatchObject({ ok: true, copy: 'a', seq: 1 });
    const r = await s.load((x) => x);
    expect(r.kind).toBe('loaded');
    if (r.kind === 'loaded') {
      expect(r.value).toEqual(b);
      expect(r.fallback).toBe(false);
    }
    expect((await s.listCopies())[0]).toMatchObject({ copy: 'a', deflated: false, len: 4_096 });
    expect(await s.slotRecord()).toMatchObject({ latest: 'a', seqA: 1, summary: { deepestRow: 3 } });
  });

  it('routine saves are deflated and rotate between the two copies', async () => {
    const idb = new IDBFactory();
    const s = await open(idb);
    await s.writeRoutine(bytes(20_000, 1));
    await s.writeRoutine(bytes(20_000, 2));
    const third = await s.writeRoutine(bytes(20_000, 3));
    expect(third).toMatchObject({ ok: true, copy: 'a', seq: 3 });
    const copies = await s.listCopies();
    expect(copies.map((c) => [c.copy, c.seq, c.deflated])).toEqual([
      ['a', 3, true],
      ['b', 2, true],
    ]);
    expect(copies[0].len).toBe(20_000);
    const r = await s.load((x) => x);
    expect(r.kind === 'loaded' && r.value).toEqual(bytes(20_000, 3));
  });

  it('a corrupt byte falls back to the other copy', async () => {
    const idb = new IDBFactory();
    const clock = { t: 0 };
    const s = await open(idb, 'test', clock);
    await s.writeCritical(bytes(1_000, 1));
    clock.t = 5 * 60_000;
    await s.writeCritical(bytes(1_000, 2)); // → copy b, newest
    s.close();
    await tamper(idb, 'test', 'slot1/b', (r) => {
      r.data[10] ^= 0xff;
    });
    const s2 = await open(idb);
    const r = await s2.load((x) => x);
    expect(r.kind).toBe('loaded');
    if (r.kind === 'loaded') {
      expect(r.copy).toBe('a');
      expect(r.fallback).toBe(true);
      expect(r.olderByMs).toBe(5 * 60_000);
      expect(r.value).toEqual(bytes(1_000, 1));
    }
  });

  it('content that passes the CRC but fails to decode also falls back', async () => {
    const s = await open(new IDBFactory());
    await s.writeCritical(new Uint8Array([1]));
    await s.writeCritical(new Uint8Array([2]));
    const r = await s.load((b) => {
      if (b[0] === 2) throw new Error('invariant');
      return b[0];
    });
    expect(r.kind === 'loaded' && r.value).toBe(1);
  });

  it('reports damaged when nothing verifies', async () => {
    const idb = new IDBFactory();
    const s = await open(idb);
    await s.writeCritical(bytes(100));
    s.close();
    await tamper(idb, 'test', 'slot1/a', (r) => {
      r.crc ^= 1;
    });
    expect((await (await open(idb)).load((x) => x)).kind).toBe('damaged');
  });

  it('the next write after a reload replaces the older copy', async () => {
    const idb = new IDBFactory();
    const s = await open(idb);
    await s.writeCritical(bytes(10, 1)); // a, seq 1
    await s.writeCritical(bytes(10, 2)); // b, seq 2
    s.close();
    const s2 = await open(idb);
    expect(await s2.writeCritical(bytes(10, 3))).toMatchObject({ copy: 'a', seq: 3 });
  });

  it('drops a compressed write made stale by a newer critical save', async () => {
    const s = await open(new IDBFactory());
    const slow = s.writeRoutine(bytes(30_000, 1)); // seq 1, compressing…
    const fast = s.writeCritical(bytes(100, 2)); // seq 2, issued synchronously
    expect(await fast).toMatchObject({ ok: true, seq: 2 });
    expect(await slow).toEqual({ ok: false, error: 'stale' });
    const r = await s.load((x) => x);
    expect(r.kind === 'loaded' && r.value).toEqual(bytes(100, 2));
  });

  it('keeps a last-known-good copy that survives both rotating copies going bad', async () => {
    const idb = new IDBFactory();
    const s = await open(idb);
    await s.writeCritical(bytes(64, 1));
    expect(await s.promoteGood('a')).toBe(true);
    await s.writeCritical(bytes(64, 2));
    s.close();
    for (const k of ['slot1/a', 'slot1/b']) await tamper(idb, 'test', k, (r) => (r.len += 1));
    const r = await (await open(idb)).load((x) => x);
    expect(r.kind === 'loaded' && r.copy).toBe('good');
    expect(r.kind === 'loaded' && r.value).toEqual(bytes(64, 1));
  });

  it('isolates channels in one database', async () => {
    const idb = new IDBFactory();
    const dev = await open(idb, 'dev');
    await dev.writeCritical(bytes(8, 1));
    const prod = await open(idb, 'prod'); // adds its stores with a version bump; dev reconnects
    expect(await prod.listCopies()).toEqual([]);
    await prod.writeCritical(bytes(8, 2));
    await new Promise((r) => setTimeout(r, 20));
    const back = await dev.load((x) => x);
    expect(back.kind === 'loaded' && back.value).toEqual(bytes(8, 1));
  });

  it('can exclude the failing copy (Safe Mode: load previous copy)', async () => {
    const s = await open(new IDBFactory());
    await s.writeCritical(new Uint8Array([1]));
    await s.writeCritical(new Uint8Array([2]));
    const r = await s.load((b) => b[0], ['b']);
    expect(r.kind === 'loaded' && [r.copy, r.value]).toEqual(['a', 1]);
    expect(await s.readVerified('b')).toEqual(new Uint8Array([2]));
  });

  it('stores key-value pairs (settings mirror)', async () => {
    const s = await open(new IDBFactory());
    expect(await s.putKv('settings', { sound: false })).toBe(true);
    expect(await s.getKv('settings')).toEqual({ sound: false });
  });
});
