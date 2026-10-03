// Quality tier defaults (canon §3.14 "Tiers"): iOS → mid; Android with deviceMemory ≤ 4 → low; else mid.
// The settings override and the test URL (?tier=) win over the default. Pure.
import type { QualityTier } from '../render/api';
import type { Settings } from './types';

export interface TierProbe {
  ios: boolean;
  android: boolean;
  deviceMemory: number | null;
}

const TIERS: readonly QualityTier[] = ['low', 'mid', 'high'];

export function isQualityTier(v: unknown): v is QualityTier {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v);
}

export function defaultTier(d: TierProbe): QualityTier {
  if (d.ios) return 'mid';
  if (d.android && d.deviceMemory !== null && d.deviceMemory <= 4) return 'low';
  return 'mid';
}

/**
 * Effective tier: URL override (tests) > explicit setting > the automatic tier (`auto`: the governor's benchmarked
 * and crash-dropped tier, src/app/qualityGovernor.ts) > device default.
 */
export function resolveTier(setting: Settings['quality'], urlTier: string | null, d: TierProbe, auto?: QualityTier): QualityTier {
  if (isQualityTier(urlTier)) return urlTier;
  if (setting !== 'auto' && isQualityTier(setting)) return setting;
  return auto ?? defaultTier(d);
}
