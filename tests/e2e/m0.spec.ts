// M0 specs (04 §11.3): save → reload state hash, a death across a relaunch, a hidden-page save that survives a
// kill, the damaged-save fallback and its notice, context loss → same state hash, and the low-tier draw-call and
// triangle caps (canon §3.14) in both looks. Tests tagged @dom also run in the CI-only WebKit smoke (04 §11.5).
import { expect, test, type Page } from '@playwright/test';
import { bootGame, canvasColourCount, digDown, holdAndHash, pressPlay, relaunch, SAVED_QUERY } from './helpers';

/** Canon §3.14, low tier: draw calls peak 100, triangles 60k. */
const LOW_DRAW_CALLS_PEAK = 100;
const LOW_TRIANGLES = 60_000;
const MIN_COLOURS = 16;

test('a saved game reloads into the same state @dom', async ({ page }) => {
  await bootGame(page);
  await pressPlay(page);
  await digDown(page, 2);
  const hash = await holdAndHash(page);
  expect(await page.evaluate(() => window.__hf!.saveNow())).toBe(true);
  const before = await page.evaluate(() => window.__hf!.pod());

  await relaunch(page);
  expect(await page.evaluate(() => window.__hf!.overlay())).toBe('title');
  expect(await page.evaluate(() => window.__hf!.stateHash())).toBe(hash);
  const after = await page.evaluate(() => window.__hf!.pod());
  expect(after).toEqual(before);
  await expect(page.locator('.hf-title').getByRole('button', { name: 'Continue' })).toBeVisible();
});

test('dying, then relaunching during the death card, still salvages and respawns on the Pump House pad @dom', async ({ page }) => {
  await bootGame(page);
  await pressPlay(page);
  // Run the tank dry in mid-air: canon §4.2 destruction → the 3 s death card (a critical save of the wreck).
  await page.evaluate(() => {
    const hf = window.__hf!;
    (hf.world.pod as { fuel: number }).fuel = 0.01;
    hf.setIntent({ sy: 1 });
  });
  await expect.poll(() => page.evaluate(() => window.__hf!.overlay()), { timeout: 10_000 }).toBe('death');
  expect(await page.evaluate(() => window.__hf!.pod().destroyed)).toBe(true);

  // Swipe home and get killed, or reload, before the card ends.
  await relaunch(page);
  expect(await page.evaluate(() => window.__hf!.pod().destroyed)).toBe(true);
  await page.locator('.hf-title').getByRole('button', { name: /^(Play|Continue)$/ }).click();
  await expect.poll(() => page.evaluate(() => window.__hf!.overlay()), { timeout: 10_000 }).toBe('death');
  await expect.poll(() => page.evaluate(() => window.__hf!.pod().destroyed), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__hf!.overlay())).toBeNull();
  const p = await page.evaluate(() => ({ pad: window.__hf!.world.padUnderPod(), pod: window.__hf!.pod() }));
  expect(p.pad).toBe('pump');
  expect(p.pod.fuel).toBeGreaterThan(0);

  // Playable again: the stick moves the pod.
  await page.evaluate(() => window.__hf!.setIntent({ sx: 1 }));
  await expect.poll(() => page.evaluate(() => window.__hf!.pod().x), { timeout: 10_000 }).toBeGreaterThan(p.pod.x + 0.5);
  await page.evaluate(() => window.__hf!.setIntent(null));
});

test('the hidden-page save survives a kill that never fires pagehide', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Page.crash is a Chromium DevTools command');
  await bootGame(page);
  await pressPlay(page);
  await digDown(page, 2);
  const hash = await holdAndHash(page);
  // visibilitychange → hidden (home swipe): the critical save runs inside the event (canon §3.15).
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  // Then the OS kills the process: no pagehide, no unload.
  await kill(page);

  const next = await page.context().newPage();
  await next.goto(`./${SAVED_QUERY}`);
  await next.waitForFunction(() => window.__hf?.ready === true, null, { timeout: 45_000 });
  expect(await next.evaluate(() => window.__hf!.stateHash())).toBe(hash);
});

/** The OS kills the tab: no pagehide, so nothing more is written. */
async function kill(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await Promise.race([cdp.send('Page.crash').catch(() => undefined), page.waitForEvent('crash')]);
}

test('a torn newest save falls back to the older copy, and the notice shows after Play', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Page.crash is a Chromium DevTools command');
  await bootGame(page);
  await pressPlay(page);
  expect(await page.evaluate(() => window.__hf!.saveNow())).toBe(true);
  const older = await holdAndHash(page);
  await page.evaluate(() => window.__hf!.app.resume());
  await digDown(page, 2);
  expect(await page.evaluate(() => window.__hf!.saveNow())).toBe(true);
  await page.waitForTimeout(300);
  await kill(page);

  // Tear the newest copy's CRC from a same-origin page that does not boot the game.
  const next = await page.context().newPage();
  await next.goto('./icon.svg');
  await next.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open('holefactory');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('test.files', 'readwrite');
    const files = tx.objectStore('test.files');
    type Rec = { seq: number; crc: number };
    const get = (k: string): Promise<Rec | undefined> =>
      new Promise((r) => (files.get(k).onsuccess = (e) => r((e.target as IDBRequest<Rec | undefined>).result)));
    const [a, b] = [await get('slot1/a'), await get('slot1/b')];
    const [key, rec] = (a?.seq ?? -1) > (b?.seq ?? -1) ? ['slot1/a', a!] : ['slot1/b', b!];
    files.put({ ...rec, crc: rec.crc ^ 1 }, key);
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  });

  await next.goto(`./${SAVED_QUERY}`);
  await next.waitForFunction(() => window.__hf?.ready === true, null, { timeout: 45_000 });
  expect(await next.evaluate(() => window.__hf!.stateHash())).toBe(older);
  // Behind the title the toast layer is hidden: the notice waits for Play, then shows whole (≤ 40 characters).
  await next.waitForTimeout(3_000);
  await next.locator('.hf-title').getByRole('button', { name: /^(Play|Continue)$/ }).click();
  await expect(next.locator('.hf-toast')).toHaveText('Damaged save: loaded copy 1 min older');
});

test('reloading twice before the first frame is not a crash: no Safe Mode @dom', async ({ page, context }) => {
  await bootGame(page);
  await pressPlay(page);
  expect(await page.evaluate(() => window.__hf!.saveNow())).toBe(true);
  // A slow first frame (shader compile on a phone): rAF callbacks wait 3 s, so the player can leave first.
  await context.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const t0 = performance.now();
    const slow = (cb: FrameRequestCallback): number => (performance.now() - t0 < 3_000 ? window.setTimeout(() => slow(cb), 50) : raf(cb));
    window.requestAnimationFrame = slow;
  });
  for (let i = 0; i < 2; i++) {
    await page.goto(`./${SAVED_QUERY}`, { waitUntil: 'commit' });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('hf-test.boot') ?? 'null')?.phase === 'load', null, { polling: 20 });
  }
  await relaunch(page);
  expect(await page.evaluate(() => window.__hf!.overlay())).toBe('title');
  await expect(page.locator('.hf-safemode')).toHaveCount(0);
});

test('context loss pauses the pod and restores the same state', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'No WebGL2 pixel checks on Linux WebKit (04 §11.5)');
  await bootGame(page);
  await pressPlay(page);
  await digDown(page, 1);
  const hash = await holdAndHash(page);
  await page.evaluate(() => window.__hf!.app.resume());
  await expect.poll(() => page.evaluate(() => window.__hf!.overlay())).toBeNull();

  expect(await page.evaluate(() => window.__hf!.loseContext())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__hf!.contextLost())).toBe(true);
  await page.evaluate(() => window.__hf!.setIntent({ sx: 1 }));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__hf!.app.podRunning())).toBe(false);
  await page.evaluate(() => window.__hf!.setIntent(null));

  expect(await page.evaluate(() => window.__hf!.restoreContext())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__hf!.contextLost()), { timeout: 10_000 }).toBe(false);
  // Restored: "Tap to resume" (canon §4.5), and nothing moved meanwhile.
  await expect.poll(() => page.evaluate(() => window.__hf!.overlay())).toBe('interrupt');
  expect(await page.evaluate(() => window.__hf!.stateHash())).toBe(hash);
  await page.locator('.hf-resume-card').click({ force: true });
  await expect.poll(() => page.evaluate(() => window.__hf!.overlay())).toBeNull();
  await expect.poll(() => canvasColourCount(page), { timeout: 15_000 }).toBeGreaterThan(MIN_COLOURS);
});

for (const look of ['toon', 'pixel'] as const) {
  test(`${look}: draw calls and triangles stay within the low-tier caps, surface and r50`, async ({ page }) => {
    await bootGame(page, `&look=${look}`);
    await pressPlay(page);
    await expect.poll(() => page.evaluate(() => window.__hf!.renderInfo().look)).toBe(look);
    const views: Record<string, { drawCalls: number; triangles: number }> = {};
    for (const [name, row] of [
      ['surface', null],
      ['r50', 50],
    ] as const) {
      if (row !== null) await page.evaluate((r) => window.__hf!.teleport(r), row);
      await page.waitForTimeout(800);
      views[name] = await page.evaluate(() => window.__hf!.renderInfo());
    }
    for (const [name, info] of Object.entries(views)) {
      expect(info.drawCalls, `${name} draw calls`).toBeGreaterThan(0);
      expect(info.drawCalls, `${name} draw calls`).toBeLessThanOrEqual(LOW_DRAW_CALLS_PEAK);
      expect(info.triangles, `${name} triangles`).toBeLessThanOrEqual(LOW_TRIANGLES);
    }
  });
}
