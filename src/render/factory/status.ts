// Status bubbles (03 §4.10): which glyph a building's status shows, one table for every bubble the game draws.
// Three-free on purpose, so the build UI can share it with the renderer's world-anchored 3D bubbles.
import type { BuildingKind, EntityView } from '../../factory/api';

/**
 * Status glyphs (03 §4.10): no input (hollow circle), output full (boxes), no recipe (?), disconnected (broken
 * link), and the Logistics overlay's jam head (⊘). The values are atlas cells (overlayMaterials.ts).
 */
export const BUBBLE_GLYPH = { NO_INPUT: 0, FULL: 1, NO_RECIPE: 2, DISCONNECTED: 3, JAM: 4 } as const;
export type BubbleGlyph = (typeof BUBBLE_GLYPH)[keyof typeof BUBBLE_GLYPH];

/** Text fallbacks of the glyphs (DOM, screen readers). */
export const BUBBLE_TEXT: Readonly<Record<BubbleGlyph, string>> = { 0: '○', 1: '▣', 2: '?', 3: '⛓', 4: '⊘' };

/**
 * Machines whose idle state means "no input". Storage (Bins, Export Terminals), Headframes, lifts, drills and
 * Routers idle by design (nothing to fetch, or nothing arriving yet) and never claim to be starved.
 */
const STARVES: ReadonlySet<BuildingKind> = new Set<BuildingKind>(['smelter', 'assembler']);

/** Kinds that carry a status bubble at all (belts show jams through the overlay instead). */
export const BUBBLE_KINDS: ReadonlySet<BuildingKind> = new Set<BuildingKind>(['smelter', 'assembler', 'export', 'headframe', 'autoDrill', 'lift', 'router']);

/** The glyph a building shows for its status, or −1 for none (working, or idle where idling is normal). */
export function statusGlyph(kind: BuildingKind, status: EntityView['status']): BubbleGlyph | -1 {
  if (!BUBBLE_KINDS.has(kind)) return -1;
  if (status === 'blocked') return BUBBLE_GLYPH.FULL;
  if (status === 'noOutput') return BUBBLE_GLYPH.DISCONNECTED;
  if (status === 'noRecipe') return BUBBLE_GLYPH.NO_RECIPE;
  if (status === 'idle' && STARVES.has(kind)) return BUBBLE_GLYPH.NO_INPUT;
  return -1;
}

/** Alert glyphs draw in the danger colour (03 §4.10), the rest in ink. */
export function glyphAlert(g: BubbleGlyph): boolean {
  return g === BUBBLE_GLYPH.FULL || g === BUBBLE_GLYPH.DISCONNECTED || g === BUBBLE_GLYPH.JAM;
}
