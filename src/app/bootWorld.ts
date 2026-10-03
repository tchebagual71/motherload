// Which World the app boots into (canon §3.15; 04 §4.10–4.13): open the store, apply boot tracking (Safe Mode
// after two boots of one copy died before their first frame), load the newest copy that verifies and decodes,
// or start a fresh claim. Also the Safe Mode actions over the failing copy.
import { SCOPE } from '../config/scope';
import { channel } from '../platform/channel';
import { BootTracker } from '../save/bootTrack';
import { decodeSaveCode, encodeSaveCode } from '../save/exportCode';
import { headerUnloadable, unloadable, unloadableKind, type Unloadable } from '../save/legacy';
import type { SaveSink } from '../save/scheduler';
import { SaveStore, type CopyId, type SaveSummary, type WriteOutcome } from '../save/store';
import { World } from '../world/world';
import type { WorldApi } from '../world/api';
import type { KeptSaveHooks, SafeModeHooks, SaveCodes, WorldFactory } from './controller';
import { damagedFallbackNotice, NOTICE, previousCopyNotice } from './notices';

/**
 * Every world the app adopts plays under the build's scope (INT-6): a fresh claim gets it, and a stored or
 * imported save from an older scope migrates forward (world/loadScope.ts); a newer one is refused like a newer
 * save version.
 */
export const worlds: WorldFactory = {
  create: (seed) => new World({ seed, scope: SCOPE }),
  deserialize: (bytes) => World.deserialize(bytes, SCOPE),
};

export const codes: SaveCodes = { encode: encodeSaveCode, decode: decodeSaveCode };

/** Stand-in when IndexedDB is unavailable: every write reports 'closed' (no toast spam). */
export const nullSink: SaveSink = {
  writeCritical: () => Promise.resolve<WriteOutcome>({ ok: false, error: 'closed' }),
  writeRoutine: () => Promise.resolve<WriteOutcome>({ ok: false, error: 'closed' }),
};

/** A sink that writes nowhere until a store is attached (a store that opened after boot gave up on it). */
export class LateSink implements SaveSink {
  private target: SaveSink = nullSink;

  attach(s: SaveSink): void {
    this.target = s;
  }

  writeCritical(bytes: Uint8Array, summary?: SaveSummary): Promise<WriteOutcome> {
    return this.target.writeCritical(bytes, summary);
  }

  writeRoutine(bytes: Uint8Array, summary?: SaveSummary): Promise<WriteOutcome> {
    return this.target.writeRoutine(bytes, summary);
  }
}

/** Non-sim randomness is fine in app/: a fresh claim gets a random 32-bit seed. */
export function randomSeed(): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  } catch {
    return (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
  }
}

/** ?seed=N (tests): a fresh world with that seed, ignoring stored saves. */
export function parseSeed(v: string | null): number | null {
  if (v === null || !/^\d+$/.test(v)) return null;
  return Number(v) >>> 0;
}

/**
 * The ?seed override is part of the ?test=1 API (04 §11.3) only: there saves go to the isolated `test` channel.
 * Anywhere else a fixed-seed world would be autosaved over the player's real save.
 */
export function seedOverride(params: URLSearchParams, testMode: boolean): number | null {
  return testMode ? parseSeed(params.get('seed')) : null;
}

/** How long boot waits for IndexedDB (a stuck WebKit open, an upgrade blocked by another tab) before going on. */
export const STORE_OPEN_TIMEOUT_MS = 3_000;

export interface OpenedStore {
  store: SaveStore | null;
  /** The open outlived STORE_OPEN_TIMEOUT_MS: boot went on without it. Settles when it opens (null = failed). */
  late: Promise<SaveStore | null> | null;
}

/** Storage problems never block boot (platform/storage.ts): a failed or stuck open boots without a store. */
export async function openStore(
  open: () => Promise<SaveStore> = () => SaveStore.open({ channel: channel() }),
  timeoutMs = STORE_OPEN_TIMEOUT_MS,
): Promise<OpenedStore> {
  const pending = Promise.resolve()
    .then(open)
    .catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const first = await Promise.race([pending, timeout]);
  clearTimeout(timer);
  return first === 'timeout' ? { store: null, late: pending } : { store: first, late: null };
}

/**
 * Use a store that opened after boot went on without it, but only if it holds no copies: this session never
 * loaded a stored save, so writing its world would overwrite one. Otherwise the store is closed again and the
 * session stays unsaved (the boot notice asks for a restart).
 */
export async function adoptLateStore(late: Promise<SaveStore | null>): Promise<SaveStore | null> {
  const s = await late;
  if (!s) return null;
  try {
    if ((await s.listCopies()).length === 0) return s;
  } catch {
    // Unreadable: leave it alone.
  }
  s.close();
  return null;
}

/** The stored save a world came from: promoted to last-known-good after a clean boot, if still these bytes. */
export interface LoadedCopy {
  copy: CopyId;
  seq: number;
}

export interface InitialWorld {
  world: WorldApi;
  coldLoad: boolean;
  loaded: LoadedCopy | null;
  /** Boot notice; `aboutWorld` = about the loaded copy (moot once the player starts a new game). */
  notice: { text: string; tone: 'info' | 'warn'; aboutWorld: boolean } | null;
  /** Safe Mode (04 §4.13): the copy whose boots keep dying before their first frame. */
  safeModeCopy: CopyId | null;
  /** No stored save was found or consulted: a first standalone launch offers "Paste save" (canon §3.15). */
  noSave: boolean;
  /**
   * The newest kept copy this build cannot load (an M0 test save, a newer version; 04 §4.11), offered for export.
   * `fresh`: it was refused (and moved out of the rotation) by this boot.
   */
  kept: KeptCopy | null;
  /** A save that cannot load is still in the rotation (the move failed): this session must not write. */
  readOnly: boolean;
}

export interface KeptCopy {
  key: string;
  kind: Unloadable;
  fresh: boolean;
}

export async function loadInitialWorld(opened: OpenedStore, tracker: BootTracker, seedParam: number | null): Promise<InitialWorld> {
  const fresh = (notice: InitialWorld['notice'] = null, safeModeCopy: CopyId | null = null, noSave = false): InitialWorld => ({
    world: worlds.create(seedParam ?? randomSeed()),
    coldLoad: false,
    loaded: null,
    notice,
    safeModeCopy,
    noSave,
    kept: null,
    readOnly: false,
  });
  if (seedParam !== null) return fresh(null, null, true);
  const store = opened.store;
  if (!store) return fresh({ text: opened.late ? NOTICE.savesNotLoading : NOTICE.savesUnavailable, tone: 'warn', aboutWorld: false });

  // The 04 §4.10 read path: the newest copy that verifies and decodes. The tracked copy is always the one about
  // to be decoded and booted, so a copy that keeps killing the boot (in its decode, or later) reaches Safe Mode
  // on its own count, fallback copies included. A copy this build can never load (04 §4.11) is skipped like a
  // damaged one, but kept: moved out of the rotation before anything is written, and offered for export.
  const refused: CopyId[] = [];
  const done = (r: InitialWorld): Promise<InitialWorld> => keepRefused(store, refused, r);
  const copies = await store.listCopies();
  if (copies.length === 0) return done(fresh(null, null, true));
  for (let i = 0; i < copies.length; i++) {
    const info = copies[i];
    const verdict = i === 0 ? tracker.begin(store.slot, info.copy) : tracker.retarget(info.copy);
    if (verdict.safeMode) return done(fresh(null, info.copy));
    const bytes = await store.readVerified(info.copy);
    if (!bytes) continue;
    let world: WorldApi;
    try {
      world = worlds.deserialize(bytes);
    } catch (e) {
      // Corrupt content behind a valid CRC: the next older copy.
      if (unloadable(e, bytes)) refused.push(info.copy);
      continue;
    }
    const notice = i > refused.length ? { text: damagedFallbackNotice(copies[0].savedAt - info.savedAt), tone: 'warn' as const, aboutWorld: true } : null;
    // An older copy this build cannot load (an M0 save under a newer claim) is next in line for the rotation.
    for (const older of copies.slice(i + 1)) {
      const b = await store.readVerified(older.copy);
      if (b && headerUnloadable(b)) refused.push(older.copy);
    }
    return done({ world, coldLoad: true, loaded: { copy: info.copy, seq: info.seq }, notice, safeModeCopy: null, noSave: false, kept: null, readOnly: false });
  }
  tracker.clear();
  // Only saves this build cannot load: not damaged, so a new claim without the "damaged" notice.
  if (refused.length > 0 && refused.length === copies.length) return done(fresh());
  return done(fresh({ text: NOTICE.damagedNewClaim, tone: 'warn', aboutWorld: true }));
}

/**
 * 04 §4.11 "never overwritten": move the refused copies to kept keys, then describe the newest kept copy (this
 * boot's, or one an earlier boot kept). A failed move leaves them in the rotation, so the session goes read-only.
 */
async function keepRefused(store: SaveStore, refused: readonly CopyId[], r: InitialWorld): Promise<InitialWorld> {
  let moved = true;
  try {
    moved = await store.keep(refused);
  } catch {
    moved = false;
  }
  if (!moved) return { ...r, notice: { text: NOTICE.savesReadOnly, tone: 'warn', aboutWorld: false }, readOnly: true };
  const kept = await newestKept(store, refused.length > 0);
  if (!kept) return r;
  // A save that loads still says how it loaded; otherwise the boot notice points at the kept copy's export.
  const notice = r.notice ?? (kept.fresh ? { text: kept.kind === 'test' ? NOTICE.testSaveKept : NOTICE.newerSaveKept, tone: 'warn' as const, aboutWorld: false } : null);
  return { ...r, kept, notice };
}

async function newestKept(store: SaveStore, fresh: boolean): Promise<KeptCopy | null> {
  try {
    const [newest] = await store.keptCopies();
    if (!newest) return null;
    const bytes = await store.readKept(newest.key);
    return { key: newest.key, kind: bytes ? unloadableKind(bytes) : 'test', fresh };
  } catch {
    return null;
  }
}

/** Export of the kept copy (04 §4.11 "with export"): the player keeps the file the build cannot load. */
export function keptSaveHooks(store: SaveStore, kept: KeptCopy): KeptSaveHooks {
  return {
    kind: kept.kind,
    fresh: kept.fresh,
    exportCode: async () => {
      const bytes = await store.readKept(kept.key);
      return bytes ? encodeSaveCode(bytes) : null;
    },
  };
}

/**
 * How much older the newest other copy is than the failing one (the Safe Mode card's "Load previous copy (n min
 * older)", APP-5), or null when there is no other copy.
 */
export async function previousCopyAge(store: Pick<SaveStore, 'listCopies'>, failing: CopyId): Promise<number | null> {
  const copies = await store.listCopies();
  const bad = copies.find((c) => c.copy === failing);
  const older = copies.find((c) => c.copy !== failing);
  if (!bad || !older) return null;
  return Math.max(0, bad.savedAt - older.savedAt);
}

/**
 * Safe Mode actions over the failing copy: export it, or "Load previous copy (n min older)". With no older copy
 * that loads, the failing copy itself is booted once more (a repeat death brings Safe Mode back next launch), so
 * the action is never a dead end.
 */
export function safeModeHooks(store: SaveStore, tracker: BootTracker, failing: CopyId, onLoaded: (loaded: LoadedCopy) => void): SafeModeHooks {
  const decode = (b: Uint8Array): WorldApi => worlds.deserialize(b);
  return {
    exportCode: async () => {
      const bytes = await store.readVerified(failing);
      return bytes ? encodeSaveCode(bytes) : null;
    },
    loadPrevious: async () => {
      const older = await store.load(decode, [failing]);
      if (older.kind === 'loaded') {
        tracker.begin(store.slot, older.copy);
        onLoaded({ copy: older.copy, seq: older.seq });
        return { ok: true, world: older.value, message: previousCopyNotice(older.olderByMs) };
      }
      const others = (await store.listCopies()).map((c) => c.copy).filter((c) => c !== failing);
      const again = await store.load(decode, others);
      if (again.kind !== 'loaded') return { ok: false, reason: NOTICE.noOlderCopy };
      tracker.begin(store.slot, again.copy);
      onLoaded({ copy: again.copy, seq: again.seq });
      return { ok: true, world: again.value, message: NOTICE.retryingCopy };
    },
  };
}
