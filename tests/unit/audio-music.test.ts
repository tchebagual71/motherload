// Kettle On step sequencer (03 §11.2 G1: 92 BPM, F major; 04 §8.1 look-ahead scheduling) without an AudioContext.
import { describe, expect, it } from 'vitest';
import { BAR_S, FORM_BARS, KETTLE_BPM, KettleOn, neighbour, songPitches, STEP_S, SWING, swingSteps, type Note } from '../../src/audio/kettleOn';

const SEED = 0x6b657474;
const newNotes = (n: number): Note[] => Array.from({ length: n }, () => ({ time: 0, inst: 'nylon', midi: 0, vel: 0 }));

/** Every note starting in [t0, t0 + seconds), collected in windows like the engine's 25-ms clock. */
function collect(seq: KettleOn, seconds: number, windowS = 0.025, t0 = 0): Note[] {
  const out: Note[] = [];
  const buf = newNotes(32);
  const end = t0 + seconds;
  for (let t = t0; t < end; t += windowS) {
    const n = seq.fill(Math.min(t + windowS, end), buf);
    for (let i = 0; i < n; i++) out.push({ ...buf[i] });
  }
  return out;
}

const F_MAJOR = new Set([5, 7, 9, 10, 0, 2, 4]);
const pc = (m: number): number => ((m % 12) + 12) % 12;

describe('Kettle On timing', () => {
  it('runs at 92 BPM in sixteenths', () => {
    expect(KETTLE_BPM).toBe(92);
    expect(STEP_S).toBeCloseTo(60 / 92 / 4, 12);
    expect(BAR_S).toBeCloseTo(16 * STEP_S, 12);
  });

  it('puts guitar eighths on the grid, off-beats swung late', () => {
    const seq = new KettleOn(SEED);
    seq.start(1);
    const guitar = collect(seq, BAR_S, 0.025, 1).filter((n) => n.inst === 'nylon');
    expect(guitar).toHaveLength(8);
    guitar.forEach((n, i) => {
      const step = i * 2;
      expect(n.time).toBeCloseTo(1 + (step + swingSteps(step)) * STEP_S, 9);
    });
    expect(swingSteps(2)).toBe(SWING);
    expect(swingSteps(4)).toBe(0);
  });

  it('plays the bass root on 1 and the fifth on 3', () => {
    const seq = new KettleOn(SEED);
    seq.start(0);
    const bass = collect(seq, BAR_S).filter((n) => n.inst === 'bass');
    expect(bass.map((n) => n.midi)).toEqual([41, 48]); // F2, C3 under F
    expect(bass[1].time).toBeCloseTo(8 * STEP_S, 9);
  });

  it('emits the same notes whatever the window size (no drops, no doubles)', () => {
    const a = new KettleOn(SEED);
    const b = new KettleOn(SEED);
    a.start(0);
    b.start(0);
    const fine = collect(a, 30, 0.025);
    const coarse = collect(b, 30, 0.4);
    expect(coarse).toEqual(fine);
    for (let i = 1; i < fine.length; i++) expect(fine[i].time).toBeGreaterThanOrEqual(fine[i - 1].time - 0.0041);
  });

  it('never writes more notes than the caller has room for', () => {
    const seq = new KettleOn(SEED);
    seq.start(0);
    const buf = newNotes(3);
    expect(seq.fill(100, buf)).toBe(3);
    const rest = collect(seq, 2 * BAR_S);
    expect(rest[0].time).toBeGreaterThanOrEqual(buf[2].time);
  });

  it('waits two bars before the kalimba on the first pass', () => {
    const seq = new KettleOn(SEED);
    seq.start(0);
    const notes = collect(seq, 3 * BAR_S);
    const firstKalimba = notes.find((n) => n.inst === 'kalimba')!;
    expect(firstKalimba.time).toBeGreaterThanOrEqual(2 * BAR_S - 0.005);
  });

  it('loops the 32-bar form, varying the repeats by seed but never leaving F major', () => {
    const seq = new KettleOn(SEED);
    seq.start(0);
    const notes = collect(seq, 2 * FORM_BARS * BAR_S + 1);
    const pass1 = notes.filter((n) => n.inst === 'kalimba' && n.time < FORM_BARS * BAR_S && n.time >= 8 * BAR_S);
    const pass2 = notes.filter((n) => n.inst === 'kalimba' && n.time >= (FORM_BARS + 8) * BAR_S && n.time < 2 * FORM_BARS * BAR_S);
    expect(pass2.map((n) => n.midi)).not.toEqual(pass1.map((n) => n.midi));
    for (const n of notes) expect(F_MAJOR.has(pc(n.midi))).toBe(true);
    for (const n of notes) {
      expect(n.vel).toBeGreaterThan(0);
      expect(n.vel).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic per seed', () => {
    const a = new KettleOn(1);
    const b = new KettleOn(1);
    const c = new KettleOn(2);
    [a, b, c].forEach((s) => s.start(0));
    const na = collect(a, FORM_BARS * BAR_S);
    expect(collect(b, FORM_BARS * BAR_S)).toEqual(na);
    expect(collect(c, FORM_BARS * BAR_S)).not.toEqual(na);
  });

  it('restarts from bar 0', () => {
    const seq = new KettleOn(SEED);
    seq.start(0);
    collect(seq, 5 * BAR_S);
    expect(seq.barIndex).toBeGreaterThan(3);
    seq.start(50);
    expect(seq.barIndex).toBe(0);
    expect(collect(seq, 0.1, 0.025, 50)[0].time).toBeCloseTo(50, 9);
  });

  it('skips notes missed during a stall and resumes on time', () => {
    const seq = new KettleOn(SEED);
    seq.start(0);
    collect(seq, 1);
    const dropped = seq.skipTo(10);
    expect(dropped).toBeGreaterThan(30);
    const next = collect(seq, 1, 0.025, 10);
    expect(next[0].time).toBeGreaterThanOrEqual(10);
    expect(seq.nextTime).toBeGreaterThanOrEqual(10);
  });
});

describe('Kettle On pitches', () => {
  it('lists the authored pitches per instrument for pre-rendering', () => {
    const p = songPitches();
    expect(p.nylon.length).toBeGreaterThanOrEqual(8);
    expect(p.bass.every((m) => m >= 38 && m <= 52)).toBe(true);
    expect(p.kalimba.every((m) => F_MAJOR.has(pc(m)))).toBe(true);
    expect(p.kalimba.length + p.nylon.length + p.bass.length).toBeLessThanOrEqual(32);
  });

  it('steps to the neighbouring pentatonic note', () => {
    expect(neighbour(72, 1)).toBe(74); // C5 → D5
    expect(neighbour(74, 1)).toBe(77); // D5 → F5 (no E in the pentatonic)
    expect(neighbour(65, -1)).toBe(62); // F4 → D4
  });
});
