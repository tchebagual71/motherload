// MVP audio (03 §11, 04 §8) in Chromium: nothing before the unlock gesture, Kettle On scheduled after it and gone by
// r64, ambience by depth, hidden → suspended → resumed only by the resuming tap, the Music setting, and no errors.
import { expect, test, type Page } from '@playwright/test';
import type { AudioDebugInfo } from '../../src/audio/engine';
import { bootGame, pressPlay } from './helpers';

declare global {
  interface Window {
    __hfAudio?: { debugInfo(): AudioDebugInfo; speak(sender: string, text: string): void };
  }
}

const info = (page: Page): Promise<AudioDebugInfo> => page.evaluate(() => window.__hfAudio!.debugInfo());

async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((vis) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test.skip(({ browserName }) => browserName !== 'chromium', 'AudioContext runs headless in Chromium only');

test('unlocks on Play, plays Kettle On and fades it with depth', async ({ page }) => {
  const { errors } = await bootGame(page);
  expect(await page.evaluate(() => window.__hf!.audioState())).toBe('none');
  await pressPlay(page);
  await expect.poll(() => page.evaluate(() => window.__hf!.audioState())).toBe('running');
  await expect.poll(async () => (await info(page)).notesPlayed, { timeout: 10_000 }).toBeGreaterThan(4);
  const surface = await info(page);
  expect(surface).toMatchObject({ musicPlaying: true, clock: true });
  expect(surface.ambience.wind).toBeGreaterThan(0);
  expect(surface.voices).toBeLessThanOrEqual(16);

  await page.evaluate(() => window.__hf!.teleport(100));
  await expect.poll(async () => (await info(page)).musicPlaying, { timeout: 10_000 }).toBe(false);
  expect((await info(page)).ambience.earth).toBeGreaterThan(0);

  await page.evaluate(() => window.__hfAudio!.speak('Dot', 'Hello Pip.'));
  await expect.poll(async () => (await info(page)).speaking).toBe(true);
  expect(errors).toEqual([]);
});

test('suspends when hidden and resumes only on the resuming tap', async ({ page }) => {
  const { errors } = await bootGame(page);
  await pressPlay(page);
  await expect.poll(() => page.evaluate(() => window.__hf!.audioState())).toBe('running');
  await setVisibility(page, 'hidden');
  await expect.poll(() => page.evaluate(() => window.__hf!.audioState())).toBe('suspended');
  await setVisibility(page, 'visible');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__hf!.audioState())).toBe('suspended');
  await page.locator('.hf-resume-card').click({ force: true });
  await expect.poll(() => page.evaluate(() => window.__hf!.audioState())).toBe('running');
  await expect.poll(async () => (await info(page)).clock).toBe(true);
  expect(errors).toEqual([]);
});

test('the Music switch stops the song and keeps the rest', async ({ page }) => {
  await bootGame(page);
  await pressPlay(page);
  await expect.poll(async () => (await info(page)).musicPlaying, { timeout: 10_000 }).toBe(true);
  await page.evaluate(() => window.__hf!.app.openSheet('settings'));
  const music = page.getByRole('switch', { name: /Music/ });
  await music.click();
  await expect(music).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await info(page)).musicPlaying, { timeout: 10_000 }).toBe(false);
  expect((await info(page)).ambience.wind).toBeGreaterThan(0);
});
