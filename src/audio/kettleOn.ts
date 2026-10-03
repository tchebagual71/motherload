// "Kettle On" (03 §11.2 G1): the surface song, 92 BPM in F major for kalimba, nylon guitar and soft bass. The MVP
// plays it from this authored 32-bar form (A A B A) through a step sequencer instead of a streamed file (03 §11.7
// placeholder); the variation is seeded, never free (03 §11.9 "aimless generative music"). Pure: times are seconds on
// whatever clock the caller passes (the AudioContext clock in the engine, plain numbers in tests).
import { hash32 } from '../shared/rng';
import type { Instrument } from './instruments';

export const KETTLE_BPM = 92;
export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 16;
export const STEP_S = 60 / KETTLE_BPM / STEPS_PER_BEAT;
export const BAR_S = STEP_S * STEPS_PER_BAR;
/** Off-beat eighths land this fraction of a step late: a light, cosy swing. */
export const SWING = 0.18;
/** ± timing spread for the melody, seconds. */
const HUMANIZE_S = 0.004;

type ChordId = 'F' | 'Am' | 'Dm' | 'Bb' | 'Gm' | 'C';

interface Chord {
  /** Guitar voicing, low to high (MIDI). */
  guitar: readonly [number, number, number, number];
  root: number;
  fifth: number;
}

const CHORDS: Readonly<Record<ChordId, Chord>> = {
  F: { guitar: [53, 57, 60, 65], root: 41, fifth: 48 },
  Am: { guitar: [52, 57, 60, 64], root: 45, fifth: 52 },
  Dm: { guitar: [50, 57, 62, 65], root: 50, fifth: 45 },
  Bb: { guitar: [53, 58, 62, 65], root: 46, fifth: 41 },
  Gm: { guitar: [50, 55, 58, 62], root: 43, fifth: 50 },
  C: { guitar: [52, 55, 60, 64], root: 48, fifth: 43 },
};

/** [step, MIDI, velocity] */
type Hit = readonly [number, number, number];

interface Bar {
  chord: ChordId;
  melody: readonly Hit[];
}

const A: readonly Bar[] = [
  { chord: 'F', melody: [[0, 72, 0.8], [4, 74, 0.6], [6, 72, 0.5], [8, 69, 0.7], [12, 65, 0.6]] },
  { chord: 'Am', melody: [[0, 69, 0.7], [2, 72, 0.5], [4, 76, 0.7], [10, 74, 0.5], [12, 72, 0.6]] },
  { chord: 'Dm', melody: [[0, 74, 0.8], [4, 77, 0.6], [8, 74, 0.6], [10, 72, 0.5], [12, 69, 0.6]] },
  { chord: 'Bb', melody: [[0, 77, 0.7], [6, 74, 0.5], [8, 72, 0.6], [12, 74, 0.7]] },
  { chord: 'F', melody: [[0, 81, 0.7], [4, 79, 0.5], [6, 77, 0.5], [8, 72, 0.7], [12, 77, 0.6]] },
  { chord: 'Gm', melody: [[0, 79, 0.7], [4, 77, 0.5], [8, 74, 0.6], [10, 72, 0.4], [12, 74, 0.5]] },
  { chord: 'Bb', melody: [[0, 77, 0.7], [2, 74, 0.4], [4, 72, 0.5], [8, 74, 0.6], [12, 77, 0.6], [14, 79, 0.4]] },
  { chord: 'C', melody: [[0, 79, 0.7], [4, 76, 0.6], [8, 72, 0.6], [12, 67, 0.5]] },
];

const B: readonly Bar[] = [
  { chord: 'Bb', melody: [[0, 74, 0.6], [8, 77, 0.6], [12, 74, 0.4]] },
  { chord: 'C', melody: [[0, 76, 0.6], [4, 79, 0.5], [8, 84, 0.6], [12, 79, 0.4]] },
  { chord: 'Am', melody: [[0, 81, 0.7], [6, 79, 0.4], [8, 76, 0.6], [12, 72, 0.5]] },
  { chord: 'Dm', melody: [[0, 74, 0.7], [4, 77, 0.5], [8, 81, 0.6], [14, 79, 0.4]] },
  { chord: 'Gm', melody: [[0, 79, 0.6], [8, 74, 0.6], [12, 70, 0.4]] },
  { chord: 'C', melody: [[0, 76, 0.6], [4, 72, 0.5], [8, 67, 0.5], [12, 72, 0.5]] },
  { chord: 'F', melody: [[0, 77, 0.7], [4, 81, 0.6], [8, 84, 0.6], [12, 81, 0.5]] },
  { chord: 'F', melody: [[0, 77, 0.7]] },
];

/** The 32-bar form; section index 1 and 3 (the repeated A) take seeded melody variation. */
export const FORM: readonly (readonly Bar[])[] = [A, A, B, A];
export const FORM_BARS = FORM.length * 8;
const VARIED_SECTIONS: ReadonlySet<number> = new Set([1, 3]);
/** On the first pass the kalimba waits two bars (guitar and bass set the table). */
const INTRO_BARS = 2;

/** Fingerpicked eighths: [step, voicing index, velocity]. */
const GUITAR: readonly Hit[] = [
  [0, 0, 0.7], [2, 2, 0.45], [4, 1, 0.55], [6, 3, 0.45], [8, 2, 0.6], [10, 1, 0.45], [12, 3, 0.55], [14, 2, 0.4],
];
/** Root on 1, fifth on 3. */
const BASS: readonly Hit[] = [
  [0, 0, 0.8],
  [8, 1, 0.6],
];

/** F major pentatonic, for neighbour-note variation. */
const PENTA_PCS: readonly number[] = [5, 7, 9, 0, 2];

export interface Note {
  /** Start time, seconds (caller's clock). */
  time: number;
  inst: Instrument;
  midi: number;
  vel: number;
}

/**
 * The authored pitches per instrument: the engine pre-renders these, and plays variation pitches (neighbours, octave
 * graces) from the nearest one at a playback rate, so memory stays bounded (03 §11.1 decoded-audio budget).
 */
export function songPitches(): Record<Instrument, number[]> {
  const sets: Record<Instrument, Set<number>> = { kalimba: new Set(), nylon: new Set(), bass: new Set() };
  for (const section of FORM) {
    for (const bar of section) {
      const c = CHORDS[bar.chord];
      c.guitar.forEach((m) => sets.nylon.add(m));
      sets.bass.add(c.root).add(c.fifth);
      for (const [, m] of bar.melody) {
        sets.kalimba.add(m);
      }
    }
  }
  const sorted = (s: Set<number>): number[] => [...s].sort((a, b) => a - b);
  return { kalimba: sorted(sets.kalimba), nylon: sorted(sets.nylon), bass: sorted(sets.bass) };
}

/** The next pentatonic pitch above (dir 1) or below (dir −1). */
export function neighbour(midi: number, dir: 1 | -1): number {
  for (let m = midi + dir; Math.abs(m - midi) <= 4; m += dir) if (PENTA_PCS.includes(((m % 12) + 12) % 12)) return m;
  return midi;
}

/** Deterministic [0, 1) from integer keys. */
function unit(...keys: number[]): number {
  return hash32(...keys) / 4_294_967_296;
}

/** Swing offset, in steps: the off-beat eighth (step 2 of each beat) is late. */
export function swingSteps(step: number): number {
  return step % STEPS_PER_BEAT === 2 ? SWING : 0;
}

const MAX_BAR_NOTES = 24;

/**
 * Bar-by-bar step sequencer for the form. `fill(until, out)` writes every note starting before `until` (in time
 * order within a bar) into the caller's pre-allocated Note objects and returns how many it wrote, so the 25-ms
 * look-ahead tick (04 §8.1) allocates nothing.
 */
export class KettleOn {
  private barStart = 0;
  /** Absolute bar count since start (pass = ⌊bar / FORM_BARS⌋). */
  private bar = 0;
  private readonly notes: Note[] = Array.from({ length: MAX_BAR_NOTES }, () => ({ time: 0, inst: 'nylon' as Instrument, midi: 0, vel: 0 }));
  private count = 0;
  private cursor = 0;

  constructor(private readonly seed: number) {}

  /** Restart the form so bar 0 begins at `t0`. */
  start(t0: number): void {
    this.barStart = t0;
    this.bar = 0;
    this.layoutBar();
  }

  get barIndex(): number {
    return this.bar;
  }

  /** Start of the next unwritten note (the next bar's downbeat once this bar is spent). */
  get nextTime(): number {
    return this.cursor < this.count ? this.notes[this.cursor].time : this.barStart + BAR_S;
  }

  fill(until: number, out: Note[]): number {
    let n = 0;
    while (n < out.length) {
      if (this.cursor >= this.count) {
        if (this.barStart + BAR_S >= until) break;
        this.barStart += BAR_S;
        this.bar++;
        this.layoutBar();
        continue;
      }
      const note = this.notes[this.cursor];
      if (note.time >= until) break;
      const o = out[n++];
      o.time = note.time;
      o.inst = note.inst;
      o.midi = note.midi;
      o.vel = note.vel;
      this.cursor++;
    }
    return n;
  }

  /**
   * After a stall (a long frame, a blocked tab), notes before `t` would play late in a burst: drop them and carry on
   * from the first note at or after `t`.
   */
  skipTo(t: number): number {
    let dropped = 0;
    for (;;) {
      if (this.cursor >= this.count) {
        if (this.barStart + BAR_S > t) return dropped;
        this.barStart += BAR_S;
        this.bar++;
        this.layoutBar();
        continue;
      }
      if (this.notes[this.cursor].time >= t) return dropped;
      this.cursor++;
      dropped++;
    }
  }

  // ---------------------------------------------------------------- bar layout

  private layoutBar(): void {
    const pass = Math.floor(this.bar / FORM_BARS);
    const inForm = this.bar % FORM_BARS;
    const sectionIdx = Math.floor(inForm / 8);
    const bar = FORM[sectionIdx][inForm % 8];
    const chord = CHORDS[bar.chord];
    this.count = 0;
    this.cursor = 0;
    for (const [step, idx, vel] of GUITAR) this.push(step, 'nylon', chord.guitar[idx], vel, 0);
    for (const [step, idx, vel] of BASS) this.push(step, 'bass', idx === 0 ? chord.root : chord.fifth, vel, 0);
    if (pass > 0 || this.bar >= INTRO_BARS) this.layoutMelody(bar, pass, sectionIdx, inForm);
    this.sortBar();
  }

  private layoutMelody(bar: Bar, pass: number, sectionIdx: number, inForm: number): void {
    const varied = VARIED_SECTIONS.has(sectionIdx) || pass > 0;
    for (let i = 0; i < bar.melody.length; i++) {
      const [step, midi, vel] = bar.melody[i];
      const r = unit(this.seed, pass, inForm, i);
      const jitter = (unit(this.seed, pass, inForm, i, 7) * 2 - 1) * HUMANIZE_S;
      const v = vel * (0.9 + 0.2 * unit(this.seed, pass, inForm, i, 11));
      if (!varied || r >= 0.36) {
        this.push(step, 'kalimba', midi, v, jitter);
      } else if (r < 0.1 && step !== 0) {
        // Dropped: a breath in the line (never the downbeat).
      } else if (r < 0.28) {
        this.push(step, 'kalimba', neighbour(midi, r < 0.19 ? 1 : -1), v, jitter);
      } else {
        // Ornament: the note plus a soft grace an octave up, an eighth later.
        this.push(step, 'kalimba', midi, v, jitter);
        if (step + 2 < STEPS_PER_BAR) this.push(step + 2, 'kalimba', midi + 12, v * 0.45, jitter);
      }
    }
  }

  private push(step: number, inst: Instrument, midi: number, vel: number, jitterS: number): void {
    if (this.count >= MAX_BAR_NOTES) return;
    const n = this.notes[this.count++];
    n.time = this.barStart + (step + swingSteps(step)) * STEP_S + jitterS;
    n.inst = inst;
    n.midi = midi;
    n.vel = vel;
  }

  /** Insertion sort by time (≤ 24 notes, already nearly ordered). */
  private sortBar(): void {
    const a = this.notes;
    for (let i = 1; i < this.count; i++) {
      const cur = a[i];
      let j = i - 1;
      while (j >= 0 && a[j].time > cur.time) {
        a[j + 1] = a[j];
        j--;
      }
      a[j + 1] = cur;
    }
  }
}
