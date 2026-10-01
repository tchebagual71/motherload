import { describe, expect, it, vi } from 'vitest';
import { cueForEvent, semitones, SFX, SFX_IDS, PRIORITY } from '../../src/audio/sfx';
import { buildSamples } from '../../src/audio/synth';
import { Cooldowns, VoicePool, type VoiceSlot } from '../../src/audio/voices';
import type { GameEvent } from '../../src/shared/events';

const CTX = { drillTier: 1 };

describe('GameEvent → SFX (03 §11.4)', () => {
  const cases: [GameEvent, string | null][] = [
    [{ t: 'dig-start', x: 1, r: 1, code: 1 }, 'digTick'],
    [{ t: 'dug', x: 1, r: 1, code: 1 }, 'digBreak'],
    [{ t: 'dig-refused', x: 1, r: 130, reason: 'hardrock' }, 'clink'],
    [{ t: 'dig-refused', x: 1, r: 50, reason: 'lode' }, 'thunk'],
    [{ t: 'dig-refused', x: 1, r: 0, reason: 'paved' }, 'thunk'],
    [{ t: 'lode-discovered', lodeId: 0 }, 'discover'],
    [{ t: 'collect', item: { kind: 'mineral', tier: 3 } }, 'collect'],
    [{ t: 'collect', item: { kind: 'relic', id: 0 } }, 'relic'],
    [{ t: 'bay-full', item: { kind: 'mineral', tier: 1 } }, 'bayFull'],
    [{ t: 'landed', v: 4 }, 'land'],
    [{ t: 'damage', amount: 3, cause: 'landing' }, 'damage'],
    [{ t: 'fuel-warning', level: 0 }, 'warnFuel'],
    [{ t: 'hull-warning' }, 'warnHull'],
    [{ t: 'destroyed', cause: 'hull' }, 'death'],
    [{ t: 'explosion', x: 1, r: 1, radius: 1 }, 'explosion'],
    [{ t: 'sale', amount: 300, count: 4 }, 'sell'],
    [{ t: 'purchase', kind: 'upgrade', amount: 750, line: 'drill', tier: 2 }, 'fanfare'],
    [{ t: 'purchase', kind: 'fuel', amount: 5 }, 'pump'],
    [{ t: 'purchase', kind: 'consumable', amount: 2_000, id: 'pop' }, 'purchase'],
    [{ t: 'incentive', row: 40, ft: 500, cash: 1_000 }, 'fanfare'],
    [{ t: 'teleport', id: 'hopBeacon', x: 1, y: -3 }, 'teleport'],
    [{ t: 'consumable-refused', id: 'pop', reason: 'airborne' }, 'error'],
    [{ t: 'consumable-used', id: 'jerrycan' }, 'pump'],
    [{ t: 'consumable-used', id: 'pop' }, null],
    [{ t: 'depth-record', row: 12 }, null],
    [{ t: 'pad-arrive', id: 'pump' }, null],
    [{ t: 'radio', sender: 'Dot', text: 'hi' }, null],
  ];
  it.each(cases)('%o → %s', (e, id) => {
    expect(cueForEvent(e, CTX)?.id ?? null).toBe(id);
  });

  it('pitches pickups up the pentatonic scale by mineral tier', () => {
    const pitch = (tier: number) => cueForEvent({ t: 'collect', item: { kind: 'mineral', tier } }, CTX)!.pitch;
    for (let t = 2; t <= 10; t++) expect(pitch(t)).toBeGreaterThan(pitch(t - 1));
    expect(pitch(6)).toBeCloseTo(2, 6); // tier 6 = one octave up
  });

  it('raises the drill by 2 semitones per tier', () => {
    const e: GameEvent = { t: 'dug', x: 0, r: 0, code: 1 };
    expect(cueForEvent(e, { drillTier: 3 })!.pitch).toBeCloseTo(semitones(4), 9);
  });

  it('beeps faster and more as fuel gets worse', () => {
    const l = [0, 1, 2].map((level) => cueForEvent({ t: 'fuel-warning', level: level as 0 | 1 | 2 }, CTX)!);
    expect(l.map((c) => c.repeat)).toEqual([0, 1, 2]);
    expect(l[2].gapMs).toBeLessThan(l[1].gapMs);
    expect(cueForEvent({ t: 'hull-warning' }, CTX)!.repeat).toBe(1); // double beep
  });

  it('scales landing and sale loudness into a sane range', () => {
    const soft = cueForEvent({ t: 'landed', v: 1 }, CTX)!.gain;
    const hard = cueForEvent({ t: 'landed', v: 12 }, CTX)!.gain;
    expect(soft).toBeGreaterThan(0);
    expect(hard).toBe(1);
    const big = cueForEvent({ t: 'sale', amount: 1e9, count: 1 }, CTX)!.gain;
    expect(big).toBeLessThanOrEqual(1);
  });

  it('ranks alarms above hazards above pod above UI', () => {
    expect(SFX.warnFuel.priority).toBeGreaterThan(SFX.damage.priority);
    expect(SFX.damage.priority).toBeGreaterThan(SFX.collect.priority);
    expect(SFX.collect.priority).toBeGreaterThan(SFX.uiTap.priority);
    expect(SFX.collect.cooldownMs).toBe(40);
    expect(PRIORITY.alarm).toBe(5);
  });
});

describe('ZzFX generator port', () => {
  it.each(SFX_IDS)('%s renders finite, bounded, non-silent samples', (id) => {
    const s = buildSamples(SFX[id].params, 22_050);
    expect(s.length).toBeGreaterThan(100);
    let peak = 0;
    for (const v of s) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeGreaterThan(0.001);
    expect(peak).toBeLessThan(2);
  });

  it('is deterministic (no built-in randomness)', () => {
    const a = buildSamples(SFX.collect.params);
    const b = buildSamples(SFX.collect.params);
    expect(a).toEqual(b);
  });

  it('applies ZzFX defaults for missing parameters (≈ 0.1 s release at 220 Hz)', () => {
    const s = buildSamples([], 10_000);
    expect(s.length).toBe(1_009); // 9-sample min attack + 1,000-sample release
  });
});

describe('voices and cooldowns (04 §8.1)', () => {
  function voice(priority: number, startedAt: number, endsAt = 10_000) {
    const stop = vi.fn<() => void>();
    return { priority, startedAt, endsAt, stop } satisfies VoiceSlot;
  }

  it('admits freely below the limit', () => {
    const pool = new VoicePool(2);
    expect(pool.admit(1, 0)).toBe(true);
    pool.add(voice(1, 0));
    expect(pool.admit(1, 0)).toBe(true);
  });

  it('steals the lowest priority first, then the oldest', () => {
    const pool = new VoicePool(3);
    const ui = voice(2, 5);
    const podOld = voice(3, 1);
    const podNew = voice(3, 9);
    [ui, podOld, podNew].forEach((v) => pool.add(v));
    expect(pool.admit(3, 10)).toBe(true);
    expect(ui.stop).toHaveBeenCalled();
    pool.add(voice(3, 10));
    expect(pool.admit(3, 11)).toBe(true);
    expect(podOld.stop).toHaveBeenCalled();
    expect(podNew.stop).not.toHaveBeenCalled();
  });

  it('drops a newcomer quieter than everything playing', () => {
    const pool = new VoicePool(1);
    pool.add(voice(5, 0));
    expect(pool.admit(2, 1)).toBe(false);
  });

  it('frees finished voices', () => {
    const pool = new VoicePool(1);
    pool.add(voice(5, 0, 100));
    expect(pool.admit(0, 100)).toBe(true);
    expect(pool.size).toBe(0);
  });

  it('enforces per-sound cooldowns', () => {
    const c = new Cooldowns();
    expect(c.take('collect', 40, 0)).toBe(true);
    expect(c.take('collect', 40, 39)).toBe(false);
    expect(c.take('collect', 40, 40)).toBe(true);
    expect(c.take('land', 40, 41)).toBe(true);
  });
});
