// Synthesised voices that ZzFX cannot make well: the Kettle On instruments (03 §11.2: kalimba, nylon guitar, soft
// bass), the transmission blips (03 §11.5) and the seamless pod loops (engine hum, fall whistle; 03 §11.4 ★6–7).
// Pure; each renders once into a mono buffer that the engine replays at a playback rate.
import { addPartials, crossfadeLoop, loopHz, normalize, onePole, Osc, PinkNoise, shapeEnds, TAU, WhiteNoise, type PartialSpec } from './dsp';

/** Music and ambience render at half rate: nothing in them needs more than 10 kHz, and it halves the memory. */
export const MUSIC_SAMPLE_RATE = 22_050;

export type Instrument = 'kalimba' | 'nylon' | 'bass';

export function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

interface InstrumentSpec {
  seconds: number;
  attackS: number;
  partials: readonly PartialSpec[];
  /** Tine click / finger noise at the attack, relative to the note peak. */
  click: number;
}

/** Kalimba tines ring with a strong fundamental and two quickly dying inharmonic modes. */
const KALIMBA: InstrumentSpec = {
  seconds: 1.3,
  attackS: 0.0015,
  click: 0.08,
  partials: [
    { ratio: 1, amp: 1, decayS: 0.75 },
    { ratio: 2, amp: 0.06, decayS: 0.3 },
    { ratio: 5.4, amp: 0.22, decayS: 0.08 },
    { ratio: 12.6, amp: 0.07, decayS: 0.03 },
  ],
};

/** Plucked nylon string: harmonic amplitudes from a pluck at 17% of the length, upper harmonics dying faster. */
const NYLON: InstrumentSpec = {
  seconds: 1.5,
  attackS: 0.002,
  click: 0.03,
  partials: Array.from({ length: 12 }, (_, i) => {
    const h = i + 1;
    return { ratio: h, amp: Math.abs(Math.sin(Math.PI * h * 0.17)) / h ** 1.15, decayS: 1.2 / (1 + 0.45 * (h - 1)) };
  }),
};

/** Soft bass: the 2nd and 3rd harmonics carry it on phone speakers (03 §11.1: nothing important below 150 Hz). */
const BASS: InstrumentSpec = {
  seconds: 1.1,
  attackS: 0.006,
  click: 0,
  partials: [
    { ratio: 1, amp: 0.8, decayS: 0.6 },
    { ratio: 2, amp: 0.65, decayS: 0.4 },
    { ratio: 3, amp: 0.3, decayS: 0.25 },
    { ratio: 4, amp: 0.12, decayS: 0.18 },
  ],
};

const SPECS: Readonly<Record<Instrument, InstrumentSpec>> = { kalimba: KALIMBA, nylon: NYLON, bass: BASS };
const NOTE_PEAK = 0.6;
const FADE_S = 0.08;

/** One note of an instrument at a MIDI pitch (seeded by the pitch, so it is identical on every render). */
export function renderNote(inst: Instrument, midi: number, sr = MUSIC_SAMPLE_RATE): Float32Array {
  const spec = SPECS[inst];
  const out = new Float32Array(Math.round(spec.seconds * sr));
  addPartials(out, sr, midiHz(midi), spec.partials);
  if (spec.click > 0) addClick(out, sr, spec.click, midi);
  shapeEnds(out, sr, spec.attackS, FADE_S);
  return normalize(out, NOTE_PEAK);
}

/** A 4-ms burst of differentiated (bright) noise at the attack. */
function addClick(out: Float32Array, sr: number, level: number, seed: number): void {
  const n = Math.round(0.004 * sr);
  const w = new WhiteNoise(seed * 7919 + 1);
  let prev = 0;
  for (let i = 0; i < n && i < out.length; i++) {
    const v = w.next();
    out[i] += (v - prev) * 0.5 * level * (1 - i / n);
    prev = v;
  }
}

// ---------------------------------------------------------------- transmission blips (03 §11.5)

export type BlipSound = 'blipDot' | 'blipMarlow' | 'blipStatic' | 'tickStatic' | 'blipCelesta' | 'blipLog';

/** Blips are dense (16 a second): kept below the one-shot SFX peaks so a line never shouts. */
const BLIP_PEAK = 0.3;

/** Dot: a warm FM sine at G4 (ratio 1, index falling 1.4 → 0.2 over the blip). */
function renderDotBlip(sr: number): Float32Array {
  const n = Math.round(0.05 * sr);
  const out = new Float32Array(n);
  const f = midiHz(67);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t / 0.018);
    const index = 0.2 + 1.2 * env;
    out[i] = Math.sin(TAU * f * t + index * Math.sin(TAU * f * t)) * env;
  }
  shapeEnds(out, sr, 0.003, 0.01);
  return normalize(out, BLIP_PEAK);
}

/** Marlow: a soft (odd-harmonic, rolled-off) square at G3 with a little grit. */
function renderMarlowBlip(sr: number): Float32Array {
  const n = Math.round(0.06 * sr);
  const out = new Float32Array(n);
  addPartials(out, sr, midiHz(55), [
    { ratio: 1, amp: 1, decayS: 0.04 },
    { ratio: 3, amp: 0.3, decayS: 0.03 },
    { ratio: 5, amp: 0.15, decayS: 0.025 },
    { ratio: 7, amp: 0.07, decayS: 0.02 },
  ]);
  const w = new WhiteNoise(55);
  for (let i = 0; i < n; i++) out[i] += w.next() * 0.04 * (1 - i / n);
  shapeEnds(out, sr, 0.004, 0.012);
  return normalize(out, BLIP_PEAK);
}

/** Channel Zero: a 40-ms band-limited static burst per word. */
function renderStatic(sr: number): Float32Array {
  const n = Math.round(0.04 * sr);
  const out = new Float32Array(n);
  const w = new WhiteNoise(4040);
  const lp = onePole(3_000, sr);
  const hp = onePole(700, sr);
  let low = 0;
  let base = 0;
  for (let i = 0; i < n; i++) {
    low += lp * (w.next() - low);
    base += hp * (low - base);
    // Gated in 4-ms grains so it crackles rather than hisses.
    const gate = (i / Math.round(0.004 * sr)) % 2 < 1.4 ? 1 : 0.25;
    out[i] = (low - base) * gate;
  }
  shapeEnds(out, sr, 0.002, 0.01);
  return normalize(out, BLIP_PEAK);
}

/** Channel Zero's tick per number: a 6-ms ping at 2.4 kHz. */
function renderTick(sr: number): Float32Array {
  const out = new Float32Array(Math.round(0.006 * sr));
  addPartials(out, sr, 2_400, [{ ratio: 1, amp: 1, decayS: 0.0015 }]);
  shapeEnds(out, sr, 0.0003, 0.001);
  return normalize(out, BLIP_PEAK);
}

/** the Surveyor: one celesta note per word (bell partials, A4; pitched by playback rate along a whole-tone row). */
function renderCelesta(sr: number): Float32Array {
  const out = new Float32Array(Math.round(0.7 * sr));
  addPartials(out, sr, 440, [
    { ratio: 1, amp: 1, decayS: 0.35 },
    { ratio: 4, amp: 0.25, decayS: 0.08 },
    { ratio: 10, amp: 0.06, decayS: 0.02 },
  ]);
  shapeEnds(out, sr, 0.002, 0.08);
  return normalize(out, BLIP_PEAK * 0.8);
}

/** Deepreach logs: a dull triangle-ish blip at A3 (the tape wow is applied per blip as pitch drift). */
function renderLogBlip(sr: number): Float32Array {
  const out = new Float32Array(Math.round(0.055 * sr));
  addPartials(out, sr, midiHz(57), [
    { ratio: 1, amp: 1, decayS: 0.04 },
    { ratio: 3, amp: 0.11, decayS: 0.03 },
    { ratio: 5, amp: 0.04, decayS: 0.02 },
  ]);
  const w = new WhiteNoise(57);
  for (let i = 0; i < out.length; i++) out[i] += w.next() * 0.05;
  shapeEnds(out, sr, 0.004, 0.012);
  return normalize(out, BLIP_PEAK);
}

const BLIP_RENDER: Readonly<Record<BlipSound, (sr: number) => Float32Array>> = {
  blipDot: renderDotBlip,
  blipMarlow: renderMarlowBlip,
  blipStatic: renderStatic,
  tickStatic: renderTick,
  blipCelesta: renderCelesta,
  blipLog: renderLogBlip,
};

export function renderBlip(sound: BlipSound, sr: number): Float32Array {
  return BLIP_RENDER[sound](sr);
}

// ---------------------------------------------------------------- seamless pod loops

const LOOP_S = 1;
const XFADE_S = 0.08;

/**
 * Engine hum (★6): a buzzy 110-Hz harmonic stack with a 15-Hz flutter over a low pink-noise rush. Every periodic
 * layer has whole cycles per second, and the noise is crossfaded, so the 1-s loop has no seam.
 */
export function renderEngineLoop(sr: number): Float32Array {
  const len = Math.round(LOOP_S * sr);
  const noise = new Float32Array(len + Math.round(XFADE_S * sr));
  const pink = new PinkNoise(611);
  const lp = onePole(1_400, sr);
  const hp = onePole(200, sr);
  let y = 0;
  let low = 0;
  for (let i = 0; i < noise.length; i++) {
    y += lp * (pink.next() - y);
    low += hp * (y - low);
    noise[i] = (y - low) * 2.4;
  }
  const out = crossfadeLoop(noise, len);
  const f0 = loopHz(110, LOOP_S);
  // Fundamental held back (phone speakers), harmonics 2–10 falling as 1/h.
  const harmonics = Array.from({ length: 10 }, (_, i) => new Osc(f0 * (i + 1), sr));
  const flutter = new Osc(loopHz(15, LOOP_S), sr);
  for (let i = 0; i < len; i++) {
    let hum = harmonics[0].next() * 0.2;
    for (let h = 1; h < harmonics.length; h++) hum += harmonics[h].next() / (h + 1);
    out[i] += hum * 0.22 * (0.8 + 0.2 * flutter.next());
  }
  return normalize(out, 0.5);
}

/** Fall whistle (★7): an 880-Hz sine with a 6-Hz vibrato and a breath of noise; pitched by fall speed at play time. */
export function renderWhistleLoop(sr: number): Float32Array {
  const len = Math.round(LOOP_S * sr);
  const noise = new Float32Array(len + Math.round(XFADE_S * sr));
  const w = new WhiteNoise(880);
  const lp = onePole(2_500, sr);
  let y = 0;
  for (let i = 0; i < noise.length; i++) {
    y += lp * (w.next() - y);
    noise[i] = y * 0.25;
  }
  const out = crossfadeLoop(noise, len);
  const f = loopHz(880, LOOP_S);
  const vib = loopHz(6, LOOP_S);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    out[i] += Math.sin(TAU * f * t + 2.2 * Math.sin(TAU * vib * t));
  }
  return normalize(out, 0.4);
}
