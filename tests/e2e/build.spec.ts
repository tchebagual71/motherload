// Build mode (03 §4; canon §4.11) on a fresh MVP claim, driven by real CDP touch events (04 §11.3): BUILD on the
// Rim, a 3-tile belt painted from the rusted Headframe toward the Smelter, a Storage Bin placed and confirmed, undo
// and redo from the dock, ✕ Done; plus the 03 §13 two-pointer test (a second finger turns a stroke into the camera,
// nothing committed). Touches aim at cells through the renderer's cellToScreen, 44 pt below the lifted point.
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { bootGame, driveTo, pressPlay } from './helpers';

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

/** Drag through `pts` in ≤ 14-pt moves: the first leaves the 10-pt tap slop at once. */
async function drag(cdp: CDPSession, page: Page, pts: Pt[]): Promise<void> {
  await touch(cdp, 'touchStart', [pts[0]]);
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
async function fingersFor(page: Page, candidates: [number, number][][]): Promise<{ cells: [number, number][]; pts: Pt[] } | null> {
  return page.evaluate(
    ({ candidates, lift }) => {
      const hf = window.__hf!;
      const area = hf.build!.area;
      for (const cells of candidates) {
        const pts = cells.map(([x, y]) => {
          const s = hf.cellToScreen('yard', x, y);
          return { x: s.x, y: s.y + lift };
        });
        const ok = pts.every((p) => p.x > 8 && p.x < area.x1 - 8 && p.y > area.y0 + 8 && p.y < area.y1 - 12 && document.elementFromPoint(p.x, p.y)?.id === 'game');
        if (ok) return { cells, pts };
      }
      return null;
    },
    { candidates, lift: LIFT },
  );
}

const beltTiles = (page: Page): Promise<number> => page.evaluate(() => Array.from(window.__hf!.world.factory!.beltWords('yard')).filter((w) => w !== 0).length);
const bins = (page: Page): Promise<number> => page.evaluate(() => window.__hf!.world.factory!.entities().filter((e) => e.kind === 'bin').length);

/** A fresh claim with Belts and Bins unlocked (U2 stands in for the first lode), $2,020, in build mode on the Rim. */
async function enterBuildOnRim(page: Page, cdp: CDPSession): Promise<number> {
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
  // Park beside the Headframe (the play camera follows the pod; the build camera centres on the Headframe).
  await driveTo(page, x0 + 2);
  const context = page.locator('.hf-context[data-context="build"]');
  await expect(context).toBeVisible({ timeout: 10_000 });
  await tapSelector(cdp, page, '.hf-context[data-context="build"]');
  await expect.poll(() => page.evaluate(() => window.__hf!.mode())).toBe('build');
  await expect(page.locator('.hf-dock')).toBeVisible();
  await expect(page.locator('.hf-hud')).toHaveCount(0);
  // Build controls ignore the opening tap's trailing click for 400 ms.
  await page.waitForTimeout(450);
  return x0;
}

test('build mode on the Rim: paint belts, place a Bin, undo, redo and exit with real touches', async ({ page, context }) => {
  const { errors } = await bootGame(page);
  const cdp = await context.newCDPSession(page);
  const x0 = await enterBuildOnRim(page, cdp);
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
  const x0 = await enterBuildOnRim(page, cdp);
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
