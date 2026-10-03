// HFSV version 1 (04 §4.9, §4.11; canon §3.15): the FACT section, Kit meter units and the ghost timer in PODS,
// and the version 0 (M0) migration rule — no FACT means a fresh factory with the survey set.
import { describe, expect, it } from 'vitest';
import { NO_INTENT, type PodIntent } from '../../src/pod/types';
import { POD_H } from '../../src/shared/canon';
import { F, T } from '../../src/shared/types';
import { SAVE_VERSION, SaveError, crc32, deserialize } from '../../src/save/codec';
import { World } from '../../src/world/world';
import { onboardingWorld } from './integration.helpers';

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

/** Re-frame sections into a file with `version`, editing bodies by tag, with a fresh CRC. */
function reframe(bytes: Uint8Array, version: number, edit: (tag: string, body: Uint8Array) => Uint8Array | null = (_t, b) => b): Uint8Array {
  const parts: Uint8Array[] = [bytes.slice(0, 4), new Uint8Array([version & 0xff, version >> 8])];
  for (const s of sections(bytes)) {
    const body = edit(s.tag, bytes.slice(s.start + 8, s.end));
    if (!body) continue;
    const head = new Uint8Array(8);
    head.set(bytes.subarray(s.start, s.start + 4));
    new DataView(head.buffer).setUint32(4, body.length, true);
    parts.push(head, body);
  }
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n + 4);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  new DataView(out.buffer).setUint32(n, crc32(out, 0, n), true);
  return out;
}

/** An M0 (version 0) file from a kit-free world: PODS loses the v1 ghost timer, there is no FACT. */
function asVersion0(w: World): Uint8Array {
  if (w.pod.cargo.some((c) => c.kind === 'kit')) throw new Error('asVersion0: version 0 Kits carry no units byte; use a kit-free world');
  return reframe(w.serialize(), 0, (tag, body) => (tag === 'FACT' ? null : tag === 'PODS' ? body.slice(0, body.length - 4) : body));
}

/**
 * Hash of everything a save carries (world sections + FACT). The CRC runs over the payload only: a CRC-32 taken
 * over a file *including* its own CRC trailer is the constant residue 0x2144DF1C, whatever the content.
 */
const saveHash = (w: World): number => {
  const b = w.serialize();
  return crc32(b, 0, b.length - 4);
};

function standAt(w: World, x: number, r: number): void {
  const p = w.pod;
  p.x = p.prevX = x + 0.5;
  p.y = p.prevY = -(r + 1) + POD_H / 2;
  p.vx = p.vy = 0;
  p.grounded = true;
  p.row = Math.max(0, r);
}

/** A little pod life on the Rim between factory ticks: drive right, idle, drive left. */
function rimIntent(i: number): PodIntent {
  const phase = Math.floor(i / 240) % 4;
  return phase === 0 ? { ...NO_INTENT, sx: 0.8 } : phase === 2 ? { ...NO_INTENT, sx: -0.8 } : NO_INTENT;
}

describe('HFSV version 1 layout', () => {
  it('an MVP save is version 1 with FACT after the eight world sections; an M0-scope one has no FACT', () => {
    expect(SAVE_VERSION).toBe(1);
    const mvp = new World({ seed: 3, scope: 'mvp' }).serialize();
    expect(new DataView(mvp.buffer).getUint16(4, true)).toBe(1);
    expect(sections(mvp).map((s) => s.tag)).toEqual(['META', 'TERR', 'LODE', 'PODS', 'WALT', 'STRY', 'RNGS', 'PADS', 'FACT']);
    expect(deserialize(mvp).factory).toBeInstanceOf(Uint8Array);
    const m0 = new World({ seed: 3, scope: 'm0' }).serialize();
    expect(sections(m0).map((s) => s.tag)).not.toContain('FACT');
    expect(deserialize(m0).factory).toBeUndefined();
    expect(mvp.length).toBeLessThan(150_000);
  });
});

describe('factory round trip (02 §10.11 test 6, through the World)', () => {
  it('a claim with a drill, a lift, belts and items in flight reloads to the same state and runs on identically', () => {
    const { w } = onboardingWorld(7);
    const f = w.factory!;
    for (let i = 0; i < 900; i++) w.step(rimIntent(i), true);
    const lift = f.entities().find((e) => e.kind === 'lift')!;
    expect(f.inspect(lift.id)!.inFlight).toBeGreaterThan(0);
    expect(f.stockpileCount('copperIngot') + f.stockpileCount('copperOre')).toBeGreaterThanOrEqual(0);
    const bytes = w.serialize();
    const back = World.deserialize(bytes, 'mvp');
    expect(back.factory!.stateHash()).toBe(f.stateHash());
    expect(back.serialize()).toEqual(bytes);
    for (let i = 0; i < 3_000; i++) {
      w.step(rimIntent(900 + i), true);
      back.step(rimIntent(900 + i), true);
    }
    w.drainEvents();
    back.drainEvents();
    expect(back.factory!.stateHash()).toBe(f.stateHash());
    expect(saveHash(back)).toBe(saveHash(w));
    expect(f.stockpileCount('copperIngot')).toBeGreaterThan(0);
  });

  it('keeps Kit meter units in cargo and the ghost timer mid-count', () => {
    const w = new World({ seed: 7, scope: 'mvp' });
    const f = w.factory!;
    f.discoverLode(w.meta.scriptedLodeId, true);
    const g = w.terrain;
    for (let x = 12; x <= 24; x++) {
      g.set(x, 11, T.DIRT);
      g.set(x, 10, T.AIR);
      g.flags[g.idx(x, 10)] |= F.SEEN;
    }
    f.placeGhost({ kind: 'belt', x: 16, y: 10, dir: 0, length: 4 });
    w.pod.cargo.push({ kind: 'kit', id: 'belt', units: 5 }, { kind: 'kit', id: 'liftRail' });
    standAt(w, 15, 10);
    for (let i = 0; i < 35; i++) w.step(NO_INTENT, true);
    const bytes = w.serialize();
    const back = World.deserialize(bytes, 'mvp');
    expect(back.pod.cargo).toEqual(w.pod.cargo);
    expect(back.ghostProgress()).toEqual(w.ghostProgress());
    for (const x of [w, back]) for (let i = 0; i < 25; i++) x.step(NO_INTENT, true);
    expect(back.factory!.ghosts()).toHaveLength(0);
    expect(w.factory!.ghosts()).toHaveLength(0);
    expect(back.pod.cargo).toEqual([{ kind: 'kit', id: 'belt', units: 1 }, { kind: 'kit', id: 'liftRail' }]);
    expect(saveHash(back)).toBe(saveHash(w));
  });

  it('refuses a FACT body the factory cannot read as a SaveError, and a version 0 file carrying FACT', () => {
    const bytes = new World({ seed: 3, scope: 'mvp' }).serialize();
    const bad = reframe(bytes, 1, (tag, body) => {
      if (tag !== 'FACT') return body;
      const b = body.slice();
      b[0] = 0xff;
      b[1] = 0xff; // factory format version
      return b;
    });
    expect(() => World.deserialize(bad, 'mvp')).toThrow(SaveError);
    try {
      World.deserialize(bad, 'mvp');
    } catch (e) {
      expect((e as SaveError).code).toBe('section');
    }
    const v0WithFact = reframe(bytes, 0, (tag, body) => (tag === 'PODS' ? body.slice(0, body.length - 4) : body));
    expect(() => deserialize(v0WithFact)).toThrow(SaveError);
  });
});

describe('migration: version 0 (M0) saves (04 §4.11, MVP rule)', () => {
  function playedM0(): World {
    const w = new World({ seed: 7, scope: 'm0' });
    w.debugGiveCash(3_210);
    w.buyUpgrade('bay', 2);
    w.pod.cargo.push({ kind: 'mineral', tier: 2 }, { kind: 'relic', id: 1 });
    w.story.deepestRow = 50;
    w.story.trips = 4;
    w.story.flags.someFlag = true;
    w.terrain.lodes[w.meta.scriptedLodeId].discovered = true;
    for (let i = 0; i < 120; i++) w.step(i % 2 ? NO_INTENT : { ...NO_INTENT, sx: 0.5 }, true);
    w.drainEvents();
    return w;
  }

  it('loads with a fresh factory (survey set placed), keeping pod, wallet and story', () => {
    const m0 = playedM0();
    const v0 = asVersion0(m0);
    expect(new DataView(v0.buffer).getUint16(4, true)).toBe(0);
    expect(deserialize(v0).factory).toBeUndefined();
    const w = World.deserialize(v0, 'mvp');
    expect(w.scope).toBe('mvp');
    const f = w.factory!;
    expect(f.entities().map((e) => [e.kind, e.rusted])).toEqual([
      ['headframe', true],
      ['smelter', true],
      ['bin', true],
    ]);
    expect(f.entities().every((e) => e.x === f.entities()[0].x)).toBe(true);
    expect(w.pod).toEqual(m0.pod);
    expect(w.wallet).toEqual(m0.wallet);
    const { flags, ...rest } = w.story;
    const { flags: oldFlags, ...oldRest } = m0.story;
    expect(rest).toEqual(oldRest);
    for (const k of Object.keys(oldFlags)) expect(flags[k]).toBe(oldFlags[k]);
    // What the claim already knew reaches the factory quietly.
    expect(f.isUnlocked('U1')).toBe(true);
    expect(f.isUnlocked('U2')).toBe(true);
    expect(flags['rung:U2']).toBe(true);
    expect(w.starterKitReady()).toBe(true);
    expect(w.drainEvents()).toEqual([]);
    // It saves as version 1 with FACT from now on, and reloads unchanged.
    const v1 = w.serialize();
    expect(new DataView(v1.buffer).getUint16(4, true)).toBe(1);
    expect(World.deserialize(v1, 'mvp').serialize()).toEqual(v1);
  });

  it('an untouched M0 claim migrates to a factory equal to a new game’s', () => {
    const fresh = new World({ seed: 7, scope: 'mvp' });
    const migrated = World.deserialize(asVersion0(new World({ seed: 7, scope: 'm0' })), 'mvp');
    expect(migrated.factory!.stateHash()).toBe(fresh.factory!.stateHash());
    expect(migrated.factory!.isUnlocked('U2')).toBe(false);
    expect(migrated.starterKitReady()).toBe(false);
  });

  it('an M0 build’s version 1 file (no FACT) migrates the same way', () => {
    const m0 = playedM0();
    const w = World.deserialize(m0.serialize(), 'mvp');
    expect(w.factory!.entities()).toHaveLength(3);
    expect(w.factory!.isUnlocked('U2')).toBe(true);
    expect(w.pod).toEqual(m0.pod);
  });
});
