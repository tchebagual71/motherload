// Which World the app boots into (canon §3.15; 04 §4.10–4.13): open the store, apply boot tracking (Safe Mode
// after two boots of one copy died before their first frame), load the newest copy that verifies and decodes,
// or start a fresh claim. Also the Safe Mode actions over the failing copy.
import { SCOPE } from '../config/scope';
import { channel } from '../platform/channel';
import { BootTracker } from '../save/bootTrack';
import { decodeSaveCode, encodeSaveCode } from '../save/exportCode';
import type { SaveSink } from '../save/scheduler';
import { SaveStore, type CopyId, type WriteOutcome } from '../save/store';
import { World } from '../world/world';
import type { WorldApi } from '../world/api';
import type { SafeModeHooks, SaveCodes, WorldFactory } from './controller';

export const worlds: WorldFactory = {
  create: (seed) => new World({ seed, scope: SCOPE }),
  deserialize: (bytes) => World.deserialize(bytes),
};

export const codes: SaveCodes = { encode: encodeSaveCode, decode: decodeSaveCode };

/** Stand-in when IndexedDB is unavailable: every write reports 'closed' (no toast spam). */
export const nullSink: SaveSink = {
  writeCritical: () => Promise.resolve<WriteOutcome>({ ok: false, error: 'closed' }),
  writeRoutine: () => Promise.resolve<WriteOutcome>({ ok: false, error: 'closed' }),
};

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

export async function openStore(): Promise<SaveStore | null> {
  try {
    return await SaveStore.open({ channel: channel() });
  } catch {
    return null;
  }
}

export interface InitialWorld {
  world: WorldApi;
  coldLoad: boolean;
  /** Stored copy the world came from (promoted to last-known-good after a clean boot). */
  copy: CopyId | null;
  notice: { text: string; tone: 'info' | 'warn' } | null;
  /** Safe Mode (04 §4.13): the copy whose boots keep dying before their first frame. */
  safeModeCopy: CopyId | null;
}

function minutesOlder(ms: number): string {
  return `${Math.max(1, Math.round(ms / 60_000))} min older`;
}

export async function loadInitialWorld(store: SaveStore | null, tracker: BootTracker, seedParam: number | null): Promise<InitialWorld> {
  const fresh = (notice: InitialWorld['notice'] = null, safeModeCopy: CopyId | null = null): InitialWorld => ({
    world: worlds.create(seedParam ?? randomSeed()),
    coldLoad: false,
    copy: null,
    notice,
    safeModeCopy,
  });
  if (seedParam !== null) return fresh();
  if (!store) return fresh({ text: 'Saving is unavailable in this browser', tone: 'warn' });

  const copies = await store.listCopies();
  if (copies.length === 0) return fresh();
  const latest = copies[0].copy;
  if (tracker.begin(store.slot, latest).safeMode) return fresh(null, latest);

  const r = await store.load((b) => worlds.deserialize(b));
  if (r.kind === 'loaded') {
    if (r.copy !== latest) tracker.retarget(r.copy);
    const notice = r.fallback ? { text: `Save damaged: restored the previous copy (${minutesOlder(r.olderByMs)})`, tone: 'warn' as const } : null;
    return { world: r.value, coldLoad: true, copy: r.copy, notice, safeModeCopy: null };
  }
  tracker.clear();
  return fresh(r.kind === 'damaged' ? { text: 'Save damaged: started a new claim', tone: 'warn' } : null);
}

/** Safe Mode actions over the failing copy: export it, or fall back to the next older copy. */
export function safeModeHooks(store: SaveStore, tracker: BootTracker, failing: CopyId, onLoaded: (copy: CopyId) => void): SafeModeHooks {
  return {
    exportCode: async () => {
      const bytes = await store.readVerified(failing);
      return bytes ? encodeSaveCode(bytes) : null;
    },
    loadPrevious: async () => {
      const r = await store.load((b) => worlds.deserialize(b), [failing]);
      if (r.kind !== 'loaded') return { ok: false, reason: 'No older copy: export it, then start a new game' };
      tracker.begin(store.slot, r.copy);
      onLoaded(r.copy);
      return { ok: true, world: r.value };
    },
  };
}
