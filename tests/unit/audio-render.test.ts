// Offline renderers: Kettle On notes (in tune, clean ends), seamless loops (engine hum, fall whistle, ambience beds)
// and the DSP helpers they share.
import { describe, expect, it } from 'vitest';
import { BEDS, renderBed, type BedId } from '../../src/audio/beds';
import { crossfadeLoop, loopHz, PinkNoise, WhiteNoise } from '../../src/audio/dsp';
import { midiHz, MUSIC_SAMPLE_RATE, renderEngineLoop, renderNote, renderWhistleLoop, type Instrument } from '../../src/audio/instruments';
import { songPitches } from '../../src/audio/kettleOn';

/** Fundamental by autocorrelation, searched within ±15% of the expected period. */
function pitchOf(s: Float32Array, sr: number, expectHz: number): number {
  const from = Math.round(0.3 * sr); // after the inharmonic tine modes have died away
  const n = Math.round(0.2 * sr);
  const p = sr / expectHz;
  let best = 0;
  let bestLag = 0;
  for (let lag = Math.floor(p * 0.85); lag <= Math.ceil(p * 1.15); lag++) {
    let acc = 0;
    for (let i = from; i < from + n; i++) acc += s[i] * s[i + lag];
    if (acc > best) {
      best = acc;
      bestLag = lag;
    }
  }
  // Parabolic refinement around the peak.
  const r = (lag: number): number => {
    let acc = 0;
    for (let i = from; i < from + n; i++) acc += s[i] * s[i + lag];
    return acc;
  };
  const [a, b, c] = [r(bestLag - 1), r(bestLag), r(bestLag + 1)];
  const shift = (0.5 * (a - c)) / (a - 2 * b + c);
  return sr / (bestLag + shift);
}

/** The loop's wrap step is no bigger than the steps inside it (99.9th percentile). */
function seamless(s: Float32Array): boolean {
  const steps = new Float32Array(s.length - 1);
  for (let i = 1; i < s.length; i++) steps[i - 1] = Math.abs(s[i] - s[i - 1]);
  steps.sort();
  const p999 = steps[Math.floor(steps.length * 0.999)];
  return Math.abs(s[0] - s[s.length - 1]) <= p999;
}

describe('Kettle On notes', () => {
  const pitches = songPitches();
  const cases: [Instrument, number][] = (['kalimba', 'nylon', 'bass'] as const).flatMap((i) => pitches[i].map((m) => [i, m] as [Instrument, number]));

  it.each(cases)('%s %i is bounded, starts and ends silent', (inst, midi) => {
    const s = renderNote(inst, midi);
    let peak = 0;
    for (const v of s) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeCloseTo(0.6, 6);
    expect(Math.abs(s[0])).toBeLessThan(1e-3);
    expect(Math.abs(s[s.length - 1])).toBeLessThan(1e-4);
  });

  it.each([
    ['kalimba', 72],
    ['nylon', 57],
    ['bass', 45],
  ] as const)('%s %i is in tune (±5 cents)', (inst, midi) => {
    const f = pitchOf(renderNote(inst, midi), MUSIC_SAMPLE_RATE, midiHz(midi));
    expect(Math.abs(1200 * Math.log2(f / midiHz(midi)))).toBeLessThan(5);
  });

  it('decays: the tail is far quieter than the attack', () => {
    const s = renderNote('nylon', 53);
    const rms = (a: number, b: number): number => {
      let e = 0;
      for (let i = a; i < b; i++) e += s[i] * s[i];
      return Math.sqrt(e / (b - a));
    };
    const sr = MUSIC_SAMPLE_RATE;
    expect(rms(sr, sr + 2_000)).toBeLessThan(rms(0, 2_000) * 0.4);
  });
});

describe('seamless loops', () => {
  it.each(['wind', 'earth', 'deep'] as BedId[])('the %s bed loops without a seam', (id) => {
    const s = renderBed(id);
    expect(s.length).toBe(Math.round(BEDS[id].seconds * BEDS[id].sampleRate));
    expect(seamless(s)).toBe(true);
  });

  it('the engine hum and fall whistle loop without a seam', () => {
    expect(seamless(renderEngineLoop(32_000))).toBe(true);
    expect(seamless(renderWhistleLoop(32_000))).toBe(true);
  });

  it('crossfadeLoop folds the overhang into the head', () => {
    const w = new WhiteNoise(1);
    const src = Float32Array.from({ length: 1_100 }, () => w.next());
    const out = crossfadeLoop(src, 1_000);
    expect(out).toHaveLength(1_000);
    expect(out[999]).toBe(src[999]);
    expect(out[0]).toBeCloseTo(src[1_000], 1);
  });

  it('rounds periodic layers to whole cycles per loop', () => {
    expect(loopHz(146.83, 8) * 8).toBe(Math.round(146.83 * 8));
    expect(loopHz(0.01, 8)).toBe(1 / 8);
  });
});

describe('noise sources', () => {
  it('are deterministic and bounded', () => {
    const a = new PinkNoise(9);
    const b = new PinkNoise(9);
    for (let i = 0; i < 10_000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(Math.abs(v)).toBeLessThan(1.5);
    }
  });
});
