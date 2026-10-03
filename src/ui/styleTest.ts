// M0 style test (03 §9.4; canon §5.1; INT-4, UI-4): blind A/B labels, the questionnaire and its paste code.
// Pure: no DOM (btoa/atob and TextEncoder exist in browsers and Node).
import type { Look } from '../shared/types';

/** Result paste code: `HFST1:` + base64url(UTF-8 JSON). */
export const STYLE_RESULT_PREFIX = 'HFST1:';

/** 03 §9.4 item 5: rated 1–5 for each look. */
export const STYLE_QUESTIONS = [
  'Ore readability',
  'Feels like Little Rocket Lab',
  'Charm',
  'Eye comfort',
  'Motion',
  'Build clarity',
] as const;

/** 03 §9.4 item 4: the six gallery bookmarks (app/styleViews.ts stages them in this order). */
export const STYLE_BOOKMARK_LABELS = ['Yard wide', 'Rim', 'Shaft, row 2', 'Ore, row 40', 'Hardrock + Magma', 'Yard build'] as const;

export type AbLabel = 'A' | 'B';
export type ShipChoice = AbLabel | 'both';

/**
 * Blind labels by seed parity (03 §9.4 item 2): on an even seed A is Clean Toon, on an odd one Pixel Lab, so the
 * label never tells the tester which look they are rating.
 */
export function abLabel(look: Look, seed: number): AbLabel {
  const toonIsA = (seed >>> 0) % 2 === 0;
  return (look === 'toon') === toonIsA ? 'A' : 'B';
}

export function lookOf(label: AbLabel, seed: number): Look {
  return abLabel('toon', seed) === label ? 'toon' : 'pixel';
}

export interface StyleAnswers {
  /** Ratings per question for look A and look B: 1–5, 0 = not answered. */
  a: number[];
  b: number[];
  ship: ShipChoice | null;
  note: string;
}

export function emptyAnswers(): StyleAnswers {
  return { a: STYLE_QUESTIONS.map(() => 0), b: STYLE_QUESTIONS.map(() => 0), ship: null, note: '' };
}

/** Untrusted stored answers → well-formed answers (anything malformed starts empty). */
export function sanitizeAnswers(raw: unknown): StyleAnswers {
  const d = emptyAnswers();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const ratings = (v: unknown): number[] =>
    STYLE_QUESTIONS.map((_, i) => {
      const n = Array.isArray(v) ? v[i] : 0;
      return Number.isInteger(n) && n >= 0 && n <= 5 ? (n as number) : 0;
    });
  return {
    a: ratings(r.a),
    b: ratings(r.b),
    ship: r.ship === 'A' || r.ship === 'B' || r.ship === 'both' ? r.ship : null,
    note: typeof r.note === 'string' ? r.note.slice(0, 500) : '',
  };
}

export interface StyleResult {
  v: 1;
  build: string;
  seed: number;
  /** Which look "A" was in this claim. */
  aIs: Look;
  answers: StyleAnswers;
  /** The Perf Report code (`HFP1:`…) with the per-look frame segments (04 §10.3). */
  perf: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeStyleResult(r: StyleResult): string {
  return STYLE_RESULT_PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(r)));
}

/** Throws on anything that is not a style-test result code. */
export function decodeStyleResult(code: string): StyleResult {
  const c = code.trim();
  if (!c.startsWith(STYLE_RESULT_PREFIX)) throw new Error('not a style-test result code');
  const r = JSON.parse(new TextDecoder().decode(fromBase64Url(c.slice(STYLE_RESULT_PREFIX.length)))) as Partial<StyleResult>;
  if (r.v !== 1 || typeof r.seed !== 'number' || (r.aIs !== 'toon' && r.aIs !== 'pixel')) throw new Error('unknown result version');
  return { v: 1, build: String(r.build ?? ''), seed: r.seed, aIs: r.aIs, answers: sanitizeAnswers(r.answers), perf: String(r.perf ?? '') };
}
