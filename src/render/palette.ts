// Shared palette (03 §8.2–8.6). Hex numbers for three.js Color. Owned by 03; mirrored here for code.

export const SURFACE = {
  skyTop: 0xf2b58e,
  skyBottom: 0xfadcc0,
  sunsetHalo: 0x8ec0ec,
  dust: 0xf4b07f,
  sun: 0xffe3c4,
  hemiSky: 0xf7cdaa,
  hemiGround: 0x7e3a33,
  shadowTint: 0x5b3a66,
  groundTop: 0xe2804f,
  groundTopAlt: 0xd97748,
  groundSide: 0xb85a37,
  groundShadow: 0x7e3a33,
  rockLit: 0xa8553e,
  rockDark: 0x6b2f2c,
  rimAsphalt: 0x5e4a52,
  rimPaving: 0xc9a98a,
} as const;

export interface StratumColours {
  id: string;
  top: number; // first row
  bottom: number; // last row
  front: number;
  side: number;
  back: number;
  accent: number;
  ambientTint: number;
  /** Ambient light at the band's top and bottom row (linear in between). */
  ambient: [number, number];
}

export const STRATA: readonly StratumColours[] = [
  { id: 'B0', top: 0, bottom: 19, front: 0xd9774a, side: 0xb35a36, back: 0x7a3a2c, accent: 0xf0a070, ambientTint: 0xc9805e, ambient: [1.0, 0.55] },
  { id: 'B1', top: 20, bottom: 63, front: 0xc98a4b, side: 0x9e6535, back: 0x6a4128, accent: 0xe7b677, ambientTint: 0xa57a50, ambient: [0.55, 0.42] },
  { id: 'B2', top: 64, bottom: 128, front: 0xa44b3b, side: 0x7c342c, back: 0x4f2321, accent: 0xd07158, ambientTint: 0x7d4038, ambient: [0.42, 0.32] },
  { id: 'B3', top: 129, bottom: 261, front: 0x74506f, side: 0x553a54, back: 0x36243a, accent: 0xa07aa0, ambientTint: 0x5a4060, ambient: [0.32, 0.22] },
  { id: 'B4', top: 262, bottom: 395, front: 0x46557a, side: 0x333f5e, back: 0x1f263d, accent: 0x7486b5, ambientTint: 0x3a4565, ambient: [0.22, 0.17] },
  { id: 'B5', top: 396, bottom: 479, front: 0x2f2840, side: 0x221c30, back: 0x15111f, accent: 0x5e4f80, ambientTint: 0x2a2238, ambient: [0.17, 0.14] },
  { id: 'B6', top: 480, bottom: 583, front: 0x4a2026, side: 0x34161c, back: 0x1e0b10, accent: 0xff6a2b, ambientTint: 0x4a1e1a, ambient: [0.14, 0.12] },
  { id: 'SEAL', top: 584, bottom: 584, front: 0x1a1420, side: 0x120e17, back: 0x120e17, accent: 0x4d4754, ambientTint: 0x1e2a26, ambient: [0.12, 0.12] },
  { id: 'B7', top: 585, bottom: 607, front: 0x2a2230, side: 0x1d1724, back: 0x120e17, accent: 0x7cffb0, ambientTint: 0x1e2a26, ambient: [0.12, 0.12] },
];
/** B0 ambient detail: 1.0 at r0 → 0.80 at r4 → 0.55 at r19 (03 §8.3). */
export const AMBIENT_FLOOR = 0.12;
export const BRIGHT_MINES_AMBIENT = 0.35;

export function stratumAt(row: number): StratumColours {
  for (const s of STRATA) if (row <= s.bottom) return s;
  return STRATA[STRATA.length - 1];
}

/** Ambient light level for a row (canon/03 ambient table). */
export function ambientAt(row: number): number {
  if (row < 0) return 1;
  if (row <= 4) return 1.0 - (0.2 * row) / 4;
  if (row <= 19) return 0.8 - (0.25 * (row - 4)) / 15;
  const s = stratumAt(row);
  const span = Math.max(1, s.bottom - s.top);
  const t = Math.min(1, Math.max(0, (row - s.top) / span));
  return Math.max(AMBIENT_FLOOR, s.ambient[0] + (s.ambient[1] - s.ambient[0]) * t);
}

/** Ore codes, tier 1..10 (index 0 = tier 1). Silhouette names per 03 §8.4. */
export const ORES = [
  { base: 0x7e828e, highlight: 0xc0683e, emissive: 0, shape: 'cubeCluster' },
  { base: 0xe0782e, highlight: 0xffb27a, emissive: 0, shape: 'nuggets' },
  { base: 0x3f6fe0, highlight: 0x9db8ff, emissive: 0, shape: 'flakes' },
  { base: 0xffc53d, highlight: 0xfff1b0, emissive: 0.15, shape: 'fatNugget' },
  { base: 0xb8b4c8, highlight: 0xd9ccff, emissive: 0.2, shape: 'hexPrism' },
  { base: 0x4fe3ff, highlight: 0xd6fbff, emissive: 0.9, shape: 'crossedRods' },
  { base: 0x9cd83a, highlight: 0xe4ff9a, emissive: 0.4, shape: 'pearCut' },
  { base: 0xf2365f, highlight: 0xffd23a, emissive: 0.45, shape: 'cabochon' },
  { base: 0xeefbff, highlight: 0xffffff, emissive: 0.6, shape: 'octahedron' },
  { base: 0xb78cff, highlight: 0xebddff, emissive: 0.7, shape: 'twinPoint' },
] as const;

/** Relic colours by relic id (Fossil Shell, Strongbox, Recorder, Sigil Tablet). */
export const RELIC_COLOURS = [0xf2e6c9, 0xc8963e, 0xff7a3d, 0x5e5a70] as const;

export const SPECIAL = {
  hardrock: 0x6a6370,
  hardrockDark: 0x4d4754,
  hardrockChamfer: 0x8e8796,
  hardrockChamferDeep: 0x8b8496,
  magmaCore: 0xffb238,
  magmaMid: 0xff6a1a,
  magmaCrust: 0x7a1e10,
  methaneRevealed: 0xb8e34a,
  seal: 0x1a1420,
  sealSeam: 0x4d4754,
  heartstone: 0x2a2230,
  turf: 0xe2804f,
} as const;

export const ROLE = {
  logistics: 0xf6c343,
  logisticsDeck: 0x3a3346,
  chevron: 0xffe9a8,
  extraction: 0xff7a3d,
  processing: 0xff5a4e,
  furnace: 0xffb238,
  assembly: 0x2ec4b6,
  power: 0x4da8ff,
  storage: 0x9b7bff,
  support: 0xb8a27a,
  supportGlow: 0xffd9a0,
  buildingBody: 0xede3d2,
  buildingTrim: 0x4a3f55,
  rust: 0x8a4b2e,
} as const;

export const POD = {
  body: 0xf4f1ea,
  visor: 0x46e0d2,
  accent: 0xff7a3d,
  snifferLed: 0x7cff6b,
  flame: 0xffd36b,
  /** Per-tier trim band (t1..t7). */
  trims: [0x8e8796, 0xe0782e, 0x3f6fe0, 0xffc53d, 0xb8b4c8, 0x4fe3ff, 0xeefbff],
} as const;

export const LIGHT = {
  bubbleRadius: 4.5,
  bubbleStrength: 0.95,
  coneStrength: 0.6,
  coneAngleDeg: 40,
  coneRows: 7,
  lamp: 0xffd9a0,
  magma: 0xff7a2e,
  thrust: 0xffd36b,
} as const;

export const SHADING = {
  rampSteps: [0.45, 0.62, 0.84],
  rampSmooth: 0.04,
  shadowTint: 0x5b3a66,
  shadowAmount: 0.35,
  outline: 0x2b1e2f,
  ao: [1.0, 0.82, 0.68, 0.55],
} as const;

export const UI = {
  cream: 0xf6ead7,
  ink: 0x2b1e2f,
  plum: 0x4a3f55,
  amber: 0xffb238,
  danger: 0xff5a4e,
  good: 0x2ec4b6,
} as const;
