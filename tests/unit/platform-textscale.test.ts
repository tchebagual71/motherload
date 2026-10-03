// OS text size → default text scale (03 §1.5 "Default: OS"; canon §3.12: 100 / 115 % in the MVP).
import { describe, expect, it } from 'vitest';
import { defaultSettings, sanitizeSettings } from '../../src/app/settings';
import { osTextScale, textScaleFromOs } from '../../src/platform/device';

describe('OS text scale', () => {
  it('iOS: Dynamic Type body ≥ 19 px → 115%; the default 17 px → 100%', () => {
    expect(textScaleFromOs(17, 16)).toBe(1);
    expect(textScaleFromOs(19, 16)).toBe(1.15);
    expect(textScaleFromOs(23, 16)).toBe(1.15); // 130% is v1
  });

  it('elsewhere: a root font size ≥ 18.4 px → 115%', () => {
    expect(textScaleFromOs(null, 16)).toBe(1);
    expect(textScaleFromOs(null, 18.4)).toBe(1.15);
    expect(textScaleFromOs(null, Number.NaN)).toBe(1);
  });

  it('no document: 100%', () => {
    expect(osTextScale()).toBe(1);
  });

  it('is the default for a new player; a stored choice wins', () => {
    const d = defaultSettings(393, 852, false, 1.15);
    expect(d.textScale).toBe(1.15);
    expect(sanitizeSettings({ textScale: 1 }, d).textScale).toBe(1);
    expect(sanitizeSettings({}, d).textScale).toBe(1.15);
    expect(defaultSettings(393, 852).textScale).toBe(1);
  });
});
