import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parse } from 'yaml';
import type { SearchPassage, ServiceSource } from '../../site/lib/types';

const passages = JSON.parse(readFileSync('dist/preview/generated/passages.json', 'utf8')) as SearchPassage[];
// Build validation owns schema parsing; avoid Astro/tsx-only JSON-module imports here.
const productionHasRecordings = (readdirSync('services', { recursive: true }) as string[])
  .filter((file) => file.endsWith('/service.yaml'))
  .map((file) => parse(readFileSync(`services/${file}`, 'utf8')) as ServiceSource)
  .some((service) => service.editorial_status === 'reviewed' && service.videos.some((video) => video.media_disposition === 'playable'));
const tracked = passages.find((passage) => passage.id === 'p0927-romans-government')!;
const newPassage = passages.find((passage) => passage.serviceId === '2026-09-13')!;
const source = (id: string) => parse(readFileSync(`services/${id.slice(0, 4)}/${id}/service.yaml`, 'utf8')) as ServiceSource;
const trackedFiles = new Set(execFileSync('git', ['ls-files', '-z', '--', 'services'], { encoding: 'utf8', timeout: 5000 }).split('\0'));
function editableSource(passage: SearchPassage) {
  const yaml = `services/${passage.date.slice(0, 4)}/${passage.serviceId}/service.yaml`;
  const original = source(passage.serviceId).passages.find((item) => item.id === passage.id)!;
  const candidate = original.transcript_file ? path.posix.join(path.posix.dirname(yaml), original.transcript_file) : yaml;
  return trackedFiles.has(yaml) && trackedFiles.has(candidate) ? candidate : undefined;
}
const choices = ['transcript', 'timestamp', 'scripture', 'speaker', 'section', 'other'];
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
  ['watch without YouTube', `watch/?id=${tracked.id}`], ['service', `services/${newPassage.serviceId}/`],
  ['browse', 'browse/topics/government/'], ['production publication state', 'http://127.0.0.1:4174/replay-check/'],
];
for (const [label, route] of axeRoutes) test(`axe tagged checks: ${label}`, async ({ page }, testInfo) => {
  await exactOnly(page);
  const youtube: string[] = [];
  page.on('request', (request) => { if (/youtube/.test(request.url())) youtube.push(request.url()); });
  await page.goto(route);
  await expect(page.getByRole('main')).toBeVisible();
  if (label === 'results') await expect(page.locator('.result-list > li').first()).toBeVisible();
  if (label === 'watch without YouTube') await expect(page.getByRole('heading', { level: 1, name: tracked.title, exact: true })).toBeVisible();
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
  expect([...url.searchParams.keys()].sort()).toEqual(['body', 'page', 'passage-id', 'section-id', 'service-id', 'template', 'timestamps', 'title', 'video-id'].sort());
  for (const [key, value] of Object.entries(fields)) expect(url.searchParams.get(key), key).toBe(value);
  const body = url.searchParams.get('body')!;
  for (const key of ['service-id', 'video-id', 'passage-id', 'section-id', 'timestamps', 'page']) expect(body).toContain(`### ${key}\n${url.searchParams.get(key)}`);
  for (const choice of choices) expect(body).toContain(`- [ ] ${choice}`);
  expect([...url.searchParams.values()].join('\n')).not.toMatch(/PRIVATE_M3|localStorage|history|resume|\/Users\/|review_notes|sha256|q=/);
  return url;
}
function passageFields(passage: SearchPassage) {
  return { 'service-id': passage.serviceId, 'video-id': passage.videoId, 'passage-id': passage.id, 'section-id': source(passage.serviceId).passages.find((item) => item.id === passage.id)!.section_id,
    timestamps: `${passage.videoId}: ${passage.start}–${passage.end} seconds`, page: `/replay-check/watch/?id=${passage.id}` };
}

test('correction context, Markdown fallback and tracked-source gates across service, watch, search and browse', async ({ page }) => {
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
      timestamps: videos.map((video) => `${video.id}: 0–${video.duration} seconds`).join('\n'),
      'passage-id': 'Not selected (whole recording/service)', 'section-id': 'Not selected (whole recording/service)', page: `/replay-check/services/${service.id}/`,
    });
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: passage.title, exact: true }) }).first();
    await inspectCorrection(card.getByRole('link', { name: 'Suggest a correction' }), passageFields(passage));
    // Follow real Git tracking so this acceptance remains valid after content is
    // checkpointed. Before that, new M3 sources must have no claimed edit link.
    const editable = editableSource(passage);
    await expect(card.getByRole('link', { name: 'Edit this transcript' })).toHaveCount(editable ? 1 : 0);
    if (editable) {
      const edit = new URL((await card.getByRole('link', { name: 'Edit this transcript' }).getAttribute('href'))!);
      expect(edit.pathname).toContain('/edit/');
      expect(edit.pathname.endsWith(`/${editable}`)).toBe(true);
      expect(edit.hash).toBe('');
    }
    await page.goto(`watch/?id=${passage.id}&q=${privateMarker}&t=3217.123`);
    await inspectCorrection(page.locator('.playback-details').getByRole('link', { name: 'Suggest a correction' }), passageFields(passage));
    await expect(page.locator('.playback-details').getByRole('link', { name: 'Edit this transcript' })).toHaveCount(editable ? 1 : 0);
    await touchAndSeparation(page.locator('.playback-details .action-row a, .playback-details .action-row button'));
  }
  await page.goto(`watch/?service=${tracked.serviceId}&video=${tracked.videoId}&t=3217.123&q=${privateMarker}`);
  const fullVideo = source(tracked.serviceId).videos.find((video) => video.id === tracked.videoId)!;
  await inspectCorrection(page.locator('.playback-details').getByRole('link', { name: 'Suggest a correction' }), {
    'service-id': tracked.serviceId, 'video-id': tracked.videoId, 'passage-id': 'Not selected (whole recording/service)',
    'section-id': 'Not selected (whole recording/service)', timestamps: `${tracked.videoId}: 0–${fullVideo.duration} seconds`,
    page: `/replay-check/watch/?service=${tracked.serviceId}&video=${tracked.videoId}`,
  });
  for (const route of ['search/?q=Romans%2013', 'browse/topics/government/']) {
    await page.goto(route);
    const card = page.locator('article.passage-result').first();
    await expect(card).toBeVisible();
    const id = new URL((await card.getByRole('link', { name: 'Play passage', exact: true }).getAttribute('href'))!, page.url()).searchParams.get('id');
    await inspectCorrection(card.getByRole('link', { name: 'Suggest a correction' }), passageFields(passages.find((passage) => passage.id === id)!));
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
  const input = page.getByRole('searchbox', { name: 'Search sermons, dates or Bible passages' });
  await tabTo(page, input, mobileLayout ? 'Tab' : 'Shift+Tab');
  await page.keyboard.type('Romans 13');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Search results' })).toBeVisible();
  const play = page.getByRole('link', { name: 'Play passage', exact: true }).first();
  const id = new URL((await play.getAttribute('href'))!, page.url()).searchParams.get('id');
  const passage = passages.find((item) => item.id === id)!;
  await tabTo(page, play);
  await page.keyboard.press('Enter');
  const button = page.getByRole('button', { name: `Play ${passage.title}`, exact: true });
  await tabTo(page, button);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => ({ id: window.testPlayer?.videoId, time: window.testPlayer?.time }))).toEqual({ id: passage.videoId, time: passage.start });
  await expect(page.locator('.youtube-host iframe')).toHaveAttribute('title', passage.title);
  await expect(page.locator('.youtube-host iframe')).toBeFocused();
});

test('keyboard chapters, transcript disclosures, correction activation and reduced motion', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`watch/?id=${tracked.id}`);
  await expect(page.getByRole('heading', { name: tracked.title, level: 1, exact: true })).toBeVisible();
  const chapter = page.locator('.chapter-row').first();
  await tabTo(page, chapter);
  await page.keyboard.press('Enter');
  await expect(chapter).toHaveAttribute('aria-current', 'true');
  await expect(chapter).toContainText('Current chapter');
  await expect(chapter).toBeFocused();
  const section = source(tracked.serviceId).sections[0];
  await inspectCorrection(page.locator('.playback-details').getByRole('link', { name: 'Suggest a correction' }), {
    'section-id': section.id, timestamps: `${section.video_id}: ${section.start}–${section.end} seconds`,
    page: `/replay-check/watch/?service=${tracked.serviceId}&video=${section.video_id}&t=${Math.floor(section.start)}`,
  });
  await page.goto(`watch/?id=${tracked.id}`);
  const disclosure = page.locator('.transcript-panel summary').first();
  await tabTo(page, disclosure);
  await page.keyboard.press('Enter');
  await expect(disclosure.locator('..')).toHaveAttribute('open', '');
  const suggestion = disclosure.locator('..').getByRole('link', { name: 'Suggest a correction' });
  await tabTo(page, suggestion);
  // Observe native Enter navigation at the request boundary; never contact GitHub.
  const requestPromise = page.waitForRequest((request) => new URL(request.url()).hostname === 'github.com');
  await page.route('https://github.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Synthetic test-only navigation sink</title>' }));
  await page.keyboard.press('Enter');
  const outgoing = await requestPromise;
  expect((await outgoing.allHeaders()).referer).toBeUndefined();
  await expect(page).toHaveTitle('Synthetic test-only navigation sink');
  await page.goto(`watch/?id=${tracked.id}`);
  const all = page.locator('summary#passages-title');
  await tabTo(page, all);
  await page.keyboard.press('Enter');
  const selected = page.locator('.compact-passage-list a[aria-current="true"]');
  await expect(selected).toContainText('Selected passage');
  await touchAndSeparation(page.locator('.playback-details .action-row a, .playback-details .action-row button'));
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
  await page.route('**/generated/passages.json', (route) => ++attempts === 1 ? route.fulfill({ status: 503, body: 'Synthetic test-only index outage' }) : route.continue());
  await page.goto('search/?q=Romans%2013');
  await expect(page.getByRole('status').filter({ hasText: 'The archive could not be refreshed.' })).toBeVisible();
  await expect(page.locator('.result-list > li').first()).toBeVisible();
  const retry = page.getByRole('button', { name: 'Retry loading the archive' });
  await tabTo(page, retry);
  await page.keyboard.press('Enter');
  await expect(retry).toHaveCount(0);
  expect(attempts).toBe(2);
  await expect(page.getByRole('status').filter({ hasText: 'Meaning-based search is unavailable. Exact search still works.' })).toBeVisible();
  await expect(page.locator('.result-list')).toContainText(tracked.title);
  await expect(page.getByRole('button', { name: 'Retry meaning-based search' })).toBeVisible();
  await noOverflow(page);
});

test('test adapter unavailable-video error exposes retry and timestamped direct link', async ({ page }) => {
  await adapter(page, true);
  await page.goto(`watch/?id=${tracked.id}`);
  await tabTo(page, page.getByRole('button', { name: `Play ${tracked.title}`, exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('This recording is unavailable in the embedded player. Try watching on YouTube.');
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
    { ...tracked, title, speaker, scripture: references, scriptureDisplay: references },
    { ...newPassage, title: 'Synthetic layout fixture with no speaker', speaker: undefined, scripture: [], scriptureDisplay: [] },
  ];
  await page.route('**/generated/passages.json', (route) => route.fulfill({ json: fixtures }));
  await page.goto('search/?q=Synthetic%20layout%20fixture');
  const cards = page.locator('article.passage-result');
  await expect(cards).toHaveCount(2);
  const longCard = cards.filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(longCard.locator('.metadata')).toContainText(speaker);
  for (const ref of references) await expect(longCard.getByRole('link', { name: `Read ${ref} in the ESV`, exact: true })).toBeVisible();
  const missing = cards.filter({ hasText: 'Synthetic layout fixture with no speaker' });
  await expect(missing.locator('.metadata')).not.toContainText(/undefined|null|Unknown speaker/);
  expect((await missing.locator('.metadata').innerText()).trim()).not.toMatch(/·$/);
  await touchAndSeparation(page.locator('.passage-result .action-row a'));
  await noOverflow(page);
});

test('synthetic response-only long playback title keeps Play and consent clear', async ({ page }) => {
  const title = `Synthetic test-only playback title ${'long title phrase '.repeat(24)}${'unbroken'.repeat(16)}`;
  await page.route('**/watch/**', async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    expect(html).toContain(tracked.title);
    await route.fulfill({ response, body: html.replaceAll(tracked.title, title) });
  });
  await page.goto(`watch/?id=${tracked.id}`);
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
