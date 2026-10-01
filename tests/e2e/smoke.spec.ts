// M0 smoke (04 §11.3): boot without errors in both looks, HUD, a dig, the Pump House pad sheet (stays closed
// after closing), the A/B look switch and the upright card on rotation. Runs on the iPhone SE and iPhone 15
// projects; tests tagged @dom also run in the CI-only WebKit smoke.
import { expect, test } from '@playwright/test';
import { RIM_BUILDINGS, START_CASH, START_FUEL } from '../../src/shared/canon';
import { bootGame, canvasColourCount, driveTo, pressPlay } from './helpers';

const PUMP = RIM_BUILDINGS.find((b) => b.id === 'pump')!;
/** A blank or single-colour canvas quantises to a handful of colours; the world has dozens. */
const MIN_COLOURS = 16;

test('boots to the title, plays, and shows the HUD @dom', async ({ page, browserName }) => {
  const { errors } = await bootGame(page);
  await pressPlay(page);
  await expect(page.locator('.hf-hud')).toBeVisible();
  const start = await page.evaluate(() => ({ fuel: window.__hf!.pod().fuel, cash: window.__hf!.cash() }));
  expect(start.fuel).toBeCloseTo(START_FUEL, 1);
  expect(start.cash).toBe(START_CASH);
  // The Play tap is the unlock gesture (03 §11.1).
  if (browserName === 'chromium') await expect.poll(() => page.evaluate(() => window.__hf!.audioState())).toBe('running');
  expect(errors).toEqual([]);
});

test('exports a Perf Report code', async ({ page }) => {
  await bootGame(page);
  await pressPlay(page);
  await page.waitForTimeout(500);
  const code = await page.evaluate(() => window.__hf!.perfReport());
  expect(code).toMatch(/^HFP1:[A-Za-z0-9_-]+$/);
});

test('renders the world on the canvas', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'No WebGL2 pixel checks on Linux WebKit (04 §11.5)');
  await bootGame(page);
  await pressPlay(page);
  await expect.poll(() => canvasColourCount(page), { timeout: 15_000 }).toBeGreaterThan(MIN_COLOURS);
  const info = await page.evaluate(() => window.__hf!.renderInfo());
  expect(info.drawCalls).toBeGreaterThan(0);
});

test('digs down from the Rim', async ({ page }) => {
  await bootGame(page);
  await pressPlay(page);
  const y0 = await page.evaluate(() => window.__hf!.pod().y);
  await page.evaluate(() => window.__hf!.setIntent({ sy: -1 }));
  await expect.poll(() => page.evaluate(() => window.__hf!.pod().y), { timeout: 15_000 }).toBeLessThan(y0 - 1);
  await page.evaluate(() => window.__hf!.setIntent(null));
});

test('the Pump House sheet opens on its pad and stays closed after closing', async ({ page }) => {
  await bootGame(page);
  await pressPlay(page);
  await driveTo(page, (PUMP.x0 + PUMP.x1 + 1) / 2);
  // Stick neutral 0.3 s on the armed pad opens the sheet (canon §2.4).
  await expect.poll(() => page.evaluate(() => window.__hf!.sheet()), { timeout: 10_000 }).toBe('pump');
  const sheet = page.getByRole('dialog', { name: 'Pump House' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => page.evaluate(() => window.__hf!.sheet())).toBeNull();
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => window.__hf!.sheet())).toBeNull();
  await expect(page.locator('.hf-sheet')).toHaveCount(0);
  await page.evaluate(() => window.__hf!.setIntent(null));
});

test('switches between Clean Toon and Pixel Lab', async ({ page, browserName }, testInfo) => {
  test.skip(browserName === 'webkit', 'No WebGL2 pixel checks on Linux WebKit (04 §11.5)');
  await bootGame(page, '&look=toon');
  await pressPlay(page);
  for (const look of ['toon', 'pixel'] as const) {
    if ((await page.evaluate(() => window.__hf!.look())) !== look) {
      const chip = page.locator('.hf-style-chip');
      if (await chip.count()) await chip.click();
      else await page.evaluate((l) => window.__hf!.setLook(l), look);
    }
    await expect.poll(() => page.evaluate(() => window.__hf!.renderInfo().look)).toBe(look);
    await expect.poll(() => canvasColourCount(page), { timeout: 10_000 }).toBeGreaterThan(MIN_COLOURS);
    await testInfo.attach(`look-${look}.png`, { body: await page.screenshot(), contentType: 'image/png' });
  }
});

test('landscape shows the upright card and pauses; portrait asks to resume @dom', async ({ page }) => {
  await bootGame(page);
  await pressPlay(page);
  const portrait = page.viewportSize()!;
  await page.setViewportSize({ width: portrait.height, height: portrait.width });
  await expect(page.locator('.hf-upright')).toBeVisible();
  expect(await page.evaluate(() => window.__hf!.overlay())).toBe('upright');
  const step0 = await page.evaluate(() => window.__hf!.pod().x);
  await page.evaluate(() => window.__hf!.setIntent({ sx: 1 }));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__hf!.pod().x)).toBeCloseTo(step0, 3);
  await page.evaluate(() => window.__hf!.setIntent(null));

  await page.setViewportSize(portrait);
  await expect(page.locator('.hf-interrupt')).toBeVisible();
  // The card breathes forever (CSS animation), so skip the stability wait; the click still lands on it.
  await page.locator('.hf-resume-card').click({ force: true });
  await expect.poll(() => page.evaluate(() => window.__hf!.overlay())).toBeNull();
});
