import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import type { SearchPassage, ServiceSource } from '../../site/lib/types';

// Built real corpus is required; an empty or missing build fails rather than skips.
const passages = JSON.parse(readFileSync('dist/preview/generated/passages.json', 'utf8')) as SearchPassage[];
// The CLI validates these against the strict source schema. Keep browser fixtures
// free of build-only imports (including JSON modules handled by Astro/tsx).
const services = ['2026-09-06', '2026-08-16', '2026-06-28', '2020-09-27', '2025-11-02']
  .map((id) => parse(readFileSync(`services/${id.slice(0, 4)}/${id}/service.yaml`, 'utf8')) as ServiceSource);
const allSources = (readdirSync('services', { recursive: true }) as string[])
  .filter((file) => file.endsWith('/service.yaml'))
  .map((file) => parse(readFileSync(`services/${file}`, 'utf8')) as ServiceSource);
const latestSermon = allSources
  .filter((service) => ['needs_review', 'reviewed'].includes(service.editorial_status ?? ''))
  .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  .flatMap((service) => [...service.videos].sort((a, b) => a.sequence - b.sequence)
    .filter((video) => video.media_disposition === 'playable' && (service.type === 'sermon' || service.sections.some((section) => section.video_id === video.id && section.type === 'sermon')))
    .map((video) => ({ service, video, sermon: service.sections.find((section) => section.video_id === video.id && section.type === 'sermon') })))[0];
const august = services.find((service) => service.id === '2026-08-16')!;
const governmentIds = ['p0927-romans-government', 'p0927-government-allegiance'];
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

test('live worker hybrid government query reaches a relevant top-three passage and its timestamp', async ({ page, context }) => {
  const modelRequests: string[] = [];
  context.on('request', (request) => { if (/\/(models|onnx)\//.test(request.url())) modelRequests.push(request.url()); });
  await mockYouTube(page);
  await page.goto(`search/?q=${encodeURIComponent('How should Christians relate to government?')}`);
  // This exact status is emitted only after real worker embedding + shared hybrid ranking.
  await expect(page.locator('.search-status').getByText(/^\d+ passages? found\.$/)).toBeVisible({ timeout: 30_000 });
  const links = page.locator('.result-list > li').getByRole('link', { name: 'Play passage', exact: true });
  const topIds = (await links.evaluateAll((items) => items.slice(0, 3).map((item) => new URL((item as HTMLAnchorElement).href).searchParams.get('id'))));
  const accepted = topIds.find((id) => id && governmentIds.includes(id));
  expect(accepted, `Actual hybrid top 3: ${topIds.join(', ')}`).toBeTruthy();
  expect(modelRequests.some((url) => url.endsWith('model_quantized.onnx'))).toBe(true);
  expect(modelRequests.every((url) => new URL(url).origin === 'http://127.0.0.1:4173')).toBe(true);
  const passage = passages.find((item) => item.id === accepted)!;
  expect(passage.serviceId).toBe('2020-09-27');
  const result = page.locator('.result-list > li').filter({ has: page.locator(`a[href$="id=${accepted}"]`) });
  await expect(result.locator('.match-reasons')).toContainText('Semantic similarity');
  await result.getByRole('link', { name: 'Play passage', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`watch/\\?id=${accepted}$`));
  await page.getByRole('button', { name: `Play ${passage.title}`, exact: true }).click();
  await expectPlayer(page, passage.videoId, passage.start);
});

test('August ordered uploads, cross-upload chapters and passage soft-stop use the correct physical IDs', async ({ page }) => {
  await mockYouTube(page);
  await page.goto('services/2026-08-16/');
  const uploads = page.getByRole('link', { name: 'Play full recording', exact: true });
  expect(await uploads.evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get('video'))))
    .toEqual(['mw4SAoJRZgo', 'XWAH9SWFcoo', 'IcIxBc--VvM']);
  await uploads.first().click();
  await page.locator('button.play-button').click();
  await expectPlayer(page, august.videos[0].id, 0);
  for (const video of august.videos.slice(1)) {
    const chapter = august.sections.find((section) => section.video_id === video.id)!;
    const button = page.getByRole('button').filter({ has: page.getByText(chapter.title, { exact: true }) });
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'true');
    await expect(button).toContainText('Current chapter');
    await expect(page.locator('.youtube-host iframe')).toHaveCount(0);
    // A different upload remounts idle and requires Play; no automatic-play claim.
    await page.locator('button.play-button').click();
    await expectPlayer(page, video.id, chapter.start);
  }
  expect(await page.evaluate(() => window.testVideoIds)).toEqual(august.videos.map((video) => video.id));
  for (const video of august.videos) {
    const passage = passages.find((item) => item.serviceId === august.id && item.videoId === video.id)!;
    await page.goto(`watch/?id=${passage.id}`);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: passage.title, exact: true })).toBeVisible();
    await page.locator('button.play-button').click();
    await expectPlayer(page, video.id, passage.start);
  }
  const last = passages.find((item) => item.videoId === august.videos[2].id)!;
  await page.evaluate((end) => { window.testPlayer.time = end; }, last.end);
  await expect(page.getByText('Passage finished. Playback is paused.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue watching', exact: true }).click();
  await expect(page.getByText('Continuing through the full recording.')).toBeVisible();
  const before = await page.evaluate(() => ({ pauses: window.testPlayer.pauses, ticks: window.testPlayer.ticks }));
  await page.evaluate((end) => { window.testPlayer.time = end + 5; }, last.end);
  await expect.poll(() => page.evaluate(() => window.testPlayer.ticks)).toBeGreaterThan(before.ticks + 2);
  expect(await page.evaluate(() => ({ pauses: window.testPlayer.pauses, state: window.testPlayer.state }))).toEqual({ pauses: before.pauses, state: 1 });
});

test('static browse URLs and focused search display ESV references without hidden BSB text or Bible API requests', async ({ page, context }) => {
  const bibleRequests: string[] = [];
  context.on('request', (request) => { if (/esv\.org|bible\./i.test(new URL(request.url()).hostname)) bibleRequests.push(request.url()); });
  await page.route('**/models/**', (route) => route.abort());
  for (const [route, heading] of [['speakers/yong-teck-meng', 'Rev. Yong Teck Meng'], ['scripture/romans', 'Romans'], ['topics/government', 'Government'], ['years/2020', '2020']]) {
    const response = await page.goto(`browse/${route}/`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    if (route === 'years/2020') await expect(page.locator('main a[href$="/services/2020-09-27/"]')).toBeVisible();
    else expect(await page.locator('main a[href*="id=p0927-"]').count()).toBeGreaterThan(0);
    await expect(page.locator(`a[href*="${failedId}"]`)).toHaveCount(0);
  }
  await page.goto('search/');
  const input = page.locator('input[type="search"]:visible');
  await input.focus();
  await input.fill('living sacrifice');
  await expect(input).toBeFocused();
  expect(await input.evaluate((element) => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= window.innerHeight; })).toBe(true);
  const passage = passages.find((item) => item.id === 'p1102-living-sacrifice')!;
  const result = page.locator('.result-list > li').filter({ has: page.locator('a[href$="id=p1102-living-sacrifice"]') });
  await expect(result).toBeVisible();
  await expect(result.locator('.match-reasons')).toContainText('Verse-text match (BSB)');
  for (const reference of passage.scripture) {
    const link = result.getByRole('link', { name: `Read ${reference} in the ESV`, exact: true });
    await expect(link).toHaveAttribute('href', `https://www.esv.org/${encodeURIComponent(reference)}/`);
    await expect(link).toContainText('(ESV)');
  }
  expect(passage.verseText).toBeTruthy();
  // DOM text, not serialized island props or the intentionally enriched search JSON.
  const text = await page.locator('main').textContent();
  for (const verse of passage.verseText!.split('\n').filter((line) => line.length > 60)) expect(text).not.toContain(verse);
  expect(bibleRequests).toEqual([]);
});

test('new and returning home use local progress; clearing search history preserves resume', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading', { level: 1, name: 'Watch the latest sermon', exact: true })).toBeVisible();
  const featured = page.locator('section.featured');
  const badge = featured.getByText('Unreviewed preview', { exact: true });
  if (latestSermon.service.editorial_status === 'needs_review') await expect(badge).toBeVisible();
  else await expect(badge).toHaveCount(0);
  const featuredUrl = new URL((await featured.locator('a.video-card-link').getAttribute('href'))!, page.url());
  expect(featuredUrl.searchParams.get('service')).toBe(latestSermon.service.id);
  expect(featuredUrl.searchParams.get('video')).toBe(latestSermon.video.id);
  expect(Number(featuredUrl.searchParams.get('t') ?? 0)).toBe(Math.floor(latestSermon.sermon?.start ?? 0));
  const saved = { serviceId: '2026-09-06', videoId: 'ZTDYIJUDb0M', time: 3200 };
  await page.evaluate((value) => {
    localStorage.setItem('recs-replay:resume:v1', JSON.stringify(value));
    localStorage.setItem('recs-replay:search-history:v1', JSON.stringify(['Romans 13', 'living sacrifice']));
  }, saved);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /Pick up where you left off|Continue watching/ })).toBeVisible();
  await expect(featured.locator('a.video-card-link')).toHaveAttribute('href', /video=ZTDYIJUDb0M&t=3200$/);
  await expect(featured.getByText(/Resume at 53:20/)).toBeVisible();
  await page.goto('search/');
  await expect(page.getByRole('button', { name: 'Romans 13', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search history', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Search history cleared on this device. Playback progress is kept.' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('recs-replay:search-history:v1'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('recs-replay:resume:v1')!))).toEqual(saved);
  await page.goto('');
  await expect(featured.locator('a.video-card-link')).toHaveAttribute('href', /video=ZTDYIJUDb0M&t=3200$/);
});

test('failed stream stays out of ordinary links/index and production excludes every unreviewed service', async ({ page, request }) => {
  const index = await request.get('generated/passages.json');
  expect(index.ok()).toBe(true);
  expect(await index.json()).toEqual(passages);
  expect(passages.length).toBeGreaterThan(0);
  expect(passages.every((passage) => passage.videoId !== failedId)).toBe(true);
  expect(new Set(passages.map((passage) => passage.serviceId)).size).toBeGreaterThanOrEqual(5);
  for (const service of services) {
    const corePassages = passages.filter((passage) => passage.serviceId === service.id);
    expect(corePassages.length, `Required core service ${service.id}`).toBeGreaterThan(0);
    expect(corePassages.every((passage) => passage.preview === (service.editorial_status !== 'reviewed'))).toBe(true);
  }
  for (const route of ['', 'browse/services/', ...services.map((service) => `services/${service.id}/`)]) {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator(`a[href*="${failedId}"]`)).toHaveCount(0);
  }
  await page.goto('services/2026-06-28/');
  await expect(page.getByRole('link', { name: 'Play full recording', exact: true })).toHaveAttribute('href', /video=k27dmsPvmG8$/);
  await page.goto(`watch/?video=${failedId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Recording not found', exact: true })).toBeVisible();
  const production = 'http://127.0.0.1:4174/replay-check/';
  const productionIndex = await request.get(`${production}generated/passages.json`);
  expect(productionIndex.ok()).toBe(true);
  // The CLI independently verifies this built preview against enriched source.
  // Human-approved passages retain identical fields and preview:false in both modes.
  const expectedProduction = passages.filter((passage) => !passage.preview);
  expect(await productionIndex.json()).toEqual(expectedProduction);
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
