import { test, expect, noModel } from './fixtures';

test('meaning search verifies vectors without secure-context Web Crypto', async ({ page, context }) => {
  test.skip(noModel, 'Real model execution is checked locally.');
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(() => { Object.defineProperty(window.crypto, 'subtle', { value: undefined }); });
  await page.goto('search/?q=government');
  expect(await page.evaluate(() => window.crypto.subtle)).toBeUndefined();
  await expect(page.locator('.search-status').getByText(/^\d+ recordings? found\.$/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Meaning-based search is unavailable. Exact search still works.')).toHaveCount(0);
});
