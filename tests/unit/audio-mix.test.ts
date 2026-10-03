// Depth mix curves and ducking (03 §11.2 G1 low-pass, §11.3 ambience groups, §11.6 ducks).
import { describe, expect, it } from 'vitest';
import { ambienceMix, CROSSFADE_ROWS, dbToGain, DUCK, Ducks, fadeIn, fadeOut, kettleMix, KETTLE_MIX, type AmbienceMix, type MusicMix } from '../../src/audio/mix';

const music = (d: number): MusicMix => kettleMix(d, { cutoffHz: 0, gain: 0 });
const amb = (d: number): AmbienceMix => ambienceMix(d, { wind: 0, earth: 0, deep: 0, windCutoffHz: 0 });

describe('Kettle On through rock (03 §11.2)', () => {
  it('is open on the Rim, 700 Hz and −12 dB at r40, gone by r64', () => {
    expect(music(0)).toEqual({ cutoffHz: 16_000, gain: 1 });
    const r40 = music(KETTLE_MIX.muffledRow);
    expect(r40.cutoffHz).toBeCloseTo(700, 6);
    expect(r40.gain).toBeCloseTo(dbToGain(-12), 9);
    expect(music(64).gain).toBe(0);
    expect(music(300).gain).toBe(0);
  });

  it('sweeps monotonically, exponentially in frequency', () => {
    let prev = music(0);
    for (let d = 1; d <= 70; d++) {
      const m = music(d);
      expect(m.cutoffHz).toBeLessThanOrEqual(prev.cutoffHz);
      expect(m.gain).toBeLessThanOrEqual(prev.gain);
      prev = m;
    }
    // Halfway in rows is the geometric mean in Hz.
    expect(music(20).cutoffHz).toBeCloseTo(Math.sqrt(16_000 * 700), 6);
  });
});

describe('ambience beds (03 §11.3)', () => {
  it('is wind on the Rim, earth in B2–B3, deep from B4', () => {
    expect(amb(0)).toMatchObject({ wind: 1, earth: 0, deep: 0 });
    expect(amb(100)).toMatchObject({ wind: 0, earth: 1, deep: 0 });
    expect(amb(300)).toMatchObject({ wind: 0, earth: 0 });
    expect(amb(300).deep).toBeCloseTo(1, 9);
  });

  it('muffles the wind as the pod goes down the shaft', () => {
    expect(amb(0).windCutoffHz).toBe(5_000);
    expect(amb(20).windCutoffHz).toBeCloseTo(900, 6);
    expect(amb(30).wind).toBeCloseTo(0.5, 9);
  });

  it('crossfades with equal power over 24 rows at each group edge', () => {
    expect(CROSSFADE_ROWS).toBe(24);
    for (let d = 52; d <= 76; d += 2) expect(fadeIn(d, 64) ** 2 + fadeOut(d, 64) ** 2).toBeCloseTo(1, 9);
    expect(fadeIn(52, 64)).toBe(0);
    expect(fadeIn(76, 64)).toBe(1);
    expect(amb(64).earth).toBeCloseTo(Math.SQRT1_2, 9);
    expect(amb(262).earth ** 2 + amb(262).deep ** 2).toBeCloseTo(1, 9);
  });

  it('hushes to −12 dB in B5', () => {
    expect(amb(450).deep).toBeCloseTo(dbToGain(-12), 9);
  });
});

describe('ducks (03 §11.6)', () => {
  it('holds −4 dB and a 4-kHz low-pass while a sheet or build mode is up', () => {
    const d = new Ducks();
    expect(d.musicDb(0)).toBe(0);
    expect(d.musicCutoffHz()).toBe(Infinity);
    d.held = true;
    expect(d.musicDb(0)).toBe(DUCK.sheetDb);
    expect(d.musicCutoffHz()).toBe(4_000);
  });

  it('takes the deepest timed duck, which expires on time', () => {
    const d = new Ducks();
    d.hit('sell', 0, 700);
    d.hit('radio', 0, 2_000);
    d.hit('alarm', 100, 900);
    expect(d.musicDb(500)).toBe(-8);
    expect(d.musicDb(1_200)).toBe(-6);
    expect(d.ambienceDb(1_200)).toBe(-3);
    expect(d.musicDb(2_000)).toBe(0);
    expect(d.ambienceDb(2_000)).toBe(0);
  });

  it('lifts the radio duck when the line is cut', () => {
    const d = new Ducks();
    d.hit('radio', 0, 5_000);
    d.clearRadio();
    expect(d.musicDb(10)).toBe(0);
  });
});
