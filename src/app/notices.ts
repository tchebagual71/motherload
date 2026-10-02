// Save, boot and update notices (03 §6.2: a toast is ≤ 40 characters, so each one names its action within the
// cap instead of being clipped; 04 §4.10 "Save damaged — restored the previous copy (n min older)").
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
  updateReady: 'Update ready: it installs next launch',
} as const;

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
