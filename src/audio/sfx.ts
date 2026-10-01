// SFX designs (03 §11.4) as ZzFX presets, and the GameEvent → SFX mapping. Pure (no AudioContext), so the
// mapping is unit-tested in Node. Variants are parameters: pitch (playback rate), gain and repeats.
import type { GameEvent } from '../shared/events';
import type { ZzfxParams } from './synth';

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
  | 'land'
  | 'damage'
  | 'warnFuel'
  | 'warnHull'
  | 'explosion'
  | 'sell'
  | 'purchase'
  | 'pump'
  | 'use'
  | 'teleport'
  | 'error'
  | 'uiTap'
  | 'sheetOpen'
  | 'sheetClose'
  | 'fanfare'
  | 'death';

/** 04 §8.1: alarms > hazard tells > pod > UI > factory > ambience. */
export const PRIORITY = { ambience: 0, factory: 1, ui: 2, pod: 3, hazard: 4, alarm: 5 } as const;

export interface SfxDef {
  params: ZzfxParams;
  priority: number;
  /** Minimum ms between two starts of this sound (04 §8.1: pickup 40 ms). */
  cooldownMs: number;
  /** Looped continuous source rather than a one-shot. */
  loop?: boolean;
}

// [vol, rand, freq, attack, sustain, release, shape, curve, slide, dSlide, jump, jumpTime, repeat, noise, mod,
//  crush, delay, sustainVol, decay, tremolo, filter]
export const SFX: Readonly<Record<SfxId, SfxDef>> = {
  digTick: { params: [0.45, 0, 190, 0, 0.01, 0.04, 4, 1.5, 0, 0, 0, 0, 0, 2.5, 0, 0, 0, 1, 0.01, 0, 1500], priority: PRIORITY.pod, cooldownMs: 60 },
  digBreak: { params: [0.8, 0, 110, 0, 0.03, 0.18, 4, 1, -5, 0, 0, 0, 0, 1.8, 0, 0.1, 0, 0.6, 0.04, 0, 900], priority: PRIORITY.pod, cooldownMs: 30 },
  clink: { params: [0.55, 0, 1500, 0, 0.01, 0.25, 0, 1.5, 0, 0, 600, 0.02, 0, 0, 0, 0, 0, 0.6, 0.01, 0, 0], priority: PRIORITY.pod, cooldownMs: 120 },
  thunk: { params: [0.9, 0, 90, 0, 0.02, 0.12, 1, 2, -8, 0, 0, 0, 0, 0.3, 0, 0, 0, 0.8, 0.02, 0, 400], priority: PRIORITY.pod, cooldownMs: 120 },
  discover: { params: [0.55, 0, 523, 0.01, 0.25, 0.3, 0, 1, 0, 0, 132, 0.08, 0.08, 0, 0, 0, 0, 0.7, 0, 0, 0], priority: PRIORITY.pod, cooldownMs: 400 },
  collect: { params: [0.5, 0, 880, 0, 0.02, 0.12, 0, 1.8, 0, 0, 440, 0.04, 0, 0, 0, 0, 0, 0.8, 0.01, 0, 0], priority: PRIORITY.pod, cooldownMs: 40 },
  relic: { params: [0.6, 0, 1046, 0.005, 0.05, 0.6, 0, 1, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0.5, 0.05, 0.3, 0], priority: PRIORITY.pod, cooldownMs: 200 },
  bayFull: { params: [0.8, 0, 140, 0, 0.04, 0.2, 2, 1, -10, 0, 0, 0, 0, 0.8, 0, 0.2, 0, 0.6, 0.03, 0, 0], priority: PRIORITY.hazard, cooldownMs: 600 },
  thrust: { params: [0.7, 0, 60, 0, 1, 0, 4, 1, 0, 0, 0, 0, 0, 9, 0, 0, 0, 1, 0, 0, 600], priority: PRIORITY.pod, cooldownMs: 0, loop: true },
  land: { params: [1, 0, 70, 0, 0.02, 0.2, 0, 2, -4, 0, 0, 0, 0, 1.2, 0, 0, 0, 0.7, 0.03, 0, 300], priority: PRIORITY.pod, cooldownMs: 80 },
  damage: { params: [0.9, 0, 320, 0, 0.03, 0.3, 2, 1.2, -2, 0, -60, 0.03, 0, 0.5, 25, 0.1, 0, 0.6, 0.02, 0, 0], priority: PRIORITY.hazard, cooldownMs: 60 },
  warnFuel: { params: [0.45, 0, 880, 0, 0.07, 0.03, 5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], priority: PRIORITY.alarm, cooldownMs: 0 },
  warnHull: { params: [0.5, 0, 660, 0, 0.06, 0.03, 5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], priority: PRIORITY.alarm, cooldownMs: 0 },
  explosion: { params: [1.2, 0, 60, 0.01, 0.2, 0.8, 4, 1, -1, 0, 0, 0, 0, 3, 0, 0.3, 0.1, 0.5, 0.1, 0, 500], priority: PRIORITY.hazard, cooldownMs: 50 },
  sell: { params: [0.6, 0, 1200, 0, 0.03, 0.15, 1, 1, 0, 0, 500, 0.05, 0.07, 0, 0, 0, 0, 0.8, 0, 0, 0], priority: PRIORITY.ui, cooldownMs: 150 },
  purchase: { params: [0.6, 0, 440, 0.01, 0.1, 0.2, 1, 1, 0, 0, 220, 0.06, 0, 0, 0, 0, 0, 0.7, 0.02, 0, 0], priority: PRIORITY.ui, cooldownMs: 100 },
  pump: { params: [0.6, 0, 200, 0, 0.05, 0.12, 0, 1, 6, 0, 0, 0, 0.04, 0, 3, 0, 0, 0.8, 0, 0.5, 0], priority: PRIORITY.pod, cooldownMs: 100 },
  use: { params: [0.5, 0, 1400, 0, 0.08, 0.1, 3, 1, -20, 0, 0, 0, 0, 0.6, 0, 0.3, 0, 0.6, 0, 0, 0], priority: PRIORITY.pod, cooldownMs: 100 },
  teleport: { params: [0.6, 0, 300, 0.02, 0.2, 0.2, 0, 1, 15, 0, 0, 0, 0, 0, 12, 0, 0, 0.6, 0, 0.4, 0], priority: PRIORITY.pod, cooldownMs: 200 },
  error: { params: [0.4, 0, 150, 0, 0.06, 0.06, 5, 0.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], priority: PRIORITY.ui, cooldownMs: 150 },
  uiTap: { params: [0.3, 0, 1700, 0, 0.005, 0.03, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], priority: PRIORITY.ui, cooldownMs: 30 },
  sheetOpen: { params: [0.35, 0, 300, 0.02, 0.04, 0.08, 0, 1, 8, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0], priority: PRIORITY.ui, cooldownMs: 80 },
  sheetClose: { params: [0.35, 0, 500, 0.01, 0.04, 0.08, 0, 1, -8, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0], priority: PRIORITY.ui, cooldownMs: 80 },
  fanfare: { params: [0.8, 0, 523, 0.02, 0.4, 0.4, 1, 1, 0, 0, 262, 0.12, 0.12, 0, 0, 0, 0.05, 0.7, 0, 0.1, 0], priority: PRIORITY.ui, cooldownMs: 500 },
  death: { params: [1, 0, 400, 0.02, 0.4, 0.8, 2, 1, -6, 0, -100, 0.2, 0, 0.6, 0, 0.2, 0.15, 0.6, 0.1, 0, 0], priority: PRIORITY.hazard, cooldownMs: 1000 },
};

export const SFX_IDS = Object.keys(SFX) as SfxId[];

export interface SfxCue {
  id: SfxId;
  /** Playback rate (1 = as designed). */
  pitch: number;
  gain: number;
  /** Extra plays after the first (beeps), `gapMs` apart. */
  repeat: number;
  gapMs: number;
}

export interface SfxContext {
  /** Installed drill tier (dig pitch rises 2 semitones per tier, 03 §11.4 ★1). */
  drillTier: number;
}

/** Major-pentatonic steps for mineral tiers 1..10 (03 §11.4 ★4: pickup pitch by tier). */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] as const;
/** Fuel warning beeps per level (20/10/5 %) and their gap: faster as it gets worse (★14). */
const FUEL_BEEPS = [
  { repeat: 0, gapMs: 0 },
  { repeat: 1, gapMs: 160 },
  { repeat: 2, gapMs: 110 },
] as const;

export function semitones(n: number): number {
  return 2 ** (n / 12);
}

function cue(id: SfxId, pitch = 1, gain = 1, repeat = 0, gapMs = 0): SfxCue {
  return { id, pitch, gain, repeat, gapMs };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The sound for one sim event, or null when the event is silent (or its sound follows from another event). */
export function cueForEvent(e: GameEvent, ctx: SfxContext): SfxCue | null {
  switch (e.t) {
    case 'dig-start':
      return cue('digTick', semitones(2 * (ctx.drillTier - 1)));
    case 'dug':
      return cue('digBreak', semitones(2 * (ctx.drillTier - 1)));
    case 'dig-refused':
      return e.reason === 'hardrock' ? cue('clink') : cue('thunk');
    case 'lode-discovered':
      return cue('discover');
    case 'collect':
      if (e.item.kind === 'mineral') return cue('collect', semitones(PENTATONIC[clamp(e.item.tier, 1, 10) - 1]));
      return e.item.kind === 'relic' ? cue('relic') : cue('collect', semitones(-5));
    case 'bay-full':
      return cue('bayFull');
    case 'landed':
      return cue('land', 1, clamp(e.v / 8, 0.35, 1));
    case 'damage':
      return e.cause === 'magma' ? cue('damage', semitones(-3)) : cue('damage', 1, clamp(0.5 + e.amount / 20, 0.5, 1));
    case 'fuel-warning': {
      const b = FUEL_BEEPS[e.level];
      return cue('warnFuel', 1, 1, b.repeat, b.gapMs);
    }
    case 'hull-warning':
      return cue('warnHull', 1, 1, 1, 140);
    case 'destroyed':
      return cue('death');
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
    case 'sale':
      return cue('sell', 1, clamp(0.55 + Math.log10(Math.max(1, e.amount)) / 10, 0.55, 1));
    case 'purchase':
      if (e.kind === 'fuel') return cue('pump');
      if (e.kind === 'repair') return cue('use');
      return e.kind === 'upgrade' ? cue('fanfare', 1.25) : cue('purchase');
    case 'coop-credit':
      return cue('pump');
    default:
      return null;
  }
}
