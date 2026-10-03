// Build mode (03 §4; canon §4.11) on a fresh MVP claim, driven by real CDP touch events (04 §11.3): BUILD where
// the claim starts (no parking: the Yard opens on Pip, 03 §4.1), one-finger pans to the rusted survey set, a 3-tile
// belt painted from the Headframe toward the Smelter, a Storage Bin placed and confirmed, undo and redo from the
// dock, ✕ Done; the 03 §13 two-pointer test (a second finger turns a stroke into the camera, nothing committed);
// and the BUILD-1 / BUILD-3 regressions (a finger resting before it paints; a pinch with one finger on the dock band).
// Touches aim at cells through the renderer's cellToScreen, 44 pt below the lifted point.
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { bootGame, pressPlay } from './helpers';

const LIFT = 44;

type Pt = { x: number; y: number };

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: (Pt & { id?: number })[]): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });
}

async function tap(cdp: CDPSession, page: Page, p: Pt): Promise<void> {
  await touch(cdp, 'touchStart', [p]);
  await page.waitForTimeout(50);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(120);
}

async function tapSelector(cdp: CDPSession, page: Page, selector: string): Promise<void> {
  const loc = page.locator(selector).first();
  await expect(loc).toBeVisible();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  await tap(cdp, page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

/** Drag through `pts` in ≤ 14-pt moves: the first leaves the 10-pt tap slop at once (after `holdMs` resting still). */
async function drag(cdp: CDPSession, page: Page, pts: Pt[], holdMs = 0): Promise<void> {
  await touch(cdp, 'touchStart', [pts[0]]);
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 14));
    for (let i = 1; i <= n; i++) {
      await touch(cdp, 'touchMove', [{ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }]);
      await page.waitForTimeout(16);
    }
  }
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(120);
}

/**
 * Finger points (44 pt under each Yard cell's centre) for the first candidate whose fingers all land on the canvas,
 * inside the world area and clear of the dock; null when none does.
 */
async function fingersFor(page: Page, candidates: [number, number][][], margin = 8): Promise<{ cells: [number, number][]; pts: Pt[] } | null> {
  return page.evaluate(
    ({ candidates, lift, m }) => {
      const hf = window.__hf!;
      const area = hf.build!.area;
      for (const cells of candidates) {
        const pts = cells.map(([x, y]) => {
          const s = hf.cellToScreen('yard', x, y);
          return { x: s.x, y: s.y + lift };
        });
        const ok = pts.every(
          (p) => p.x > area.x0 + m && p.x < area.x1 - m && p.y > area.y0 + m && p.y < area.y1 - Math.max(12, m) && document.elementFromPoint(p.x, p.y)?.id === 'game',
        );
        if (ok) return { cells, pts };
      }
      return null;
    },
    { candidates, lift: LIFT, m: margin },
  );
}

/** Clear of the 40-pt edge auto-pan margin (canon §3.12): a stroke there would scroll the view under the finger. */
const NO_EDGE_PAN = 48;

const beltTiles = (page: Page): Promise<number> => page.evaluate(() => Array.from(window.__hf!.world.factory!.beltWords('yard')).filter((w) => w !== 0).length);
const bins = (page: Page): Promise<number> => page.evaluate(() => window.__hf!.world.factory!.entities().filter((e) => e.kind === 'bin').length);

/**
 * Pan the build view with one-finger drags (no tool armed: a drag pans, 03 §4.2) until Yard cell (x, y) sits near
 * the middle of the world area.
 */
async function panToCell(page: Page, cdp: CDPSession, x: number, y: number): Promise<void> {
  for (let i = 0; i < 16; i++) {
    const g = await page.evaluate(
      ([x, y]) => {
        const hf = window.__hf!;
        const a = hf.build!.area;
        return { s: hf.cellToScreen('yard', x, y), c: { x: (a.x0 + a.x1) / 2, y: (a.y0 + a.y1) / 2 } };
      },
      [x, y] as const,
    );
    const dx = g.c.x - g.s.x;
    const dy = g.c.y - g.s.y;
    if (Math.hypot(dx, dy) < 40) return;
    const k = Math.min(1, 120 / Math.max(Math.abs(dx), Math.abs(dy)));
    const from = { x: g.c.x - (dx * k) / 2, y: g.c.y - (dy * k) / 2 };
    await drag(cdp, page, [from, { x: from.x + dx * k, y: from.y + dy * k }]);
  }
  throw new Error(`could not pan Yard cell ${x},${y} into view`);
}

/** A fresh claim with Belts and Bins unlocked (U2 stands in for the first lode), $2,020, in build mode where it starts. */
async function enterBuild(page: Page, cdp: CDPSession): Promise<number> {
  await pressPlay(page);
  const set = await page.evaluate(() => window.__hf!.world.factory!.entities().map((e) => ({ kind: e.kind, x: e.x, y: e.y, rusted: e.rusted })));
  // U0: the rusted survey set over Dot's shaft (02 §2.2): Headframe rows 1–2, Smelter rows 4–5, Bin rows 7–8.
  expect(set.map((e) => [e.kind, e.y, e.rusted])).toEqual([
    ['headframe', 1, true],
    ['smelter', 4, true],
    ['bin', 7, true],
  ]);
  await page.evaluate(() => {
    const hf = window.__hf!;
    hf.world.factory!.unlockRung('U2');
    hf.giveCash(2_000);
  });
  const x0 = set[0].x;
  // BUILD where the claim starts, far from the Headframe: no parking.
  const context = page.locator('.hf-context[data-context="build"]');
  await expect(context).toBeVisible({ timeout: 10_000 });
  await tapSelector(cdp, page, '.hf-context[data-context="build"]');
  await expect.poll(() => page.evaluate(() => window.__hf!.mode())).toBe('build');
  await expect(page.locator('.hf-dock')).toBeVisible();
  await expect(page.locator('.hf-hud')).toHaveCount(0);
  // 03 §4.1: the Yard opens on the Headframe within 12 columns of Pip, else on Pip.
  const view = await page.evaluate(() => ({ cam: window.__hf!.build!.cam, pod: window.__hf!.pod() }));
  const hfCentre = x0 + 1;
  expect(view.cam.plane).toBe('yard');
  expect(view.cam.cx).toBeCloseTo(Math.abs(hfCentre - view.pod.x) <= 12 ? hfCentre : view.pod.x, 3);
  // Build controls ignore the opening tap's trailing click for 400 ms.
  await page.waitForTimeout(450);
  await panToCell(page, cdp, x0 + 1, 4);
  return x0;
}

/** A point in the dock band between its buttons (the band shows the world through it but is not the canvas). */
async function dockGap(page: Page): Promise<Pt> {
  const gap = await page.evaluate(() => {
    const d = document.querySelector('.hf-dock')!.getBoundingClientRect();
    const y = d.top + d.height / 2;
    for (let x = 4; x < d.right - 4; x += 2) if (document.elementFromPoint(x, y)?.classList.contains('hf-dock')) return { x, y };
    return null;
  });
  expect(gap, 'a gap in the dock band').not.toBeNull();
  return gap!;
}

/** Two fingers spreading apart: `a` on the canvas, `b` wherever it lands. */
async function pinchOut(cdp: CDPSession, page: Page, a: Pt, b: Pt): Promise<void> {
  await touch(cdp, 'touchStart', [{ ...a, id: 1 }, { ...b, id: 2 }]);
  await page.waitForTimeout(30);
  for (let i = 1; i <= 8; i++) {
    await touch(cdp, 'touchMove', [
      { x: a.x + i * 3, y: a.y - i * 6, id: 1 },
      { x: b.x - i * 3, y: b.y + Math.min(i * 2, 10), id: 2 },
    ]);
    await page.waitForTimeout(20);
  }
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(200);
}

test('build mode: pan to the survey set, paint belts, place a Bin, undo, redo and exit with real touches', async ({ page, context }) => {
  const { errors } = await bootGame(page);
  const cdp = await context.newCDPSession(page);
  const x0 = await enterBuild(page, cdp);
  expect(await page.evaluate(() => window.__hf!.app.podRunning())).toBe(false);
  expect(await page.evaluate(() => window.__hf!.buildFrame()?.plane)).toBe('yard');

  // ---- Belt: 3 tiles from the Headframe toward the Smelter, the last one turning into the Smelter's input edge.
  await tapSelector(cdp, page, '[data-tool="belt"]');
  expect(await page.evaluate(() => window.__hf!.build!.tool)).toBe('belt');
  const path = await fingersFor(page, [
    [[x0 + 2, 2], [x0 + 2, 3], [x0 + 1, 3]],
    [[x0 - 1, 2], [x0 - 1, 3], [x0, 3]],
    [[x0 + 2, 3], [x0 + 1, 3], [x0, 3]],
    [[x0 - 1, 3], [x0, 3], [x0 + 1, 3]],
  ]);
  expect(path, 'a Headframe → Smelter path on screen').not.toBeNull();
  await drag(cdp, page, path!.pts);
  const pending = await page.evaluate(() => window.__hf!.build!.pending);
  expect(pending).toEqual({ t: 'path', cells: path!.cells.map(([x, y]) => ({ x, y })) });
  expect(await page.evaluate(() => window.__hf!.buildFrame()?.preview)).toMatchObject({ kind: 'belt', valid: true, dir: 1 });
  await expect(page.locator('.hf-pending')).toHaveText('$15 · 3 tiles');
  const cash0 = await page.evaluate(() => window.__hf!.cash());
  await tapSelector(cdp, page, '[data-dock="ok"]');
  expect(await beltTiles(page)).toBe(3);
  expect(await page.evaluate(() => window.__hf!.cash())).toBe(cash0 - 15);

  // ---- Storage Bin: ghost at the lifted point, then ✓.
  await tapSelector(cdp, page, '.hf-tab:has-text("Storage")');
  await tapSelector(cdp, page, '[data-tool="bin"]');
  // A tap on cell (x, y) centres the 2×2 ghost on the lifted point: its min corner lands on (x, y).
  const spots: [number, number][][] = [];
  for (const [dx, y] of [[3, 5], [-3, 5], [3, 6], [-3, 6], [4, 3], [-3, 3]]) spots.push([[x0 + dx, y]]);
  const free = await page.evaluate((s) => s.filter(([[x, y]]) => window.__hf!.world.factory!.canPlace('bin', 1, x, y, 1) === null), spots);
  const spot = await fingersFor(page, free);
  expect(spot, 'a free 2×2 Yard spot on screen').not.toBeNull();
  await tap(cdp, page, spot!.pts[0]);
  expect(await page.evaluate(() => window.__hf!.build!.pending)).toMatchObject({ t: 'piece', kind: 'bin', x: spot!.cells[0][0], y: spot!.cells[0][1] });
  expect(await page.evaluate(() => window.__hf!.build!.error)).toBeNull();
  await tapSelector(cdp, page, '[data-dock="ok"]');
  expect(await bins(page)).toBe(2);
  const cash1 = await page.evaluate(() => window.__hf!.cash());
  expect(cash1).toBe(cash0 - 15 - 250);

  // ---- Undo / redo from the dock (03 §4.8).
  await tapSelector(cdp, page, '[data-dock="undo"]');
  expect(await bins(page)).toBe(1);
  expect(await page.evaluate(() => window.__hf!.cash())).toBe(cash1 + 250);
  await expect(page.locator('.hf-toast').last()).toHaveText('Undid: Storage Bin (+$250)');
  await tapSelector(cdp, page, '[data-dock="redo"]');
  expect(await bins(page)).toBe(2);
  expect(await page.evaluate(() => window.__hf!.cash())).toBe(cash1);
  expect(await beltTiles(page)).toBe(3);

  // ---- ✕ Done: back to play; the pod runs again.
  await tapSelector(cdp, page, '[data-dock="done"]');
  await expect.poll(() => page.evaluate(() => window.__hf!.mode())).toBe('play');
  expect(await page.evaluate(() => window.__hf!.buildFrame())).toBeNull();
  await expect(page.locator('.hf-hud')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__hf!.app.podRunning())).toBe(true);
  expect(errors).toEqual([]);
});

test('a second finger during a stroke becomes the camera: nothing is committed (03 §13)', async ({ page, context }) => {
  const { errors } = await bootGame(page);
  const cdp = await context.newCDPSession(page);
  const x0 = await enterBuild(page, cdp);
  await tapSelector(cdp, page, '[data-tool="belt"]');
  const path = await fingersFor(page, [
    [[x0 + 2, 2], [x0 + 2, 3]],
    [[x0 - 1, 2], [x0 - 1, 3]],
    [[x0 - 1, 3], [x0, 3]],
  ]);
  expect(path).not.toBeNull();
  const [a, b] = path!.pts;
  await touch(cdp, 'touchStart', [{ ...a, id: 1 }]);
  await touch(cdp, 'touchMove', [{ x: a.x + (b.x - a.x) / 2, y: a.y + (b.y - a.y) / 2, id: 1 }]);
  // Second finger ~100 ms after the first.
  await page.waitForTimeout(60);
  const second = { x: Math.min(a.x + 90, 360), y: a.y - 60, id: 2 };
  await touch(cdp, 'touchStart', [{ ...b, id: 1 }, second]);
  await touch(cdp, 'touchMove', [{ x: b.x + 20, y: b.y, id: 1 }, { ...second, x: second.x + 30 }]);
  await touch(cdp, 'touchEnd', [{ ...second, x: second.x + 30 }]);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(150);
  expect(await beltTiles(page)).toBe(0);
  expect(await page.evaluate(() => window.__hf!.mode())).toBe('build');
  expect(await page.evaluate(() => window.__hf!.build!.tool)).toBe('belt');
  expect(errors).toEqual([]);
});

test('a finger resting before it paints still paints; a pinch with one finger on the dock band commits nothing (BUILD-1, BUILD-3)', async ({ page, context }) => {
  const { errors } = await bootGame(page);
  const cdp = await context.newCDPSession(page);
  const x0 = await enterBuild(page, cdp);
  await tapSelector(cdp, page, '[data-tool="belt"]');
  // Free rows 3 and 6 run between the survey Headframe, Smelter and Bin, through the middle of the view.
  const runs: [number, number][][] = [];
  for (const y of [3, 6, 2])
    for (const dx of [-1, 0, 1, -3, 3, -4, 4, -2, 2]) {
      const x = dx < 0 ? x0 + dx - 2 : x0 + dx;
      runs.push([[x, y], [x + 1, y], [x + 2, y]]);
    }
  const path = await fingersFor(page, runs, NO_EDGE_PAN);
  expect(path, 'a free 3-tile run on screen').not.toBeNull();

  // ---- BUILD-1: rest 600 ms to aim (past the 450-ms long-press), then drag: a stroke, not an inspect sheet.
  await drag(cdp, page, path!.pts, 600);
  expect(await page.evaluate(() => window.__hf!.build!.pending)).toEqual({ t: 'path', cells: path!.cells.map(([x, y]) => ({ x, y })) });
  expect(await page.evaluate(() => window.__hf!.build!.inspectId)).toBeNull();
  await tapSelector(cdp, page, '[data-dock="clear"]');
  expect(await page.evaluate(() => window.__hf!.build!.pending)).toBeNull();

  // ---- BUILD-3: finger 1 on the canvas, finger 2 in the dock band: the camera zooms, nothing is painted.
  const gap = await dockGap(page);
  const ppu0 = await page.evaluate(() => window.__hf!.build!.cam.ppu);
  await pinchOut(cdp, page, path!.pts[1], gap);
  expect(await page.evaluate(() => window.__hf!.build!.pending)).toBeNull();
  expect(await page.evaluate(() => window.__hf!.build!.cam.ppu)).toBeGreaterThan(ppu0);
  expect(await beltTiles(page)).toBe(0);

  // ---- …and under Instant build a Bin is not placed by it either.
  await page.evaluate(() => window.__hf!.app.updateSettings({ instantBuild: true }));
  await tapSelector(cdp, page, '.hf-tab:has-text("Storage")');
  await tapSelector(cdp, page, '[data-tool="bin"]');
  const cash = await page.evaluate(() => window.__hf!.cash());
  const at = await page.evaluate(() => {
    const a = window.__hf!.build!.area;
    return { x: (a.x0 + a.x1) / 2, y: a.y1 - 80 };
  });
  await pinchOut(cdp, page, at, await dockGap(page));
  expect(await bins(page)).toBe(1);
  expect(await page.evaluate(() => window.__hf!.cash())).toBe(cash);
  expect(await page.evaluate(() => window.__hf!.mode())).toBe('build');
  expect(errors).toEqual([]);
});
