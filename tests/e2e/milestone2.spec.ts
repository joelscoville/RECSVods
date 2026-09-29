import type { Page } from '@playwright/test';
import { test, expect, noModel } from './fixtures';
import { readFileSync, readdirSync } from 'node:fs';
import type { SearchChapter } from '../../site/lib/types';
import { chapterFor, chooseOnly, sermonEnd, readServiceFixture } from './archive-fixtures';
import { browserEndpoints } from '../../scripts/testing-config';

// Built real corpus is required; an empty or missing build fails rather than skips.
const passages = JSON.parse(readFileSync('dist/preview/generated/chapters.json', 'utf8')).chapters as SearchChapter[];
const scripture = JSON.parse(readFileSync('dist/preview/generated/scripture.json', 'utf8')) as { verses: Record<string, string> };
// The CLI validates these against the strict source schema. Keep browser fixtures
// free of build-only imports (including JSON modules handled by Astro/tsx).
const services = ['2026-09-06', '2026-08-16', '2026-06-28', '2020-09-27', '2025-11-02']
  .map((id) => readServiceFixture(`services/${id.slice(0, 4)}/${id}/service.yaml`));
const allSources = (readdirSync('services', { recursive: true }) as string[])
  .filter((file) => file.endsWith('/service.yaml'))
  .map((file) => readServiceFixture(`services/${file}`));
const latestSermon = allSources
  .filter((service) => ['needs_review', 'reviewed'].includes(service.editorial_status ?? ''))
  .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  .flatMap((service) => [...service.videos].sort((a, b) => a.sequence - b.sequence)
    .filter((video) => video.media_disposition === 'playable' && (service.type === 'sermon' || service.chapters.some((chapter) => chapter.video_id === video.id && chapter.type === 'sermon')))
    .map((video) => ({ service, video, sermon: service.chapters.find((chapter) => chapter.video_id === video.id && chapter.type === 'sermon') })))[0];
const august = services.find((service) => service.id === '2026-08-16')!;
const governmentIds = ['s0927-romans-order', 's0927-conclusion'].map(id => chapterFor(id).id);
const failedId = 'wh4mCRKRJ-4';
type TestPlayer = { videoId: string; time: number; state: number; pauses: number; ticks: number };
declare global { interface Window { testPlayer: TestPlayer; testVideoIds: string[] } }

async function mockYouTube(page: Page) {
  await page.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.testVideoIds=[];window.YT={Player:class{
      constructor(host,options){this.videoId=options.videoId;this.time=0;this.state=2;this.pauses=0;this.ticks=0;
        this.iframe=document.createElement('iframe');host.replaceWith(this.iframe);window.testPlayer=this;
        window.testVideoIds.push(options.videoId);setTimeout(()=>options.events.onReady({target:this}),0)}
      seekTo(time){this.time=time}playVideo(){this.state=1}pauseVideo(){this.state=2;this.pauses++}
      getCurrentTime(){this.ticks++;return this.time}getPlayerState(){return this.state}
      getIframe(){return this.iframe}destroy(){this.iframe.remove()}
    }};window.onYouTubeIframeAPIReady();`,
  }));
}
async function expectPlayer(page: Page, videoId: string, start: number) {
  await expect.poll(() => page.evaluate(() => window.testPlayer && ({ videoId: window.testPlayer.videoId, time: window.testPlayer.time, state: window.testPlayer.state })))
    .toEqual({ videoId, time: start, state: 1 });
}

test.beforeEach(async ({ context }) => {
  // No real YouTube, Bible API or model CDN network is needed. The one API fixture
  // is installed at page level; search model/ONNX requests remain real loopback.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
});

test('live worker hybrid government query reaches a relevant top-three chapter and its timestamp', { tag: '@model' }, async ({ page, context }) => {
  test.skip(noModel, 'Actual model acceptance is local-only; CI performs no inference.');
  const modelRequests: string[] = [];
  context.on('request', (request) => { if (/\/(models|onnx)\//.test(request.url())) modelRequests.push(request.url()); });
  await mockYouTube(page);
  await page.goto(`search/?q=${encodeURIComponent('How should Christians relate to government?')}`);
  // This exact status is emitted only after real worker embedding + shared hybrid ranking.
  await expect(page.locator('.search-status').getByText(/^\d+ recordings? found\.$/)).toBeVisible({ timeout: 30_000 });
  // Each recording result carries the chapter that ranked it.
  const topIds = await page.locator('.recording-result').evaluateAll((items) => items.slice(0, 3).map((item) => (item as HTMLElement).dataset.match));
  const accepted = topIds.find((id) => id && governmentIds.includes(id));
  expect(accepted, `Actual hybrid top 3: ${topIds.join(', ')}`).toBeTruthy();
  expect(modelRequests.some((url) => url.endsWith('model_quantized.onnx'))).toBe(true);
  expect(modelRequests.every((url) => new URL(url).origin === new URL(browserEndpoints().preview).origin)).toBe(true);
  const passage = passages.find((item) => item.id === accepted)!;
  expect(passage.serviceId).toBe('2020-09-27');
  const result = page.locator(`.recording-result[data-match="${accepted}"]`);
  await expect(result.locator('.match-reasons')).toContainText('Similar in meaning');
  await result.locator('h2 a').click();
  await expect(page).toHaveURL(new RegExp(`(chapter|match)=${accepted}$`));
  await page.getByRole('button', { name: `Play ${passage.serviceTitle}`, exact: true }).click();
  // The result opened the sermon; "Chapter only" reaches the chapter that ranked it.
  if (new URL(page.url()).searchParams.get('match') === accepted) await page.locator('.chapter-controls').getByRole('button', { name: 'Chapter only', exact: true }).click();
  await expectPlayer(page, passage.videoId, passage.start);
});

test('August ordered uploads, cross-upload chapters and chapter soft-stop use the correct physical IDs', async ({ page }) => {
  await mockYouTube(page);
  await page.goto('services/2026-08-16/');
  const uploads = page.getByRole('link', { name: 'Play full recording', exact: true });
  expect(await uploads.evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get('video'))))
    .toEqual(['mw4SAoJRZgo', 'XWAH9SWFcoo', 'IcIxBc--VvM']);
  await uploads.first().click();
  await page.reload();
  await page.locator('button.play-button, button.try-embedded').click();
  await expectPlayer(page, august.videos[0].id, 0);
  await expect(page).toHaveURL(/video=mw4SAoJRZgo$/);
  for (const video of august.videos.slice(1)) {
    const chapter = august.chapters.find((chapter) => chapter.video_id === video.id)!;
    const button = page.locator('.outline-list > .outline-item > .outline-entry button.chapter-row').filter({ has: page.getByText(chapter.title, { exact: true }), hasText: `Video ${video.sequence}` });
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'true');
    await expect(button).toContainText('Current chapter');
    await expect(page.locator('.youtube-host iframe')).toHaveCount(0);
    // A different upload remounts idle and requires Play; no automatic-play claim.
    await page.locator('button.play-button, button.try-embedded').click();
    await expectPlayer(page, video.id, chapter.start);
  }
  expect(await page.evaluate(() => window.testVideoIds)).toEqual(august.videos.map((video) => video.id));
  for (const video of august.videos) {
    const passage = passages.find((item) => item.serviceId === august.id && item.videoId === video.id)!;
    await page.goto(`watch/?chapter=${passage.id}`);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: passage.serviceTitle, exact: true })).toBeVisible();
    await expect(page.locator('.chapters .chapter-row[aria-current="true"]')).toContainText(passage.title);
    await page.locator('button.play-button, button.try-embedded').click();
    await expectPlayer(page, video.id, passage.start);
  }
  const last = passages.find((item) => item.videoId === august.videos[2].id)!;
  // A chapter link plays to the end of the service; "Chapter/Sermon only" brings the stop forward.
  const stopAt = await chooseOnly(page, last);
  await page.evaluate((end) => { window.testPlayer.time = end; }, stopAt);
  await expect(page.getByText(/^Paused at the end of (this chapter|the sermon)\.$/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep playing', exact: true }).click();
  await expect(page.getByText('Playing to the end of the recording.')).toBeVisible();
  const before = await page.evaluate(() => ({ pauses: window.testPlayer.pauses, ticks: window.testPlayer.ticks }));
  await page.evaluate((end) => { window.testPlayer.time = end + 5; }, stopAt);
  await expect.poll(() => page.evaluate(() => window.testPlayer.ticks)).toBeGreaterThan(before.ticks + 2);
  expect(await page.evaluate(() => ({ pauses: window.testPlayer.pauses, state: window.testPlayer.state }))).toEqual({ pauses: before.pauses, state: 1 });
});

test('selecting the current chapter restarts it without remounting YouTube', async ({ page }) => {
  const chapter = passages.find(item => !item.parentId)!;
  await mockYouTube(page);
  await page.goto(`watch/?chapter=${chapter.id}`);
  await page.locator('button.play-button, button.try-embedded').click();
  await expectPlayer(page, chapter.videoId, chapter.start);
  // Stop at this chapter's end, reach it, then pick the same chapter again from the outline.
  const stopAt = await chooseOnly(page, chapter);
  await page.evaluate(end => { window.testPlayer.time = end; }, stopAt);
  await expect(page.getByText(/^Paused at the end of (this chapter|the sermon)\.$/)).toBeVisible();
  await page.locator('.outline-list > .outline-item > .outline-entry button.chapter-row').filter({ has: page.getByText(chapter.title, { exact: true }) }).click();
  await expectPlayer(page, chapter.videoId, chapter.start);
  expect(await page.evaluate(() => window.testVideoIds)).toEqual([chapter.videoId]);
  await expect(page.getByText(/^Paused at the end of/)).toHaveCount(0);
});

test('Sermon only plays every sermon chapter and Full service instead starts at the first part', async ({ page }) => {
  await mockYouTube(page);
  // 13 September: the sermon is divided into several chapters; Sermon only must not stop after the first.
  const sermon = passages.filter(item => item.serviceId === '2026-09-13' && item.type === 'sermon' && !item.parentId).sort((a, b) => a.start - b.start)[0];
  const end = sermonEnd(sermon);
  expect(end).toBeGreaterThan(sermon.end);
  await page.goto(`watch/?chapter=${sermon.id}`);
  await page.locator('button.play-button, button.try-embedded').click();
  await expectPlayer(page, sermon.videoId, sermon.start);
  await page.locator('.chapter-controls').getByRole('button', { name: 'Sermon only', exact: true }).click();
  const ticks = await page.evaluate(time => { window.testPlayer.time = time; return window.testPlayer.ticks; }, sermon.end + 1);
  await expect.poll(() => page.evaluate(() => window.testPlayer.ticks)).toBeGreaterThan(ticks + 1);
  expect(await page.evaluate(() => window.testPlayer.state)).toBe(1);
  await page.evaluate(time => { window.testPlayer.time = time; }, end);
  await expect(page.getByText('Paused at the end of the sermon.')).toBeVisible();
  // 16 August: the sermon sits in part 2; the full service starts at the beginning of part 1.
  const partTwo = passages.find(item => item.videoId === 'XWAH9SWFcoo' && item.type === 'sermon' && !item.parentId)!;
  await page.goto(`watch/?chapter=${partTwo.id}`);
  await page.locator('button.play-button, button.try-embedded').click();
  await expectPlayer(page, 'XWAH9SWFcoo', partTwo.start);
  await page.locator('.chapter-controls').getByRole('button', { name: 'Full service instead', exact: true }).click();
  await expect(page).toHaveURL(/video=mw4SAoJRZgo$/);
  await page.locator('button.play-button, button.try-embedded').click();
  await expectPlayer(page, 'mw4SAoJRZgo', 0);
});

test('copying a full-recording resume link retains its timestamp', async ({ page, isMobile }) => {
  // Phones use the four-button action grid (subsections, full service, YouTube, correction) without Copy link.
  test.skip(isMobile, 'Copy link is a desktop action');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => { document.documentElement.dataset.copied = value; } } });
  });
  const chapter = passages[0];
  await page.goto(`watch/?service=${chapter.serviceId}&video=${chapter.videoId}&t=42.5`);
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-copied', new RegExp(`video=${chapter.videoId}&t=42$`));
});

test('static browse URLs and focused search display ESV references without hidden BSB text or Bible API requests', { tag: '@responsive' }, async ({ page, context }) => {
  const bibleRequests: string[] = [];
  context.on('request', (request) => { if (/esv\.org|bible\./i.test(new URL(request.url()).hostname)) bibleRequests.push(request.url()); });
  await page.route('**/models/**', (route) => route.abort());
  for (const [route, heading] of [['scripture/romans', 'Romans'], ['topics/government', 'Government'], ['years/2020', '2020']]) {
    const response = await page.goto(`browse/${route}/`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    // Category pages use the home card grid; every card opens its recording (at its sermon) directly.
    expect(await page.locator('main .video-card a[href*="chapter=c20200927-"]').count()).toBeGreaterThan(0);
    await expect(page.locator(`a[href*="${failedId}"]`)).toHaveCount(0);
  }
  await page.goto('search/');
  const input = page.locator('input[type="search"]:visible');
  await input.focus();
  await input.fill('living sacrifice');
  await expect(input).toBeFocused();
  expect(await input.evaluate((element) => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= window.innerHeight; })).toBe(true);
  const passage = passages.find((item) => item.id === 's1102-daily')!;
  // One result per recording; it shows the recording's best-matching chapter and that chapter's references.
  const result = page.locator(`.recording-result[data-service="${passage.serviceId}"]`);
  await expect(result).toBeVisible();
  await expect(result.locator('.match-reasons')).toContainText('Verse-text match (BSB)');
  const shownId = await result.getAttribute('data-match');
  const shown = passages.find((item) => item.id === shownId)!;
  // The result leads with the verse the words matched, narrowed from a passage the chapter cites.
  const links = result.locator('.scripture a');
  const labels = await links.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')!.replace(/^Read (.*) in the ESV$/, '$1')));
  const index = scripture as unknown as { references: Record<string, string[]>; verses: Record<string, string> };
  expect(shown.scripture.some((reference) => index.references[reference]?.includes(labels[0]))).toBe(true);
  expect(index.verses[labels[0]]).toMatch(/living sacrifice/i);
  for (const [i, reference] of labels.entries()) {
    await expect(links.nth(i)).toHaveAttribute('href', `https://www.esv.org/${encodeURIComponent(reference)}/`);
    await expect(links.nth(i)).toContainText('(ESV)');
  }
  expect(passage).not.toHaveProperty('verseText');
  // BSB is separately deduplicated search input, never rendered in the DOM.
  const text = await page.locator('main').textContent();
  for (const verse of Object.values(scripture.verses).filter((line) => line.length > 60)) expect(text).not.toContain(verse);
  expect(bibleRequests).toEqual([]);
});

test('new and returning home use local progress; clearing search history preserves resume', { tag: '@responsive' }, async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading', { level: 1, name: 'Watch the latest sermon', exact: true })).toBeVisible();
  const featured = page.locator('section.featured');
  const badge = featured.getByText('Unreviewed preview', { exact: true });
  if (latestSermon.service.editorial_status === 'needs_review') await expect(badge).toBeVisible();
  else await expect(badge).toHaveCount(0);
  const featuredUrl = new URL((await featured.locator('a.video-card-link').getAttribute('href'))!, page.url());
  if (latestSermon.sermon) expect(featuredUrl.searchParams.get('chapter')).toBe(latestSermon.sermon.id);
  else {
    expect(featuredUrl.searchParams.get('service')).toBe(latestSermon.service.id);
    expect(featuredUrl.searchParams.get('video')).toBe(latestSermon.video.id);
  }
  const saved = { serviceId: '2026-09-06', videoId: 'ZTDYIJUDb0M', time: 3200 };
  await page.evaluate((value) => {
    localStorage.setItem('recs-replay:resume:v1', JSON.stringify(value));
    localStorage.setItem('recs-replay:search-history:v1', JSON.stringify(['Romans 13', 'living sacrifice']));
  }, saved);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /Pick up where you left off|Continue watching/ })).toBeVisible();
  await expect(featured.locator('a.video-card-link')).toHaveAttribute('href', /video=ZTDYIJUDb0M&t=3200$/);
  await expect(featured.locator('.thumb-date')).toHaveText('Resume at 53:20');
  await expect(featured.locator('.card-metadata')).toContainText('Resume at 53:20');
  await page.goto('search/');
  await expect(page.getByRole('button', { name: 'Romans 13', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search history', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Search history cleared on this device. Playback progress is kept.' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('recs-replay:search-history:v1'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('recs-replay:resume:v1')!))).toEqual(saved);
  await page.goto('');
  await expect(featured.locator('a.video-card-link')).toHaveAttribute('href', /video=ZTDYIJUDb0M&t=3200$/);
  await mockYouTube(page);
  await featured.locator('a.video-card-link').click();
  await page.reload();
  await page.locator('button.play-button, button.try-embedded').click();
  await expectPlayer(page, saved.videoId, saved.time);
  await expect(page).toHaveURL(/video=ZTDYIJUDb0M&t=3200$/);
});

test('failed stream stays out of ordinary links/index and production excludes every unreviewed service', async ({ page, request }) => {
  const index = await request.get('generated/chapters.json');
  expect(index.ok()).toBe(true);
  expect((await index.json()).chapters).toEqual(passages);
  expect(passages.length).toBeGreaterThan(0);
  expect(passages.every((passage) => passage.videoId !== failedId)).toBe(true);
  expect(new Set(passages.map((passage) => passage.serviceId)).size).toBeGreaterThanOrEqual(5);
  for (const service of services) {
    const corePassages = passages.filter((passage) => passage.serviceId === service.id);
    expect(corePassages.length, `Required core service ${service.id}`).toBeGreaterThan(0);
    expect(corePassages.every((passage) => passage.preview === (service.editorial_status !== 'reviewed'))).toBe(true);
  }
  for (const route of ['', 'browse/all/', ...services.map((service) => `services/${service.id}/`)]) {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator(`a[href*="${failedId}"]`)).toHaveCount(0);
  }
  await page.goto('services/2026-06-28/');
  await expect(page.getByRole('link', { name: 'Play full recording', exact: true })).toHaveAttribute('href', /video=k27dmsPvmG8$/);
  await page.goto(`watch/?video=${failedId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Recording not found', exact: true })).toBeVisible();
  const production = browserEndpoints().production;
  const productionIndex = await request.get(`${production}generated/chapters.json`);
  expect(productionIndex.ok()).toBe(true);
  // The CLI independently verifies this built preview against public source metadata.
  // Human-approved chapters retain identical fields and preview:false in both modes.
  const expectedProduction = passages.filter((passage) => !passage.preview);
  expect((await productionIndex.json()).chapters).toEqual(expectedProduction);
  await page.goto(production);
  if (!expectedProduction.length) {
    await expect(page.getByRole('heading', { level: 1, name: 'The archive is being prepared', exact: true })).toBeVisible();
    await expect(page.locator('a[href*="/watch/"]')).toHaveCount(0);
  }
  for (const service of services) {
    const eligible = service.editorial_status === 'reviewed' && service.videos.some((video) => video.media_disposition === 'playable');
    expect((await request.get(`${production}services/${service.id}/`)).status()).toBe(eligible ? 200 : 404);
  }
});
