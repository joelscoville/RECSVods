import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173/replay-check/', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1728, height: 1000 } } },
    { name: 'portrait', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'landscape', use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    // Foreground previews are owned by Playwright; Astro's agent auto-backgrounding must not detach them.
    { command: 'pnpm exec astro preview --ignore-lock --host 127.0.0.1 --port 4173', env: { ARCHIVE_MODE: 'preview', SITE_BASE_PATH: '/replay-check/' }, url: 'http://127.0.0.1:4173/replay-check/', reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
    { command: 'pnpm exec astro preview --ignore-lock --host 127.0.0.1 --port 4174', env: { ARCHIVE_MODE: 'production', SITE_BASE_PATH: '/replay-check/' }, url: 'http://127.0.0.1:4174/replay-check/', reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
  ],
});
