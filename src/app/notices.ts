// Save, boot and update notices (03 §6.2: a toast is ≤ 40 characters, so each one names its action within the
// cap instead of being clipped; 04 §4.10 "Save damaged — restored the previous copy (n min older)").
import type { DigRefusal } from '../shared/events';
import type { Scope } from '../shared/types';

export const NOTICE = {
  storageFull: 'Storage full: export in Menu → Saves',
  saveFailed: 'Could not save: export your save',
  savesUnavailable: 'Saving is unavailable in this browser',
  /** IndexedDB did not open in time (04 §4.10): boot went on without the stored save. */
  savesNotLoading: 'Saves are not loading: restart the app',
  /** …and the store opened later, empty, so this session's world is saved after all. */
  savesBack: 'Saving works again',
  damagedNewClaim: 'Save damaged: started a new claim',
  noOlderCopy: 'No older copy: export or start over',
  /** Safe Mode with no older copy: "Try again" boots the failing copy once more. */
  retryingCopy: 'No older copy: trying this save again',
  updateReady: 'Update ready: tap Update on the Rim',
  /** INT-3: specimens dug into a full bay are destroyed (canon §3.7). */
  bayFull: 'Bay full: open Cargo to make room',
  /** A sign tap needs Pip grounded on the Rim (01 §3.10). */
  landFirst: 'Land on the Rim first',
  /** Sign-tap auto-drive: a hole Pip cannot skim lies on the way (01 §3.2 gap skim bridges 1-wide gaps only). */
  holeAhead: 'Hole in the way: fly over',
  /** …the drive ended with Pip off the Rim (it never ends silently). */
  driveLeftRim: 'Auto-drive stopped: Pip left the Rim',
  /** …or stuck on the Rim for longer than a Rim crossing takes. */
  driveStuck: 'Auto-drive stopped: something in the way',
} as const;

/**
 * Pod refusal toasts (03 §6.2; 01 §3.4; INT-9). The sim emits one 'dig-refused' per push, so each push says it
 * once. Hardrock and lode rock answer with their clink / thunk and sparks only.
 */
export function refusalNotice(reason: DigRefusal, scope: Scope): string | null {
  switch (reason) {
    case 'paved':
      return 'Paved — dig beside the pad';
    case 'anchored':
      return 'Supports a belt — remove it first';
    case 'floor':
      return scope === 'm0' ? 'Test floor: the M0 dig ends here' : 'Co-op drilling rights end here';
    case 'seam':
      return 'Unknown seam: too hard to drill';
    case 'heartstone':
    case 'seal':
      return 'Nothing drills through that';
    default:
      return null;
  }
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "5 min", "3 h", "12 days": how much older a fallback copy is (at least 1 min). */
export function ageText(ms: number): string {
  if (ms < HOUR_MS) return `${Math.max(1, Math.round(ms / MINUTE_MS))} min`;
  if (ms < 2 * DAY_MS) return `${Math.round(ms / HOUR_MS)} h`;
  return `${Math.round(ms / DAY_MS)} days`;
}

/** Boot fell back to an older copy because the newest one failed its CRC or decode. */
export function damagedFallbackNotice(olderByMs: number): string {
  return `Damaged save: loaded copy ${ageText(olderByMs)} older`;
}

/** Safe Mode's "Load previous copy (n min older)" worked. */
export function previousCopyNotice(olderByMs: number): string {
  return `Loaded previous copy (${ageText(olderByMs)} older)`;
}
