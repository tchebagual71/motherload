// Saves this build can never load (04 §4.11): M0 test saves (HFSV version 0, never migrated) and files from a newer
// version or scope. Unlike a damaged copy they are not dropped for the next older one and never overwritten: boot
// moves them out of the rotation (SaveStore.keep) and the player can still export them.
import { SAVE_MAGIC } from '../shared/canon';
import { isSaveError, MIN_SAVE_VERSION, SAVE_VERSION } from './codec';

/** 'test': an M0 test-build save; 'newer': a save from a newer version or scope of the game. */
export type Unloadable = 'test' | 'newer';

/** The HFSV format version in a save's header ('HFSV', then u16 little-endian), or null for anything else. */
export function saveVersion(bytes: Uint8Array): number | null {
  if (bytes.length < SAVE_MAGIC.length + 2) return null;
  for (let i = 0; i < SAVE_MAGIC.length; i++) if (bytes[i] !== SAVE_MAGIC.charCodeAt(i)) return null;
  return bytes[4] | (bytes[5] << 8);
}

/**
 * Why a save that failed to load can never load in this build, or null when it is simply damaged. The codec and
 * World.deserialize refuse both kinds with SaveError 'version' (a too-old or too-new format, a newer scope).
 */
export function unloadable(e: unknown, bytes: Uint8Array): Unloadable | null {
  return isSaveError(e) && e.code === 'version' ? unloadableKind(bytes) : null;
}

/** Which kind of unloadable save `bytes` is, from its header version (a newer scope keeps the current version). */
export function unloadableKind(bytes: Uint8Array): Unloadable {
  const v = saveVersion(bytes);
  return v !== null && v < MIN_SAVE_VERSION ? 'test' : 'newer';
}

/**
 * The header alone says the save can never load here (a version outside this build's range), or null. For copies
 * older than the one that loaded: the rotation writes over the older copy next, so one this build cannot load must
 * be kept before then, without paying for a full decode. (A newer scope behind a current version needs the decode.)
 */
export function headerUnloadable(bytes: Uint8Array): Unloadable | null {
  const v = saveVersion(bytes);
  if (v === null) return null;
  return v < MIN_SAVE_VERSION ? 'test' : v > SAVE_VERSION ? 'newer' : null;
}
