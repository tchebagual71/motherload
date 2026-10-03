// Build-mode reducers, copy, camera and layout (03 §2.3–2.4, §4; 02 §2; canon §3.4, §3.12). Pure functions only.
import { describe, expect, it } from 'vitest';
import { DIR, type Cell, type Dir, type GhostView } from '../../src/factory/api';
import { BUILD_ZOOM, clampCamera, clampPpu, defaultCamera, entryPlane, planeBounds } from '../../src/ui/build/camera';
import { errText, kitBill, kitsForUnits, undoText, unlockText } from '../../src/ui/build/text';
import {
  cardsFor,
  dockLayout,
  drillSites,
  extendPath,
  footprintAt,
  kitsInCargo,
  lPath,
  liftChip,
  liftEnds,
  liftRails,
  loupePlace,
  mineRun,
  pathDirs,
  planeTools,
  shoppingList,
  shoppingSummary,
  snapDrill,
  snapEndDir,
  takesInput,
  worldArea,
  yardBeltCost,
} from '../../src/ui/build/tools';
import type { Lode } from '../../src/shared/types';

const c = (x: number, y: number): Cell => ({ x, y });

describe('belt paths (03 §4.4)', () => {
  it('appends each entered cell, walking 4-connected across jumps', () => {
    let p = extendPath([], c(3, 3));
    p = extendPath(p, c(4, 3));
    p = extendPath(p, c(6, 5)); // a fast finger skipped cells
    expect(p).toEqual([c(3, 3), c(4, 3), c(5, 3), c(5, 4), c(6, 4), c(6, 5)].map((q) => q));
    for (let i = 1; i < p.length; i++) expect(Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y)).toBe(1);
  });

  it('backing up erases', () => {
    let p = [c(3, 3), c(4, 3), c(5, 3), c(6, 3)];
    p = extendPath(p, c(5, 3));
    expect(p).toEqual([c(3, 3), c(4, 3), c(5, 3)]);
    p = extendPath(p, c(3, 3));
    expect(p).toEqual([c(3, 3)]);
  });

  it('crossing an older part of the stroke is kept (Junctions, 02 §2.1)', () => {
    let p = [c(5, 2), c(5, 3), c(5, 4), c(4, 4), c(3, 4), c(3, 3)];
    p = extendPath(p, c(6, 3));
    expect(p.slice(-3)).toEqual([c(4, 3), c(5, 3), c(6, 3)]);
  });

  it('returns the same array when the finger stays on the end cell', () => {
    const p = [c(1, 1), c(2, 1)];
    expect(extendPath(p, c(2, 1))).toBe(p);
  });

  it('L mode draws the horizontal leg first, or vertical when flipped', () => {
    expect(lPath(c(1, 1), c(3, 3), false)).toEqual([c(1, 1), c(2, 1), c(3, 1), c(3, 2), c(3, 3)]);
    expect(lPath(c(1, 1), c(3, 3), true)).toEqual([c(1, 1), c(1, 2), c(1, 3), c(2, 3), c(3, 3)]);
  });

  it('faces every tile toward the next; the end keeps the stroke direction unless given', () => {
    const p = [c(1, 1), c(2, 1), c(2, 2)];
    expect(pathDirs(p)).toEqual([DIR.E, DIR.S, DIR.S]);
    expect(pathDirs(p, DIR.W)).toEqual([DIR.E, DIR.S, DIR.W]);
    expect(pathDirs([c(4, 4)], DIR.N)).toEqual([DIR.N]);
  });

  it('snaps the last tile into a side neighbour that takes input (ports within 1 cell)', () => {
    // Stroke heading east along row 3; the Smelter sits south of the last tile.
    const accepts = (x: number, y: number, d: Dir) => x === 26 && y === 4 && d === DIR.S;
    expect(snapEndDir([c(24, 3), c(25, 3), c(26, 3)], accepts)).toBe(DIR.S);
    // Something straight ahead already takes it: keep the drag's direction.
    expect(snapEndDir([c(25, 3), c(26, 3)], (x, y) => x === 27 && y === 3)).toBeUndefined();
    expect(snapEndDir([c(25, 3)], accepts)).toBeUndefined();
  });

  it('knows which edges take belts (02 §2.2)', () => {
    expect(takesInput('bin', DIR.S, DIR.N)).toBe(true);
    expect(takesInput('smelter', DIR.S, DIR.S)).toBe(true); // enters through the north edge
    expect(takesInput('smelter', DIR.S, DIR.N)).toBe(false); // that is its output edge
    expect(takesInput('headframe', DIR.S, DIR.S)).toBe(false);
  });

  it('prices new tiles and crossings ($5 a tile)', () => {
    const words = new Uint16Array(48 * 33);
    const path = [c(1, 1), c(2, 1), c(3, 1)];
    expect(yardBeltCost(path, pathDirs(path), words, 5)).toBe(15);
    words[1 * 48 + 2] = 0x8000 | (1 << 12) | (DIR.E << 10); // same axis: no charge
    expect(yardBeltCost(path, pathDirs(path), words, 5)).toBe(10);
    words[1 * 48 + 2] = 0x8000 | (1 << 12) | (DIR.S << 10); // perpendicular: a Junction
    expect(yardBeltCost(path, pathDirs(path), words, 5)).toBe(15);
  });
});

describe('underground pieces (02 §2.3–2.6; 03 §4.4–4.5)', () => {
  it('row-locks a belt run toward the finger', () => {
    const r = mineRun(c(10, 40), c(6, 37));
    expect(r).toMatchObject({ x: 10, y: 40, dir: DIR.W, length: 5 });
    expect(r.cells.map((q) => q.x)).toEqual([10, 9, 8, 7, 6]);
    expect(r.cells.every((q) => q.y === 40)).toBe(true);
    expect(mineRun(c(3, 9), c(3, 9))).toMatchObject({ dir: DIR.E, length: 1 });
  });

  it('takes a lift top above the foot in its column ±1, else not a top', () => {
    expect(liftEnds(c(26, 45), c(27, 0))).toEqual({ x: 26, foot: 45, top: 0 });
    expect(liftEnds(c(26, 45), c(28, 10))).toBeNull();
    expect(liftEnds(c(26, 45), c(26, 46))).toBeNull();
  });

  it('meters lift Kits: a foot covers H ≤ 31, then one Rail per 32 rows (02 §3.4)', () => {
    expect(liftRails(31, 0)).toBe(0);
    expect(liftRails(45, 0)).toBe(1);
    expect(liftRails(64, 0)).toBe(2);
    expect(liftChip(45, 0)).toBe('H 45 · Foot Kit + 1 Rail · 30/min · 30 s');
  });

  it('snaps a drill to the nearest site of a discovered lode within 1 cell', () => {
    const lode: Lode = { id: 0, metal: 'copper', purity: 'normal', x0: 27, top: 46, scripted: true, scope: 'mvp', discovered: true };
    const sites = drillSites([lode, { ...lode, id: 1, x0: 5, discovered: false }], () => true);
    expect(sites.map((s) => s.cell)).toEqual([c(27, 44), c(28, 44)]);
    expect(snapDrill(c(26, 44), sites)).toEqual(c(27, 44));
    expect(snapDrill(c(29, 45), sites)).toEqual(c(28, 44));
    expect(snapDrill(c(20, 44), sites)).toBeNull();
    expect(snapDrill(c(27, 44), sites, (s) => s.x !== 27)).toEqual(c(28, 44));
  });

  it('centres a footprint on the lifted point; a cell-centre tap makes that cell the 2×2 min corner', () => {
    expect(footprintAt(10.4, 5.7, 1, 1)).toEqual(c(10, 5));
    expect(footprintAt(10.5, 5.5, 2, 2)).toEqual(c(10, 5));
    expect(footprintAt(10.4999, 5.5001, 2, 2)).toEqual(c(10, 5));
    expect(footprintAt(10.3, 5.7, 2, 2)).toEqual(c(9, 5));
    expect(footprintAt(10.6, 5.2, 2, 2)).toEqual(c(10, 4));
    expect(footprintAt(10.5, 5.5, 3, 3)).toEqual(c(9, 4));
  });
});

describe('Kits and the Shopping list (02 §2.9; 03 §4.6)', () => {
  const ghost = (kit: string, units: number): GhostView => ({ id: 1, kind: 'belt', mk: 1, x: 0, y: 0, w: units, h: 1, dir: 0, part: null, kit, kitUnits: units, order: 0 });

  it('counts metered Kits by their units', () => {
    expect(kitsInCargo([{ kind: 'kit', id: 'belt' }, { kind: 'kit', id: 'belt', units: 3 }, { kind: 'kit', id: 'autoDrill' }, { kind: 'mineral', tier: 1 }])).toEqual({ belt: 11, autoDrill: 1 });
  });

  it('lists what the ghosts still need against the bay', () => {
    const lines = shoppingList([ghost('belt', 8), ghost('belt', 4), ghost('autoDrill', 1), ghost('liftRail', 1)], { belt: 8, autoDrill: 1 });
    expect(lines).toEqual([
      { kit: 'belt', needUnits: 12, haveUnits: 8, needKits: 2, haveKits: 1, buyKits: 1 },
      { kit: 'autoDrill', needUnits: 1, haveUnits: 1, needKits: 1, haveKits: 1, buyKits: 0 },
      { kit: 'liftRail', needUnits: 1, haveUnits: 0, needKits: 1, haveKits: 0, buyKits: 1 },
    ]);
    expect(shoppingSummary(lines)).toEqual({ text: 'Kits: 4 needed, 2 carried', short: true });
    expect(shoppingSummary(shoppingList([ghost('autoDrill', 1)], { autoDrill: 2 })).short).toBe(false);
  });
});

describe('copy (03 §6.2)', () => {
  it('maps every 02 §2.5 code to its toast', () => {
    expect(errText({ ok: false, code: 'E_LOCKED', rung: 'U2' })).toBe('Unlocks: Discover a lode');
    expect(errText({ ok: false, code: 'E_YARD' })).toBe('Outside your Yard');
    expect(errText({ ok: false, code: 'E_OCCUPIED' })).toBe("Something's already here");
    expect(errText({ ok: false, code: 'E_SOLID' })).toBe('Dig this out first');
    expect(errText({ ok: false, code: 'E_UNSEEN' })).toBe('Explore here first');
    expect(errText({ ok: false, code: 'E_FLOOR' })).toBe('Needs a floor');
    expect(errText({ ok: false, code: 'E_LODE' })).toBe('Drills sit on a discovered lode');
    expect(errText({ ok: false, code: 'E_LODE' }, { lodeHasDrill: true })).toBe('This lode has a drill');
    expect(errText({ ok: false, code: 'E_POD' })).toBe('Pip is in the way');
    expect(errText({ ok: false, code: 'E_COLUMN', y: 212 }, { kind: 'lift' })).toBe('Shaft blocked at row 212');
    expect(errText({ ok: false, code: 'E_COLUMN', x: 3, y: 1 }, { kind: 'headframe' })).toBe('No Headframe column here');
    expect(errText({ ok: false, code: 'E_ARENA' })).toBe('Not in the Hollow Heart');
    expect(errText({ ok: false, code: 'E_FUNDS', need: 1250 })).toBe('Need $1,250 more');
    expect(errText({ ok: false, code: 'E_PARTS', need: 2, item: 'hullPlate' })).toBe('Need 2 Hull Plate');
    expect(errText({ ok: false, code: 'E_KIT', need: 9, item: 'belt' })).toBe('Need 2 Belt Kit in cargo');
    for (const code of ['E_LOCKED', 'E_FUNDS', 'E_KIT', 'E_COLUMN', 'E_STOCKPILE_FULL'] as const) {
      expect(errText({ ok: false, code, need: 99_999, item: 'liftFoot', rung: 'U3', y: 583 }).length).toBeLessThanOrEqual(40);
    }
  });

  it('meters Kit bills and names undo steps (03 §4.4, §4.8)', () => {
    expect(kitsForUnits('belt', 16)).toBe(2);
    expect(kitBill('belt', 16)).toBe('16 tiles = 2 Belt Kits');
    expect(kitBill('belt', 1)).toBe('1 tile = 1 Belt Kit');
    expect(kitBill('autoDrill', 1)).toBe('1 Auto-Drill Kit');
    expect(undoText('Undid', 'Belt ×12', 60)).toBe('Undid: Belt ×12 (+$60)');
    expect(undoText('Redid', 'Smelter', -300)).toBe('Redid: Smelter (−$300)');
    expect(undoText('Undid', null, 0)).toBe('Undid: last step');
    expect(unlockText('U3')).toBe('Unlocks: Produce an ingot');
  });
});

describe('build cards (03 §2.3–2.4)', () => {
  const deps = (rungs: string[], carried: Record<string, number> = {}) => ({ unlocked: (r: string) => rungs.includes(r), carried, v1: false });

  it('shows Yard prices and the rung trigger on locked cards', () => {
    const cards = cardsFor('yard', 'logistics', deps(['U0', 'U2']));
    expect(cards.map((k) => [k.tool, k.sub, k.locked])).toEqual([
      ['belt', '$5/tile', false],
      ['router', '$40', true],
      ['headframe', '$200', false],
    ]);
    expect(cards[1].lockText).toBe('Unlocks: Produce an ingot');
    expect(cards[0].highlight).toBe(true); // 02 §9.2: before the first ingot
    expect(cardsFor('yard', 'logistics', deps(['U0', 'U2', 'U3']))[0].highlight).toBe(false);
  });

  it('shows the Kits in the bay underground', () => {
    const cards = cardsFor('mine', 'logistics', deps(['U0', 'U2'], { belt: 12, liftFoot: 1, liftRail: 2 }));
    expect(cards.map((k) => [k.tool, k.sub])).toEqual([
      ['belt', 'Kit ×2'],
      ['router', 'Kit ×0'],
      ['lift', 'Kit ×1 · R2'],
    ]);
    expect(cardsFor('mine', 'extract', deps(['U2']))[0]).toMatchObject({ tool: 'autoDrill', locked: false });
  });

  it('offers each plane its own pieces', () => {
    expect(planeTools('yard')).toEqual(['belt', 'router', 'headframe', 'smelter', 'assembler', 'bin', 'export', 'bulldoze']);
    expect(planeTools('mine')).toEqual(['belt', 'router', 'lift', 'autoDrill', 'bulldoze']);
  });
});

describe('dock band and loupe layout (03 §2.3; UX review M8)', () => {
  const xs = (w: number, left = false) => Object.fromEntries(dockLayout(w, left).map((s) => [s.id, s.x]));

  it('matches the 375-pt wireframe and moves the right group +18 at 393', () => {
    expect(xs(375)).toEqual({ done: 8, undo: 56, redo: 104, pan: 159, rotate: 207, clear: 255, ok: 311 });
    expect(xs(393)).toEqual({ done: 8, undo: 56, redo: 104, pan: 177, rotate: 225, clear: 273, ok: 329 });
  });

  it('keeps ≥ 44-pt targets without overlap down to 320 pt (✋ moves to the zoom stack)', () => {
    for (const w of [320, 360, 375, 393, 430]) {
      const slots = dockLayout(w, false).sort((a, b) => a.x - b.x);
      for (const s of slots) expect(s.w).toBeGreaterThanOrEqual(44);
      for (let i = 1; i < slots.length; i++) expect(slots[i].x).toBeGreaterThanOrEqual(slots[i - 1].x + slots[i - 1].w);
      expect(slots[0].x).toBeGreaterThanOrEqual(0);
      expect(slots.at(-1)!.x + slots.at(-1)!.w).toBeLessThanOrEqual(w);
      expect(slots.at(-1)!.id).toBe('ok'); // ✓ on the dominant (right) side
    }
    expect(dockLayout(360, false).some((s) => s.id === 'pan')).toBe(true);
    expect(dockLayout(320, false).some((s) => s.id === 'pan')).toBe(false);
  });

  it('mirrors for left-handed players (✓ on the left)', () => {
    const l = xs(375, true);
    expect(l.ok).toBe(375 - 311 - 56);
    expect(l.done).toBe(375 - 8 - 44);
  });

  it('places the world area between the top bar and the dock', () => {
    expect(worldArea(375, 667, 20, 0)).toEqual({ x0: 0, y0: 64, x1: 375, y1: 483 });
    expect(worldArea(393, 852, 59, 34)).toEqual({ x0: 0, y0: 103, x1: 393, y1: 634 });
  });

  it('puts the loupe 120 pt above the finger on the non-dominant side, inside the world area', () => {
    const area = { x0: 0, y0: 64, x1: 375, y1: 483 };
    expect(loupePlace(200, 400, area, false)).toEqual({ x: 200 - 64 - 44, y: 400 - 120 - 44 });
    expect(loupePlace(200, 400, area, true).x).toBe(200 + 64 - 44);
    const nearLeft = loupePlace(30, 400, area, false);
    expect(nearLeft.x).toBe(30 + 64 - 44); // flipped
    const nearTop = loupePlace(200, 120, area, false);
    expect(nearTop.y).toBeGreaterThanOrEqual(area.y0);
    expect(nearTop.y + 44).toBeLessThanOrEqual(120); // never below the finger…
    expect(200 < nearTop.x || 200 > nearTop.x + 88).toBe(true); // …and beside it when it cannot sit above
  });
});

describe('build camera (canon §3.4; 03 §5)', () => {
  it('clamps zoom per plane, with the 44-ppu floor for 1×1 tools on the Yard', () => {
    expect(clampPpu('yard', 20)).toBe(39);
    expect(clampPpu('yard', 20, true)).toBe(44);
    expect(clampPpu('yard', 99)).toBe(64);
    expect(clampPpu('mine', 40)).toBe(47);
    expect(clampPpu('mine', 70)).toBe(60);
  });

  it('opens on the Yard from the surface (centred on a nearby Headframe) and on the mine underground', () => {
    expect(entryPlane(0.39)).toBe('yard');
    expect(entryPlane(-12)).toBe('mine');
    const ents = [{ kind: 'headframe' as const, plane: 'yard' as const, x: 26, y: 1, w: 2 }];
    expect(defaultCamera('yard', { podX: 22.5, podY: 0.4, entities: ents })).toEqual({ plane: 'yard', cx: 27, cy: 4, ppu: BUILD_ZOOM.yard.base, yaw: 0 });
    expect(defaultCamera('yard', { podX: 7.5, podY: 0.4, entities: ents }).cx).toBe(7.5);
    expect(defaultCamera('mine', { podX: 26.5, podY: -45.6, entities: ents })).toEqual({ plane: 'mine', cx: 26.5, cy: 45.6, ppu: 47, yaw: 0 });
  });

  it('keeps the centre on the plane (mine: seen rows + 4)', () => {
    const cam = { plane: 'mine' as const, cx: 60, cy: 200, ppu: 47, yaw: 0 as const };
    expect(clampCamera(cam, planeBounds('mine', 8, 50))).toMatchObject({ cx: 48, cy: 54 });
    expect(clampCamera({ ...cam, plane: 'yard', cy: -3 }, planeBounds('yard', 8, 0))).toMatchObject({ cy: 0 });
  });
});
