// CI variant of playwright.config.ts (04 §11.3): serve the already-built dist/ (no rebuild) with `vite preview`
// under HF_BASE (e.g. /motherload/, exactly as Pages serves it), and add the CI-only WebKit smoke project.
// Usage: HF_BASE=/motherload/ npx playwright test -c tests/e2e/playwright.ci.config.ts --project=iphone-15
import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import base from '../../playwright.config';

const BASE = process.env.HF_BASE ?? '/';
const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  ...base,
  testDir: '.',
  outputDir: resolve(import.meta.dirname, '../../test-results'),
  reporter: [['list'], ['html', { open: 'never', outputFolder: resolve(import.meta.dirname, '../../playwright-report') }]],
  retries: process.env.CI ? 1 : 0,
  use: { ...base.use, baseURL: `${ORIGIN}${BASE}` },
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: resolve(import.meta.dirname, '../..'),
    url: `${ORIGIN}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    ...(base.projects ?? []),
    {
      // 04 §11.5: DOM-only checks on Linux WebKit (no WebGL pixel compares).
      name: 'webkit-smoke',
      grep: /@dom/,
      use: { ...devices['iPhone 15'], launchOptions: {} },
    },
  ],
});
