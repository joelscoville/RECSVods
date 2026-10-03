import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { readFileSync, writeFileSync } from 'node:fs';
import type { SearchUnit } from '../../site/lib/display';
import { fakeYouTube, player, previewUnits, unitFor, uploadAt } from './archive-fixtures';
import { browserEndpoints } from '../../scripts/testing-config';

// Every check here includes viewport-sensitive accessibility, keyboard or layout assertions.
test.describe('responsive accessibility and recovery', { tag: '@responsive' }, () => {
const metadata = JSON.parse(readFileSync('dist/preview/generated/chapters.json', 'utf8'));
const productionHasRecordings = JSON.parse(readFileSync('dist/production/generated/chapters.json', 'utf8')).units.length > 0;
// The Romans 13 recording, and one of its key points.
const tracked = unitFor('2020-09-27');
const trackedPoint = previewUnits.find((unit) => unit.recordingId === tracked.recordingId && unit.kind === 'subchapter')!;
const newPassage = unitFor('2026-09-13');
/** Where a recording opens without a time: its sermon. */
const sermonStart = (recordingId: string) => unitFor(recordingId).start;
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

const axeRoutes = [
  ['home', ''], ['search', 'search/'], ['results', 'search/?q=Romans%2013'],
  ['watch without YouTube', `watch/?r=${tracked.recordingId}`], ['service', `services/${newPassage.recordingId}/`],
  ['browse', 'browse/topics/government/'], ['production publication state', browserEndpoints().production],
];
for (const [label, route] of axeRoutes) test(`axe tagged checks: ${label}`, async ({ page }, testInfo) => {
  await exactOnly(page);
  const youtube: string[] = [];
  page.on('request', (request) => { if (/youtube/.test(request.url())) youtube.push(request.url()); });
  await page.goto(route);
  await expect(page.getByRole('main')).toBeVisible();
  if (label === 'results') await expect(page.locator('.result-list > li').first()).toBeVisible();
  if (label === 'watch without YouTube') await expect(page.getByRole('heading', { level: 1, name: tracked.recordingTitle, exact: true })).toBeVisible();
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

/** The one correction control: "Suggest a change" opens the editor at the moment being watched,
 * carrying nothing from the page's search, history or saved state. */
async function inspectSuggestion(link: Locator, recordingId: string, params: Record<string, string>) {
  const url = new URL((await link.getAttribute('href'))!, 'http://127.0.0.1');
  expect(url.pathname).toBe(`/replay-check/edit/${recordingId}/`);
  expect(Object.fromEntries(url.searchParams)).toEqual(params);
  expect(url.href).not.toMatch(/PRIVATE_M3|localStorage|history|resume|q=/);
}

test('one Suggest a change link per page, carrying no private state, and no transcript editing', async ({ page }) => {
  await exactOnly(page);
  await page.addInitScript((marker) => {
    localStorage.setItem('recs-replay:search-history:v1', JSON.stringify([marker]));
    localStorage.setItem('recs-replay:resume:v2', JSON.stringify({ recordingId: '2026-09-06', time: 3217.123 }));
    history.replaceState({ private: marker }, '');
  }, privateMarker);
  for (const passage of [tracked, newPassage]) {
    await page.goto(`services/${passage.recordingId}/?q=${privateMarker}`);
    await inspectSuggestion(page.locator('.service-heading').getByRole('link', { name: 'Suggest a change' }), passage.recordingId, {});
    // One correction link per page: chapter rows carry none, and there is no second "report" link.
    await expect(page.locator('.service-chapters').getByRole('link', { name: 'Suggest a change' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Suggest a change' })).toHaveCount(1);
    await expect(page.getByRole('link', { name: /Report a problem|Suggest a correction/ })).toHaveCount(0);
    await page.goto(`watch/?r=${passage.recordingId}&q=${privateMarker}&t=1234`);
    await inspectSuggestion(page.locator('.playback-footer').getByRole('link', { name: 'Suggest a change' }), passage.recordingId, { t: '1234' });
    await expect(page.getByRole('link', { name: 'Edit this transcript' })).toHaveCount(0);
    await expect(page.locator('.transcript-panel, .compact-passage-list')).toHaveCount(0);
    await touchAndSeparation(page.locator('.playback-footer .action-row a, .playback-footer .action-row button'));
  }
  for (const route of ['search/?q=Romans%2013', 'browse/topics/government/']) {
    await page.goto(route);
    const browse = route.startsWith('browse/');
    const card = page.locator(browse ? '.browse-grid .video-card' : 'article.recording-result').first();
    await expect(card).toBeVisible();
    // Result and browse lists carry no per-item correction links.
    await expect(page.locator('main').getByRole('link', { name: 'Suggest a change' })).toHaveCount(0);
  }
});

test('Tab and Enter journey: skip, named search, result and Play', async ({ page }) => {
  await exactOnly(page);
  await fakeYouTube(page);
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
  const href = new URL((await play.getAttribute('href'))!, page.url());
  const passage = unitFor(href.searchParams.get('r')!), start = Number(href.searchParams.get('t') ?? 0);
  await tabTo(page, play);
  await page.keyboard.press('Enter');
  const button = page.getByRole('button', { name: `Play ${passage.recordingTitle}`, exact: true });

  await tabTo(page, button);
  await page.keyboard.press('Enter');
  const expected = uploadAt(passage.recordingId, start);
  await expect.poll(async () => { const value = await player(page); return value && { id: value.videoId, time: value.time }; }).toEqual(expected);
  await expect(page.locator('.youtube-host iframe')).toHaveAttribute('title', passage.recordingTitle);
  await expect(page.locator('.youtube-host iframe')).toBeFocused();
});

test('keyboard chapters, Suggest a change activation, transcript exclusion and reduced motion', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`watch/?r=${tracked.recordingId}&t=${sermonStart(tracked.recordingId)}`);
  await expect(page.getByRole('heading', { name: tracked.recordingTitle, level: 1, exact: true })).toBeVisible();
  await expect(page.locator('.chapters .chapter-row[aria-current="true"]')).toContainText(previewUnits.find(unit => unit.recordingId === tracked.recordingId && unit.kind === 'chapter' && unit.start === tracked.start)!.title);
  const chapter = page.locator('.chapter-row').first();
  await tabTo(page, chapter);
  await page.keyboard.press('Enter');
  await expect(chapter).toHaveAttribute('aria-current', 'true');
  await expect(chapter).toContainText('Current chapter');
  await expect(chapter).toBeFocused();
  const firstStart = Math.floor(previewUnits.find(unit => unit.recordingId === tracked.recordingId && unit.kind === 'chapter')!.start);
  await inspectSuggestion(page.locator('.playback-footer').getByRole('link', { name: 'Suggest a change' }), tracked.recordingId, firstStart ? { t: String(firstStart) } : {});
  await page.goto(`watch/?r=${tracked.recordingId}`);
  await expect(page.locator('.transcript-panel, .compact-passage-list')).toHaveCount(0);
  const suggestion = page.locator('.playback-footer').getByRole('link', { name: 'Suggest a change' });
  await tabTo(page, suggestion);
  // Enter opens the chapter editor, on this site.
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/replay-check/edit/${tracked.recordingId}/$`));
  const focus = trackedPoint.entryId!;
  await page.goto(`watch/?r=${tracked.recordingId}&focus=${focus}`);
  // Opening a key point directly reveals the key points, so the point itself is highlighted.
  await expect(page.locator('.chapters .chapter-row[aria-current="true"]')).toContainText(trackedPoint.title);
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
  // Installation is unavailable in this fixture. An intentionally unstarted model is not an error.
  await expect(page.getByRole('status').filter({ hasText: 'with exact search.' })).toBeVisible();
  await expect(page.locator(`.recording-result[data-service="${tracked.recordingId}"]`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry meaning-based search' })).toHaveCount(0);
  await noOverflow(page);
});

test('test adapter unavailable-video error exposes retry and timestamped direct link', async ({ page }) => {
  await fakeYouTube(page, { failFirst: true });
  await page.goto(`watch/?r=${tracked.recordingId}&t=${sermonStart(tracked.recordingId)}`);
  const start = sermonStart(tracked.recordingId), at = uploadAt(tracked.recordingId, start);
  await tabTo(page, page.getByRole('button', { name: `Play ${tracked.recordingTitle}`, exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('This recording is unavailable on YouTube. It may be private or removed.');
  const direct = page.locator('.player-message').getByRole('link', { name: 'Watch on YouTube' });
  await expect(direct).toHaveAttribute('href', `https://www.youtube.com/watch?v=${at.id}&t=${Math.floor(at.time)}`);
  await touchAndSeparation(page.locator('.player-message a, .player-message button'));
  await tabTo(page, page.getByRole('button', { name: 'Try again' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => { const value = await player(page); return value && { state: value.state, time: value.time }; }).toEqual({ state: 1, time: at.time });
  await noOverflow(page);
});

test('synthetic response-only long titles, multiple references and no references', async ({ page }) => {
  await exactOnly(page);
  // Only HTTP response data changes. This text is never written to archive/build sources.
  const title = `Synthetic layout fixture ${'extraordinarilylongunbrokentitle'.repeat(8)}`;
  const references = ['Luke 17:1-9', 'Matthew 18:5-7', 'Romans 13:1-7', '1 Corinthians 3:1-9'];
  const point = previewUnits.find((unit) => unit.recordingId === newPassage.recordingId && unit.kind === 'point')!;
  const fixtures: SearchUnit[] = [
    { ...tracked, scripture: references, scriptureDisplay: references }, { ...trackedPoint, title },
    { ...newPassage, scripture: [], scriptureDisplay: [] }, { ...point, title: 'Synthetic layout fixture with no references' },
  ];
  await page.route('**/generated/chapters.json*', (route) => route.fulfill({ json: { ...metadata, units: fixtures } }));
  await page.goto('search/?q=Synthetic%20layout%20fixture');
  // One result per recording; the synthetic chapter is the match, so its long title sits in the match row.
  const cards = page.locator('article.recording-result');
  await expect(cards).toHaveCount(2);
  const longCard = cards.filter({ has: page.locator('.matched-chapter', { hasText: title }) });
  await expect(longCard).toHaveCount(1);
  for (const ref of references.slice(0, 2)) await expect(longCard.getByRole('link', { name: `Read ${ref} in the ESV`, exact: true })).toBeVisible();
  await expect(longCard.locator('.scripture')).toContainText('+2 references');
  const missing = cards.filter({ has: page.locator('.matched-chapter', { hasText: 'Synthetic layout fixture with no references' }) });
  await expect(missing.locator('.metadata')).not.toContainText(/undefined|null/);
  await expect(missing.locator('.scripture')).toHaveCount(0);
  expect((await missing.locator('.metadata').innerText()).trim()).not.toMatch(/·$/);
  await noOverflow(page);
});

test('synthetic response-only long playback title keeps Play and consent clear', async ({ page }) => {
  const title = `Synthetic test-only playback title ${'long title phrase '.repeat(24)}${'unbroken'.repeat(16)}`;
  await page.route('**/watch/**', async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    expect(html).toContain(tracked.recordingTitle);
    await route.fulfill({ response, body: html.replaceAll(tracked.recordingTitle, title) });
  });
  await page.goto(`watch/?r=${tracked.recordingId}`);
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

});
