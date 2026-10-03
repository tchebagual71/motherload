// Kettle On player (03 §11.2 G1; 04 §8.1 sequencer): the engine's 25-ms clock calls pump(), which schedules every
// note due in the next LOOKAHEAD_S on the AudioContext clock. Notes are pre-rendered per authored pitch
// (instruments.ts) and replayed through the voice pool at the lowest priority, so SFX always win a voice.
import { KettleOn, songPitches, type Note } from './kettleOn';
import { MUSIC_SAMPLE_RATE, renderNote, type Instrument } from './instruments';
import { Bank, type SourcePlayer, type Voice } from './play';
import { PRIORITY } from './sfx';

/** 04 §8.1: schedule ≤ 100 ms ahead. */
export const LOOKAHEAD_S = 0.1;
/** The first note lands this long after start, so it is never scheduled in the past. */
const START_DELAY_S = 0.06;
/** Instrument balance under the music bus. */
const INSTRUMENT_GAIN: Readonly<Record<Instrument, number>> = { kalimba: 0.5, nylon: 0.34, bass: 0.42 };
const SMOOTH_S = 0.25;
/** Below this the bus is inaudible; after FADED_S there the song stops (and restarts from bar 0 on the way up). */
const SILENT_GAIN = 0.002;
const FADED_S = 2;
const BATCH = 32;

const INSTRUMENTS: readonly Instrument[] = ['kalimba', 'nylon', 'bass'];

export class MusicPlayer {
  readonly bank: Bank<number>;
  private readonly filter: BiquadFilterNode;
  private readonly bus: GainNode;
  private readonly seq: KettleOn;
  private readonly batch: Note[] = Array.from({ length: BATCH }, () => ({ time: 0, inst: 'nylon' as Instrument, midi: 0, vel: 0 }));
  private readonly pitches = songPitches();
  /** Ring of this player's own voices: the oldest is cut when the song exceeds its share of the pool. */
  private readonly mine: (Voice | null)[];
  private ring = 0;
  private playing = false;
  private gainTarget = -1;
  private cutoffTarget = -1;
  private silentSince = Number.POSITIVE_INFINITY;
  notesPlayed = 0;

  constructor(
    ctx: BaseAudioContext,
    dest: AudioNode,
    private readonly player: SourcePlayer,
    seed: number,
    maxNotes: number,
  ) {
    this.bank = new Bank<number>(ctx);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 16_000;
    this.filter.Q.value = 0.5;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.filter.connect(this.bus).connect(dest);
    this.seq = new KettleOn(seed);
    this.mine = new Array<Voice | null>(maxNotes).fill(null);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get bar(): number {
    return this.seq.barIndex;
  }

  get gain(): number {
    return this.gainTarget;
  }

  get cutoff(): number {
    return this.cutoffTarget;
  }

  /** Render jobs for every authored note (the engine runs one per frame after unlock). */
  renderJobs(): (() => void)[] {
    const jobs: (() => void)[] = [];
    for (const inst of INSTRUMENTS) for (const m of this.pitches[inst]) jobs.push(() => void this.buffer(inst, m));
    return jobs;
  }

  /**
   * Bus gain and low-pass from the depth mix and ducks. Starts the song when it becomes audible and stops it once
   * it has been silent for FADED_S.
   */
  setMix(gain: number, cutoffHz: number, t: number): void {
    if (Math.abs(gain - this.gainTarget) > 0.002) {
      this.gainTarget = gain;
      this.bus.gain.setTargetAtTime(gain, t, SMOOTH_S);
    }
    if (Math.abs(cutoffHz - this.cutoffTarget) > this.cutoffTarget * 0.01) {
      this.cutoffTarget = cutoffHz;
      this.filter.frequency.setTargetAtTime(cutoffHz, t, SMOOTH_S);
    }
    if (gain > SILENT_GAIN) {
      this.silentSince = Number.POSITIVE_INFINITY;
      if (!this.playing) this.start(t);
    } else if (this.playing) {
      if (this.silentSince === Number.POSITIVE_INFINITY) this.silentSince = t;
      else if (t - this.silentSince >= FADED_S) this.stop();
    }
  }

  start(t: number): void {
    this.seq.start(t + START_DELAY_S);
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
    this.silentSince = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.mine.length; i++) {
      this.mine[i]?.stop();
      this.mine[i] = null;
    }
  }

  /** Clock tick: schedule every note starting before t + LOOKAHEAD_S. */
  pump(t: number): void {
    if (!this.playing) return;
    // A stall longer than the look-ahead (blocked main thread): skip the missed notes rather than burst them.
    if (this.seq.nextTime < t) this.seq.skipTo(t);
    for (;;) {
      const n = this.seq.fill(t + LOOKAHEAD_S, this.batch);
      for (let i = 0; i < n; i++) this.playNote(this.batch[i]);
      if (n < BATCH) return;
    }
  }

  private playNote(note: Note): void {
    // Variation pitches (neighbours, octave graces) replay the nearest authored note at a playback rate.
    const base = this.nearestPitch(note.inst, note.midi);
    const old = this.mine[this.ring];
    if (old) {
      this.player.pool.release(old);
      old.stop();
    }
    const rate = 2 ** ((note.midi - base) / 12);
    const v = this.player.play(this.buffer(note.inst, base), this.filter, note.time, rate, note.vel * INSTRUMENT_GAIN[note.inst], PRIORITY.music, true);
    this.mine[this.ring] = v;
    this.ring = (this.ring + 1) % this.mine.length;
    if (v) this.notesPlayed++;
  }

  private nearestPitch(inst: Instrument, midi: number): number {
    const list = this.pitches[inst];
    let best = list[0];
    for (const m of list) if (Math.abs(m - midi) < Math.abs(best - midi)) best = m;
    return best;
  }

  /** Key: instrument index × 128 + MIDI. */
  private buffer(inst: Instrument, midi: number): AudioBuffer {
    const key = INSTRUMENTS.indexOf(inst) * 128 + midi;
    return this.bank.peek(key) ?? this.bank.put(key, MUSIC_SAMPLE_RATE, renderNote(inst, midi));
  }
}
