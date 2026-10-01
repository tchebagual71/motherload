// Render public/icon.svg to the PWA PNG icons with Playwright's Chromium (04 §9.1: 192, 512, maskable 512;
// apple-touch-icon 180). Run: node scripts/make-icons.mjs   (uses PLAYWRIGHT_BROWSERS_PATH if set)
// Outputs are committed to public/; re-run only when icon.svg changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/icon.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');

// Maskable: icon.svg is full-bleed and keeps Pip, the drill and the hole mouth within ~150 px of the centre,
// inside the 80% safe circle (radius 205 px at 512), so the same art serves; masks only trim the sun and ores.
const OUTPUTS = [
  { file: 'icon-192.png', size: 192, art: svg },
  { file: 'icon-512.png', size: 512, art: svg },
  { file: 'icon-maskable-512.png', size: 512, art: svg },
  { file: 'apple-touch-icon.png', size: 180, art: svg },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const o of OUTPUTS) {
    await page.setViewportSize({ width: o.size, height: o.size });
    const sized = o.art.replace(/width="512" height="512"/, `width="${o.size}" height="${o.size}"`);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#2b1e2f">${sized}</body></html>`);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: o.size, height: o.size }, omitBackground: false });
    writeFileSync(join(root, 'public', o.file), png);
    console.log(`public/${o.file} ${o.size}×${o.size}`);
  }
} finally {
  await browser.close();
}
