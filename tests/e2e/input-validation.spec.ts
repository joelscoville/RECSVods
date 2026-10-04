import { readFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { test, expect } from './fixtures';
import type { RecordingSource } from '../../site/lib/recording-schema';

test('YAML milliseconds render correctly and invalid precision is isolated to its recording @responsive', async ({ page, context }) => {
  const good = parse(readFileSync('services/2026-08-16.yaml', 'utf8')) as RecordingSource;
  good.recordingTitle = 'Valid millisecond recording'; good.status = 'draft'; good.uploads[1].uploadDuration = '30:02.801';
  const bad = structuredClone(good);
  bad.recordingTitle = 'Invalid precision recording'; bad.serviceDate = '2026-09-06'; bad.uploads[1].uploadDuration = '30:02.1234567890';
  const files: Record<string, string> = { 'services/2026-08-16.yaml': stringify(good), 'services/2026-09-06.yaml': stringify(bad),
    'taxonomy/topics.yaml': readFileSync('taxonomy/topics.yaml', 'utf8'), 'taxonomy/series.yaml': '[]' };
  await context.route('https://api.github.com/**', route => route.fulfill({ json: { tree: Object.keys(files).map(path => ({ path, type: 'blob' })) } }));
  await context.route('https://raw.githubusercontent.com/**', route => {
    const file = Object.keys(files).find(file => route.request().url().endsWith(file));
    return route.fulfill({ status: file ? 200 : 404, body: file ? files[file] : '' });
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('recs-recording-editor:v3:2026-08-16', '{}'));
  await page.goto('dev/');
  const valid = page.locator('.dev-card').filter({ hasText: good.recordingTitle });
  await expect(valid).toBeVisible(); await expect(valid).toContainText('1:33:01.801');
  const invalid = page.locator('.dev-card').filter({ hasText: 'services/2026-09-06.yaml' });
  await expect(invalid.getByRole('alert')).toContainText('uploads.1.uploadDuration');
  await expect(invalid.getByRole('alert')).toContainText('up to 9 fractional digits');
  await expect(invalid.getByRole('link', { name: 'File on GitHub', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('dev/edit/?id=2026-09-06');
  await expect(page.getByRole('alert')).toContainText('uploads.1.uploadDuration');
  await page.goto('dev/watch/?r=2026-09-06');
  await expect(page.getByRole('alert')).toContainText('uploads.1.uploadDuration');
  // Fixing the file and reloading recovers the listing without affecting the valid entry.
  bad.uploads[1].uploadDuration = '30:02.801'; files['services/2026-09-06.yaml'] = stringify(bad);
  await page.goto('dev/');
  await expect(page.locator('.dev-card').filter({ hasText: bad.recordingTitle })).toBeVisible();
  await expect(page.locator('.dev-card').filter({ hasText: good.recordingTitle })).toBeVisible();
  await expect(page.locator('.dev-card [role="alert"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
