// Terrain colour rules (03 §8.3–8.5): strata with wavy, dithered band edges and per-cell jitter.
// Colours stay sRGB hex here; the mesher writes them as u8 and the shader decodes to linear.
import { HEART_TOP_ROW, SEAL_ROW } from '../../shared/canon';
import { hash32 } from '../../shared/rng';
import { STRATA, type StratumColours } from '../palette';

const SALT_WAVE = 0x5a17;
const SALT_DITHER = 0xd17e;
const SALT_JITTER = 0x1177;

/** Index of the last dithered band (B6); the Seal and B7 rows are hard-edged. */
const LAST_SOFT_BAND = 6;
const SEAL_INDEX = 7;
const HEART_INDEX = 8;
/** Lattice spacing (columns) of the band-edge wave. */
const WAVE_STEP = 5;
/** Wave amplitude (rows) and dither half-width (rows): edges spread over ≈ 3–6 rows. */
const WAVE_AMP = 1.5;
const DITHER_HALF = 2;

function unit(h: number): number {
  return h / 4294967296;
}

/** Smooth per-boundary wave in rows: value noise over columns. */
export function bandWave(x: number, boundary: number, seed: number): number {
  const cell = Math.floor(x / WAVE_STEP);
  const f = (x - cell * WAVE_STEP) / WAVE_STEP;
  const a = unit(hash32(seed, SALT_WAVE, boundary, cell));
  const b = unit(hash32(seed, SALT_WAVE, boundary, cell + 1));
  const s = f * f * (3 - 2 * f);
  return (a + (b - a) * s) * 2 * WAVE_AMP - WAVE_AMP;
}

/**
 * Stratum index (into palette STRATA) for a cell: the number of band boundaries the cell lies
 * below, each boundary displaced by a wave and a per-cell dither (03 §8.3 "edges wavy, dithered").
 */
export function bandIndexAt(x: number, r: number, seed: number): number {
  if (r >= HEART_TOP_ROW) return HEART_INDEX;
  if (r === SEAL_ROW) return SEAL_INDEX;
  let band = 0;
  for (let k = 1; k <= LAST_SOFT_BAND; k++) {
    const top = STRATA[k].top;
    const near = r - top;
    if (near < -(WAVE_AMP + DITHER_HALF + 1)) break;
    const dither = (unit(hash32(seed, SALT_DITHER, k, x, r)) * 2 - 1) * DITHER_HALF;
    if (near - bandWave(x, k, seed) + dither >= 0) band = k;
    else break;
  }
  return band;
}

export function stratumForCell(x: number, r: number, seed: number): StratumColours {
  return STRATA[bandIndexAt(x, r, seed)];
}

// ---------------------------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------------------------

export function scaleHex(hex: number, k: number): number {
  const ch = (s: number): number => Math.max(0, Math.min(255, Math.round(((hex >> s) & 0xff) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number): number => {
    const x = (a >> s) & 0xff;
    const y = (b >> s) & 0xff;
    return Math.max(0, Math.min(255, Math.round(x + (y - x) * t)));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * Per-cell jitter (03 §8.3 "hue ±3%, value ±5%"), tuned down for the style test: read literally
 * (±10.8° of hue) neighbouring cells flip between yellow and red and the slab reads as a checkerboard,
 * so the total spread is 3% hue / 5% value (±1.5% / ±2.5%). Deterministic in (seed, x, r).
 */
export const JITTER_HUE = 0.03;
export const JITTER_VALUE = 0.05;
export function jitterHex(hex: number, x: number, r: number, seed: number, scale = 1): number {
  const h = hash32(seed, SALT_JITTER, x, r);
  const dh = ((h & 0xffff) / 65535 - 0.5) * JITTER_HUE * scale;
  const dv = (((h >>> 16) & 0xffff) / 65535 - 0.5) * JITTER_VALUE * scale;
  return shiftHsv(hex, dh, 1 + dv);
}

/** Rotate hue by `dh` turns and scale value by `kv`. */
export function shiftHsv(hex: number, dh: number, kv: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 1e-6) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue /= 6;
  }
  const sat = max > 0 ? d / max : 0;
  hue = (((hue + dh) % 1) + 1) % 1;
  const v = Math.min(1, max * kv);
  return hsvToHex(hue, sat, v);
}

function hsvToHex(h: number, s: number, v: number): number {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = v, g = t, b = p;
  switch (i % 6) {
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}
