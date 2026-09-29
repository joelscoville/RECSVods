import { test, expect } from '@playwright/test';
import { performanceEvidence } from './performance-fixture';

test('data saver sends no optional requests and keeps exact search usable @responsive', async ({ page }, testInfo) => {
  await performanceEvidence(page, 'slow');
  const optional: string[] = [];
  page.on('request', request => { if (/\/(models|onnx)\/|\.woff2|scripture\.json|semantic\.worker|chapters\.json/.test(request.url())) optional.push(request.url()); });
  await page.goto('search/?q=Romans%2013');
  await expect(page.locator('html')).toHaveAttribute('data-data-mode', 'save-data');
  await expect(page.locator('.result-list')).toContainText('Authority');
  await expect(page.locator('.search-status')).toContainText('saving data');
  await expect(page.locator('html')).toHaveAttribute('data-essential-ready', 'true');
  await page.waitForTimeout(1200);
  expect(optional).toEqual([]);
  expect(await page.locator('.thumb-pattern').count()).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('saver-search.png'), fullPage: true });
});

test('low compute suppresses model and patterns independently of fast data @responsive', async ({ page }, testInfo) => {
  await performanceEvidence(page, 'fast', 'low');
  const optional: string[] = [];
  page.on('request', request => { if (/\/(models|onnx)\/|semantic\.worker|\.woff2/.test(request.url())) optional.push(request.url()); });
  await page.goto('');
  await expect(page.locator('html')).toHaveAttribute('data-compute-mode', 'low-compute');
  await page.waitForTimeout(1200);
  expect(optional).toEqual([]);
  await expect(page.locator('.video-card').first()).toBeVisible();
  expect(await page.locator('.thumb-pattern').count()).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('low-compute-home.png'), fullPage: true });
});

test('unknown bandwidth does not turn a cache-fast page into an automatic download', async ({ page }) => {
  await performanceEvidence(page, 'unknown');
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('');
  await expect(page.locator('html')).toHaveAttribute('data-essential-ready', 'true');
  await page.waitForTimeout(1200);
  await expect(page.locator('html')).toHaveAttribute('data-data-mode', 'unknown');
  expect(requests.filter(url => /semantic-sw|\/(models|onnx)\//.test(url))).toEqual([]);
});

test('fast home installs once; data saver uses the real cached model; low compute does not @model', async ({ page, context }) => {
  test.setTimeout(120_000);
  await performanceEvidence(page);
  const requests: string[] = [];
  context.on('request', request => requests.push(request.url()));
  await page.goto('');
  await expect(page.locator('html')).toHaveAttribute('data-semantic-cached', 'true', { timeout: 45_000 });
  expect(requests.filter(url => url.endsWith('model_quantized.onnx'))).toHaveLength(1);
  expect(requests.some(url => url.includes('semantic.worker'))).toBe(false);
  const coldCount = requests.length;
  await page.evaluate(() => sessionStorage.setItem('recs-performance:v1', JSON.stringify({ data: 'save-data', compute: 'normal' })));
  await page.goto('search/?q=Romans%2013');
  await expect(page.locator('.search-status')).toContainText('Cached meaning-based search is available');
  await expect(page.locator('.search-status')).not.toContainText('with exact search', { timeout: 30_000 });
  expect(requests.slice(coldCount).filter(url => url.endsWith('model_quantized.onnx'))).toHaveLength(0);
  expect(requests.slice(coldCount).some(url => url.includes('semantic.worker'))).toBe(true);
  const beforeLow = requests.length;
  await page.evaluate(() => sessionStorage.setItem('recs-performance:v1', JSON.stringify({ data: 'normal', compute: 'low-compute' })));
  await page.reload();
  await expect(page.locator('.search-status')).toContainText('optimized for this device');
  await expect(page.locator('.result-list')).toBeVisible();
  expect(requests.slice(beforeLow).some(url => url.includes('semantic.worker'))).toBe(false);
});

test('cached runtime eviction fails closed instead of downloading in data saver @model', async ({ page, context }) => {
  test.setTimeout(90_000);
  await performanceEvidence(page);
  await page.goto('');
  await expect(page.locator('html')).toHaveAttribute('data-semantic-cached', 'true', { timeout: 45_000 });
  await page.evaluate(() => sessionStorage.setItem('recs-performance:v1', JSON.stringify({ data: 'save-data', compute: 'normal' })));
  // Evict after the readiness check but before ONNX asks for the runtime.
  await page.route('**/*semantic.worker*', async route => {
    await page.evaluate(async () => {
      for (const name of await caches.keys()) if (name.startsWith('recs-semantic:')) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) if (request.url.endsWith('.wasm')) await cache.delete(request);
      }
    });
    await route.continue();
  });
  const responses: { url: string; status: number; cached: boolean }[] = [];
  context.on('response', response => { if (response.url().includes('.wasm')) responses.push({ url: response.url(), status: response.status(), cached: response.fromServiceWorker() }); });
  await page.goto('search/?q=Romans%2013');
  await expect(page.locator('.search-status')).toContainText('Meaning-based search is unavailable', { timeout: 30_000 });
  await expect(page.locator('.result-list')).toContainText('Authority');
  expect(responses.some(response => response.status === 503 && response.cached)).toBe(true);
  expect(responses.some(response => !response.cached)).toBe(false);
});

test('installation resumes across a full navigation without creating an inference worker @model', async ({ page, context }) => {
  test.setTimeout(90_000);
  await performanceEvidence(page);
  const modelRequest = context.waitForEvent('request', request => request.url().endsWith('model_quantized.onnx'));
  await page.goto('');
  await modelRequest;
  await page.goto('browse/all/');
  await expect(page.locator('html')).toHaveAttribute('data-semantic-cached', 'true', { timeout: 45_000 });
  expect(page.workers()).toHaveLength(0);
  await expect(page.locator('.video-card').first()).toBeVisible();
});
