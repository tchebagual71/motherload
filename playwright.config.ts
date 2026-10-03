import { defineConfig, devices } from '@playwright/test';

// Chromium is pre-installed at /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH); @playwright/test 1.56.1 expects build 1194.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
  // iPhone SE (1st gen, 320 × 568: the narrowest layout), SE (3rd gen, 375 × 667 at DPR 2: the smallest current
  // target, 03 §1.5) and 15 (393 pt wide at DPR 3).
  projects: [
    { name: 'iphone-se', use: { ...devices['iPhone SE'], browserName: 'chromium', defaultBrowserType: 'chromium' } },
    { name: 'iphone-se-3', use: { ...devices['iPhone SE (3rd gen)'], browserName: 'chromium', defaultBrowserType: 'chromium' } },
    { name: 'iphone-15', use: { ...devices['iPhone 15'], browserName: 'chromium', defaultBrowserType: 'chromium' } },
  ],
});
