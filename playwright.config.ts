import { defineConfig } from '@playwright/test';
import { browserEndpoints, browserWorkers } from './scripts/testing-config';

const { port, preview, production } = browserEndpoints();

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  // Tests own their pages, routes, storage and output paths. Build staging is prepared before this run.
  fullyParallel: true,
  workers: browserWorkers(),
  use: { baseURL: preview, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', grepInvert: /@model/, use: { viewport: { width: 1728, height: 1000 } } },
    { name: 'portrait', grep: /@responsive/, grepInvert: /@model/, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'landscape', grep: /@responsive/, grepInvert: /@model/, use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
    ...(process.env.RECS_E2E_NO_MODEL === '0' ? [{ name: 'model', grep: /@model/, workers: 1, use: { viewport: { width: 1728, height: 1000 } } }] : []),
  ],
  webServer: [
    // Foreground previews are owned by Playwright; Astro's agent auto-backgrounding must not detach them.
    { command: `pnpm exec astro preview --ignore-lock --host 127.0.0.1 --port ${port}`, env: { ARCHIVE_MODE: 'preview', SITE_BASE_PATH: '/replay-check/' }, url: preview, reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
    { command: `pnpm exec astro preview --ignore-lock --host 127.0.0.1 --port ${port + 1}`, env: { ARCHIVE_MODE: 'production', SITE_BASE_PATH: '/replay-check/' }, url: production, reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
  ],
});
