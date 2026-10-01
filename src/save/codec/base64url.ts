// RFC 4648 §5 base64url without padding, in pure code (no btoa/atob, which the sim build does not have).
// PURE MODULE.
import { SaveError } from './errors';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ENC = new Uint8Array(64);
const DEC = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) {
  ENC[i] = ALPHABET.charCodeAt(i);
  DEC[ALPHABET.charCodeAt(i)] = i;
}
/** String.fromCharCode argument batch (well under every engine's argument limit). */
const CHARS_PER_CALL = 0x2000;

export function encodeBase64Url(bytes: Uint8Array): string {
  const n = bytes.length;
  const out = new Uint8Array(Math.ceil((n * 4) / 3));
  let o = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = ENC[v >>> 18];
    out[o++] = ENC[(v >>> 12) & 63];
    out[o++] = ENC[(v >>> 6) & 63];
    out[o++] = ENC[v & 63];
  }
  if (i < n) {
    const v = (bytes[i] << 16) | (i + 1 < n ? bytes[i + 1] << 8 : 0);
    out[o++] = ENC[v >>> 18];
    out[o++] = ENC[(v >>> 12) & 63];
    if (i + 1 < n) out[o++] = ENC[(v >>> 6) & 63];
  }
  let s = '';
  for (let k = 0; k < o; k += CHARS_PER_CALL) s += String.fromCharCode(...out.subarray(k, Math.min(o, k + CHARS_PER_CALL)));
  return s;
}

function sextet(s: string, i: number): number {
  const c = s.charCodeAt(i);
  const v = c < 128 ? DEC[c] : -1;
  if (v < 0) throw new SaveError('export', `Invalid character in save code at ${i}`);
  return v;
}

/** Throws SaveError('export') on any character outside the alphabet or an impossible length. */
export function decodeBase64Url(s: string): Uint8Array {
  const len = s.length;
  if (len % 4 === 1) throw new SaveError('export', 'Save code has an impossible length');
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const v = (sextet(s, i) << 18) | (sextet(s, i + 1) << 12) | (sextet(s, i + 2) << 6) | sextet(s, i + 3);
    out[o++] = v >>> 16;
    out[o++] = (v >>> 8) & 0xff;
    out[o++] = v & 0xff;
  }
  const rest = len - i;
  if (rest >= 2) {
    const v = (sextet(s, i) << 18) | (sextet(s, i + 1) << 12) | (rest === 3 ? sextet(s, i + 2) << 6 : 0);
    out[o++] = v >>> 16;
    if (rest === 3) out[o++] = (v >>> 8) & 0xff;
  }
  return out;
}
