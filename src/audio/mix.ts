// Depth-driven mix curves and ducking (03 §11.2, §11.3, §11.6). Pure: no AudioContext, so the curves are unit-tested
// in Node. Depth is in rows below the Rim surface (0 on the Rim and in the sky), fractional for smooth sweeps.

/** 03 §11.2 G1: "Low-pass 16 kHz → 700 Hz and −12 dB by r40; gone by r64". */
export const KETTLE_MIX = {
  topHz: 16_000,
  floorHz: 700,
  muffledRow: 40,
  muffledDb: -12,
  goneRow: 64,
} as const;

/** 03 §11.6 ducking, and the shop / build duck of 03 §11.2. */
export const DUCK = {
  sheetDb: -4,
  sheetLowpassHz: 4_000,
  radioMusicDb: -6,
  radioAmbienceDb: -3,
  alarmDb: -8,
  alarmMs: 900,
  sellDb: -4,
  sellMs: 700,
} as const;

/** 03 §11.2: groups crossfade with equal power over 24 rows, centred on the group boundary. */
export const CROSSFADE_ROWS = 24;
/** Ambience group boundaries (canon §2.5 music groups B0–1 / B2–3 / B4–5). */
export const AMBIENCE_EDGES = { earth: 64, deep: 262, hush: 396 } as const;

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface MusicMix {
  cutoffHz: number;
  /** Linear gain on top of the music bus level (1 = surface). */
  gain: number;
}

/** Kettle On through rock: exponential cutoff sweep and a dB-linear fade to −12 dB by r40, then out by r64. */
export function kettleMix(depth: number, out: MusicMix): MusicMix {
  const k = KETTLE_MIX;
  const x = clamp01(depth / k.muffledRow);
  out.cutoffHz = k.topHz * (k.floorHz / k.topHz) ** x;
  const muffled = dbToGain(k.muffledDb * x);
  out.gain = depth <= k.muffledRow ? muffled : muffled * (1 - clamp01((depth - k.muffledRow) / (k.goneRow - k.muffledRow)));
  return out;
}

export interface AmbienceMix {
  /** Rim wind, heard muffled down the shaft through B0–B1. */
  wind: number;
  /** Earthy room-tone drone, B2–B3. */
  earth: number;
  /** Pressure rumble and glassy hush, B4 and below (−12 dB in B5). */
  deep: number;
  windCutoffHz: number;
}

/** Linear 0 → 1 across the CROSSFADE_ROWS window centred on `edge`. */
function ramp(depth: number, edge: number): number {
  return clamp01((depth - (edge - CROSSFADE_ROWS / 2)) / CROSSFADE_ROWS);
}

/** Equal-power weights across that window: fadeIn² + fadeOut² = 1. */
export function fadeIn(depth: number, edge: number): number {
  return Math.sin((ramp(depth, edge) * Math.PI) / 2);
}

export function fadeOut(depth: number, edge: number): number {
  const x = ramp(depth, edge);
  return x >= 1 ? 0 : Math.cos((x * Math.PI) / 2);
}

const WIND_OPEN_HZ = 5_000;
const WIND_SHAFT_HZ = 900;
/** Rows over which the open-air wind closes down to the muffled shaft wind (B0). */
const WIND_MUFFLE_ROWS = 20;
const WIND_SHAFT_LEVEL = 0.5;
/** 03 §11.3 B5: near silence (−12 dB). */
const HUSH_LEVEL = dbToGain(-12);

/** 03 §11.3 beds per group: wind on the Rim, earth below r64, deep below r262, hushed below r396. */
export function ambienceMix(depth: number, out: AmbienceMix): AmbienceMix {
  const e = AMBIENCE_EDGES;
  const m = clamp01(depth / WIND_MUFFLE_ROWS);
  out.windCutoffHz = WIND_OPEN_HZ * (WIND_SHAFT_HZ / WIND_OPEN_HZ) ** m;
  out.wind = (1 - (1 - WIND_SHAFT_LEVEL) * m) * fadeOut(depth, e.earth);
  out.earth = fadeIn(depth, e.earth) * fadeOut(depth, e.deep);
  out.deep = fadeIn(depth, e.deep) * (1 - (1 - HUSH_LEVEL) * ramp(depth, e.hush));
  return out;
}

export type DuckKind = 'radio' | 'alarm' | 'sell';

/**
 * Timed ducks (radio, alarm, sell) plus the held shop/build duck. The deepest active duck wins; they do not stack
 * (03 §11.6 lists them as independent levels).
 */
export class Ducks {
  /** A sheet (shop, menu) is open or build mode is on: −4 dB and a 4-kHz low-pass on music. */
  held = false;
  private radioUntil = Number.NEGATIVE_INFINITY;
  private alarmUntil = Number.NEGATIVE_INFINITY;
  private sellUntil = Number.NEGATIVE_INFINITY;

  hit(kind: DuckKind, nowMs: number, ms: number): void {
    const until = nowMs + ms;
    if (kind === 'radio') this.radioUntil = Math.max(this.radioUntil, until);
    else if (kind === 'alarm') this.alarmUntil = Math.max(this.alarmUntil, until);
    else this.sellUntil = Math.max(this.sellUntil, until);
  }

  /** Ends a radio duck early (the transmission was cut). */
  clearRadio(): void {
    this.radioUntil = Number.NEGATIVE_INFINITY;
  }

  musicDb(nowMs: number): number {
    let db = this.held ? DUCK.sheetDb : 0;
    if (nowMs < this.radioUntil) db = Math.min(db, DUCK.radioMusicDb);
    if (nowMs < this.alarmUntil) db = Math.min(db, DUCK.alarmDb);
    if (nowMs < this.sellUntil) db = Math.min(db, DUCK.sellDb);
    return db;
  }

  ambienceDb(nowMs: number): number {
    return nowMs < this.radioUntil ? DUCK.radioAmbienceDb : 0;
  }

  musicCutoffHz(): number {
    return this.held ? DUCK.sheetLowpassHz : Number.POSITIVE_INFINITY;
  }
}
