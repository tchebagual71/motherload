// Visual regression (04 §11.4): surface play and underground r50 in both looks, frozen time, canvas only.
// Frozen time: the loop stops and the view is reached in fixed 60-Hz frames (__hf.freeze / frames), so the camera
// takes the same path on every machine. Baselines come only from CI (update-snapshots.yml in the pinned image);
// until a view has one, its test is skipped rather than failed, so the first run of that workflow can write them.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { existsSync } from 'node:fs';
import { bootGame, pressPlay } from './helpers';

/** 04 §11.4 Toon canvas thresholds (Pixel Lab's RT_B readback is compared the same way until readRT exists). The
 *  timeout covers SwiftShader working through the settle frames' queued GL work before the first capture. */
const SHOT = { maxDiffPixelRatio: 0.005, threshold: 0.15, timeout: 30_000 } as const;

function missingBaseline(testInfo: TestInfo, name: string): boolean {
  const updating = testInfo.config.updateSnapshots === 'all' || testInfo.config.updateSnapshots === 'changed';
  return !updating && !existsSync(testInfo.snapshotPath(name, { kind: 'screenshot' }));
}

/** Fixed frames after the jump (2 s): the camera's path and the chunks meshed are then the same on every run. */
const SETTLE_FRAMES = 120;

/** Stop the loop, go to the view, and let it settle in fixed frames. */
async function frozenView(page: Page, row: number | null): Promise<void> {
  await page.evaluate(
    ({ row, frames }) => {
      const hf = window.__hf!;
      hf.freeze();
      if (row !== null) hf.teleport(row);
      hf.frames(frames);
    },
    { row, frames: SETTLE_FRAMES },
  );
}

for (const look of ['toon', 'pixel'] as const) {
  for (const view of ['surface', 'r50'] as const) {
    const name = `${view}-${look}.png`;
    test(`${look} ${view} matches its baseline`, async ({ page, browserName }, testInfo) => {
      test.skip(browserName === 'webkit', 'No WebGL2 pixel compares on Linux WebKit (04 §11.5)');
      test.skip(missingBaseline(testInfo, name), 'No CI baseline yet: run update-snapshots.yml');
      await bootGame(page, `&look=${look}`);
      await pressPlay(page);
      await page.addStyleTag({ content: '#ui { visibility: hidden !important; }' });
      await frozenView(page, view === 'r50' ? 50 : null);
      await expect(page.locator('#game')).toHaveScreenshot(name, SHOT);
      await page.evaluate(() => window.__hf!.unfreeze());
    });
  }
}
