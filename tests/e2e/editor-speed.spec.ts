import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fakeYouTube, player, readRecording, seconds, uploadAt } from './archive-fixtures';

async function open(page: Page) {
  await page.addInitScript(() => localStorage.setItem('recs-chapter-editor:github-ready', '1'));
  await page.goto('edit/2026-08-16/');
  await expect(page.getByRole('group', { name: 'Playback speed', exact: true })).toBeVisible();
}
const speed = (page: Page, rate: number) => page.getByRole('group', { name: 'Playback speed', exact: true }).getByRole('button', { name: `${rate}×`, exact: true });
test.beforeEach(async ({ context }) => { await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()); });

test('speed chosen during loading is applied to actual playback and remains usable while paused @responsive', async ({ page, isMobile }) => {
  await fakeYouTube(page, { readyDelay: 1000 }); await open(page);
  await page.getByRole('button', { name: 'Load video', exact: true }).click();
  await expect(page.getByText('Loading the video…', { exact: true })).toBeVisible();
  if (isMobile) await speed(page, 2).tap(); else await speed(page, 2).click();
  await expect(page.locator('.ce-host iframe')).toBeVisible();
  await expect.poll(async () => (await player(page))?.rate).toBe(2);
  await expect(speed(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('toolbar').getByRole('button', { name: 'Pause', exact: true }).click();
  if (isMobile) await speed(page, 0.5).tap(); else await speed(page, 0.5).click();
  await expect.poll(async () => (await player(page))?.rate).toBe(0.5);
  expect((await player(page))!.state).toBe(2);
  await expect(speed(page, 0.5)).toHaveAttribute('aria-pressed', 'true');
  if (isMobile) for (const button of await page.getByRole('group', { name: 'Playback speed' }).getByRole('button').all()) {
    const box = (await button.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
test('speed survives a multipart upload resetting it after a seek @responsive', async ({ page }) => {
  await fakeYouTube(page); await open(page); await page.getByRole('button', { name: 'Load video', exact: true }).click();
  await expect(page.locator('.ce-host iframe')).toBeVisible();
  await speed(page, 1.5).click(); await expect.poll(async () => (await player(page))?.rate).toBe(1.5);
  const recording = readRecording('2026-08-16'), time = recording.uploads.slice(0, 2).reduce((total, upload) => total + seconds(upload.uploadDuration) - seconds(upload.uploadSkip ?? '0:00'), 0) + 10;
  await page.getByRole('button', { name: /^Playhead / }).click();
  await page.getByRole('textbox', { name: 'Go to time', exact: true }).fill(String(time));
  await page.getByRole('textbox', { name: 'Go to time', exact: true }).press('Enter');
  await expect.poll(async () => (await player(page))?.videoId).toBe(uploadAt('2026-08-16', time).id);
  await expect.poll(async () => (await player(page))?.rateRequests.filter(rate => rate === 1.5).length ?? 0).toBeGreaterThanOrEqual(3);
  await expect.poll(async () => (await player(page))?.rate).toBe(1.5);
  await expect(speed(page, 1.5)).toHaveAttribute('aria-pressed', 'true');
});
test('a rejected provider speed is reported rather than falsely marked active @responsive', async ({ page }) => {
  await fakeYouTube(page, { rejectRate: 2 }); await open(page); await page.getByRole('button', { name: 'Load video', exact: true }).click();
  await expect(page.locator('.ce-host iframe')).toBeVisible(); await speed(page, 2).click();
  await expect(page.getByRole('status').filter({ hasText: '2× could not be applied' })).toBeVisible();
  await expect(speed(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(speed(page, 2)).toHaveAttribute('aria-pressed', 'false');
  expect((await player(page))!.rate).toBe(1);
});

test('unsupported speeds are disabled using the provider rate list', async ({ page }) => {
  await fakeYouTube(page, { playbackRates: [1] }); await open(page);
  await page.getByRole('button', { name: 'Load video', exact: true }).click();
  await expect(page.locator('.ce-host iframe')).toBeVisible();
  for (const rate of [0.5, 1.5, 2]) await expect(speed(page, rate)).toBeDisabled();
  await expect(speed(page, 1)).toBeEnabled();
  await expect(speed(page, 1)).toHaveAttribute('aria-pressed', 'true');
});
