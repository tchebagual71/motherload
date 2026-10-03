import { describe, expect, it, vi } from 'vitest';
import { bandIndex, cueForEvent, drillBand, DRILL_BANDS, renderSfx, semitones, SFX, SFX_IDS, PRIORITY } from '../../src/audio/sfx';
import { buildSamples } from '../../src/audio/synth';
import { BANDS } from '../../src/shared/canon';
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
    [{ t: 'radio', sender: 'Dot', beat: 'test', cards: ['hi'] }, null],
    [{ t: 'damage', amount: 29, cause: 'magma' }, 'sizzle'],
    [{ t: 'damage', amount: 40, cause: 'methane' }, 'explosion'],
    [{ t: 'respawned', fee: 100, debt: 0, lost: [] }, 'salvage'],
    [{ t: 'ghost-complete', kind: 'belt' }, 'build'],
    [{ t: 'lode-pinged', lodeId: 2 }, 'discover'],
    [{ t: 'milestone', id: 'm1', title: 'First haul' }, 'fanfare'],
    [{ t: 'unlock', rung: 'U1', label: 'Smelter' }, 'fanfare'],
    // INT-2: 'starter-kit' is the OFFER (the lode was found: 'lode-discovered' rings), the claim is the purchase.
    [{ t: 'starter-kit' }, null],
    [{ t: 'purchase', kind: 'kit', amount: 0, kit: 'starter' }, 'purchase'],
    [{ t: 'purchase', kind: 'repair', amount: 40 }, 'use'],
    [{ t: 'consumable-used', id: 'patchKit' }, 'use'],
    [{ t: 'coop-credit', liters: 5 }, 'pump'],
    [{ t: 'export-sale', amount: 90, count: 3 }, null],
    [{ t: 'trip-end', trip: 1, deepestRow: 12 }, null],
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

  it('colours the break by band (03 §11.4 ★1 band filter)', () => {
    const at = (r: number) => cueForEvent({ t: 'dug', x: 0, r, code: 1 }, CTX)!.pitch;
    expect(at(70)).toBeCloseTo(DRILL_BANDS[2].pitch, 9); // B2 Clay Deeps
    expect(at(140)).toBeCloseTo(DRILL_BANDS[3].pitch, 9); // B3 Violet Shale
    expect(at(70)).toBeLessThan(at(0));
    for (const b of BANDS) {
      expect(bandIndex(b.top)).toBe(BANDS.indexOf(b));
      expect(bandIndex(b.bottom)).toBe(BANDS.indexOf(b));
    }
    expect(drillBand(130).lowpassHz).toBeGreaterThan(drillBand(100).lowpassHz); // brittle shale vs damp clay
    expect(DRILL_BANDS).toHaveLength(BANDS.length);
  });

  it('shimmers gems (a second ping) and adds coins with the sale value', () => {
    expect(cueForEvent({ t: 'collect', item: { kind: 'mineral', tier: 3 } }, CTX)!.repeat).toBe(0);
    expect(cueForEvent({ t: 'collect', item: { kind: 'mineral', tier: 7 } }, CTX)!.repeat).toBe(1);
    const coins = (amount: number) => cueForEvent({ t: 'sale', amount, count: 1 }, CTX)!.repeat;
    expect([coins(5), coins(300), coins(5_000), coins(1e7)]).toEqual([0, 1, 2, 3]);
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

describe('the MVP set (canon §5.5: ≤ 20 SFX designs)', () => {
  it('covers the 20 ★ designs of 03 §11.4 and no more', () => {
    const stars = new Set(SFX_IDS.map((id) => SFX[id].star));
    expect([...stars].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('routes drill sounds through the band filter and blips through the voice band', () => {
    expect(SFX.digTick.bus).toBe('drill');
    expect(SFX.digBreak.bus).toBe('drill');
    for (const id of SFX_IDS.filter((i) => i.startsWith('blip') || i === 'tickStatic')) expect(SFX[id].bus).toBe('voice');
    expect(SFX.warnFuel.duck).toBe('alarm');
    expect(SFX.sell.duck).toBe('sell');
  });

  // 03 §11.1: nothing important below 150 Hz (phone speakers); the tells carry in 400 Hz–4 kHz.
  const TELLS = ['clink', 'thunk', 'bayFull', 'damage', 'sizzle', 'warnFuel', 'warnHull', 'error', 'collect', 'discover', 'death', 'explosion', 'land'] as const;
  it.each(TELLS)('%s keeps most of its energy above 150 Hz', (id) => {
    const s = renderSfx(id, 32_000);
    expect(lowShare(s, 32_000, 150)).toBeLessThan(0.2);
  });
});

/** Energy share below `hz` (4th-order low-pass: two cascaded RBJ biquads). */
function lowShare(s: Float32Array, sr: number, hz: number): number {
  const w = (2 * Math.PI * hz) / sr;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 - cos) / 2 / a0;
  const b1 = (1 - cos) / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let x = Float64Array.from(s);
  for (let pass = 0; pass < 2; pass++) {
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      y[i] = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = y[i];
    }
    x = y;
  }
  let lo = 0;
  let all = 0;
  for (let i = 0; i < s.length; i++) {
    lo += x[i] * x[i];
    all += s[i] * s[i];
  }
  return lo / all;
}

describe('ZzFX generator port', () => {
  it.each(SFX_IDS)('%s renders finite, bounded, non-silent samples', (id) => {
    const s = renderSfx(id, 22_050);
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
    expect(renderSfx('collect', 44_100)).toEqual(renderSfx('collect', 44_100));
    expect(renderSfx('blipDot', 44_100)).toEqual(renderSfx('blipDot', 44_100));
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
