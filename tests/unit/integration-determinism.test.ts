// Determinism suite (04 §11.1 "Determinism"; MVP-14; 02 §10.9): pod intents and factory commands driven
// through World.step give one combined world + factory hash, identical on repeat and across save → load,
// and pinned by a golden value. Pod replays stay exact while building (04 §3.6 coupling).
import { describe, expect, it } from 'vitest';
import { DIR } from '../../src/factory/api';
import { NO_INTENT, type PodIntent } from '../../src/pod/types';
import { crc32 } from '../../src/save/codec';
import { World } from '../../src/world/world';
import { onboardingWorld } from './integration.helpers';

/** Steps scripted after the onboarding chain is up. */
const N = 9_600;
const SAMPLE = 600;

/**
 * Golden values for seed 7 (world save CRC32 incl. FACT, factory stateHash) after onboarding + N scripted steps.
 * A deliberate sim change (pod, terrain, story, economy or factory rules) moves them: re-run this file, check
 * that only the intended behaviour changed, and update both numbers in the same commit.
 */
const GOLDEN = { world: 0x99ae93e5, factory: 0x1da9e652 };

function must<T extends { ok: boolean }>(r: T): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
}

/** Pod intents for step i of the script: Rim drives, idles, a short hop. */
function podIntent(i: number): PodIntent {
  const phase = Math.floor(i / 300) % 6;
  switch (phase) {
    case 0:
      return { ...NO_INTENT, sx: 0.9 };
    case 2:
      return { ...NO_INTENT, sx: -0.9 };
    case 4:
      return i % 300 < 20 ? { ...NO_INTENT, thrust: true } : NO_INTENT;
    default:
      return NO_INTENT;
  }
}

/** Factory commands and Rim services applied before step i (the command log). */
function commands(w: World, i: number): void {
  const f = w.factory!;
  const hx = f.entities().find((e) => e.kind === 'headframe')!.x;
  switch (i) {
    case 60:
      must(w.expandYard());
      break;
    case 1_200:
      w.stockpileCargo({ kind: 'mineral', tier: 1 }, 'all');
      w.stockpileCargo({ kind: 'mineral', tier: 2 }, 'all');
      break;
    case 1_800:
      must(w.buyKit('belt', 1, 'stockpile'));
      break;
    case 3_600: {
      // After the first ingot (U3): the survey Bin unloads Copper Ingots into an Assembler on Wire (A2).
      const bin = f.entities().find((e) => e.kind === 'bin')!.id;
      must(f.setUnloadFilter(bin, 'copperIngot'));
      must(f.paintBelts([9, 10].map((y) => ({ x: hx + 1, y })), 1, DIR.S));
      const asm = (must(f.place('assembler', 1, hx, 11, DIR.S)) as { id: number }).id;
      must(f.setRecipe(asm, 'A2'));
      must(f.paintBelts([{ x: hx, y: 13 }], 1, DIR.S));
      must(f.place('bin', 1, hx, 14, DIR.S));
      break;
    }
    case 6_000:
      must(f.paintBelts([{ x: hx + 3, y: 12 }], 1, DIR.E));
      break;
    case 7_200:
      must(f.undo());
      break;
  }
}

/** CRC-32 of the save payload (not over the trailer: a CRC over data + its own CRC is a constant residue). */
function saveCrc(w: World): number {
  const b = w.serialize();
  return crc32(b, 0, b.length - 4);
}

function combined(w: World): number {
  return (saveCrc(w) ^ Math.imul(w.factory!.stateHash(), 0x9e3779b1)) >>> 0;
}

/** Run the script from step `from` to `to` on `w`, sampling the combined hash every SAMPLE steps. */
function play(w: World, from: number, to: number, samples: number[] = []): number[] {
  for (let i = from; i < to; i++) {
    commands(w, i);
    w.step(podIntent(i), true);
    w.drainEvents();
    if ((i + 1) % SAMPLE === 0) samples.push(combined(w));
  }
  return samples;
}

describe('determinism: world + factory (04 §11.1)', () => {
  it('is identical on repeat', () => {
    const a = onboardingWorld(7).w;
    const b = onboardingWorld(7).w;
    expect(combined(a)).toBe(combined(b));
    expect(play(a, 0, N)).toEqual(play(b, 0, N));
    expect(a.factory!.stockpileCount('wire')).toBeGreaterThan(0);
  });

  it('save at N/2 + load + N/2 equals N straight, byte for byte', () => {
    const straight = onboardingWorld(7).w;
    const split = onboardingWorld(7).w;
    const s1 = play(straight, 0, N);
    const s2 = play(split, 0, N / 2);
    const reloaded = World.deserialize(split.serialize(), 'mvp');
    play(reloaded, N / 2, N, s2);
    expect(s2).toEqual(s1);
    expect(reloaded.serialize()).toEqual(straight.serialize());
  });

  it('matches the golden hash', () => {
    const w = onboardingWorld(7).w;
    play(w, 0, N);
    const got = { world: saveCrc(w), factory: w.factory!.stateHash() };
    expect(got).toEqual(GOLDEN);
  });
});
