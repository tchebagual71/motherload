// Basic map and depth ruler (03 §4.11, §6.6; canon §3.12): the charted-cell image, known lodes and pings, the
// pinch/pan view, 22-pt tap snapping, the layer hook, the ruler geometry and the ruler component.
import { signal } from '@preact/signals';
import { h, render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { LODE_H, MINE_W, MVP_SEAL_ROW, SURVEY_PING_ROW, TOUCH } from '../../src/shared/canon';
import { F, T, mineralCode, type Lode } from '../../src/shared/types';
import { ORES, RELIC_COLOURS, SPECIAL } from '../../src/render/palette';
import { generateWorld } from '../../src/terrain/generate';
import { createFakeApp } from '../../src/ui/fakes';
import {
  FOG,
  IRIDIUM_PING_ROW,
  MAP_SKY_ROWS,
  MAP_ZOOM,
  MARKER_PT,
  SNAP_PT,
  cellColour,
  centreOn,
  clampView,
  feetText,
  initialView,
  isPinged,
  knownLodes,
  mapLayers,
  mapRows,
  paintMap,
  registerMapLayer,
  snapMarker,
  toScreen,
  zoomAbout,
  type MapSource,
} from '../../src/ui/map/mapModel';
import { Ruler } from '../../src/ui/map/Ruler';
import { CONTEXT_SIZE, RULER_HIT, RULER_RAIL, contextTop, railBands, rowToRail, rulerGeometry, type RulerSettings } from '../../src/ui/map/rulerLayout';
import type { Viewport } from '../../src/ui/viewport';
import { flush, installFakeDom, type FakeDom } from './ui-dom.helpers';

function source(): MapSource & { lodes: Lode[] } {
  const terrain = new Uint8Array(MINE_W * 400).fill(T.DIRT);
  const flags = new Uint8Array(MINE_W * 400);
  const lodes: Lode[] = [];
  return {
    seed: 5,
    terrain,
    flags,
    lodes,
    lodeAt: (x, r) => lodes.find((l) => x >= l.x0 && x < l.x0 + 3 && r >= l.top && r < l.top + LODE_H) ?? null,
  };
}

function lode(patch: Partial<Lode>): Lode {
  return { id: 0, metal: 'copper', purity: 'normal', x0: 10, top: 100, scripted: false, scope: 'mvp', discovered: false, ...patch };
}

const at = (x: number, r: number) => r * MINE_W + x;

describe('map image (03 §6.6)', () => {
  it('fogs uncharted cells, shows charted rock in its band and open cells darker', () => {
    const s = source();
    expect(cellColour(s, 5, 40, MVP_SEAL_ROW)).toBe(FOG);
    s.flags[at(5, 40)] = F.CHARTED;
    const rock = cellColour(s, 5, 40, MVP_SEAL_ROW);
    expect(rock).not.toBe(FOG);
    s.terrain[at(5, 40)] = T.AIR;
    const open = cellColour(s, 5, 40, MVP_SEAL_ROW);
    expect(open & 0xff).toBeLessThan(rock & 0xff);
  });

  it('shows ores, relics and hazards only once the pod has seen them', () => {
    const s = source();
    s.terrain[at(3, 50)] = mineralCode(4);
    s.flags[at(3, 50)] = F.CHARTED;
    expect(cellColour(s, 3, 50, MVP_SEAL_ROW)).not.toBe(ORES[3].base);
    s.flags[at(3, 50)] |= F.SEEN;
    expect(cellColour(s, 3, 50, MVP_SEAL_ROW)).toBe(ORES[3].base);
    s.terrain[at(3, 50)] = T.HARDROCK;
    expect(cellColour(s, 3, 50, MVP_SEAL_ROW)).toBe(SPECIAL.hardrock);
  });

  it('paints discovered lodes in their metal and seals every row from the floor down', () => {
    const s = source();
    const l = lode({ x0: 10, top: 100 });
    s.lodes.push(l);
    s.terrain[at(11, 100)] = T.LODE_ROCK;
    s.flags[at(11, 100)] = F.CHARTED;
    const hidden = cellColour(s, 11, 100, MVP_SEAL_ROW);
    l.discovered = true;
    expect(cellColour(s, 11, 100, MVP_SEAL_ROW)).not.toBe(hidden);
    s.flags[at(4, MVP_SEAL_ROW)] = F.CHARTED | F.SEEN;
    expect(cellColour(s, 4, MVP_SEAL_ROW, MVP_SEAL_ROW)).toBe(SPECIAL.seal);
    expect(cellColour(s, 4, MVP_SEAL_ROW + 30, MVP_SEAL_ROW)).toBe(SPECIAL.seal);
  });

  it('fills one opaque RGBA texel per cell down to the scope floor', () => {
    const s = source();
    s.flags[at(0, 0)] = F.CHARTED;
    expect(mapRows('mvp')).toBe(MVP_SEAL_ROW + 1);
    const out = new Uint8ClampedArray(MINE_W * mapRows('mvp') * 4);
    paintMap(s, 'mvp', out);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
    const fog = [(FOG >> 16) & 0xff, (FOG >> 8) & 0xff, FOG & 0xff];
    expect(Array.from(out.subarray(4, 7))).toEqual(fog);
    expect(Array.from(out.subarray(0, 3))).not.toEqual(fog);
  });

  it('paints a real generated world within budget', () => {
    const { grid } = generateWorld(7);
    grid.flags.fill(F.CHARTED | F.SEEN);
    const out = new Uint8ClampedArray(MINE_W * mapRows('mvp') * 4);
    const t0 = performance.now();
    paintMap(grid, 'mvp', out);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(new Set(Array.from({ length: 200 }, (_, i) => out[i * 4 * 70])).size).toBeGreaterThan(3);
    expect(RELIC_COLOURS.length).toBeGreaterThan(0);
  });
});

describe('known lodes and pings (canon §3.2)', () => {
  it('lists discovered lodes with metal, purity letter and depth, and hides undiscovered ones', () => {
    const lodes = [lode({ id: 1, discovered: true, purity: 'rich', metal: 'gold', top: 148 }), lode({ id: 2 })];
    const known = knownLodes(lodes, 'mvp', 0);
    expect(known.map((l) => l.id)).toEqual([1]);
    expect(known[0]).toMatchObject({ letter: 'R', colour: ORES[3].base, title: 'Gold lode', pinged: false, cr: 149 });
    expect(known[0].detail).toBe(`Rich purity · ${feetText(148)}`);
  });

  it("shows Dot's survey ping as '?' once the pod passes the ping row, until the lode is found", () => {
    const survey = lode({ id: 3, scripted: true, top: 46 });
    expect(knownLodes([survey], 'mvp', SURVEY_PING_ROW - 1)).toEqual([]);
    const [p] = knownLodes([survey], 'mvp', SURVEY_PING_ROW);
    expect(p).toMatchObject({ letter: '?', pinged: true, colour: null, title: 'Survey ping' });
    survey.discovered = true;
    expect(knownLodes([survey], 'mvp', 400)[0]).toMatchObject({ letter: 'N', pinged: false });
    const iridium = lode({ metal: 'iridium', purity: 'poor', top: 197 });
    expect(isPinged(iridium, IRIDIUM_PING_ROW - 1)).toBe(false);
    expect(isPinged(iridium, IRIDIUM_PING_ROW)).toBe(true);
    expect(isPinged(lode({ metal: 'iridium', purity: 'poor', top: 385 }), 400)).toBe(false);
  });

  it('never lists Unknown seams before v1 or lodes below the scope floor', () => {
    const lodes = [lode({ id: 4, metal: 'kerogen', scope: 'v1', discovered: true }), lode({ id: 5, discovered: true, top: MVP_SEAL_ROW + 10 })];
    expect(knownLodes(lodes, 'mvp', 600)).toEqual([]);
    expect(knownLodes(lodes, 'v1', 600).map((l) => l.id)).toEqual([4, 5]);
  });
});

describe('map view (03 §6.6)', () => {
  const rows = mapRows('mvp');

  it('starts near 7 pt per cell on a 375-pt phone, centred on the pod row', () => {
    const v = initialView(343, 520, rows, 150);
    expect(v.scale).toBeGreaterThanOrEqual(6.5);
    expect(v.scale).toBeLessThanOrEqual(7.5);
    const pod = toScreen(v, MINE_W / 2, 150.5);
    expect(pod.x).toBeCloseTo(343 / 2, 3);
    expect(pod.y).toBeCloseTo(260, 3);
  });

  it('keeps the map edges on screen near the Rim and the floor', () => {
    const top = initialView(343, 520, rows, 0);
    expect(top.oy).toBe(0);
    const bottom = initialView(343, 520, rows, rows);
    expect(bottom.oy + (rows + MAP_SKY_ROWS) * bottom.scale).toBeCloseTo(520, 3);
    const v = clampView({ scale: 7, ox: 900, oy: 900, w: 343, h: 520 }, rows);
    expect(v.oy).toBe(0);
    expect(v.ox).toBeCloseTo((343 - MINE_W * 7) / 2, 3);
  });

  it('pinches between 3 and 14 pt per cell about the fingers', () => {
    const v = initialView(343, 520, rows, 150);
    const before = { x: (171 - v.ox) / v.scale, y: (300 - v.oy) / v.scale };
    zoomAbout(v, 1.5, 171, 300, rows);
    expect(v.scale).toBeGreaterThan(10);
    expect((300 - v.oy) / v.scale).toBeCloseTo(before.y, 3);
    zoomAbout(v, 10, 171, 300, rows);
    expect(v.scale).toBe(MAP_ZOOM.max);
    zoomAbout(v, 0.01, 171, 300, rows);
    expect(v.scale).toBe(MAP_ZOOM.min);
  });

  it('centres on the pod', () => {
    const v = initialView(343, 520, rows, 10);
    centreOn(v, 30, 200, rows);
    expect(toScreen(v, 30, 200).y).toBeCloseTo(260, 3);
  });

  it('snaps a tap to the nearest marker within 22 pt; markers are at least 24 pt', () => {
    expect(MARKER_PT).toBeGreaterThanOrEqual(24);
    const markers = [
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 130, y: 100 },
    ];
    expect(snapMarker(markers, 112, 100)?.id).toBe('a');
    expect(snapMarker(markers, 118, 104)?.id).toBe('b');
    expect(snapMarker(markers, 100, 100 + SNAP_PT + 1)).toBeNull();
  });

  it('takes extra layers (lifts) through the registry and drops them on unregister', () => {
    const off = registerMapLayer({ id: 'lifts', draw: () => {}, rulerRows: () => [{ row: 40, colour: '#f6c343' }] });
    expect(mapLayers().map((l) => l.id)).toContain('lifts');
    off();
    expect(mapLayers().map((l) => l.id)).not.toContain('lifts');
  });
});

describe('depth ruler geometry (canon §3.12; 03 §4.11)', () => {
  const SE: Viewport = { w: 375, h: 667, it: 20, ib: 0, il: 0, ir: 0 };
  const P15: Viewport = { w: 393, h: 852, it: 59, ib: 34, il: 0, ir: 0 };
  const base: RulerSettings = { controlSize: 'M', thrustButton: false, leftHanded: false, oneHanded: false };

  it('puts a 24-pt rail on the right edge with a 44-pt hit strip from 8 pt under the HUD to 12 pt above the context button', () => {
    for (const v of [SE, P15]) {
      const g = rulerGeometry(v, base);
      expect(g.side).toBe('right');
      expect(g.railX1 - g.railX0).toBe(RULER_RAIL);
      expect(g.hitX1 - g.hitX0).toBe(RULER_HIT);
      expect(g.railX1).toBe(v.w);
      expect(g.top).toBe(v.it + TOUCH.hudRow + 8);
      expect(g.bottom).toBe(contextTop(v, base) - 12);
      expect(g.bottom - g.top).toBeGreaterThan(200);
    }
    expect(contextTop(P15, { ...base, controlSize: 'L' })).toBeLessThan(contextTop(P15, base) - CONTEXT_SIZE.L + CONTEXT_SIZE.M);
  });

  it('mirrors for left-handed play 24 pt in from the edge, and goes non-dominant above the stick when one-handed', () => {
    const left = rulerGeometry(SE, { ...base, leftHanded: true });
    expect(left.side).toBe('left');
    expect(left.railX0).toBe(24);
    const one = rulerGeometry(P15, { ...base, oneHanded: true });
    expect(one.side).toBe('left');
    expect(one.bottom).toBeLessThanOrEqual(0.45 * P15.h - 12);
  });

  it('shrinks the hit strip to the rail in build mode', () => {
    const g = rulerGeometry(P15, base, true);
    expect(g.hitX1 - g.hitX0).toBe(RULER_RAIL);
  });

  it('maps rows 0 … floor onto the rail and tints it by band down to the floor', () => {
    expect(rowToRail(0, MVP_SEAL_ROW, 100, 420)).toBe(100);
    expect(rowToRail(160, MVP_SEAL_ROW, 100, 420)).toBe(260);
    expect(rowToRail(999, MVP_SEAL_ROW, 100, 420)).toBe(420);
    const bands = railBands(MVP_SEAL_ROW);
    expect(bands[0][0]).toBe(0);
    expect(bands[bands.length - 1][1]).toBe(MVP_SEAL_ROW);
    expect(bands.map((b) => b[2])).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('depth ruler component', () => {
  let dom: FakeDom | null = null;
  afterEach(async () => {
    if (!dom) return;
    await flush(() => render(null, dom!.root as unknown as HTMLElement));
    dom.restore();
    dom = null;
  });

  it('opens the map on tap in play, not in build mode', async () => {
    dom = installFakeDom();
    const app = createFakeApp({ scope: 'mvp', look: 'toon', styleTest: false });
    const vp = signal<Viewport>({ w: 393, h: 852, it: 59, ib: 34, il: 0, ir: 0 });
    await flush(() => render(h(Ruler, { app, vp }), dom!.root as unknown as HTMLElement));
    const btn = dom.root.querySelector('.hf-ruler');
    expect(btn).not.toBeNull();
    expect((btn!.style as unknown as { width: string }).width).toBe(`${RULER_HIT}px`);
    expect(dom.root.querySelector('.hf-ruler-pod')).not.toBeNull();
    expect(dom.root.querySelectorAll('.hf-ruler-band').length).toBe(5);
    await flush(() => btn!.click());
    expect(app.state.sheet.peek()).toBe('map');
    app.state.sheet.value = null;
    await flush(() => app.enterBuild());
    const narrow = dom.root.querySelector('.hf-ruler')!;
    expect((narrow.style as unknown as { width: string }).width).toBe(`${RULER_RAIL}px`);
    await flush(() => narrow.click());
    expect(app.state.sheet.peek()).toBeNull();
  });
});
