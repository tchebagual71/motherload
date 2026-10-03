// HFSV save codec (canon §3.15; 04 §4.9, §4.13). PURE MODULE.
//
// Layout (little-endian):  'HFSV' · u16 version · sections… · u32 CRC32
//   section = FourCC · u32 length · body
// The CRC32 covers every byte before the trailer. Readers skip unknown FourCCs, so later builds can add
// sections without a version bump; a changed meaning needs a new version and a migration (04 §4.11).
// Compression and storage live in the app shell (src/save), never here.
import { EXPORT_PREFIX, SAVE_MAGIC } from '../../shared/canon';
import { decodeBase64Url, encodeBase64Url } from './base64url';
import { ByteReader, ByteWriter } from './bytes';
import { crc32 } from './crc32';
import { SaveError } from './errors';
import {
  TAG,
  readLodes,
  readMeta,
  readPads,
  readGhostTimer,
  readPod,
  readRng,
  readStory,
  readTerrain,
  readWallet,
  writeLodes,
  writeMeta,
  writePads,
  writeGhostTimer,
  writePod,
  writeRng,
  writeStory,
  writeTerrain,
  writeWallet,
} from './sections';
import type { SaveState } from './types';

export { SaveError, isSaveError, type SaveErrorCode } from './errors';
export { crc32 } from './crc32';
export type { PadSnapshot, SaveState } from './types';

/**
 * HFSV format version (04 §4.9, §4.11). M0 wrote 0; the MVP writes 1 (Kit meter units in cargo, the ghost
 * timer in PODS, the optional FACT section). Version 0 still loads: no FACT, so the World hosts a fresh factory.
 */
export const SAVE_VERSION = 1;
/** Oldest version this build reads. */
export const MIN_SAVE_VERSION = 0;
/** 04 §4.9: an HFSV file is ≤ 1 MiB uncompressed. */
export const MAX_SAVE_BYTES = 1 << 20;

const HEADER_BYTES = 6;
const SECTION_HEADER_BYTES = 8;
const CRC_BYTES = 4;
const REQUIRED = [TAG.META, TAG.TERR, TAG.LODE, TAG.PODS, TAG.WALT, TAG.STRY, TAG.RNGS, TAG.PADS] as const;
/** Present when the World hosts a factory (MVP+). */
const OPTIONAL = [TAG.FACT] as const;
type Tag = (typeof REQUIRED)[number] | (typeof OPTIONAL)[number];
const KNOWN: ReadonlySet<string> = new Set<string>([...REQUIRED, ...OPTIONAL]);

/** Reused between saves: the critical path must not grow a fresh 60 KB buffer each time. */
const writer = new ByteWriter();

function section(w: ByteWriter, tag: Tag, body: () => void): void {
  w.ascii4(tag);
  const at = w.beginLength();
  body();
  w.endLength(at);
}

/** Encode the full World state as raw (uncompressed) HFSV bytes. */
export function serialize(s: SaveState): Uint8Array {
  const w = writer;
  w.reset();
  w.ascii4(SAVE_MAGIC);
  w.u16(SAVE_VERSION);
  section(w, TAG.META, () => writeMeta(w, s));
  section(w, TAG.TERR, () => writeTerrain(w, s.grid));
  section(w, TAG.LODE, () => writeLodes(w, s.grid.lodes));
  section(w, TAG.PODS, () => {
    writePod(w, s.pod);
    writeGhostTimer(w, s.ghost);
  });
  section(w, TAG.WALT, () => writeWallet(w, s.wallet));
  section(w, TAG.STRY, () => writeStory(w, s.story));
  section(w, TAG.RNGS, () => writeRng(w, s.rng));
  section(w, TAG.PADS, () => writePads(w, s.pads));
  const fact = s.factory;
  if (fact) section(w, TAG.FACT, () => w.bytes(fact));
  w.u32(crc32(w.view8()));
  return w.toBytes();
}

/** Check magic, CRC and version; returns the version and the section table (tag → body window). */
function readEnvelope(bytes: Uint8Array): { version: number; table: Map<string, [number, number]> } {
  if (bytes.length > MAX_SAVE_BYTES) throw new SaveError('bounds', `Save is larger than ${MAX_SAVE_BYTES} bytes`);
  if (bytes.length < HEADER_BYTES + CRC_BYTES) throw new SaveError('truncated', 'Save is too short');
  const head = new ByteReader(bytes);
  if (head.ascii4('magic') !== SAVE_MAGIC) throw new SaveError('magic', 'Not a HoleFactory save');
  const end = bytes.length - CRC_BYTES;
  const stored = new ByteReader(bytes, end).u32('CRC');
  if (crc32(bytes, 0, end) !== stored) throw new SaveError('crc', 'Save is damaged (checksum mismatch)');
  const version = head.u16('version');
  if (version > SAVE_VERSION) throw new SaveError('version', 'Save is from a newer version');
  if (version < MIN_SAVE_VERSION) throw new SaveError('version', "This test save can't be loaded");

  const table = new Map<string, [number, number]>();
  const r = new ByteReader(bytes, HEADER_BYTES, end);
  while (r.remaining > 0) {
    if (r.remaining < SECTION_HEADER_BYTES) throw new SaveError('truncated', 'Save ends inside a section header');
    const tag = r.ascii4('section tag');
    const len = r.u32('section length');
    const start = r.pos;
    r.bytes(len, `section ${tag}`);
    if (!KNOWN.has(tag)) continue;
    if (table.has(tag)) throw new SaveError('section', `Duplicate section ${tag}`);
    table.set(tag, [start, start + len]);
  }
  for (const tag of REQUIRED) if (!table.has(tag)) throw new SaveError('missing', `Save has no ${tag} section`);
  // Version 0 predates the factory: a FACT section there is not one this build wrote.
  if (version < 1 && table.has(TAG.FACT)) throw new SaveError('section', 'Version 0 save with a FACT section');
  return { version, table };
}

/** Run `read` over one section body and require it to consume the body exactly. */
function readSection<T>(bytes: Uint8Array, table: Map<string, [number, number]>, tag: Tag, read: (r: ByteReader) => T): T {
  const [start, end] = table.get(tag)!;
  const r = new ByteReader(bytes, start, end);
  const value = read(r);
  if (r.remaining !== 0) throw new SaveError('section', `Section ${tag} has ${r.remaining} unread bytes`);
  return value;
}

/** Decode and validate HFSV bytes. Throws SaveError on any corruption; never anything else. */
export function deserialize(bytes: Uint8Array): SaveState {
  try {
    return decode(bytes);
  } catch (e) {
    if (e instanceof SaveError) throw e;
    throw new SaveError('bounds', `Save could not be decoded: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function decode(bytes: Uint8Array): SaveState {
  const { version, table } = readEnvelope(bytes);
  const meta = readSection(bytes, table, TAG.META, readMeta);
  const grid = readSection(bytes, table, TAG.TERR, (r) => readTerrain(r, meta.seed));
  readSection(bytes, table, TAG.LODE, (r) => readLodes(r, grid));
  if (meta.scriptedLodeId >= grid.lodes.length && grid.lodes.length > 0) {
    throw new SaveError('bounds', `scriptedLodeId out of range: ${meta.scriptedLodeId}`);
  }
  return {
    seed: meta.seed,
    scope: meta.scope,
    deepHeat: meta.deepHeat,
    stepNo: meta.stepNo,
    meta: { surveyColumn: meta.surveyColumn, scriptedLodeId: meta.scriptedLodeId },
    grid,
    ...readSection(bytes, table, TAG.PODS, (r) => {
      const pod = readPod(r, version);
      return version >= 1 ? { pod, ghost: readGhostTimer(r) } : { pod };
    }),
    wallet: readSection(bytes, table, TAG.WALT, readWallet),
    story: readSection(bytes, table, TAG.STRY, readStory),
    rng: readSection(bytes, table, TAG.RNGS, readRng),
    pads: readSection(bytes, table, TAG.PADS, readPads),
    ...readFactory(bytes, table),
  };
}

/** The FACT body as an owned copy (the factory parses and validates it when the World hosts it). */
function readFactory(bytes: Uint8Array, table: Map<string, [number, number]>): { factory?: Uint8Array } {
  const at = table.get(TAG.FACT);
  return at ? { factory: bytes.slice(at[0], at[1]) } : {};
}

// ---------- Export codes (canon §3.15: `HF1:` + base64url) ----------

export function encodeExportCode(bytes: Uint8Array): string {
  return EXPORT_PREFIX + encodeBase64Url(bytes);
}

/** Bytes of an `HF1:` code (whitespace from pasting is ignored). Throws SaveError('export') if malformed. */
export function decodeExportCode(code: string): Uint8Array {
  const s = code.replace(/\s+/g, '');
  if (!s.startsWith(EXPORT_PREFIX)) throw new SaveError('export', 'That code is not a HoleFactory save');
  const body = s.slice(EXPORT_PREFIX.length);
  if (body.length === 0) throw new SaveError('export', 'That code is empty');
  return decodeBase64Url(body);
}
