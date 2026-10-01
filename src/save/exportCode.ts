// Export/import codes (canon §3.15: `HF1:` + base64url). The pure codec owns the format; this adapter gives the
// app one normalised result shape whatever the codec returns (bytes, a Result-like object, or a throw).
import { EXPORT_PREFIX } from '../shared/canon';
import { decodeExportCode, encodeExportCode } from './codec';

export type DecodedCode = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };

export const CODE_NOT_A_SAVE = 'That code is not a HoleFactory save';
export const CODE_DAMAGED = 'That code is damaged';

export function encodeSaveCode(bytes: Uint8Array): string {
  return String(encodeExportCode(bytes));
}

function fromObject(o: Record<string, unknown>): DecodedCode | null {
  for (const k of ['bytes', 'value', 'data']) {
    const b = o[k];
    if (b instanceof Uint8Array) return { ok: true, bytes: b };
  }
  if (o.ok === false) {
    const why = o.reason ?? o.error ?? o.message;
    return { ok: false, reason: typeof why === 'string' && why ? why : CODE_DAMAGED };
  }
  return null;
}

export function decodeSaveCode(code: string): DecodedCode {
  const trimmed = code.trim();
  if (!trimmed.startsWith(EXPORT_PREFIX)) return { ok: false, reason: CODE_NOT_A_SAVE };
  try {
    const r: unknown = decodeExportCode(trimmed);
    if (r instanceof Uint8Array) return { ok: true, bytes: r };
    if (r && typeof r === 'object') return fromObject(r as Record<string, unknown>) ?? { ok: false, reason: CODE_DAMAGED };
    return { ok: false, reason: CODE_DAMAGED };
  } catch {
    return { ok: false, reason: CODE_DAMAGED };
  }
}
