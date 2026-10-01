// Typed decode failures (04 §4.13: corrupt saves fall back to the other copy; fuzzing allows no other
// exception to escape the decoder). PURE MODULE.

export type SaveErrorCode =
  /** Fewer bytes than a header, a section or a field needs. */
  | 'truncated'
  /** Not an HFSV file. */
  | 'magic'
  /** A format version this build cannot read (M0 saves never migrate). */
  | 'version'
  /** CRC32 trailer mismatch. */
  | 'crc'
  /** Malformed section table: duplicate or mis-sized section. */
  | 'section'
  /** A required section is absent. */
  | 'missing'
  /** A value outside its canon bounds. */
  | 'bounds'
  /** Not a valid `HF1:` export code. */
  | 'export';

export class SaveError extends Error {
  readonly code: SaveErrorCode;

  constructor(code: SaveErrorCode, message: string) {
    super(message);
    this.name = 'SaveError';
    this.code = code;
  }
}

export function isSaveError(e: unknown): e is SaveError {
  return e instanceof SaveError;
}
