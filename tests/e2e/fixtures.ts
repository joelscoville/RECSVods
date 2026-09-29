import { test as base, expect } from '@playwright/test';
import { performanceEvidence } from './performance-fixture';

export const noModel = process.env.RECS_E2E_NO_MODEL !== '0';
export const test = base.extend({
  serviceWorkers: noModel ? 'block' : 'allow',
  page: async ({ page }, use) => {
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
