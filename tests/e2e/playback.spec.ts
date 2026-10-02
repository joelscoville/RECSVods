import type { Page } from '@playwright/test';
import { test, expect, noModel } from './fixtures';
import { readFileSync } from 'node:fs';
import { fakeYouTube, player, previewUnits, readRecording, seconds, setPlayerTime } from './archive-fixtures';
import { browserEndpoints } from '../../scripts/testing-config';

// Built real archive is required; an empty or missing build fails rather than skips.
const scripture = JSON.parse(readFileSync('dist/preview/generated/scripture.json', 'utf8')) as { references: Record<string, string[]>; verses: Record<string, string> };
const august = readRecording('2026-08-16');
/** Where each upload starts on the recording clock. */
const uploadStarts = august.uploads.reduce<number[]>((list, _upload, i) => [...list, i ? list[i - 1] + seconds(august.uploads[i - 1].uploadDuration) - seconds(august.uploads[i - 1].uploadSkip ?? '0:00') : 0], []);
const chapterStart = (kind: string) => seconds(august.chapters.find(chapter => chapter.chapterKind === kind)!.chapterStart);
const failedId = 'wh4mCRKRJ-4';

test.beforeEach(async ({ context }) => {
  // No real YouTube, Bible API or model CDN network is needed; the IFrame API is faked per page.
  await context.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});
async function play(page: Page) {
  await page.locator('button.play-button').click();
  await expect.poll(async () => (await player(page))?.state).toBe(1);
}

test('live worker hybrid government query reaches the Romans 13 sermon in the top three', { tag: '@model' }, async ({ page, context }) => {
  test.skip(noModel, 'Actual model acceptance is local-only; CI performs no inference.');
  const modelRequests: string[] = [];
  context.on('request', (request) => { if (/\/(models|onnx)\//.test(request.url())) modelRequests.push(request.url()); });
  await page.goto(`search/?q=${encodeURIComponent('How should Christians relate to government?')}`);
  // This exact status is emitted only after real worker embedding and shared hybrid ranking.
  await expect(page.locator('.search-status').getByText(/^\d+ recordings? found\.$/)).toBeVisible({ timeout: 30_000 });
  const top = await page.locator('.recording-result').evaluateAll((items) => items.slice(0, 3).map((item) => (item as HTMLElement).dataset.service));
  expect(top, `Actual hybrid top 3: ${top.join(', ')}`).toContain('2020-09-27');
  expect(modelRequests.some((url) => url.endsWith('model_quantized.onnx'))).toBe(true);
  expect(modelRequests.every((url) => new URL(url).origin === new URL(browserEndpoints().preview).origin)).toBe(true);
  await expect(page.locator('.recording-result[data-service="2020-09-27"] .match-reasons')).toContainText(/Similar in meaning|Scripture|match/);
});

test('three uploads play as one recording: chapters reach the right upload, and each upload runs into the next', async ({ page }) => {
  await fakeYouTube(page);
  await page.goto('services/2026-08-16/');
  // The recording page links each YouTube part for anyone who prefers YouTube.
  const parts = page.locator('.service-recordings').getByRole('link', { name: 'Watch on YouTube', exact: true });
  expect(await parts.evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get('v'))))
    .toEqual(august.uploads.map(upload => upload.youtubeId));
  const sermon = august.chapters.find(chapter => chapter.chapterKind === 'sermon')!;
  await page.locator('.service-chapters .outline-list > .outline-item > .outline-entry a').filter({ hasText: sermon.chapterTitle }).click();
  await expect(page).toHaveURL(new RegExp(`watch/\\?r=2026-08-16&t=${Math.floor(chapterStart('sermon'))}&focus=${sermon.chapterId}$`));
  await play(page);
  // The sermon starts in the second upload (links carry whole seconds).
  await expect.poll(async () => (await player(page))?.videoId).toBe(august.uploads[1].youtubeId);
  expect((await player(page))!.time).toBeCloseTo(chapterStart('sermon') - uploadStarts[1], 1);
  // The closing is in the third: choosing it switches upload in the same player.
  await page.locator('.chapters button.chapter-row').filter({ hasText: 'Response and Closing' }).click();
  await expect.poll(async () => (await player(page))?.videoId).toBe(august.uploads[2].youtubeId);
  expect((await player(page))!.time).toBeCloseTo(chapterStart('closing') - uploadStarts[2], 1);
  await expect(page.locator('.chapters button.chapter-row[aria-current="true"]')).toContainText('Response and Closing');
  // When an upload ends, the next one carries on from its start.
  await page.locator('.chapters button.chapter-row').filter({ hasText: august.chapters[0].chapterTitle }).click();
  await expect.poll(async () => (await player(page))?.videoId).toBe(august.uploads[0].youtubeId);
  await page.evaluate(() => (window as unknown as { testPlayer: { change(state: number): void } }).testPlayer.change(0));
  await expect.poll(async () => (await player(page))?.videoId).toBe(august.uploads[1].youtubeId);
  expect((await player(page))!.time).toBe(seconds(august.uploads[1].uploadSkip ?? '0:00'));
  expect(await page.locator('.youtube-host iframe').count()).toBe(1);
});

test('Sermon only stops at the end of a sermon that crosses an upload; Full service starts at 0:00', async ({ page }) => {
  await fakeYouTube(page);
  await page.goto('watch/?r=2026-08-16');
  await play(page);
  await page.locator('.chapter-controls').getByRole('button', { name: 'Sermon only', exact: true }).click();
  await expect(page.locator('.chapter-controls [role="status"]')).toHaveText('Playback will stop at the end of the sermon.');
  // Play on past the end of the second upload, into the third, to the end of the sermon.
  await page.evaluate(() => (window as unknown as { testPlayer: { change(state: number): void } }).testPlayer.change(0));
  await expect.poll(async () => (await player(page))?.videoId).toBe(august.uploads[2].youtubeId);
  await setPlayerTime(page, chapterStart('closing') - uploadStarts[2]);
  await expect(page.getByText('Paused at the end of the sermon.')).toBeVisible();
  await page.locator('.chapter-controls').getByRole('button', { name: 'Full service instead', exact: true }).click();
  await expect(page).toHaveURL(/watch\/\?r=2026-08-16$/);
  await expect.poll(async () => (await player(page))?.videoId).toBe(august.uploads[0].youtubeId);
  expect((await player(page))!.time).toBe(0);
});

test('copying a link keeps the recording and the time', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Copy link is a desktop action');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => { document.documentElement.dataset.copied = value; } } });
  });
  await page.goto('watch/?r=2026-08-16&t=42');
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-copied', /watch\/\?r=2026-08-16&t=42$/);
});

test('browse pages and search show ESV references without hidden BSB text or Bible API requests', { tag: '@responsive' }, async ({ page, context }) => {
  const bibleRequests: string[] = [];
  context.on('request', (request) => { if (/esv\.org|bible\./i.test(new URL(request.url()).hostname)) bibleRequests.push(request.url()); });
  await page.route('**/models/**', (route) => route.abort());
  const government = readRecording('2020-09-27');
  for (const [route, heading] of [['scripture/romans', 'Romans'], [`topics/${government.sermonTopics![0]}`, undefined], ['years/2020', '2020']] as const) {
    const response = await page.goto(`browse/${route}/`);
    expect(response?.status()).toBe(200);
    if (heading) await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    // Category pages use the home card grid; every card opens its recording.
    expect(await page.locator('main .video-card a[href*="watch/?r=2020-09-27"]').count()).toBeGreaterThan(0);
    await expect(page.locator(`a[href*="${failedId}"]`)).toHaveCount(0);
  }
  await page.goto('search/');
  const input = page.locator('input[type="search"]:visible');
  await input.focus();
  await input.fill('living sacrifice');
  await expect(input).toBeFocused();
  // One result per recording, leading with the verse its words matched.
  const result = page.locator('.recording-result[data-service="2025-11-02"]');
  await expect(result).toBeVisible();
  await expect(result.locator('.match-reasons')).toContainText('Verse-text match (BSB)');
  const links = result.locator('.scripture a');
  const labels = await links.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')!.replace(/^Read (.*) in the ESV$/, '$1')));
  expect(scripture.verses[labels[0]]).toMatch(/living sacrifice/i);
  for (const [i, reference] of labels.entries()) {
    await expect(links.nth(i)).toHaveAttribute('href', `https://www.esv.org/${encodeURIComponent(reference)}/`);
    await expect(links.nth(i)).toContainText('(ESV)');
  }
  // BSB is search input only, never rendered.
  const text = await page.locator('main').textContent();
  for (const verse of Object.values(scripture.verses).filter((line) => line.length > 60)) expect(text).not.toContain(verse);
  expect(bibleRequests).toEqual([]);
});

test('new and returning home use local progress; clearing search history keeps it', { tag: '@responsive' }, async ({ page }) => {
  const latest = [...new Set(previewUnits.map(unit => unit.recordingId))].sort().at(-1)!;
  await page.goto('');
  await expect(page.getByRole('heading', { level: 1, name: 'Watch the latest sermon', exact: true })).toBeVisible();
  const featured = page.locator('section.featured');
  await expect(featured.getByText('Unreviewed preview', { exact: true })).toBeVisible();
  const featuredUrl = new URL((await featured.locator('a.video-card-link').getAttribute('href'))!, page.url());
  expect(featuredUrl.searchParams.get('r')).toBe(latest);
  const saved = { recordingId: '2026-09-06', time: 3200 };
  await page.evaluate((value) => {
    localStorage.setItem('recs-replay:resume:v2', JSON.stringify(value));
    localStorage.setItem('recs-replay:search-history:v1', JSON.stringify(['Romans 13', 'living sacrifice']));
  }, saved);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /Pick up where you left off|Continue watching/ })).toBeVisible();
  await expect(featured.locator('a.video-card-link')).toHaveAttribute('href', /watch\/\?r=2026-09-06&t=3200$/);
  await expect(featured.locator('.thumb-date')).toHaveText('Resume at 53:20');
  await page.goto('search/');
  await expect(page.getByRole('button', { name: 'Romans 13', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search history', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Search history cleared on this device. Playback progress is kept.' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('recs-replay:search-history:v1'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('recs-replay:resume:v2')!))).toEqual(saved);
  await fakeYouTube(page);
  await page.goto('');
  // The server renders the latest sermon first; wait for local progress to hydrate
  // before following the returning viewer's card.
  await expect(featured.locator('a.video-card-link')).toHaveAttribute('href', /watch\/\?r=2026-09-06&t=3200$/);
  await featured.locator('a.video-card-link').click();
  await expect(page).toHaveURL(/watch\/\?r=2026-09-06&t=3200$/);
  await play(page);
  expect((await player(page))!.time).toBe(3200);
});

test('the failed upload stays out of every link, and production shows only published recordings', async ({ page, request }) => {
  const index = await request.get('generated/chapters.json');
  expect(index.ok()).toBe(true);
  expect((await index.json()).units).toEqual(previewUnits);
  expect(new Set(previewUnits.map((unit) => unit.recordingId)).size).toBeGreaterThanOrEqual(20);
  for (const route of ['', 'browse/all/', 'services/2026-06-28/']) {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator(`a[href*="${failedId}"]`)).toHaveCount(0);
  }
  await page.goto('watch/?r=missing');
  await expect(page.getByRole('heading', { level: 1, name: 'Recording not found', exact: true })).toBeVisible();
  const production = browserEndpoints().production;
  const expected = previewUnits.filter((unit) => !unit.preview);
  expect((await (await request.get(`${production}generated/chapters.json`)).json()).units).toEqual(expected);
  await page.goto(production);
  if (!expected.length) {
    await expect(page.getByRole('heading', { level: 1, name: 'The archive is being prepared', exact: true })).toBeVisible();
    await expect(page.locator('a[href*="/watch/"]')).toHaveCount(0);
    expect((await request.get(`${production}services/2026-06-28/`)).status()).toBe(404);
  }
});
