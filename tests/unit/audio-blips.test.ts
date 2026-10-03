// Transmission voice plans (03 §11.5): letter rates, rests, vowel emphasis, per-sender sounds, reduced motion.
import { describe, expect, it } from 'vitest';
import { COMMA_S, CONSONANT_GAIN, MAX_BLIP_RATE, newBlips, planBlips, RadioVoice, STOP_S, VOICES, type Blip, type Sender } from '../../src/audio/blips';

function plan(sender: Sender, text: string, reduced = false): Blip[] {
  const out = newBlips();
  const n = planBlips(sender, text, reduced, out);
  return out.slice(0, n).map((b) => ({ ...b }));
}

describe('blip plans', () => {
  it('gives Dot one warm blip per letter at 16 per second', () => {
    const b = plan('Dot', 'Hello');
    expect(b).toHaveLength(5);
    expect(b.every((x) => x.sound === 'blipDot')).toBe(true);
    expect(b[1].t - b[0].t).toBeCloseTo(1 / 16, 9);
  });

  it('never exceeds 18 blips per second for any sender', () => {
    for (const sender of Object.keys(VOICES) as Sender[]) {
      const b = plan(sender, 'Steady now, Pip. The clay is soft here and the 500 ft bonus is close!');
      for (let i = 1; i < b.length; i++) expect(b[i].t - b[i - 1].t).toBeGreaterThanOrEqual(1 / MAX_BLIP_RATE - 1e-9);
    }
  });

  it('rests 120 ms at a comma and 280 ms at a stop', () => {
    const slot = 1 / 16;
    const comma = plan('Dot', 'ab,cd');
    expect(comma[2].t - comma[1].t).toBeCloseTo(slot + COMMA_S, 9);
    const stop = plan('Dot', 'ab. cd');
    expect(stop[2].t - stop[1].t).toBeCloseTo(slot + STOP_S + slot, 9);
  });

  it('sounds vowels 1.5 × louder than consonants', () => {
    const b = plan('Dot', 'ka');
    expect(b[0].gain).toBeCloseTo(CONSONANT_GAIN, 9);
    expect(b[1].gain).toBe(1);
    expect(b[1].gain / b[0].gain).toBeCloseTo(1.5, 9);
  });

  it('walks a pentatonic scale, the same way for the same line', () => {
    const a = plan('Dot', 'The kettle is on.');
    expect(plan('Dot', 'The kettle is on.')).toEqual(a);
    const semis = a.map((x) => Math.round(12 * Math.log2(x.pitch)));
    for (const s of semis) expect(VOICES.Dot.scale).toContain(s);
    for (let i = 1; i < semis.length; i++) {
      const di = VOICES.Dot.scale.indexOf(semis[i]) - VOICES.Dot.scale.indexOf(semis[i - 1]);
      expect(Math.abs(di)).toBeLessThanOrEqual(1);
    }
  });

  it('bursts static per word for Channel Zero, with a tick per number', () => {
    const b = plan('Channel Zero', 'Signal at 500 feet.');
    expect(b.map((x) => x.sound)).toEqual(['blipStatic', 'blipStatic', 'tickStatic', 'blipStatic']);
  });

  it('rings one slow celesta note per word for the Surveyor, on a whole-tone row', () => {
    const b = plan('the Surveyor', 'All of it is owed');
    expect(b).toHaveLength(5);
    expect(b[1].t - b[0].t).toBeCloseTo(VOICES['the Surveyor'].wordS, 9);
    for (const x of b) expect(Math.round(12 * Math.log2(x.pitch)) % 2).toBe(0);
  });

  it('adds tape wow to the Deepreach logs', () => {
    const b = plan('Deepreach log', 'Log six. The seam is singing again tonight.');
    const off = b.map((x) => 12 * Math.log2(x.pitch) - Math.round(12 * Math.log2(x.pitch)));
    expect(Math.max(...off.map(Math.abs))).toBeGreaterThan(0.05);
  });

  it('speaks one blip per word under reduced motion', () => {
    expect(plan('Dot', 'Mind the clay, Pip.', true)).toHaveLength(4);
  });

  it('caps a line at the pre-allocated blip count', () => {
    const out = newBlips(10);
    expect(planBlips('Dot', 'a'.repeat(90), false, out)).toBe(10);
  });
});

describe('RadioVoice', () => {
  it('hands out blips a look-ahead window at a time, on absolute times', () => {
    const v = new RadioVoice();
    const len = v.speak('Dot', 'abcdefgh', 10, false);
    expect(len).toBeCloseTo(7 / 16 + 0.1, 9);
    const seen: number[] = [];
    v.pump(10.1, (_b, when) => seen.push(when));
    expect(seen).toEqual([10, 10 + 1 / 16]);
    v.pump(11, (_b, when) => seen.push(when));
    expect(seen).toHaveLength(8);
    expect(v.speaking).toBe(false);
  });

  it('stops mid-line, and a new card replaces the old', () => {
    const v = new RadioVoice();
    v.speak('Dot', 'abcdefgh', 0, false);
    v.stop();
    const seen: number[] = [];
    v.pump(5, (_b, when) => seen.push(when));
    expect(seen).toEqual([]);
    v.speak('Marlow', 'xy', 1, false);
    v.pump(5, (b) => seen.push(b.sound === 'blipMarlow' ? 1 : 0));
    expect(seen).toEqual([1, 1]);
  });
});
