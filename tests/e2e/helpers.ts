// Shared e2e helpers. The game exposes window.__hf with ?test=1 (src/debug/testHook.ts).
import { expect, type Page } from '@playwright/test';
import type {} from '../../src/debug/testHook';

/** Fixed seed, low tier, DPR 1 and standalone (Play instead of the install-first title), 04 §11.3. */
export const TEST_QUERY = '?test=1&seed=7&tier=low&dpr=1&standalone=1';
/** The same without the seed: boots whatever the (test-channel) store holds, as a relaunch does. */
export const SAVED_QUERY = '?test=1&tier=low&dpr=1&standalone=1';

export interface Booted {
  errors: string[];
}

export async function bootGame(page: Page, extra = '', query = TEST_QUERY): Promise<Booted> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`./${query}${extra}`);
  await page.waitForFunction(() => window.__hf?.ready === true, null, { timeout: 45_000 });
  return { errors };
}

/** Relaunch: navigate (pagehide → critical save) to the unseeded URL, which loads the stored save. */
export async function relaunch(page: Page): Promise<void> {
  await page.goto(`./${SAVED_QUERY}`);
  await page.waitForFunction(() => window.__hf?.ready === true, null, { timeout: 45_000 });
}

/** Hold the pod ("Tap to resume") so nothing but the step counter moves, then hash the world state. */
export async function holdAndHash(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hf = window.__hf!;
    hf.setIntent(null);
    hf.app.interrupt();
    return hf.stateHash();
  });
}

/** Dig straight down from the start until the pod is `rows` below where it began. */
export async function digDown(page: Page, rows: number): Promise<void> {
  const y0 = await page.evaluate(() => window.__hf!.pod().y);
  await page.evaluate(() => window.__hf!.setIntent({ sy: -1 }));
  await expect.poll(() => page.evaluate(() => window.__hf!.pod().y), { timeout: 20_000 }).toBeLessThan(y0 - rows);
  await page.evaluate(() => window.__hf!.setIntent(null));
}

export async function pressPlay(page: Page): Promise<void> {
  const title = page.locator('.hf-title');
  await expect(title).toBeVisible();
  await title.getByRole('button', { name: /^(Play|Continue)$/ }).click();
  await expect.poll(() => page.evaluate(() => window.__hf!.overlay())).toBeNull();
}

/** Distinct (5-bit quantised) colours in a screenshot of the canvas: a blank canvas has 1–2. */
export async function canvasColourCount(page: Page): Promise<number> {
  const png = await page.locator('#game').screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 53) seen.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3));
    return seen.size;
  }, png.toString('base64'));
}

/**
 * Drive to column centre `targetX` deterministically: a damped controller run in synchronous sim steps
 * through the test hook (headless SwiftShader frame rates would make a wall-clock controller oscillate).
 * Stops early if a Rim sheet opens (the pod is then paused). Resolves with the final pod x.
 */
export async function driveTo(page: Page, targetX: number, maxSteps = 1_800): Promise<number> {
  return page.evaluate(
    ({ targetX, maxSteps }) => {
      const hf = window.__hf!;
      for (let i = 0; i < maxSteps; i++) {
        const p = hf.pod();
        const dx = targetX - p.x;
        if ((Math.abs(dx) < 0.15 && Math.abs(p.vx) < 0.2) || hf.sheet() !== null) break;
        const sx = Math.max(-1, Math.min(1, dx * 0.9 - p.vx * 0.35));
        hf.setIntent({ sx: Math.abs(sx) < 0.06 ? 0 : sx });
        hf.step(1);
      }
      hf.setIntent({ sx: 0 });
      const p = hf.pod();
      if (Math.abs(targetX - p.x) > 0.6 && hf.sheet() === null) throw new Error(`driveTo(${targetX}) stopped at x=${p.x.toFixed(2)}`);
      return p.x;
    },
    { targetX, maxSteps },
  );
}
