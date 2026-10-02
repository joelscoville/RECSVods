import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { performanceEvidence } from './performance-fixture';

export const noModel = process.env.RECS_E2E_NO_MODEL !== '0';
// Optional shared-Chrome execution: use the already running browser and let
// Playwright own only isolated test contexts, never the person's existing tabs.
export const browserTest = process.env.RECS_E2E_CHROME_PORT_FILE ? base.extend({
  browser: [async ({ playwright }, use) => {
    const [port, socket] = readFileSync(process.env.RECS_E2E_CHROME_PORT_FILE!, 'utf8').trim().split(/\r?\n/);
    const browser = await playwright.chromium.connectOverCDP(`ws://127.0.0.1:${port}${socket}`);
    await use(browser);
    await browser.close(); // Disconnects this CDP client; Chrome stays running.
  }, { scope: 'worker' }],
}) : base;
export const test = browserTest.extend({
  serviceWorkers: noModel ? 'block' : 'allow',
  page: async ({ page }, use) => {
    if (process.env.RECS_E2E_CHROME_PORT_FILE) await page.addInitScript(() => {
      // Exercise copy flows without changing the person's system clipboard.
      let text = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (value: string) => { text = value; }, readText: async () => text,
      } });
    });
    // UI regressions exercise full metadata/BSB deterministically. Adaptive policy has its own suite.
    await performanceEvidence(page);
    if (noModel) {
      // Ordinary UI checks never start inference. test:e2e:model explicitly selects it.
      await page.route('**/*semantic.worker*', route => route.abort());
      await page.route('**/models/**', route => route.abort());
    }
    await use(page);
  },
});
export { expect };
