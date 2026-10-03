// Ambience beds (03 §11.3): thin noise loops, one per band group, crossfaded by depth (mix.ts ambienceMix). Pure;
// each bed is rendered once (seeded) as a seamless loop. Gust and drone modulations have whole cycles per loop, and
// the noise overhang is crossfaded into the head, so the loop point is inaudible.
import { crossfadeLoop, loopHz, normalize, onePole, Osc, PinkNoise, WhiteNoise } from './dsp';

export type BedId = 'wind' | 'earth' | 'deep';

export interface BedSpec {
  seconds: number;
  /** The beds are low-passed material: none needs more than 5 kHz. */
  sampleRate: number;
}

export const BEDS: Readonly<Record<BedId, BedSpec>> = {
  wind: { seconds: 12, sampleRate: 11_025 },
  earth: { seconds: 8, sampleRate: 11_025 },
  deep: { seconds: 8, sampleRate: 11_025 },
};

const XFADE_S = 0.5;
const BED_PEAK = 0.5;

/** Rim wind: pink noise through a gust-driven low-pass; three slow swells (2, 3 and 5 cycles per 12-s loop) keep the
 *  gusts from repeating audibly. */
function renderWind(sr: number, seconds: number): Float32Array {
  const len = Math.round(seconds * sr);
  const total = len + Math.round(XFADE_S * sr);
  const src = new Float32Array(total);
  const pink = new PinkNoise(2004);
  const g1 = new Osc(loopHz(1 / 6, seconds), sr);
  const g2 = new Osc(loopHz(1 / 4, seconds), sr, 1.3);
  const g3 = new Osc(loopHz(5 / 12, seconds), sr, 2.2);
  const hpK = onePole(120, sr);
  let y = 0;
  let hp = 0;
  let k = 0;
  for (let i = 0; i < total; i++) {
    const gust = 0.55 + 0.22 * g1.next() + 0.14 * g2.next() + 0.09 * g3.next();
    // The gust moves slowly: refresh the filter coefficient every 64 samples.
    if ((i & 63) === 0) k = onePole(250 + 900 * gust, sr);
    y += k * (pink.next() - y);
    hp += hpK * (y - hp);
    src[i] = (y - hp) * gust;
  }
  return normalize(crossfadeLoop(src, len), BED_PEAK);
}

/** Earth (B2–B3 room tone): a damp low rumble and a faint D-minor drone on D3 / A3 / D4 that breathes slowly. */
function renderEarth(sr: number, seconds: number): Float32Array {
  const len = Math.round(seconds * sr);
  const total = len + Math.round(XFADE_S * sr);
  const src = new Float32Array(total);
  const w = new WhiteNoise(64);
  const lp1 = onePole(400, sr);
  const lp2 = onePole(220, sr);
  let a = 0;
  let b = 0;
  for (let i = 0; i < total; i++) {
    a += lp1 * (w.next() - a);
    b += lp2 * (a - b);
    src[i] = b * 2.5;
  }
  const out = crossfadeLoop(src, len);
  const tones = [146.83, 220, 293.66];
  for (let k = 0; k < tones.length; k++) {
    const tone = new Osc(loopHz(tones[k], seconds), sr);
    const breathe = new Osc(loopHz(1 / 4, seconds), sr, k * 2.1);
    for (let i = 0; i < len; i++) out[i] += 0.18 * tone.next() * (0.6 + 0.4 * breathe.next());
  }
  return normalize(out, BED_PEAK);
}

/** Deep (B4 pressure, B5 hush): a slow-swelling rumble band (120–500 Hz, so phone speakers carry it) and a very quiet
 *  glassy air on top. */
function renderDeep(sr: number, seconds: number): Float32Array {
  const len = Math.round(seconds * sr);
  const total = len + Math.round(XFADE_S * sr);
  const src = new Float32Array(total);
  const w = new WhiteNoise(262);
  const air = new WhiteNoise(396);
  const swell = new Osc(loopHz(1 / 8, seconds), sr);
  const lp = onePole(500, sr);
  const hp = onePole(120, sr);
  const hpAir = onePole(3_000, sr);
  let r = 0;
  let r2 = 0;
  let sub = 0;
  let airLow = 0;
  for (let i = 0; i < total; i++) {
    r += lp * (w.next() - r);
    r2 += lp * (r - r2);
    sub += hp * (r2 - sub);
    const x = air.next();
    airLow += hpAir * (x - airLow);
    src[i] = (r2 - sub) * 6 * (0.65 + 0.35 * swell.next()) + (x - airLow) * 0.03;
  }
  return normalize(crossfadeLoop(src, len), BED_PEAK);
}

export function renderBed(id: BedId): Float32Array {
  const { seconds, sampleRate } = BEDS[id];
  if (id === 'wind') return renderWind(sampleRate, seconds);
  return id === 'earth' ? renderEarth(sampleRate, seconds) : renderDeep(sampleRate, seconds);
}
