// Which world a boot loads (04 §4.10–4.13), over real World saves in fake-indexeddb: the fallback read path,
// Safe Mode on whichever copy keeps dying, boots the player left, the ?seed override, a stuck IndexedDB open, and
// last-known-good promotion of the bytes that actually booted.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import {
  adoptLateStore,
  LateSink,
  loadInitialWorld,
  openStore,
  safeModeHooks,
  seedOverride,
  worlds,
} from '../../src/app/bootWorld';
import { damagedFallbackNotice, NOTICE, previousCopyNotice } from '../../src/app/notices';
import { memoryKeyValue, type KeyValue } from '../../src/platform/storage';
import { BootTracker } from '../../src/save/bootTrack';
import { SaveStore, type FileRecord } from '../../src/save/store';
import { World } from '../../src/world/world';

const MIN = 60_000;
const KEY = 'hf-test.boot';

function worldBytes(seed: number): Uint8Array {
  return worlds.create(seed).serialize();
}

async function open(idb: IDBFactory, clock = { t: 0 }): Promise<SaveStore> {
  return SaveStore.open({ channel: 'test', idb, now: () => clock.t });
}

/** Overwrite one stored record in place (a torn or bit-rotted copy). */
async function tamper(idb: IDBFactory, key: string, mutate: (r: FileRecord) => void): Promise<void> {
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const req = idb.open('holefactory');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('test.files', 'readwrite');
    const files = tx.objectStore('test.files');
    const get = files.get(key);
    get.onsuccess = () => {
      const r = get.result as FileRecord;
      mutate(r);
      files.put(r, key);
    };
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

/** Two saves: a = seed 1 (older), b = seed 2 (newest, 5 min later). */
async function twoCopies(idb: IDBFactory): Promise<void> {
  const clock = { t: 0 };
  const s = await open(idb, clock);
  await s.writeCritical(worldBytes(1));
  clock.t = 5 * MIN;
  await s.writeCritical(worldBytes(2));
  s.close();
}

/** One boot up to the world it loads; it "dies" unless the caller drives the tracker to firstFrame. */
async function boot(idb: IDBFactory, kv: KeyValue, beforeLoad?: (t: BootTracker) => void) {
  const tracker = new BootTracker(kv, KEY);
  beforeLoad?.(tracker);
  const store = await open(idb);
  const initial = await loadInitialWorld({ store, late: null }, tracker, null);
  return { initial, tracker, store };
}

describe('loadInitialWorld (04 §4.10 read path)', () => {
  it('loads the newest copy and remembers its seq', async () => {
    const idb = new IDBFactory();
    await twoCopies(idb);
    const { initial } = await boot(idb, memoryKeyValue());
    expect(initial.world.seed).toBe(2);
    expect(initial).toMatchObject({ coldLoad: true, loaded: { copy: 'b', seq: 2 }, notice: null, safeModeCopy: null });
  });

  it('falls back past a torn copy with a notice about that world', async () => {
    const idb = new IDBFactory();
    await twoCopies(idb);
    await tamper(idb, 'slot1/b', (r) => (r.crc ^= 1));
    const { initial } = await boot(idb, memoryKeyValue());
    expect(initial.world.seed).toBe(1);
    expect(initial.loaded).toEqual({ copy: 'a', seq: 1 });
    expect(initial.notice).toEqual({ text: damagedFallbackNotice(5 * MIN), tone: 'warn', aboutWorld: true });
  });

  it('nothing loads: a new claim, saying so', async () => {
    const idb = new IDBFactory();
    await twoCopies(idb);
    for (const k of ['slot1/a', 'slot1/b']) await tamper(idb, k, (r) => (r.len += 1));
    const { initial } = await boot(idb, memoryKeyValue());
    expect(initial).toMatchObject({ coldLoad: false, loaded: null, notice: { text: NOTICE.damagedNewClaim } });
  });
});

describe('Safe Mode (04 §4.13)', () => {
  it('two deaths on the newest copy open Safe Mode on it', async () => {
    const idb = new IDBFactory();
    await twoCopies(idb);
    const kv = memoryKeyValue();
    const seen = [];
    for (let i = 0; i < 3; i++) seen.push((await boot(idb, kv)).initial.safeModeCopy);
    expect(seen).toEqual([null, null, 'b']);
  });

  it('a fallback copy that keeps dying reaches Safe Mode on that copy (no endless crash loop)', async () => {
    const idb = new IDBFactory();
    await twoCopies(idb);
    await tamper(idb, 'slot1/b', (r) => (r.crc ^= 1));
    const kv = memoryKeyValue();
    const seen = [];
    for (let i = 0; i < 4; i++) seen.push((await boot(idb, kv)).initial.safeModeCopy);
    expect(seen).toEqual([null, null, 'a', 'a']);
  });

  it('the copy being decoded is the tracked one, so a decode that kills the tab counts against it', async () => {
    const idb = new IDBFactory();
    await twoCopies(idb);
    await tamper(idb, 'slot1/b', (r) => (r.crc ^= 1));
    const kv = memoryKeyValue();
    const atDecode: unknown[] = [];
    const spy = vi.spyOn(World, 'deserialize');
    spy.mockImplementation((bytes) => {
      atDecode.push(JSON.parse(kv.get(KEY) ?? 'null'));
      spy.mockRestore();
      return World.deserialize(bytes);
    });
    await boot(idb, kv);
    expect(atDecode).toEqual([{ slot: 1, copy: 'a', phase: 'load', n: 0 }]);
  });

  it('boots the player left before their first frame (reloads, app switches) never open Safe Mode', async () => {
    const idb = new IDBFactory();
    await twoCopies(idb);
    const kv = memoryKeyValue();
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const { initial, tracker } = await boot(idb, kv);
      tracker.setLeft(true); // pagehide / hidden before firstFrame
      seen.push(initial.safeModeCopy);
    }
    seen.push((await boot(idb, kv)).initial.safeModeCopy);
    expect(seen).toEqual([null, null, null, null, null]);
  });

  it('"Load previous copy" loads the older copy and says how much older', async () => {
    const idb = new IDBFactory();
    await twoCopies(idb);
    const kv = memoryKeyValue();
    const store = await open(idb);
    const onLoaded = vi.fn();
    const r = await safeModeHooks(store, new BootTracker(kv, KEY), 'b', onLoaded).loadPrevious();
    expect(r).toMatchObject({ ok: true, message: previousCopyNotice(5 * MIN) });
    expect(r.ok && r.world.seed).toBe(1);
    expect(onLoaded).toHaveBeenCalledWith({ copy: 'a', seq: 1 });
    expect(JSON.parse(kv.get(KEY) ?? 'null')).toMatchObject({ copy: 'a', phase: 'load' });
  });

  it('with no older copy it boots the failing copy once more instead of doing nothing', async () => {
    const idb = new IDBFactory();
    const s = await open(idb);
    await s.writeCritical(worldBytes(3));
    const onLoaded = vi.fn();
    const r = await safeModeHooks(s, new BootTracker(memoryKeyValue(), KEY), 'a', onLoaded).loadPrevious();
    expect(r).toMatchObject({ ok: true, message: NOTICE.retryingCopy });
    expect(r.ok && r.world.seed).toBe(3);
    expect(onLoaded).toHaveBeenCalledWith({ copy: 'a', seq: 1 });
  });

  it('nothing loadable at all: a reason, not a silent no-op', async () => {
    const idb = new IDBFactory();
    const s = await open(idb);
    await s.writeCritical(worldBytes(3));
    s.close();
    await tamper(idb, 'slot1/a', (r) => (r.crc ^= 1));
    const r = await safeModeHooks(await open(idb), new BootTracker(memoryKeyValue(), KEY), 'a', vi.fn()).loadPrevious();
    expect(r).toEqual({ ok: false, reason: NOTICE.noOlderCopy });
  });
});

describe('last-known-good promotion (04 §4.13)', () => {
  it('two saves inside BOOT_STABLE_MS rotate over the booted copy: it is not promoted', async () => {
    const idb = new IDBFactory();
    await twoCopies(idb);
    const { initial, store } = await boot(idb, memoryKeyValue());
    const booted = initial.loaded!;
    await store.writeCritical(worldBytes(4)); // hide
    await store.writeCritical(worldBytes(5)); // pagehide / respawn: back onto the booted copy
    expect(await store.promoteGood(booted.copy, booted.seq)).toBe(false);
    expect(await store.readVerified('good')).toBeNull();
  });

  it('an untouched booted copy is promoted byte for byte', async () => {
    const idb = new IDBFactory();
    await twoCopies(idb);
    const { initial, store } = await boot(idb, memoryKeyValue());
    await store.writeCritical(worldBytes(4)); // one save: lands on the other copy
    expect(await store.promoteGood(initial.loaded!.copy, initial.loaded!.seq)).toBe(true);
    expect(await store.readVerified('good')).toEqual(worldBytes(2));
  });
});

describe('?seed (04 §11.3 test API)', () => {
  it('is honoured only with ?test=1, where saves are isolated in the test channel', () => {
    expect(seedOverride(new URLSearchParams('seed=7&test=1'), true)).toBe(7);
    expect(seedOverride(new URLSearchParams('seed=7&standalone=1'), false)).toBeNull();
    expect(seedOverride(new URLSearchParams('test=1'), true)).toBeNull();
  });

  it('a seed override never reads the store', async () => {
    const idb = new IDBFactory();
    await twoCopies(idb);
    const store = await open(idb);
    const initial = await loadInitialWorld({ store, late: null }, new BootTracker(memoryKeyValue(), KEY), 7);
    expect(initial).toMatchObject({ coldLoad: false, loaded: null });
    expect(initial.world.seed).toBe(7);
  });
});

describe('a stuck IndexedDB open (WebKit, or an upgrade blocked by another tab)', () => {
  it('boot goes on after the timeout without a store, with a notice', async () => {
    let settle: (s: SaveStore) => void = () => undefined;
    const opened = await openStore(() => new Promise<SaveStore>((r) => (settle = r)), 10);
    expect(opened.store).toBeNull();
    expect(opened.late).not.toBeNull();
    const initial = await loadInitialWorld(opened, new BootTracker(memoryKeyValue(), KEY), null);
    expect(initial.notice).toEqual({ text: NOTICE.savesNotLoading, tone: 'warn', aboutWorld: false });
    const s = await open(new IDBFactory());
    settle(s);
    await expect(opened.late).resolves.toBe(s);
  });

  it('a failed open is "unavailable" at once; a quick open is used as is', async () => {
    const failed = await openStore(() => Promise.reject(new Error('no IDB')), 1_000);
    expect(failed).toEqual({ store: null, late: null });
    const initial = await loadInitialWorld(failed, new BootTracker(memoryKeyValue(), KEY), null);
    expect(initial.notice?.text).toBe(NOTICE.savesUnavailable);
    const s = await open(new IDBFactory());
    expect(await openStore(async () => s, 1_000)).toEqual({ store: s, late: null });
  });

  it('the late store is used only when it holds no save (this session never loaded one)', async () => {
    const empty = await open(new IDBFactory());
    expect(await adoptLateStore(Promise.resolve(empty))).toBe(empty);

    const idb = new IDBFactory();
    await twoCopies(idb);
    const full = await open(idb);
    expect(await adoptLateStore(Promise.resolve(full))).toBeNull();
    expect(full.isOpen).toBe(false);
    expect((await (await open(idb)).listCopies()).map((c) => c.seq)).toEqual([2, 1]);

    expect(await adoptLateStore(Promise.resolve(null))).toBeNull();
  });

  it('LateSink writes nowhere until a store is attached', async () => {
    const sink = new LateSink();
    expect(await sink.writeCritical(new Uint8Array([1]))).toEqual({ ok: false, error: 'closed' });
    const s = await open(new IDBFactory());
    sink.attach(s);
    expect(await sink.writeCritical(new Uint8Array([1]))).toMatchObject({ ok: true });
  });
});
