import { stringify } from 'yaml';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fakeYouTube, player } from './archive-fixtures';

async function fixture(page: Page, missing = [1]) {
  const ids = ['AVAILABLE01', 'MISSING0001', 'AVAILABLE02'];
  const recording = { recordingTitle: 'Unavailable span fixture', serviceDate: '2026-09-06', status: 'draft',
    uploads: ids.map((youtubeId, i) => ({ youtubeId, uploadDuration: i === 2 ? '1:05' : '1:00', ...(i === 2 ? { uploadSkip: '0:05' } : {}), ...(missing.includes(i) ? { uploadUnavailable: true } : {}) })),
    chapters: ['First', 'Middle', 'Last'].map((title, i) => ({ chapterId: title.toLowerCase(), chapterTitle: title, chapterKind: 'other', chapterStart: `${i}:00`, chapterEnd: `${i + 1}:00` })) };
  const files: Record<string, string> = { 'services/2026-09-06.yaml': stringify(recording), 'taxonomy/topics.yaml': '[]', 'taxonomy/series.yaml': '[]' };
  await page.context().route('https://api.github.com/**', route => route.fulfill({ json: { tree: Object.keys(files).map(path => ({ path, type: 'blob' })) } }));
  await page.context().route('https://raw.githubusercontent.com/**', route => {
    const file = Object.keys(files).find(name => route.request().url().endsWith(name));
    return route.fulfill({ status: file ? 200 : 404, body: file ? files[file] : '' });
  });
  await fakeYouTube(page);
}
test.beforeEach(async ({ context }) => { await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()); });

test('watch opens an unavailable timestamp without contacting YouTube and navigates on the original clock', async ({ page }) => {
  await fixture(page);
  const media: string[] = []; page.on('request', request => { if (/youtube/.test(request.url())) media.push(request.url()); });
  await page.goto('dev/watch/?r=2026-09-06&t=75');
  await expect(page.getByRole('heading', { name: 'This part is unavailable' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('1:00–2:00');
  expect(media).toEqual([]);
  await expect(page.getByRole('link', { name: 'Watch on YouTube', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Next available part/ }).click();
  await expect(page).toHaveURL(/t=120/);
  await page.getByRole('button', { name: 'Play Unavailable span fixture' }).click();
  await expect.poll(async () => (await player(page))?.videoId).toBe('AVAILABLE02');
  expect((await player(page))!.time).toBe(5);
});
test('playback reaching a missing middle upload stops and resumes only through explicit navigation', async ({ page }) => {
  await fixture(page); await page.goto('dev/watch/?r=2026-09-06');
  await page.getByRole('button', { name: 'Play Unavailable span fixture' }).click();
  await expect.poll(async () => (await player(page))?.state).toBe(1);
  await page.evaluate(() => (window as unknown as { testPlayer: { change(state: number): void } }).testPlayer.change(0));
  await expect(page.getByRole('heading', { name: 'This part is unavailable' })).toBeVisible();
  expect((await player(page))!.loads).toEqual(['AVAILABLE01']);
  await page.getByRole('button', { name: /^Next available part/ }).click();
  await expect.poll(async () => (await player(page))?.videoId).toBe('AVAILABLE02');
  expect((await player(page))!.time).toBe(5);
  expect((await player(page))!.loads).not.toContain('MISSING0001');
});
test('editor exposes unavailable spans and retains exact recording time when navigating', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => localStorage.setItem('recs-chapter-editor:github-ready', '1'));
  await page.goto('dev/edit/?id=2026-09-06&t=75');
  await expect(page.getByRole('heading', { name: 'This part is unavailable' })).toBeVisible();
  await expect(page.getByLabel('Playhead', { exact: true })).toHaveText('1:15');
  await expect(page.getByRole('toolbar').getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Next available part/ }).click();
  await expect(page.getByLabel('Playhead', { exact: true })).toHaveText('2:00');
  await page.getByRole('button', { name: 'Load video', exact: true }).click();
  await expect.poll(async () => (await player(page))?.videoId).toBe('AVAILABLE02');
  expect((await player(page))!.time).toBe(5);
});
test('entirely unavailable recordings have a terminal message and no misleading play or navigation actions', async ({ page }) => {
  await fixture(page, [0, 1, 2]); await page.goto('dev/watch/?r=2026-09-06&t=140');
  await expect(page.getByText('No uploads in this recording are currently available.')).toBeVisible();
  await expect(page.getByRole('button', { name: /available part/ })).toHaveCount(0);
  await expect(page.locator('button.play-button, iframe')).toHaveCount(0);
});
