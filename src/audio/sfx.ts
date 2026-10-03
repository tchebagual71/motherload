// SFX designs (03 §11.4: the MVP's 20 ★ designs; variants are parameters) and the GameEvent → SFX mapping. Most are
// ZzFX presets; the loops and blips use the custom renderers in instruments.ts. Pure (no AudioContext), so the
// mapping is unit-tested in Node.
import { BANDS, MINERALS } from '../shared/canon';
import type { GameEvent } from '../shared/events';
import type { DuckKind } from './mix';
import { renderBlip, renderEngineLoop, renderWhistleLoop } from './instruments';
import { buildSamples, type ZzfxParams } from './synth';

export type SfxId =
  | 'digTick'
  | 'digBreak'
  | 'clink'
  | 'thunk'
  | 'discover'
  | 'collect'
  | 'relic'
  | 'bayFull'
  | 'thrust'
  | 'whistle'
  | 'land'
  | 'damage'
  | 'sizzle'
  | 'explosion'
  | 'use'
  | 'teleport'
  | 'warnFuel'
  | 'warnHull'
  | 'death'
  | 'salvage'
  | 'pump'
  | 'sell'
  | 'purchase'
  | 'fanfare'
  | 'build'
  | 'uiTap'
  | 'error'
  | 'sheetOpen'
  | 'sheetClose'
  | 'blipDot'
  | 'blipMarlow'
  | 'blipStatic'
  | 'tickStatic'
  | 'blipCelesta'
  | 'blipLog';

/** 04 §8.1: alarms > hazard tells > pod > UI > factory > ambience; music notes are stolen before anything else. */
export const PRIORITY = { music: -1, ambience: 0, factory: 1, ui: 2, pod: 3, hazard: 4, alarm: 5 } as const;

export type SfxBus = 'sfx' | 'drill' | 'voice';

export interface SfxDef {
  /** The 03 §11.4 ★ design (1–20) this sound is a variant of. */
  star: number;
  /** A ZzFX preset, or a renderer for what ZzFX cannot make (seamless loops, FM blips). */
  src: ZzfxParams | ((sampleRate: number) => Float32Array);
  priority: number;
  /** Minimum ms between two starts of this sound (04 §8.1: pickup 40 ms). */
  cooldownMs: number;
  /** Looped continuous source rather than a one-shot. */
  loop?: boolean;
  /** Mixer route (default 'sfx'): drill sounds share the band filter, blips the 300–3,400 Hz voice band. */
  bus?: SfxBus;
  /** Music ducks while this plays (03 §11.6: alarm −8 dB, sell −4 dB). */
  duck?: DuckKind;
}

const P = PRIORITY;

// ZzFX order: [vol, rand, freq, attack, sustain, release, shape, curve, slide, dSlide, jump, jumpTime, repeat, noise,
//  mod, crush, delay, sustainVol, decay, tremolo, filter]. Shapes 0 sin 1 tri 2 saw 3 tan 4 noise 5 square; a
//  positive filter is a high-pass and a negative one a low-pass at 2×|filter| Hz. Tells sit in 400 Hz–4 kHz (03 §11.1).
export const SFX: Readonly<Record<SfxId, SfxDef>> = {
  // ★1 Drill: dig loop grain + break transient (pitched by tier, filtered by band at play time)
  digTick: { star: 1, src: [0.5, 0, 320, 0, 0.012, 0.035, 4, 1, 0, 0, 0, 0, 0, 3, 0, 0, 0, 1, 0.008, 0, -1100], priority: P.pod, cooldownMs: 60, bus: 'drill' },
  digBreak: { star: 1, src: [0.9, 0, 500, 0, 0.03, 0.16, 4, 1, -1, 0, 0, 0, 0, 2, 0, 0.03, 0, 0.6, 0.03, 0, -1600], priority: P.pod, cooldownMs: 30, bus: 'drill' },
  // ★2 Clink: Hardrock refusal, a bright ping
  clink: { star: 2, src: [0.7, 0, 1500, 0, 0.01, 0.25, 0, 1.5, 0, 0, 600, 0.02, 0, 0, 0, 0, 0, 0.6, 0.01, 0, 0], priority: P.pod, cooldownMs: 120 },
  // ★3 Thunk: lode / anchored refusal; discovery adds a 3-note chime
  thunk: { star: 3, src: [1, 0, 330, 0, 0.012, 0.1, 1, 1.4, -2, 0, 0, 0, 0, 0.3, 0, 0, 0, 0.7, 0.015, 0, -1200], priority: P.pod, cooldownMs: 120 },
  discover: { star: 3, src: [0.6, 0, 784, 0.005, 0.22, 0.06, 0, 1, 0, 0, 262, 0.1, 0.1, 0, 0, 0, 0.05, 0.8, 0, 0, 0], priority: P.pod, cooldownMs: 400 },
  // ★4 Pickup: pentatonic by tier (gems shimmer), relic bell
  collect: { star: 4, src: [0.5, 0, 880, 0, 0.02, 0.12, 0, 1.8, 0, 0, 440, 0.04, 0, 0, 0, 0, 0, 0.8, 0.01, 0, 0], priority: P.pod, cooldownMs: 40 },
  relic: { star: 4, src: [0.9, 0, 1318, 0.002, 0.1, 0.7, 0, 1, 0, 0, 0, 0, 0.12, 0, 0, 0, 0.08, 0.45, 0.08, 0.25, 0], priority: P.pod, cooldownMs: 200 },
  // ★5 Bay full: crumble + bonk
  bayFull: { star: 5, src: [0.9, 0, 420, 0, 0.05, 0.18, 1, 1, -2.5, 0, 0, 0, 0, 1.5, 0, 0.04, 0, 0.6, 0.03, 0, -1500], priority: P.hazard, cooldownMs: 600 },
  // ★6 Engine hum (loop; gain follows s_t, pitch the Engine tier) · ★7 fall whistle (loop; above 5.88 tiles/s)
  thrust: { star: 6, src: renderEngineLoop, priority: P.pod, cooldownMs: 0, loop: true },
  whistle: { star: 7, src: renderWhistleLoop, priority: P.pod, cooldownMs: 0, loop: true },
  // ★8 Landing thud · ★9 hull clang · ★10 magma breach sizzle · ★11 explosion whump
  land: { star: 8, src: [1.2, 0, 240, 0, 0.02, 0.18, 0, 2, -1, 0, 0, 0, 0, 1.5, 0, 0.02, 0, 0.7, 0.03, 0, -1000], priority: P.pod, cooldownMs: 80 },
  damage: { star: 9, src: [0.9, 0, 520, 0, 0.02, 0.3, 3, 1, 0, 0, -130, 0.02, 0, 0.2, 31, 0, 0.04, 0.5, 0.03, 0, 300], priority: P.hazard, cooldownMs: 60 },
  sizzle: { star: 10, src: [0.6, 0, 1800, 0.01, 0.12, 0.3, 4, 1, 0, 0, 0, 0, 0.03, 2, 0, 0.05, 0, 0.6, 0.04, 0.5, 800], priority: P.hazard, cooldownMs: 80 },
  explosion: { star: 11, src: [1.3, 0, 300, 0.005, 0.15, 0.7, 4, 1, -0.3, 0, 0, 0, 0, 4, 0, 0.05, 0.08, 0.5, 0.08, 0, -1800], priority: P.hazard, cooldownMs: 50 },
  // ★12 Item use: weld zap (Patch Kit) · ★13 teleport warble + pop
  use: { star: 12, src: [0.5, 0, 1200, 0, 0.12, 0.08, 2, 1, -2, 0, 0, 0, 0.03, 0.8, 0, 0.03, 0, 0.6, 0, 0.6, 600], priority: P.pod, cooldownMs: 100 },
  teleport: { star: 13, src: [0.6, 0, 500, 0.02, 0.2, 0.2, 0, 1, 15, 0, 0, 0, 0, 0, 12, 0, 0, 0.6, 0, 0.4, 0], priority: P.pod, cooldownMs: 200 },
  // ★14 Alarm: fuel beep (faster at 10 / 5 %), hull double beep
  warnFuel: { star: 14, src: [0.4, 0, 880, 0, 0.07, 0.03, 5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], priority: P.alarm, cooldownMs: 0, duck: 'alarm' },
  warnHull: { star: 14, src: [0.45, 0, 660, 0, 0.06, 0.03, 5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], priority: P.alarm, cooldownMs: 0, duck: 'alarm' },
  // ★15 Salvage: the pod dies (descending wreck), then the tow drone whirrs it home
  death: { star: 15, src: [1, 0, 600, 0.02, 0.5, 0.7, 2, 1, -0.6, 0, -100, 0.4, 0, 0.6, 0, 0.03, 0.15, 0.6, 0.1, 0, -2000], priority: P.hazard, cooldownMs: 1000 },
  salvage: { star: 15, src: [0.6, 0, 240, 0.05, 0.5, 0.3, 2, 1, 2, 0, 0, 0, 0.08, 0.3, 0, 0, 0, 0.6, 0, 0.4, -900], priority: P.pod, cooldownMs: 1000 },
  // ★16 Pump glug · ★17 sell coins · ★18 purchase ratchet / upgrade and incentive fanfare
  pump: { star: 16, src: [0.7, 0, 260, 0, 0.06, 0.08, 0, 1, 14, 0, 0, 0, 0.07, 0, 0, 0, 0, 0.8, 0, 0.3, 0], priority: P.pod, cooldownMs: 100 },
  sell: { star: 17, src: [0.6, 0, 1200, 0, 0.03, 0.15, 1, 1, 0, 0, 500, 0.05, 0.07, 0, 0, 0, 0, 0.8, 0, 0, 0], priority: P.ui, cooldownMs: 150, duck: 'sell' },
  purchase: { star: 18, src: [0.6, 0, 440, 0.01, 0.1, 0.2, 1, 1, 0, 0, 220, 0.06, 0, 0, 0, 0, 0, 0.7, 0.02, 0, 0], priority: P.ui, cooldownMs: 100 },
  fanfare: { star: 18, src: [0.8, 0, 523, 0.02, 0.4, 0.4, 1, 1, 0, 0, 262, 0.12, 0.12, 0, 0, 0, 0.05, 0.7, 0, 0.1, 0], priority: P.ui, cooldownMs: 500 },
  // ★19 Build: thunk + pop
  build: { star: 19, src: [0.8, 0, 420, 0, 0.02, 0.1, 1, 1, -4, 0, 380, 0.05, 0, 0.3, 0, 0, 0, 0.7, 0.01, 0, -2400], priority: P.factory, cooldownMs: 60 },
  // ★20 UI voice: taps, errors, sheets, transmission blips (03 §11.5)
  uiTap: { star: 20, src: [0.3, 0, 1700, 0, 0.005, 0.03, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], priority: P.ui, cooldownMs: 30 },
  error: { star: 20, src: [0.4, 0, 220, 0, 0.06, 0.06, 5, 1, 0, 0, -40, 0.06, 0, 0, 0, 0, 0, 1, 0, 0, -1600], priority: P.ui, cooldownMs: 150 },
  sheetOpen: { star: 20, src: [0.35, 0, 300, 0.02, 0.04, 0.08, 0, 1, 8, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0], priority: P.ui, cooldownMs: 80 },
  sheetClose: { star: 20, src: [0.35, 0, 500, 0.01, 0.04, 0.08, 0, 1, -8, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0], priority: P.ui, cooldownMs: 80 },
  blipDot: { star: 20, src: (sr) => renderBlip('blipDot', sr), priority: P.ui, cooldownMs: 0, bus: 'voice' },
  blipMarlow: { star: 20, src: (sr) => renderBlip('blipMarlow', sr), priority: P.ui, cooldownMs: 0, bus: 'voice' },
  blipStatic: { star: 20, src: (sr) => renderBlip('blipStatic', sr), priority: P.ui, cooldownMs: 0, bus: 'voice' },
  tickStatic: { star: 20, src: (sr) => renderBlip('tickStatic', sr), priority: P.ui, cooldownMs: 0, bus: 'voice' },
  blipCelesta: { star: 20, src: (sr) => renderBlip('blipCelesta', sr), priority: P.ui, cooldownMs: 0, bus: 'voice' },
  blipLog: { star: 20, src: (sr) => renderBlip('blipLog', sr), priority: P.ui, cooldownMs: 0, bus: 'voice' },
};

export const SFX_IDS = Object.keys(SFX) as SfxId[];

/** The sound's samples at `sampleRate` (deterministic; the engine caches one buffer per id). */
export function renderSfx(id: SfxId, sampleRate: number): Float32Array {
  const src = SFX[id].src;
  return typeof src === 'function' ? src(sampleRate) : buildSamples(src, sampleRate);
}

export interface SfxCue {
  id: SfxId;
  /** Playback rate (1 = as designed). */
  pitch: number;
  gain: number;
  /** Extra plays after the first (beeps, coins), `gapMs` apart. */
  repeat: number;
  gapMs: number;
}

export interface SfxContext {
  /** Installed drill tier (dig pitch rises 2 semitones per tier, 03 §11.4 ★1). */
  drillTier: number;
}

export interface DrillBand {
  /** Playback-rate factor on top of the tier pitch. */
  pitch: number;
  /** Low-pass on the drill bus: dull in clay, bright in shale and basalt (03 §11.4 ★1 "band filter"). */
  lowpassHz: number;
}

/** Per canon §2.5 band B0–B7. */
export const DRILL_BANDS: readonly DrillBand[] = [
  { pitch: 1, lowpassHz: 2_200 }, // B0 Rust Flats: loose, dry
  { pitch: 1.04, lowpassHz: 2_600 }, // B1 Ochre Beds
  { pitch: 0.9, lowpassHz: 1_300 }, // B2 Clay Deeps: damp, dull
  { pitch: 1.12, lowpassHz: 5_000 }, // B3 Violet Shale: brittle
  { pitch: 1.07, lowpassHz: 3_800 }, // B4 Blue Basalt: hard, ringing
  { pitch: 1.15, lowpassHz: 6_000 }, // B5 Obsidian Hush: glassy
  { pitch: 0.95, lowpassHz: 3_000 }, // B6 Ember Mantle
  { pitch: 0.85, lowpassHz: 2_000 }, // B7 the Hollow Heart
];

export function bandIndex(row: number): number {
  for (let i = BANDS.length - 1; i >= 0; i--) if (row >= BANDS[i].top) return i;
  return 0;
}

export function drillBand(row: number): DrillBand {
  return DRILL_BANDS[bandIndex(row)];
}

/** Major-pentatonic steps for mineral tiers 1..10 (03 §11.4 ★4: pickup pitch by tier). */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] as const;
/** Fuel warning beeps per level (20/10/5 %) and their gap: faster as it gets worse (★14). */
const FUEL_BEEPS = [
  { repeat: 0, gapMs: 0 },
  { repeat: 1, gapMs: 160 },
  { repeat: 2, gapMs: 110 },
] as const;
const GEM_SHIMMER_MS = 70;
const COIN_GAP_MS = 70;

export function semitones(n: number): number {
  return 2 ** (n / 12);
}

function cue(id: SfxId, pitch = 1, gain = 1, repeat = 0, gapMs = 0): SfxCue {
  return { id, pitch, gain, repeat, gapMs };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function drillPitch(tier: number, row: number): number {
  return semitones(2 * (tier - 1)) * drillBand(row).pitch;
}

function collectCue(item: Extract<GameEvent, { t: 'collect' }>['item']): SfxCue {
  if (item.kind === 'relic') return cue('relic');
  if (item.kind !== 'mineral') return cue('collect', semitones(-5));
  const tier = clamp(item.tier, 1, PENTATONIC.length);
  const gem = MINERALS[tier - 1]?.gem ?? false;
  return cue('collect', semitones(PENTATONIC[tier - 1]), 1, gem ? 1 : 0, gem ? GEM_SHIMMER_MS : 0);
}

/** Coins by value (★17): one more coin per decade above $10, up to four. */
function saleCue(amount: number): SfxCue {
  const decades = Math.log10(Math.max(1, amount));
  return cue('sell', 1, clamp(0.55 + decades / 10, 0.55, 1), clamp(Math.floor(decades) - 1, 0, 3), COIN_GAP_MS);
}

/** The sound for one sim event, or null when the event is silent (or its sound follows from another event). */
export function cueForEvent(e: GameEvent, ctx: SfxContext): SfxCue | null {
  switch (e.t) {
    case 'dig-start':
      return cue('digTick', drillPitch(ctx.drillTier, e.r));
    case 'dug':
      return cue('digBreak', drillPitch(ctx.drillTier, e.r));
    case 'dig-refused':
      return e.reason === 'hardrock' ? cue('clink') : cue('thunk');
    case 'lode-discovered':
      return cue('discover');
    case 'lode-pinged':
      return cue('discover', 2, 0.5);
    case 'collect':
      return collectCue(e.item);
    case 'bay-full':
      return cue('bayFull');
    case 'landed':
      return cue('land', 1, clamp(e.v / 8, 0.35, 1));
    case 'damage':
      if (e.cause === 'magma') return cue('sizzle');
      return e.cause === 'methane' ? cue('explosion', 0.7) : cue('damage', 1, clamp(0.5 + e.amount / 20, 0.5, 1));
    case 'fuel-warning': {
      const b = FUEL_BEEPS[e.level];
      return cue('warnFuel', 1, 1, b.repeat, b.gapMs);
    }
    case 'hull-warning':
      return cue('warnHull', 1, 1, 1, 140);
    case 'destroyed':
      return cue('death');
    case 'respawned':
      return cue('salvage');
    case 'explosion':
      return cue('explosion', e.radius >= 2 ? 0.8 : 1);
    case 'consumable-used':
      if (e.id === 'jerrycan') return cue('pump');
      return e.id === 'patchKit' ? cue('use') : null; // explosives and beacons sound via explosion/teleport
    case 'consumable-refused':
      return cue('error');
    case 'teleport':
      return cue('teleport');
    case 'incentive':
      return cue('fanfare');
    case 'milestone':
    case 'unlock':
    case 'first-ingot':
    case 'first-lift-delivery':
      return cue('fanfare', 1.5, 0.7);
    case 'sale':
      return saleCue(e.amount);
    case 'purchase':
      if (e.kind === 'fuel') return cue('pump');
      if (e.kind === 'repair') return cue('use');
      return e.kind === 'upgrade' ? cue('fanfare', 1.25) : cue('purchase');
    case 'starter-kit':
      return cue('purchase');
    case 'coop-credit':
      return cue('pump');
    case 'ghost-complete':
      return cue('build');
    default:
      // 'radio' speaks through the voice line (blips.ts); 'export-sale' ka-ching is v1 (03 §11.4).
      return null;
  }
}
