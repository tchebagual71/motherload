import { describe, expect, it } from 'vitest';
import { defaultTier, resolveTier } from '../../src/app/tier';
import { createSettingsStore, defaultSettings, initialLook, sanitizeSettings } from '../../src/app/settings';
import { memoryKeyValue } from '../../src/platform/storage';

const IOS = { ios: true, android: false, deviceMemory: null };
const ANDROID_LOW = { ios: false, android: true, deviceMemory: 4 };
const ANDROID_HIGH = { ios: false, android: true, deviceMemory: 8 };
const DESKTOP = { ios: false, android: false, deviceMemory: 8 };

describe('quality tier defaults (canon §3.14)', () => {
  it('iOS → mid; Android ≤ 4 GB → low; else mid', () => {
    expect(defaultTier(IOS)).toBe('mid');
    expect(defaultTier(ANDROID_LOW)).toBe('low');
    expect(defaultTier({ ...ANDROID_LOW, deviceMemory: 2 })).toBe('low');
    expect(defaultTier(ANDROID_HIGH)).toBe('mid');
    expect(defaultTier({ ...ANDROID_LOW, deviceMemory: null })).toBe('mid');
    expect(defaultTier(DESKTOP)).toBe('mid');
  });

  it('URL override beats the setting, which beats the default', () => {
    expect(resolveTier('auto', null, ANDROID_LOW)).toBe('low');
    expect(resolveTier('high', null, ANDROID_LOW)).toBe('high');
    expect(resolveTier('high', 'low', IOS)).toBe('low');
    expect(resolveTier('auto', 'bogus', IOS)).toBe('mid');
  });
});

describe('settings', () => {
  const d = defaultSettings(393, 852);

  it('has the 03 §12 defaults', () => {
    expect(d).toEqual({
      controlSize: 'M',
      leftHanded: false,
      thrustButton: false,
      reducedMotion: false,
      brightMines: false,
      sound: true,
      respectSilent: true,
      quality: 'auto',
      showPerf: false,
      textScale: 1,
      oneHanded: false,
      thrustMode: 'hold',
      returnTick: 'training',
      landingAssist: false,
      steadyDrill: false,
      music: true,
    });
    expect(defaultSettings(375, 667).controlSize).toBe('S');
    expect(defaultSettings(375, 667, true).reducedMotion).toBe(true);
  });

  it('keeps well-typed stored fields and drops the rest', () => {
    const s = sanitizeSettings({ controlSize: 'L', sound: false, quality: 'ultra', leftHanded: 'yes', extra: 1 }, d);
    expect(s.controlSize).toBe('L');
    expect(s.sound).toBe(false);
    expect(s.quality).toBe('auto');
    expect(s.leftHanded).toBe(false);
    expect(s).not.toHaveProperty('extra');
    expect(sanitizeSettings(null, d)).toEqual(d);
    expect(sanitizeSettings('garbage', d)).toEqual(d);
    expect(sanitizeSettings({ music: false }, d).music).toBe(false);
    expect(sanitizeSettings({ music: 'off' }, d).music).toBe(true);
  });

  it('round-trips through a channel-prefixed store and survives corrupt JSON', () => {
    const kv = memoryKeyValue();
    const store = createSettingsStore(kv, (n) => `hf-test.${n}`);
    store.saveSettings({ ...d, brightMines: true });
    expect(kv.get('hf-test.settings')).toContain('brightMines');
    expect(store.loadSettings(d).brightMines).toBe(true);
    kv.set('hf-test.settings', '{nope');
    expect(store.loadSettings(d)).toEqual(d);
    store.saveLook('pixel');
    expect(store.loadLook()).toBe('pixel');
    kv.set('hf-test.look', 'sepia');
    expect(store.loadLook()).toBeNull();
  });

  it('picks the initial look: URL > stored > toon', () => {
    expect(initialLook('pixel', 'toon')).toBe('pixel');
    expect(initialLook(null, 'pixel')).toBe('pixel');
    expect(initialLook('bogus', null)).toBe('toon');
  });
});
