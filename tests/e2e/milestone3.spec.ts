import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { SearchChapter } from '../../site/lib/types';
import { chapterFor, readServiceFixture } from './archive-fixtures';
import { formatTimecode } from '../../site/lib/timecode';

const metadata = JSON.parse(readFileSync('dist/preview/generated/chapters.json', 'utf8'));
const passages = metadata.chapters as SearchChapter[];
// Build validation owns schema parsing; avoid Astro/tsx-only JSON-module imports here.
const productionHasRecordings = (readdirSync('services', { recursive: true }) as string[])
  .filter((file) => file.endsWith('/service.yaml'))
  .map((file) => readServiceFixture(`services/${file}`))
  .some((service) => service.editorial_status === 'reviewed' && service.videos.some((video) => video.media_disposition === 'playable'));
const tracked = chapterFor('s0927-romans-order');
const newPassage = passages.find((passage) => passage.serviceId === '2026-09-13')!;
const source = (id: string) => readServiceFixture(`services/${id.slice(0, 4)}/${id}/service.yaml`);
const choices = ['chapter time', 'title', 'scripture', 'speaker', 'topic', 'playback or audio', 'other'];
const privateMarker = 'PRIVATE_M3_SENTINEL';
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async ({ context }) => {
  // No GitHub/account/provider requests. Player responses below are test adapters.
  await context.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

async function exactOnly(page: Page) {
  await page.route('**/models/**', (route) => route.abort());
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No document horizontal overflow').toBe(true);
}
async function touchAndSeparation(controls: Locator) {
  const boxes = await controls.evaluateAll((items) => items.map((item) => {
    const r = item.getBoundingClientRect();
    return { name: item.textContent || item.getAttribute('aria-label'), x: r.x, y: r.y, width: r.width, height: r.height };
  }).filter((r) => r.width && r.height));
  expect(boxes.length).toBeGreaterThan(0);
  for (const [i, a] of boxes.entries()) {
    expect(a.width, `${a.name} width`).toBeGreaterThanOrEqual(44);
    expect(a.height, `${a.name} height`).toBeGreaterThanOrEqual(44);
    for (const b of boxes.slice(i + 1)) {
      const intersection = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1
        && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
      expect(intersection, `${a.name} / ${b.name} overlap`).toBe(false);
    }
  }
}
async function tabTo(page: Page, target: Locator, direction = 'Tab') {
  await expect(target).toBeVisible();
  for (let i = 0; i < 180; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press(direction);
  }
  await expect(target).toBeFocused();
  expect(await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 3;
  }), 'Visible keyboard focus ring').toBe(true);
}
async function adapter(page: Page, failFirst = false) {
  await page.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `let attempts=0;window.YT={Player:class{
      constructor(host,options){this.time=0;this.state=2;this.videoId=options.videoId;
        this.iframe=document.createElement('iframe');host.replaceWith(this.iframe);window.testPlayer=this;
        setTimeout(()=>${failFirst}&&attempts++===0?options.events.onError({data:100}):options.events.onReady({target:this}),0)}
      seekTo(time){this.time=time}playVideo(){this.state=1}pauseVideo(){this.state=2}
      getCurrentTime(){return this.time}getPlayerState(){return this.state}
      getIframe(){return this.iframe}destroy(){this.iframe.remove()}
    }};window.onYouTubeIframeAPIReady();`,
  }));
}

const axeRoutes = [
  ['home', ''], ['search', 'search/'], ['results', 'search/?q=Romans%2013'],
  ['watch without YouTube', `watch/?chapter=${tracked.id}`], ['service', `services/${newPassage.serviceId}/`],
  ['browse', 'browse/topics/government/'], ['production publication state', 'http://127.0.0.1:4174/replay-check/'],
];
for (const [label, route] of axeRoutes) test(`axe tagged checks: ${label}`, async ({ page }, testInfo) => {
  await exactOnly(page);
  const youtube: string[] = [];
  page.on('request', (request) => { if (/youtube/.test(request.url())) youtube.push(request.url()); });
  await page.goto(route);
  await expect(page.getByRole('main')).toBeVisible();
  if (label === 'results') await expect(page.locator('.result-list > li').first()).toBeVisible();
  if (label === 'watch without YouTube') await expect(page.getByRole('heading', { level: 1, name: tracked.serviceTitle, exact: true })).toBeVisible();
  if (label === 'production publication state') {
    const empty = page.getByRole('heading', { name: 'The archive is being prepared' });
    if (productionHasRecordings) {
      await expect(empty).toHaveCount(0);
      await expect(page.locator('a.video-card-link').first()).toBeVisible();
    } else await expect(empty).toBeVisible();
    await expect(page.locator('.preview-label, .preview-banner')).toHaveCount(0);
  }
  await noOverflow(page);
  const result = await new AxeBuilder({ page }).withTags(tags).analyze();
  const evidence = testInfo.outputPath('axe.json');
  writeFileSync(evidence, JSON.stringify({ url: page.url(), tags, passes: result.passes.length, incomplete: result.incomplete.map(({ id }) => id), violations: result.violations }, null, 2));
  await testInfo.attach(`axe-${label}`, { path: evidence, contentType: 'application/json' });
  expect(result.violations).toEqual([]);
  expect(youtube).toEqual([]);
});

async function inspectCorrection(link: Locator, fields: Record<string, string>) {
  await expect(link).toHaveAttribute('rel', 'noreferrer');
  await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  const url = new URL((await link.getAttribute('href'))!);
  expect(url.origin).toBe('https://github.com');
  expect(url.pathname).toMatch(/\/issues\/new$/);
  expect(url.searchParams.get('template')).toBe('archive-correction.yml');
  expect([...url.searchParams.keys()].sort()).toEqual(['body', 'page', 'chapter-id', 'service-id', 'template', 'timestamps', 'title', 'video-id'].sort());
  for (const [key, value] of Object.entries(fields)) expect(url.searchParams.get(key), key).toBe(value);
  const body = url.searchParams.get('body')!;
  for (const key of ['service-id', 'video-id', 'chapter-id', 'timestamps', 'page']) expect(body).toContain(`### ${key}\n${url.searchParams.get(key)}`);
  for (const choice of choices) expect(body).toContain(`- [ ] ${choice}`);
  expect([...url.searchParams.values()].join('\n')).not.toMatch(/PRIVATE_M3|localStorage|history|resume|\/Users\/|review_notes|sha256|q=/);
  return url;
}
function passageFields(passage: SearchChapter) {
  return { 'service-id': passage.serviceId, 'video-id': passage.videoId, 'chapter-id': passage.id,
    timestamps: `${passage.videoId}: ${formatTimecode(passage.start)}–${formatTimecode(passage.end)}`, page: `/replay-check/watch/?chapter=${passage.id}` };
}

test('chapter correction context, Markdown fallback and transcript exclusion across service, watch, search and browse', async ({ page }) => {
  await exactOnly(page);
  await page.addInitScript((marker) => {
    localStorage.setItem('recs-replay:search-history:v1', JSON.stringify([marker]));
    localStorage.setItem('recs-replay:resume:v1', JSON.stringify({ serviceId: '2026-09-06', videoId: 'ZTDYIJUDb0M', time: 3217.123 }));
    history.replaceState({ private: marker }, '');
  }, privateMarker);
  for (const passage of [tracked, newPassage]) {
    const service = source(passage.serviceId);
    await page.goto(`services/${passage.serviceId}/?q=${privateMarker}`);
    const videos = service.videos.filter((video) => video.media_disposition === 'playable');
    await inspectCorrection(page.locator('.service-heading').getByRole('link', { name: 'Suggest a correction' }), {
      'service-id': service.id, 'video-id': videos.map((video) => video.id).join(', '),
      timestamps: videos.map((video) => `${video.id}: 0:00–${formatTimecode(video.duration)}`).join('\n'),
      'chapter-id': 'Not selected (whole recording/service)', page: `/replay-check/services/${service.id}/`,
    });
    // One correction link per page: chapter rows carry none.
    await expect(page.locator('.service-chapters').getByRole('link', { name: 'Suggest a correction' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Suggest a correction' })).toHaveCount(1);
    await page.goto(`watch/?chapter=${passage.id}&q=${privateMarker}&t=3217.123`);
    await inspectCorrection(page.locator('.playback-footer').getByRole('link', { name: 'Suggest a correction' }), passageFields(passage));
    await expect(page.getByRole('link', { name: 'Edit this transcript' })).toHaveCount(0);
    await expect(page.locator('.transcript-panel, .compact-passage-list')).toHaveCount(0);
    await touchAndSeparation(page.locator('.playback-footer .action-row a, .playback-footer .action-row button'));
  }
  await page.goto(`watch/?service=${tracked.serviceId}&video=${tracked.videoId}&t=3217.123&q=${privateMarker}`);
  const fullVideo = source(tracked.serviceId).videos.find((video) => video.id === tracked.videoId)!;
  await inspectCorrection(page.locator('.playback-footer').getByRole('link', { name: 'Suggest a correction' }), {
    'service-id': tracked.serviceId, 'video-id': tracked.videoId, 'chapter-id': 'Not selected (whole recording/service)',
    timestamps: `${tracked.videoId}: 0:00–${formatTimecode(fullVideo.duration)}`,
    page: `/replay-check/watch/?service=${tracked.serviceId}&video=${tracked.videoId}`,
  });
  for (const route of ['search/?q=Romans%2013', 'browse/topics/government/']) {
    await page.goto(route);
    const browse = route.startsWith('browse/');
    const card = page.locator(browse ? '.browse-grid .video-card' : 'article.recording-result').first();
    await expect(card).toBeVisible();
    // Result and browse lists carry no per-item correction links.
    await expect(page.locator('main').getByRole('link', { name: 'Suggest a correction' })).toHaveCount(0);
  }
});

test('Tab and Enter journey: skip, named search, result and Play', async ({ page }) => {
  await exactOnly(page);
  await adapter(page);
  await page.goto('');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  // Shift+Tab reaches the header before main in both responsive compositions.
  const mobile = page.getByRole('link', { name: 'Search the archive', exact: true });
  const mobileLayout = await mobile.isVisible();
  if (mobileLayout) {
    await tabTo(page, mobile, 'Shift+Tab');
    await page.keyboard.press('Enter');
  }
  const input = page.getByRole('searchbox', { name: 'Search chapters, dates or Bible references' });
  await tabTo(page, input, mobileLayout ? 'Tab' : 'Shift+Tab');
  await page.keyboard.type('Romans 13');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Search results' })).toBeVisible();
  const play = page.locator('.recording-result').first().locator('h2 a');
  const id = new URL((await play.getAttribute('href'))!, page.url()).searchParams.get('chapter');
  const passage = passages.find((item) => item.id === id)!;
  await tabTo(page, play);
  await page.keyboard.press('Enter');
  const button = page.getByRole('button', { name: `Play ${passage.serviceTitle}`, exact: true })
    .or(page.getByRole('button', { name: 'Try embedded player', exact: true }));
  await tabTo(page, button);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => ({ id: window.testPlayer?.videoId, time: window.testPlayer?.time }))).toEqual({ id: passage.videoId, time: passage.start });
  await expect(page.locator('.youtube-host iframe')).toHaveAttribute('title', passage.serviceTitle);
  await expect(page.locator('.youtube-host iframe')).toBeFocused();
});

test('keyboard chapters, correction activation, transcript exclusion and reduced motion', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`watch/?chapter=${tracked.id}`);
  await expect(page.getByRole('heading', { name: tracked.serviceTitle, level: 1, exact: true })).toBeVisible();
  await expect(page.locator('.chapters .chapter-row[aria-current="true"]')).toContainText(tracked.title);
  const chapter = page.locator('.chapter-row').first();
  await tabTo(page, chapter);
  await page.keyboard.press('Enter');
  await expect(chapter).toHaveAttribute('aria-current', 'true');
  await expect(chapter).toContainText('Current chapter');
  await expect(chapter).toBeFocused();
  const section = source(tracked.serviceId).chapters[0];
  await inspectCorrection(page.locator('.playback-footer').getByRole('link', { name: 'Suggest a correction' }), {
    'chapter-id': section.id, timestamps: `${section.video_id}: ${formatTimecode(section.start)}–${formatTimecode(section.end)}`,
    page: `/replay-check/watch/?chapter=${section.id}`,
  });
  await page.goto(`watch/?chapter=${tracked.id}`);
  await expect(page.locator('.transcript-panel, .compact-passage-list')).toHaveCount(0);
  const suggestion = page.locator('.playback-footer').getByRole('link', { name: 'Suggest a correction' });
  await tabTo(page, suggestion);
  // Observe native Enter navigation at the request boundary; never contact GitHub.
  const requestPromise = page.waitForRequest((request) => new URL(request.url()).hostname === 'github.com');
  await page.route('https://github.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Synthetic test-only navigation sink</title>' }));
  await page.keyboard.press('Enter');
  const outgoing = await requestPromise;
  expect((await outgoing.allHeaders()).referer).toBeUndefined();
  await expect(page).toHaveTitle('Synthetic test-only navigation sink');
  await page.goto(`watch/?chapter=${tracked.id}`);
  // Opening a subsection directly reveals subsections, so the subsection itself is highlighted.
  await expect(page.locator('.chapters .chapter-row[aria-current="true"]')).toContainText(tracked.parentId ? 'Current subsection' : 'Current chapter');
  await expect(page.locator('.chapters .chapter-row[aria-current="true"]')).toContainText(tracked.title);
  await touchAndSeparation(page.locator('.playback-footer .action-row a, .playback-footer .action-row button'));
  expect(await page.locator('.playback-details').evaluate((element) => {
    const css = getComputedStyle(element);
    return matchMedia('(prefers-reduced-motion: reduce)').matches && css.animationName === 'none' && css.transitionDuration === '0s' && css.scrollBehavior === 'auto';
  })).toBe(true);
  const structure = testInfo.outputPath('watch-accessible-structure.txt');
  writeFileSync(structure, await page.getByRole('main').ariaSnapshot());
  await testInfo.attach('watch-accessible-structure', { path: structure, contentType: 'text/plain' });
  await noOverflow(page);
});

test('index failure and retry preserve exact results with semantic model blocked', async ({ page }) => {
  await exactOnly(page);
  let attempts = 0;
  // Both gzip and raw attempts fail on the first load; retry succeeds.
  await page.route('**/generated/chapters.json*', (route) => ++attempts <= 2 ? route.fulfill({ status: 503, body: 'Synthetic test-only index outage' }) : route.continue());
  await page.goto('search/?q=Romans%2013');
  await expect(page.getByRole('status').filter({ hasText: 'The archive could not be refreshed.' })).toBeVisible();
  await expect(page.locator('.result-list > li').first()).toBeVisible();
  const retry = page.getByRole('button', { name: 'Retry loading the archive' });
  await tabTo(page, retry);
  await page.keyboard.press('Enter');
  await expect(retry).toHaveCount(0);
  expect(attempts).toBe(3);
  await expect(page.getByRole('status').filter({ hasText: 'Meaning-based search is unavailable. Exact search still works.' })).toBeVisible();
  await expect(page.locator(`.recording-result[data-service="${tracked.serviceId}"]`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry meaning-based search' })).toBeVisible();
  await noOverflow(page);
});

test('test adapter unavailable-video error exposes retry and timestamped direct link', async ({ page }) => {
  await adapter(page, true);
  await page.goto(`watch/?chapter=${tracked.id}`);
  await tabTo(page, page.getByRole('button', { name: `Play ${tracked.serviceTitle}`, exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('This recording is unavailable on YouTube. It may be private or removed.');
  const direct = page.locator('.player-message').getByRole('link', { name: 'Watch on YouTube' });
  await expect(direct).toHaveAttribute('href', `https://www.youtube.com/watch?v=${tracked.videoId}&t=${Math.floor(tracked.start)}`);
  await touchAndSeparation(page.locator('.player-message a, .player-message button'));
  await tabTo(page, page.getByRole('button', { name: 'Retry player' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({ state: window.testPlayer?.state, time: window.testPlayer?.time }))).toEqual({ state: 1, time: tracked.start });
  await noOverflow(page);
});

test('synthetic response-only long titles, names, multiple references and missing speaker', async ({ page }) => {
  await exactOnly(page);
  // Only HTTP response data changes. This text is never written to archive/build sources.
  const title = `Synthetic layout fixture ${'extraordinarilylongunbrokentitle'.repeat(8)}`;
  const speaker = `Synthetic test speaker ${'LongCompoundName'.repeat(14)}`;
  const references = ['Luke 17:1-9', 'Matthew 18:5-7', 'Romans 13:1-7', '1 Corinthians 3:1-9'];
  const fixtures = [
    { ...tracked, parentId: undefined, parentTitle: undefined, title, speaker, scripture: references, scriptureDisplay: references },
    { ...newPassage, title: 'Synthetic layout fixture with no speaker', speaker: undefined, scripture: [], scriptureDisplay: [] },
  ];
  await page.route('**/generated/chapters.json*', (route) => route.fulfill({ json: { ...metadata, chapters: fixtures } }));
  await page.goto('search/?q=Synthetic%20layout%20fixture');
  // One result per recording; the synthetic chapter is the match, so its long title sits in the match row.
  const cards = page.locator('article.recording-result');
  await expect(cards).toHaveCount(2);
  const longCard = cards.filter({ has: page.locator('.matched-chapter', { hasText: title }) });
  await expect(longCard).toHaveCount(1);
  for (const ref of references.slice(0, 2)) await expect(longCard.getByRole('link', { name: `Read ${ref} in the ESV`, exact: true })).toBeVisible();
  await expect(longCard.locator('.scripture')).toContainText('+2 references');
  const missing = cards.filter({ has: page.locator('.matched-chapter', { hasText: 'Synthetic layout fixture with no speaker' }) });
  await expect(missing.locator('.metadata')).not.toContainText(/undefined|null|Unknown speaker/);
  expect((await missing.locator('.metadata').innerText()).trim()).not.toMatch(/·$/);
  await noOverflow(page);
});

test('synthetic response-only long playback title keeps Play and consent clear', async ({ page }) => {
  const title = `Synthetic test-only playback title ${'long title phrase '.repeat(24)}${'unbroken'.repeat(16)}`;
  await page.route('**/watch/**', async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    expect(html).toContain(tracked.serviceTitle);
    await route.fulfill({ response, body: html.replaceAll(tracked.serviceTitle, title) });
  });
  await page.goto(`watch/?chapter=${tracked.id}`);
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
  const play = page.getByRole('button', { name: `Play ${title}`, exact: true });
  await tabTo(page, play);
  await touchAndSeparation(play);
  expect(await page.locator('.player-context strong').evaluate((element) => element.scrollWidth <= element.clientWidth), 'Player title has no horizontal text overflow').toBe(true);
  const clear = await page.locator('.player-consent').evaluate((element) => {
    const button = element.querySelector('button')!.getBoundingClientRect();
    return [...element.querySelectorAll('.player-context, p')].every((item) => {
      const r = item.getBoundingClientRect();
      return r.bottom <= button.top || r.top >= button.bottom;
    });
  });
  expect(clear, 'Title and connection notice do not overlap Play').toBe(true);
  await noOverflow(page);
});
