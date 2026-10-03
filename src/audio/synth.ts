// ZzFX sample generator (ZzFX v1.3.2 by Frank Force, MIT — https://github.com/KilledByAPixel/ZzFX).
// Ported because the `zzfx` package creates its own AudioContext at import time, which on iOS would exist
// before navigator.audioSession is configured and outside the unlock gesture (03 §11.1). Parameters keep the
// ZzFX order so presets from the ZzFX designer paste in unchanged; the built-in randomness is dropped (variety
// comes from playback-rate jitter at play time) so buffers are deterministic and cacheable. The cos and noise terms are
// skipped when their parameter is zero, and the noise is hashed (noiseAt), so a render costs a fraction of ZzFX's.

/** ZzFX parameter list: [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide,
 *  deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay,
 *  tremolo, filter]. Missing entries take ZzFX defaults. */
export type ZzfxParams = readonly (number | undefined)[];

export const ZZFX_SAMPLE_RATE = 44_100;
/** ZzFX's master volume scale (ZZFX.volume). */
const ZZFX_VOLUME = 0.3;

/**
 * ZzFX's frequency noise is sin(i⁵): white, arcsine-distributed, but a huge-argument sin costs ≈ 250 ns a sample.
 * The same distribution from a hashed phase is ≈ 10× cheaper (the render runs on the main thread after unlock).
 */
function noiseAt(i: number): number {
  let h = Math.imul(i ^ 0x5bd1e995, 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 15), 0x297a2d39);
  return Math.sin(((h ^ (h >>> 16)) >>> 0) * (Math.PI * 2 / 4_294_967_296));
}

function p(params: ZzfxParams, i: number, d: number): number {
  const v = params[i];
  return v === undefined ? d : v;
}

export function buildSamples(params: ZzfxParams, sampleRate: number = ZZFX_SAMPLE_RATE): Float32Array {
  const PI2 = Math.PI * 2;
  const abs = Math.abs;
  const sign = (v: number): number => (v < 0 ? -1 : 1);
  let volume = p(params, 0, 1);
  let frequency = p(params, 2, 220);
  let attack = p(params, 3, 0);
  let sustain = p(params, 4, 0);
  let release = p(params, 5, 0.1);
  const shape = p(params, 6, 0);
  const shapeCurve = p(params, 7, 1);
  let slide = p(params, 8, 0);
  let deltaSlide = p(params, 9, 0);
  let pitchJump = p(params, 10, 0);
  let pitchJumpTime = p(params, 11, 0);
  let repeatTime = p(params, 12, 0);
  const noise = p(params, 13, 0);
  let modulation = p(params, 14, 0);
  const bitCrush = p(params, 15, 0);
  let delay = p(params, 16, 0);
  const sustainVolume = p(params, 17, 1);
  let decay = p(params, 18, 0);
  const tremolo = p(params, 19, 0);
  const filter = p(params, 20, 0);

  slide *= (500 * PI2) / sampleRate / sampleRate;
  const startSlide = slide;
  frequency *= PI2 / sampleRate;
  let startFrequency = frequency;

  // Biquad LP/HP filter coefficients.
  const quality = 2;
  const w = (PI2 * abs(filter) * 2) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / 2 / quality;
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const b0 = (1 + sign(filter) * cos) / 2 / a0;
  const b1 = -(sign(filter) + cos) / a0;
  const b2 = b0;
  let x2 = 0;
  let x1 = 0;
  let y2 = 0;
  let y1 = 0;

  const minAttack = 9; // avoids a click when attack is 0
  attack = attack * sampleRate || minAttack;
  decay *= sampleRate;
  sustain *= sampleRate;
  release *= sampleRate;
  delay *= sampleRate;
  deltaSlide *= (500 * PI2) / sampleRate ** 3;
  modulation *= PI2 / sampleRate;
  pitchJump *= PI2 / sampleRate;
  pitchJumpTime *= sampleRate;
  repeatTime = (repeatTime * sampleRate) | 0;
  volume *= ZZFX_VOLUME;

  const length = (attack + decay + sustain + release + delay) | 0;
  const b = new Float32Array(Math.max(1, length));
  let modOffset = 0;
  let repeat = 0;
  let crush = 0;
  let jump = 1;
  let t = 0;
  let s = 0;
  const crushEvery = (bitCrush * 100) | 0;

  for (let i = 0; i < length; b[i++] = s * volume) {
    if (!(++crush % crushEvery)) {
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? shape > 4
                ? (((t / PI2) % 1) < shapeCurve / 2 ? 1 : 0) * 2 - 1 // 5 square duty
                : Math.sin(t ** 3) // 4 noise
              : Math.max(Math.min(Math.tan(t), 1), -1) // 3 tan
            : 1 - ((((2 * t) / PI2) % 2) + 2) % 2 // 2 saw
          : 1 - 4 * abs(Math.round(t / PI2) - t / PI2) // 1 triangle
        : Math.sin(t); // 0 sin

      s =
        (repeatTime ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) : 1) *
        (shape > 4 ? s : sign(s) * abs(s) ** shapeCurve) *
        (i < attack
          ? i / attack
          : i < attack + decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume)
            : i < attack + decay + sustain
              ? sustainVolume
              : i < length - delay
                ? ((length - i - delay) / release) * sustainVolume
                : 0);

      s = delay ? s / 2 + (delay > i ? 0 : ((i < length - delay ? 1 : (length - i) / delay) * b[(i - delay) | 0]) / 2 / volume) : s;

      if (filter) {
        const y = b2 * x2 + b1 * x1 + b0 * s - a2 * y2 - a1 * y1;
        x2 = x1;
        x1 = s;
        y2 = y1;
        y1 = y;
        s = y;
      }
    }

    frequency += slide += deltaSlide;
    const f = modulation ? frequency * Math.cos(modulation * modOffset++) : frequency;
    t += noise ? f + f * noise * noiseAt(i) : f;

    if (jump && ++jump > pitchJumpTime) {
      frequency += pitchJump;
      startFrequency += pitchJump;
      jump = 0;
    }

    if (repeatTime && !(++repeat % repeatTime)) {
      frequency = startFrequency;
      slide = startSlide;
      jump ||= 1;
    }
  }
  return b;
}
