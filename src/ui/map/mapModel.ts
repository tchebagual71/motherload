// Basic map and depth-ruler model (03 §4.11, §6.6; canon §3.1 "Map", §3.2 pings). Pure: no DOM.
// The map image is one RGBA texel per cell (48 × rows), drawn scaled with nearest filtering; the lode,
// ping and pod markers are drawn over it at a fixed ≥ 24-pt size.
import { LODE_H, LODE_W, MINE_W, SURVEY_PING_ROW, TILE_FT, type Purity } from '../../shared/canon';
import { F, T, mineralTierOf, relicIdOf, type Lode, type LodeMetal, type Scope } from '../../shared/types';
import { LODE_ORE_TIER, ORES, RELIC_COLOURS, SPECIAL, STRATA, SURFACE } from '../../render/palette';
import { bandIndexAt, mixHex, scaleHex } from '../../render/terrain/colors';
import { isLodeVisible, scopeFloorRow } from '../../terrain/scope';
import { formatInt } from '../format';

/** Rows the map and ruler show: the Rim (row 0) down to and including the floor row (MVP r320). */
export function mapRows(scope: Scope): number {
  return scopeFloorRow(scope) + 1;
}

// ---------------------------------------------------------------------------------------------
// Map image (one texel per cell)
// ---------------------------------------------------------------------------------------------

export const FOG = 0x1f1724;
/** Open cells sit between the band's back wall and its rock, well clear of the fog. */
const AIR_MIX = 0.35;
const LODE_ROCK_K = 0.85;

export interface MapSource {
  readonly seed: number;
  readonly terrain: Uint8Array;
  readonly flags: Uint8Array;
  lodeAt(x: number, r: number): Lode | null;
}

/**
 * Colour of one cell: fog until CHARTED; charted rock in its band colour (wavy edges as in the slab), open cells
 * darker; ores, relics and hazards only once SEEN (the pod's light bubble), discovered lodes in their metal.
 */
export function cellColour(src: MapSource, x: number, r: number, floorRow: number): number {
  if (r >= floorRow) return SPECIAL.seal;
  const i = r * MINE_W + x;
  const flags = src.flags[i];
  if ((flags & F.CHARTED) === 0) return FOG;
  const code = src.terrain[i];
  const band = STRATA[bandIndexAt(x, r, src.seed)];
  if (code === T.AIR) return mixHex(band.back, band.front, AIR_MIX);
  if (r === 0) return code === T.PAVED ? SURFACE.rimPaving : SURFACE.rimAsphalt;
  if (code === T.LODE_ROCK) {
    const lode = src.lodeAt(x, r);
    const tier = lode && lode.discovered ? LODE_ORE_TIER[lode.metal] : 0;
    return tier > 0 ? scaleHex(ORES[tier - 1].base, LODE_ROCK_K) : scaleHex(band.front, LODE_ROCK_K);
  }
  if ((flags & F.SEEN) !== 0) {
    const tier = mineralTierOf(code);
    if (tier > 0) return ORES[tier - 1].base;
    const relic = relicIdOf(code);
    if (relic >= 0) return RELIC_COLOURS[relic];
    if (code === T.HARDROCK) return SPECIAL.hardrock;
    if (code === T.MAGMA) return SPECIAL.magmaMid;
  }
  return band.front;
}

/** Fill `out` (RGBA, 48 × rows) with the map image. ≈ 15k cells in the MVP: well under a millisecond. */
export function paintMap(src: MapSource, scope: Scope, out: Uint8ClampedArray): void {
  const floor = scopeFloorRow(scope);
  const rows = Math.min(out.length / (4 * MINE_W), mapRows(scope));
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < MINE_W; x++) {
      const hex = cellColour(src, x, r, floor);
      const o = (r * MINE_W + x) * 4;
      out[o] = (hex >> 16) & 0xff;
      out[o + 1] = (hex >> 8) & 0xff;
      out[o + 2] = hex & 0xff;
      out[o + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Lodes, pings and marks
// ---------------------------------------------------------------------------------------------

const METAL_NAME: Record<LodeMetal, string> = {
  hematite: 'Hematite',
  copper: 'Copper',
  cobalt: 'Cobalt',
  gold: 'Gold',
  iridium: 'Iridium',
  thorium: 'Thorium',
  kerogen: 'Kerogen',
};
const PURITY_LETTER: Record<Purity, 'P' | 'N' | 'R'> = { poor: 'P', normal: 'N', rich: 'R' };
const PURITY_NAME: Record<Purity, string> = { poor: 'Poor', normal: 'Normal', rich: 'Rich' };
/** A world's purity knowledge for knownLodes: the hosted factory's, or none (M0 and the UI fakes have no factory). */
export function worldPurityKnown(w: { readonly factory: { purityKnown(id: number): boolean } | null }): (id: number) => boolean {
  return (id) => w.factory?.purityKnown(id) === true;
}

/** Dot pings the Poor Iridium lode (rows 195–259, canon §3.2 R12) when the pod first passes r180. */
export const IRIDIUM_PING_ROW = 180;
const IRIDIUM_PING_TOP_MAX = 259;

/** Dot's map pings (canon §3.2) that have fired, from the deepest row reached. */
export function isPinged(lode: Lode, deepestRow: number): boolean {
  if (lode.scripted) return deepestRow >= SURVEY_PING_ROW;
  if (lode.metal === 'iridium' && lode.purity === 'poor' && lode.top <= IRIDIUM_PING_TOP_MAX) return deepestRow >= IRIDIUM_PING_ROW;
  return false;
}

export interface MapLode {
  id: number;
  /** Centre of the 3×2 block in cell units (x right, r down). */
  cx: number;
  cr: number;
  top: number;
  discovered: boolean;
  /** Pinged by Dot but not yet found: a pulsing ring and "?" (03 §6.6). */
  pinged: boolean;
  /** "?" until discovered and its purity known (02 §3.6), then P / N / R (03 §6.6). */
  letter: '?' | 'P' | 'N' | 'R';
  /** Metal colour once discovered. */
  colour: number | null;
  title: string;
  detail: string;
}

/** "575 ft" for a row (canon: row r starts at 12.5 r ft). */
export function feetText(row: number): string {
  return `${formatInt(Math.round(TILE_FT * Math.max(0, row)))} ft`;
}

/**
 * Lodes the player knows about: discovered ones, plus pinged ones still to find. `purityKnown` is the factory's
 * (02 §3.6: fixed-purity lodes and Dowser scans at discovery, else the first drilled ore); until it says so a
 * discovered lode shows its metal but "?" and "Purity unknown" (SIM-8).
 */
export function knownLodes(lodes: readonly Lode[], scope: Scope, deepestRow: number, purityKnown: (id: number) => boolean): MapLode[] {
  const out: MapLode[] = [];
  const floor = scopeFloorRow(scope);
  for (const l of lodes) {
    // Kerogen and Thorium lodes are Unknown seams before v1 (canon §3.2): never on the map.
    if (!isLodeVisible(l, scope) || l.top >= floor) continue;
    const pinged = !l.discovered && isPinged(l, deepestRow);
    if (!l.discovered && !pinged) continue;
    const tier = LODE_ORE_TIER[l.metal];
    const purity = l.discovered && purityKnown(l.id) ? l.purity : null;
    out.push({
      id: l.id,
      cx: l.x0 + LODE_W / 2,
      cr: l.top + LODE_H / 2,
      top: l.top,
      discovered: l.discovered,
      pinged,
      letter: purity ? PURITY_LETTER[purity] : '?',
      colour: l.discovered && tier > 0 ? ORES[tier - 1].base : null,
      title: l.discovered ? `${METAL_NAME[l.metal]} lode` : 'Survey ping',
      detail: !l.discovered
        ? `Dot heard something big near ${feetText(l.top)}`
        : `${purity ? `${PURITY_NAME[purity]} purity` : 'Purity unknown'} · ${feetText(l.top)}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// View transform (pinch 3–14 pt per cell, pan, fit; 03 §6.6)
// ---------------------------------------------------------------------------------------------

export const MAP_ZOOM = { min: 3, max: 14, start: 7 } as const;
/** Sky rows above the Rim for the Rim buildings strip. */
export const MAP_SKY_ROWS = 3;
/** Markers stay ≥ 24 pt at any zoom; taps snap to the nearest within 22 pt (03 §6.6). */
export const MARKER_PT = 24;
export const SNAP_PT = 22;

export interface MapView {
  /** pt per cell. */
  scale: number;
  /** Screen position (pt, in the canvas) of cell (0, row −MAP_SKY_ROWS)'s top-left corner. */
  ox: number;
  oy: number;
  /** Canvas size in pt. */
  w: number;
  h: number;
}

/** The starting view: 7 pt per cell at 375 pt (wider sheets keep the whole width in view), centred on `row`. */
export function initialView(w: number, h: number, rows: number, row: number): MapView {
  const fit = (w - 8) / MINE_W;
  const view: MapView = { scale: Math.max(MAP_ZOOM.min, Math.min(MAP_ZOOM.max, fit)), ox: 0, oy: 0, w, h };
  view.ox = (w - MINE_W * view.scale) / 2;
  view.oy = h / 2 - (row + MAP_SKY_ROWS + 0.5) * view.scale;
  return clampView(view, rows);
}

/** Keep the map on screen: centred when narrower than the canvas, else edges no further in than the canvas. */
export function clampView(v: MapView, rows: number): MapView {
  const mapW = MINE_W * v.scale;
  const mapH = (rows + MAP_SKY_ROWS) * v.scale;
  v.ox = mapW <= v.w ? (v.w - mapW) / 2 : Math.min(0, Math.max(v.w - mapW, v.ox));
  v.oy = mapH <= v.h ? (v.h - mapH) / 2 : Math.min(0, Math.max(v.h - mapH, v.oy));
  return v;
}

/** Zoom by `k` about screen point (px, py), clamped to 3–14 pt per cell. */
export function zoomAbout(v: MapView, k: number, px: number, py: number, rows: number): MapView {
  const next = Math.max(MAP_ZOOM.min, Math.min(MAP_ZOOM.max, v.scale * k));
  const f = next / v.scale;
  v.ox = px - (px - v.ox) * f;
  v.oy = py - (py - v.oy) * f;
  v.scale = next;
  return clampView(v, rows);
}

/** Screen point of a map position in cell units (x right, r down from row 0). */
export function toScreen(v: MapView, x: number, r: number): { x: number; y: number } {
  return { x: v.ox + x * v.scale, y: v.oy + (r + MAP_SKY_ROWS) * v.scale };
}

/** Centre the view on cell row `row` (x keeps its pan when the map is wider than the canvas). */
export function centreOn(v: MapView, x: number, row: number, rows: number): MapView {
  v.ox = v.w / 2 - x * v.scale;
  v.oy = v.h / 2 - (row + MAP_SKY_ROWS) * v.scale;
  return clampView(v, rows);
}

export interface Marker {
  id: string;
  x: number;
  y: number;
}

/** The marker nearest to (px, py) within SNAP_PT, or null. */
export function snapMarker(markers: readonly Marker[], px: number, py: number): Marker | null {
  let best: Marker | null = null;
  let bestD = SNAP_PT;
  for (const m of markers) {
    const d = Math.hypot(m.x - px, m.y - py);
    if (d <= bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/**
 * Extra map layers (03 §6.6: lifts in the MVP, Depots and problems in v1). The factory registers its layers here;
 * the MVP ships none, so the hook costs nothing until then.
 */
export interface MapLayer {
  id: string;
  /** Draw in canvas pt; `toScreen` maps cell units. */
  draw(ctx: CanvasRenderingContext2D, view: Readonly<MapView>, toScreenFn: typeof toScreen): void;
  /** Ruler markers in rows (03 §4.11: lifts in mustard). */
  rulerRows?(): readonly { row: number; colour: string }[];
}

const layers: MapLayer[] = [];

export function registerMapLayer(layer: MapLayer): () => void {
  layers.push(layer);
  return () => {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
  };
}

export function mapLayers(): readonly MapLayer[] {
  return layers;
}
