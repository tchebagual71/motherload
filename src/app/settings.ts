// Settings persistence (03 §12 defaults). localStorage is the boot-time source (synchronous, try/catch);
// anything malformed falls back field by field to the default.
import type { KeyValue } from '../platform/storage';
import { readJson, writeJson } from '../platform/storage';
import type { Look } from '../shared/types';
import { defaultControlSize } from './layout';
import { isQualityTier } from './tier';
import type { Settings } from './types';

export const SETTINGS_KEY = 'settings';
export const LOOK_KEY = 'look';

/** `osTextScale`: the OS text size (03 §1.5 "Default: OS"; platform/device.ts osTextScale). */
export function defaultSettings(screenWidth: number, screenHeight: number, osReducedMotion = false, osTextScale: Settings['textScale'] = 1): Settings {
  return {
    controlSize: defaultControlSize(screenWidth, screenHeight),
    leftHanded: false,
    thrustButton: false,
    reducedMotion: osReducedMotion,
    brightMines: false,
    sound: true,
    respectSilent: true,
    quality: 'auto',
    showPerf: false,
    textScale: osTextScale,
    oneHanded: false,
    thrustMode: 'hold',
    returnTick: 'training',
    landingAssist: false,
    steadyDrill: false,
    music: true,
  };
}

function pickBool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}

/** Merge a stored (untrusted) object over the defaults, keeping only well-typed fields. */
export function sanitizeSettings(raw: unknown, d: Settings): Settings {
  if (!raw || typeof raw !== 'object') return { ...d };
  const r = raw as Record<string, unknown>;
  const size = r.controlSize;
  const quality = r.quality;
  return {
    controlSize: size === 'S' || size === 'M' || size === 'L' ? size : d.controlSize,
    leftHanded: pickBool(r.leftHanded, d.leftHanded),
    thrustButton: pickBool(r.thrustButton, d.thrustButton),
    reducedMotion: pickBool(r.reducedMotion, d.reducedMotion),
    brightMines: pickBool(r.brightMines, d.brightMines),
    sound: pickBool(r.sound, d.sound),
    respectSilent: pickBool(r.respectSilent, d.respectSilent),
    quality: quality === 'auto' || isQualityTier(quality) ? quality : d.quality,
    showPerf: pickBool(r.showPerf, d.showPerf),
    textScale: r.textScale === 1 || r.textScale === 1.15 || r.textScale === 1.3 ? r.textScale : d.textScale,
    oneHanded: pickBool(r.oneHanded, d.oneHanded),
    thrustMode: r.thrustMode === 'hold' || r.thrustMode === 'toggle' ? r.thrustMode : d.thrustMode,
    returnTick: r.returnTick === 'training' || r.returnTick === 'on' || r.returnTick === 'off' ? r.returnTick : d.returnTick,
    landingAssist: pickBool(r.landingAssist, d.landingAssist),
    steadyDrill: pickBool(r.steadyDrill, d.steadyDrill),
    ...(r.batterySaver === true && { batterySaver: true }),
    ...(r.instantBuild === true && { instantBuild: true }),
    music: pickBool(r.music, d.music),
  };
}

export interface SettingsStore {
  loadSettings(defaults: Settings): Settings;
  saveSettings(s: Settings): void;
  loadLook(): Look | null;
  saveLook(look: Look): void;
}

export function isLook(v: unknown): v is Look {
  return v === 'toon' || v === 'pixel';
}

/** Settings + look in localStorage under channel-prefixed keys (`key` maps a name to the full key). */
export function createSettingsStore(kv: KeyValue, key: (name: string) => string): SettingsStore {
  return {
    loadSettings: (defaults) => sanitizeSettings(readJson<unknown>(kv, key(SETTINGS_KEY)), defaults),
    saveSettings: (s) => void writeJson(kv, key(SETTINGS_KEY), s),
    loadLook: () => {
      const v = kv.get(key(LOOK_KEY));
      return isLook(v) ? v : null;
    },
    saveLook: (look) => void kv.set(key(LOOK_KEY), look),
  };
}

/** Initial look: ?look= (tests, style-test links) > stored choice > Clean Toon (PLAN §2 default). */
export function initialLook(urlLook: string | null, stored: Look | null): Look {
  if (isLook(urlLook)) return urlLook;
  return stored ?? 'toon';
}
