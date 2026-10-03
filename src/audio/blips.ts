// Transmission voices (03 §11.5; canon §6: blips, no voice acting). A card's text becomes a timed blip line per
// sender: one blip per letter at the sender's rate (≤ 18/s), vowels louder, a 120-ms rest at commas and 280 ms at
// stops; Channel Zero bursts static per word and ticks per number; the Surveyor rings one celesta note per word.
// Reduced motion speaks one blip per word. Pure: the engine plays the plan on the AudioContext clock.
import type { GameEvent } from '../shared/events';
import { hashString } from '../shared/rng';
import type { BlipSound } from './instruments';

export type Sender = Extract<GameEvent, { t: 'radio' }>['sender'];

export const MAX_BLIP_RATE = 18;
export const COMMA_S = 0.12;
export const STOP_S = 0.28;
/** 03 §11.5 "vowels × 1.5": vowels at full level, everything else at 1/1.5. */
export const CONSONANT_GAIN = 1 / 1.5;
/** A card is ≤ 90 characters (canon §2.12 #5); this leaves room and bounds the plan. */
export const MAX_BLIPS = 128;

interface VoiceSpec {
  sound: BlipSound;
  /** Blips per second for letters; for word voices, the reading rate that spaces the words. */
  rate: number;
  perWord: boolean;
  /** Pitch walk, semitones above the rendered blip's own pitch. */
  scale: readonly number[];
  /** Tape wow depth (pitch fraction) and rate, for the Deepreach logs. */
  wow: number;
  /** Fixed seconds per word (the Surveyor's slow celesta), or 0 to space words by their length. */
  wordS: number;
}

export const VOICES: Readonly<Record<Sender, VoiceSpec>> = {
  Dot: { sound: 'blipDot', rate: 16, perWord: false, scale: [-5, -3, 0, 2, 4, 7, 9], wow: 0, wordS: 0 },
  Marlow: { sound: 'blipMarlow', rate: 14, perWord: false, scale: [-2, 0, 3, 5, 7], wow: 0, wordS: 0 },
  'Channel Zero': { sound: 'blipStatic', rate: 14, perWord: true, scale: [0], wow: 0, wordS: 0 },
  'the Surveyor': { sound: 'blipCelesta', rate: 14, perWord: true, scale: [-6, -4, -2, 0, 2, 4, 6], wow: 0, wordS: 0.42 },
  'Deepreach log': { sound: 'blipLog', rate: 12, perWord: false, scale: [0, 2, 3, 5, 7], wow: 0.015, wordS: 0 },
};

const WOW_HZ = 0.8;

export interface Blip {
  /** Seconds from the start of the line. */
  t: number;
  sound: BlipSound;
  /** Playback rate. */
  pitch: number;
  gain: number;
}

export function newBlips(n = MAX_BLIPS): Blip[] {
  return Array.from({ length: n }, () => ({ t: 0, sound: 'blipDot' as BlipSound, pitch: 1, gain: 1 }));
}

const LETTER = /[\p{L}\p{N}]/u;
const VOWEL = /[aeiouy]/i;
const isLetter = (c: string): boolean => LETTER.test(c);
const isVowel = (c: string): boolean => VOWEL.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isStop = (c: string): boolean => c === '.' || c === '!' || c === '?' || c === '…';
const isComma = (c: string): boolean => c === ',' || c === ';' || c === ':' || c === '—';

/** Walks the sender's scale one degree at a time, seeded by the text, so a line always sounds the same. */
class PitchWalk {
  private h: number;
  private deg: number;

  constructor(
    private readonly scale: readonly number[],
    seed: number,
  ) {
    this.h = seed;
    this.deg = Math.floor(scale.length / 2);
  }

  next(): number {
    this.h = Math.imul(this.h ^ (this.h >>> 15), 0x2c1b3c6d) >>> 0;
    const step = (this.h >>> 8) % 3; // down, stay, up
    this.deg = Math.min(this.scale.length - 1, Math.max(0, this.deg + step - 1));
    return 2 ** (this.scale[this.deg] / 12);
  }
}

/**
 * Plans a card's blip line into `out` (pre-allocated, see newBlips) and returns the blip count. `reducedMotion`
 * collapses letter voices to one blip per word (03 §11.5).
 */
export function planBlips(sender: Sender, text: string, reducedMotion: boolean, out: Blip[]): number {
  const v = VOICES[sender];
  const walk = new PitchWalk(v.scale, hashString(text) ^ hashString(sender));
  const slot = 1 / Math.min(v.rate, MAX_BLIP_RATE);
  const perWord = v.perWord || reducedMotion;
  let t = 0;
  let n = 0;
  let wordLen = 0;
  let wordVowel = false;
  let wordDigit = false;
  const emit = (gain: number, sound: BlipSound): void => {
    if (n >= out.length) return;
    const b = out[n++];
    b.t = t;
    b.sound = sound;
    b.pitch = walk.next() * (v.wow ? 1 + v.wow * Math.sin(2 * Math.PI * WOW_HZ * t) : 1);
    b.gain = gain;
  };
  const endWord = (): void => {
    if (wordLen === 0) return;
    if (perWord) {
      const sound = sender === 'Channel Zero' && wordDigit ? 'tickStatic' : v.sound;
      emit(wordVowel ? 1 : CONSONANT_GAIN, sound);
      t += v.wordS || wordLen * slot;
    }
    wordLen = 0;
    wordVowel = false;
    wordDigit = false;
  };
  for (const c of text) {
    if (isLetter(c)) {
      if (!perWord) {
        emit(isVowel(c) ? 1 : CONSONANT_GAIN, v.sound);
        t += slot;
      }
      wordLen++;
      wordVowel ||= isVowel(c);
      wordDigit ||= isDigit(c);
      continue;
    }
    endWord();
    if (isStop(c)) t += STOP_S;
    else if (isComma(c)) t += COMMA_S;
    else if (c === ' ' && !perWord) t += slot;
  }
  endWord();
  return n;
}

/**
 * The line being spoken: planned on `speak`, then handed out a look-ahead window at a time by `pump`. One line at a
 * time; a new card replaces the old one.
 */
export class RadioVoice {
  private readonly blips = newBlips();
  private count = 0;
  private cursor = 0;
  private t0 = 0;
  private endAt = 0;

  /** Starts a card at `startTime`; returns the line's length in seconds. */
  speak(sender: Sender, text: string, startTime: number, reducedMotion: boolean): number {
    this.count = planBlips(sender, text, reducedMotion, this.blips);
    this.cursor = 0;
    this.t0 = startTime;
    const last = this.count > 0 ? this.blips[this.count - 1].t : 0;
    this.endAt = startTime + last + 0.1;
    return this.endAt - startTime;
  }

  stop(): void {
    this.count = 0;
    this.cursor = 0;
  }

  get speaking(): boolean {
    return this.cursor < this.count;
  }

  /** Clock time the line ends (for the radio duck). */
  get end(): number {
    return this.endAt;
  }

  /** Calls `play` for every blip due before `until`, with its absolute start time. */
  pump(until: number, play: (b: Blip, when: number) => void): void {
    while (this.cursor < this.count) {
      const b = this.blips[this.cursor];
      const when = this.t0 + b.t;
      if (when >= until) return;
      this.cursor++;
      play(b, when);
    }
  }
}
