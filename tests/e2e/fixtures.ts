import { test as base, expect } from '@playwright/test';

export const noModel = process.env.RECS_E2E_NO_MODEL === '1';
export const test = base.extend({
  page: async ({ page }, use) => {
    if (noModel) {
      // CI validates UI/exact search without running a model. Local acceptance
      // retains the real self-hosted worker tests with no flag.
      await page.route('**/*semantic.worker*', route => route.abort());
      await page.route('**/models/**', route => route.abort());
    }
    await use(page);
  },
});
export { expect };
