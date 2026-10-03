// Quality tiers (canon §3.14, 04 §5.8). Render-side knobs only; the app picks the tier.
import type { Look } from '../shared/types';
import type { QualityTier } from './api';

/** Which gameplay objects get toon outline hulls (04 §5.5). */
export type OutlineScope = 'pod' | 'gameplay' | 'all';

export interface QualitySpec {
  /** Production Toon DPR cap and dynamic-resolution floor. */
  dprCap: number;
  dprFloor: number;
  /** Particle budget handed to the FX system. */
  particles: number;
  /** Lamps evaluated per fragment underground (≤ 16; 8 on low). */
  lamps: number;
  /** Dirty chunk remeshes per frame, before the +4 near-pod allowance (canon §3.14). */
  remeshPerFrame: number;
  outlines: OutlineScope;
}

export const QUALITY: Readonly<Record<QualityTier, QualitySpec>> = {
  low: { dprCap: 1.25, dprFloor: 0.75, particles: 250, lamps: 8, remeshPerFrame: 1, outlines: 'pod' },
  mid: { dprCap: 1.5, dprFloor: 0.9, particles: 500, lamps: 16, remeshPerFrame: 2, outlines: 'gameplay' },
  high: { dprCap: 2.0, dprFloor: 1.2, particles: 900, lamps: 16, remeshPerFrame: 2, outlines: 'gameplay' },
};

/** Extra remeshes allowed per frame for chunks touching the pod's 3×3 or a blast (canon §3.14). */
export const REMESH_NEAR_POD = 4;
/** Toon DPR in the M0 style test: min(device, 2) regardless of tier (canon §5.1). */
export const STYLE_TEST_TOON_DPR = 2;
export const MAX_LAMPS = 16;

/**
 * Toon render DPR for a device DPR: the style test pins it (canon §5.1: dynamic resolution off); production
 * caps it by tier and, with dynamic resolution (04 §5.8), follows `dynamic` down to the tier's floor.
 */
export function toonDpr(deviceDpr: number, tier: QualityTier, styleTest: boolean, dynamic: number | null = null): number {
  const spec = QUALITY[tier];
  const cap = Math.min(deviceDpr, styleTest ? STYLE_TEST_TOON_DPR : spec.dprCap);
  const want = styleTest || dynamic === null ? cap : Math.min(cap, Math.max(spec.dprFloor, dynamic));
  return Math.max(0.5, want);
}

/** Outline scope for a tier; the style test outlines everything in both looks (04 §5.5). */
export function outlineScope(tier: QualityTier, styleTest: boolean): OutlineScope {
  return styleTest ? 'all' : QUALITY[tier].outlines;
}

/** Whether ore/relic hulls merged into terrain chunks are drawn for a scope. */
export function oreHullsEnabled(scope: OutlineScope): boolean {
  return scope !== 'pod';
}

/**
 * Whether terrain chunks carry the merged ore/relic hull geometry (04 §5.5), ≈ 27% of a chunk's
 * triangles. Production meshes it only when the look draws it: Pixel Lab and low-tier Toon would
 * upload and vertex-shade hull triangles only to clip every one. The M0 style test keeps it in both
 * looks so an A/B flip needs no remesh (canon §5.1: flip ≤ 1 frame).
 */
export function meshOreHulls(look: Look, tier: QualityTier, styleTest: boolean): boolean {
  return styleTest || (look === 'toon' && oreHullsEnabled(outlineScope(tier, false)));
}
