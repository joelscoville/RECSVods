import { test as base, expect } from '@playwright/test';

export const noModel = process.env.RECS_E2E_NO_MODEL !== '0';
export const test = base.extend({
  page: async ({ page }, use) => {
    if (noModel) {
      // Ordinary UI checks never start inference. test:e2e:model explicitly selects it.
      await page.route('**/*semantic.worker*', route => route.abort());
      await page.route('**/models/**', route => route.abort());
    }
    await use(page);
  },
});
export { expect };
