// HFSV codec: round trip, determinism after load, corruption detection, bounds, export codes, fuzzing
// (canon §3.15; 04 §4.9, §4.13).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NO_INTENT, type PodIntent } from '../../src/pod/types';
import { EXPORT_PREFIX, MINE_W } from '../../src/shared/canon';
import { T, mineralCode } from '../../src/shared/types';
import {
  SAVE_VERSION,
  SaveError,
  crc32,
  decodeExportCode,
  deserialize,
  encodeExportCode,
  serialize,
} from '../../src/save/codec';
import { decodeBase64Url, encodeBase64Url } from '../../src/save/codec/base64url';
import { World } from '../../src/world/world';

const intent = (p: Partial<PodIntent>): PodIntent => ({ ...NO_INTENT, ...p });

/** A deterministic input script: drive, dig, thrust, fire a slot, idle. */
function scripted(i: number): PodIntent {
  const phase = Math.floor(i / 90) % 6;
  switch (phase) {
    case 0:
      return intent({ sx: 1 });
    case 1:
      return intent({ sy: -1 });
    case 2:
      return intent({ sx: -0.8, sy: -0.2 });
    case 3:
      return intent({ thrust: true, sx: 0.3 });
    case 4:
      return i % 90 === 10 ? intent({ fireSlot: 0 }) : NO_INTENT;
    default:
      return intent({ sy: -1 });
  }
}

/** A world with history: dug cells, cargo, upgrades, consumables, debt, flags, a mid-air pod. */
function playedWorld(): World {
  const w = new World({ seed: 99, scope: 'm0' });
  for (let r = 1; r <= 5; r++) w.terrain.set(7, r, mineralCode(1 + (r % 3)));
  w.debugGiveCash(50_000);
  w.buyUpgrade('bay', 2);
  w.buyConsumable('hopBeacon', 3);
  w.setQuickSlot(0, 'hopBeacon');
  w.story.flags.s0 = true;
  w.story.flags.tutorialHint = false;
  w.pod.cargo.push({ kind: 'kit', id: 'autoDrill2' }, { kind: 'relic', id: 3 });
  w.wallet.debt = 12;
  for (let i = 0; i < 700; i++) w.step(scripted(i), i % 97 !== 0);
  w.drainEvents();
  return w;
}

function expectSameState(a: World, b: World): void {
  expect(b.seed).toBe(a.seed);
  expect(b.scope).toBe(a.scope);
  expect(b.deepHeat).toBe(a.deepHeat);
  expect(b.stepNo).toBe(a.stepNo);
  expect(b.meta).toEqual(a.meta);
  expect(b.pod).toEqual(a.pod);
  expect(b.wallet).toEqual(a.wallet);
  expect(b.story).toEqual(a.story);
  expect(b.terrain.terrain).toEqual(a.terrain.terrain);
  expect(b.terrain.flags).toEqual(a.terrain.flags);
  expect(b.terrain.lodeIndex).toEqual(a.terrain.lodeIndex);
  expect(b.terrain.lodes).toEqual(a.terrain.lodes);
  expect(b.saveState().rng).toEqual(a.saveState().rng);
  expect(b.saveState().pads).toEqual(a.saveState().pads);
}

/** Rewrite the CRC trailer so tests can reach the checks behind it. */
function withFixedCrc(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  new DataView(out.buffer).setUint32(out.length - 4, crc32(out, 0, out.length - 4), true);
  return out;
}

interface Section {
  tag: string;
  start: number;
  end: number;
}
function sections(bytes: Uint8Array): Section[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset);
  const out: Section[] = [];
  for (let p = 6; p < bytes.length - 4; ) {
    const tag = String.fromCharCode(...bytes.subarray(p, p + 4));
    const len = v.getUint32(p + 4, true);
    out.push({ tag, start: p, end: p + 8 + len });
    p += 8 + len;
  }
  return out;
}

function errorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof SaveError) return e.code;
    throw e;
  }
}

describe('HFSV layout (04 §4.9)', () => {
  it('magic, version, eight sections, CRC32 trailer', () => {
    const bytes = new World({ seed: 1, scope: 'm0' }).serialize();
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('HFSV');
    expect(new DataView(bytes.buffer).getUint16(4, true)).toBe(SAVE_VERSION);
    expect(sections(bytes).map((s) => s.tag)).toEqual(['META', 'TERR', 'LODE', 'PODS', 'WALT', 'STRY', 'RNGS', 'PADS']);
    expect(new DataView(bytes.buffer).getUint32(bytes.length - 4, true)).toBe(crc32(bytes, 0, bytes.length - 4));
    expect(bytes.length).toBeLessThan(100_000);
  });

  it('serialize returns an owned copy each time', () => {
    const w = new World({ seed: 1, scope: 'm0' });
    const a = w.serialize();
    w.step(intent({ sx: 1 }), true);
    const b = w.serialize();
    expect(a).not.toBe(b);
    expect(a).not.toEqual(b);
  });
});

describe('round trip', () => {
  it('restores identical state', () => {
    const a = playedWorld();
    const b = World.deserialize(a.serialize());
    expectSameState(a, b);
  });

  it('a fresh world round-trips too, in every scope', () => {
    for (const scope of ['m0', 'mvp', 'v1'] as const) {
      const a = new World({ seed: 3, scope, deepHeat: scope === 'mvp' });
      expectSameState(a, World.deserialize(a.serialize()));
    }
  });

  it('a loaded world steps identically to the original', () => {
    const a = playedWorld();
    const b = World.deserialize(a.serialize());
    const ea = [];
    const eb = [];
    for (let i = 0; i < 1_200; i++) {
      const input = scripted(i + 33);
      a.step(input, true);
      b.step(input, true);
      ea.push(...a.drainEvents());
      eb.push(...b.drainEvents());
    }
    expect(eb).toEqual(ea);
    expect(b.serialize()).toEqual(a.serialize());
  });

  it('a save taken mid-dig resumes the dig', () => {
    const a = new World({ seed: 5, scope: 'm0' });
    for (let i = 0; i < 400 && !a.pod.dig; i++) a.step(intent({ sy: -1 }), true);
    for (let i = 0; i < 5; i++) a.step(intent({ sy: -1 }), true);
    expect(a.pod.dig).not.toBeNull();
    const b = World.deserialize(a.serialize());
    expect(b.pod.dig).toEqual(a.pod.dig);
    for (let i = 0; i < 120; i++) {
      a.step(intent({ sy: -1 }), true);
      b.step(intent({ sy: -1 }), true);
    }
    expect(b.pod).toEqual(a.pod);
  });

  it('the codec round-trips SaveState directly', () => {
    const s = playedWorld().saveState();
    const back = deserialize(serialize(s));
    expect(back.pod).toEqual(s.pod);
    expect(back.story).toEqual(s.story);
    expect(back.pads).toEqual(s.pads);
  });
});

describe('corruption (04 §4.13)', () => {
  const good = new World({ seed: 11, scope: 'm0' }).serialize();

  it('detects a flipped byte by CRC', () => {
    for (const at of [7, 500, 30_000, good.length - 10]) {
      const bad = good.slice();
      bad[at] ^= 0x40;
      expect(errorCode(() => World.deserialize(bad))).toBe('crc');
    }
  });

  it('detects a damaged trailer', () => {
    const bad = good.slice();
    bad[bad.length - 1] ^= 1;
    expect(errorCode(() => deserialize(bad))).toBe('crc');
  });

  it('rejects truncation, foreign files and other versions', () => {
    expect(errorCode(() => deserialize(good.subarray(0, 5)))).toBe('truncated');
    expect(errorCode(() => deserialize(good.subarray(0, good.length - 100)))).toBe('crc');
    expect(errorCode(() => deserialize(new Uint8Array(64)))).toBe('magic');
    const newer = good.slice();
    new DataView(newer.buffer).setUint16(4, SAVE_VERSION + 1, true);
    expect(errorCode(() => deserialize(withFixedCrc(newer)))).toBe('version');
  });

  it('rejects out-of-bounds values even with a valid CRC', () => {
    const terr = sections(good).find((s) => s.tag === 'TERR')!;
    const badCode = good.slice();
    badCode[terr.start + 12 + 100] = 200;
    expect(errorCode(() => deserialize(withFixedCrc(badCode)))).toBe('bounds');

    const pods = sections(good).find((s) => s.tag === 'PODS')!;
    const badX = good.slice();
    new DataView(badX.buffer).setFloat64(pods.start + 8, Number.NaN, true);
    expect(errorCode(() => deserialize(withFixedCrc(badX)))).toBe('bounds');
    new DataView(badX.buffer).setFloat64(pods.start + 8, MINE_W + 5, true);
    expect(errorCode(() => deserialize(withFixedCrc(badX)))).toBe('bounds');
  });

  it('requires every section and skips unknown ones', () => {
    const secs = sections(good);
    const pads = secs.find((s) => s.tag === 'PADS')!;
    const missing = new Uint8Array(good.length - (pads.end - pads.start));
    missing.set(good.subarray(0, pads.start));
    missing.set(good.subarray(pads.end), pads.start);
    expect(errorCode(() => deserialize(withFixedCrc(missing)))).toBe('missing');

    const extra = new Uint8Array(good.length + 11);
    extra.set(good.subarray(0, 6));
    extra.set([0x58, 0x54, 0x52, 0x41, 3, 0, 0, 0, 1, 2, 3], 6); // 'XTRA', len 3
    extra.set(good.subarray(6), 17);
    expect(World.deserialize(withFixedCrc(extra)).seed).toBe(11);

    const dup = new Uint8Array(good.length + (pads.end - pads.start));
    dup.set(good.subarray(0, good.length - 4));
    dup.set(good.subarray(pads.start, pads.end), good.length - 4);
    expect(errorCode(() => deserialize(withFixedCrc(dup)))).toBe('section');
  });

  it('fuzz: mutated saves load (and then step) or throw SaveError, never anything else', () => {
    const small = new World({ seed: 2, scope: 'm0' }).serialize();
    const secs = sections(small).filter((s) => s.tag !== 'TERR');
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: secs.length - 1 }), fc.nat(), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 6 }),
        (edits) => {
          const bytes = small.slice();
          for (const [si, off, v] of edits) {
            const s = secs[si];
            bytes[s.start + (off % (s.end - s.start))] = v;
          }
          let w: World;
          try {
            w = World.deserialize(withFixedCrc(bytes));
          } catch (e) {
            if (!(e instanceof SaveError)) throw e;
            return;
          }
          for (let i = 0; i < 60; i++) w.step(scripted(i * 7), true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fuzz: random truncations always throw SaveError', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: good.length - 1 }), (n) => {
        const cut = good.slice(0, n);
        expect(() => deserialize(n >= 10 ? withFixedCrc(cut) : cut)).toThrow(SaveError);
      }),
      { numRuns: 100 },
    );
  });
});

describe('export codes (canon §3.15: HF1: + base64url)', () => {
  it('round-trips a save', () => {
    const bytes = playedWorld().serialize();
    const code = encodeExportCode(bytes);
    expect(code.startsWith(EXPORT_PREFIX)).toBe(true);
    expect(code.slice(EXPORT_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeExportCode(code)).toEqual(bytes);
    expect(World.deserialize(decodeExportCode(code)).stepNo).toBe(700);
  });

  it('tolerates whitespace from pasting', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 251, 252, 0]);
    const code = encodeExportCode(bytes);
    const pasted = `  ${code.slice(0, 5)}\n${code.slice(5)} \n`;
    expect(decodeExportCode(pasted)).toEqual(bytes);
  });

  it('rejects foreign or malformed codes with SaveError', () => {
    expect(errorCode(() => decodeExportCode('HF2:AAAA'))).toBe('export');
    expect(errorCode(() => decodeExportCode('HF1:'))).toBe('export');
    expect(errorCode(() => decodeExportCode('HF1:AB+/'))).toBe('export');
    expect(errorCode(() => decodeExportCode('HF1:AAAAA'))).toBe('export');
    expect(errorCode(() => decodeExportCode('HF1:é'))).toBe('export');
  });

  it('base64url matches the RFC 4648 §5 reference for any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        const s = encodeBase64Url(bytes);
        expect(s).toBe(Buffer.from(bytes).toString('base64url'));
        expect(decodeBase64Url(s)).toEqual(bytes);
      }),
      { numRuns: 300 },
    );
  });
});

describe('bounds on load', () => {
  it('lode table rebuilds lodeIndex', () => {
    const w = new World({ seed: 21, scope: 'mvp' });
    const lode = w.terrain.lodes[3];
    const b = World.deserialize(w.serialize());
    expect(b.terrain.lodeAt(lode.x0 + 1, lode.top + 1)?.id).toBe(3);
    expect(b.terrain.get(lode.x0, lode.top)).toBe(T.LODE_ROCK);
  });
});
