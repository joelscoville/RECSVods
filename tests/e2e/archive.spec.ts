import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import type { SearchChapter } from '../../site/lib/types';
import { chapterFor, chooseOnly } from './archive-fixtures';
import { browserEndpoints } from '../../scripts/testing-config';

const chapters = JSON.parse(readFileSync('dist/preview/generated/chapters.json', 'utf8')).chapters as SearchChapter[];
const production = JSON.parse(readFileSync('dist/production/generated/chapters.json', 'utf8')).chapters as SearchChapter[];

test('old passage links resolve to their chapter without exposing transcript controls', async ({ page }) => {
  const chapter = chapterFor('s0927-romans-order');
  expect(chapter).toBeTruthy();
  await page.goto('watch/?id=p0927-romans-government');
  await expect(page).toHaveURL(new RegExp(`watch/\\?chapter=${chapter.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: chapter.serviceTitle, exact: true })).toBeVisible();
  await expect(page.locator('.chapters .chapter-row[aria-current="true"]')).toContainText(chapter.title);
  await expect(page.locator('.transcript-panel, .compact-passage-list')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit this transcript' })).toHaveCount(0);
});

test('production excludes every unreviewed chapter', async ({ request }) => {
  const response = await request.get(`${browserEndpoints().production}generated/chapters.json`);
  expect(response.ok()).toBe(true);
  const index = (await response.json()).chapters as SearchChapter[];
  expect(index).toEqual(production);
  expect(index.every((p) => !p.preview)).toBe(true);
  const approvedIds = new Set(index.map((p) => p.id));
  for (const chapter of chapters.filter((p) => p.preview)) expect(approvedIds.has(chapter.id)).toBe(false);
});

test('home, focused search, and policies stay usable at the viewport', { tag: '@responsive' }, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const route of ['', 'search/', 'policies/']) {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.goto('search/');
  const input = page.locator('input[type="search"]:visible');
  await input.focus();
  await expect(input).toBeFocused();
  await input.fill('zxqvpl-no-match');
  await expect(page.getByRole('heading', { name: /No matching recordings|No published chapters yet/ })).toBeVisible();
  expect(await input.evaluate((element) => element.getBoundingClientRect().top >= 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('keyboard skip link, labelled search, and shareable URL state', { tag: '@responsive' }, async ({ page }) => {
  await page.goto('search/?q=first-query');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /Skip to/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  const input = page.locator('input[type="search"]:visible');
  await expect(input).toHaveValue('first-query');
  await input.fill('second-query');
  await input.press('Enter');
  await expect(page).toHaveURL(/q=second-query/);
  await page.reload();
  await expect(input).toHaveValue('second-query');
});

test('real preview chapter search opens a reload-safe player and soft endpoint', { tag: '@responsive' }, async ({ page }) => {
  expect(chapters.length, 'Real content is required for acceptance').toBeGreaterThan(0);
  const passage = chapters[0];
  // Exact results must work even when semantic assets cannot load.
  await page.route('**/models/**', (route) => route.abort());
  await page.goto(`search/?q=${encodeURIComponent(passage.title)}`);
  // Results are recordings: a result opens its sermon and carries the matched chapter along.
  const result = page.locator(`.recording-result[data-match="${passage.id}"]`);
  await expect(result.locator('.matched-chapter')).toContainText(passage.title);
  if (passage.preview) await expect(page.getByText(/Unreviewed preview/).first()).toBeVisible();
  const opens = chapters.find((item) => item.videoId === passage.videoId && item.type === 'sermon' && !item.parentId) ?? passage;
  await result.locator('h2 a').click();
  await expect(page).toHaveURL(new RegExp(`watch/\\?chapter=${opens.id}${opens.id === passage.id ? '' : `&match=${passage.id}`}$`));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: passage.serviceTitle, exact: true })).toBeVisible();
  await expect(page.locator('.chapters .chapter-row[aria-current="true"]')).toContainText(opens.title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Exercise the real UI/controller with a deterministic IFrame API adapter.
  // This does not replace the required manual check of actual YouTube playback.
  await page.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.YT={Player:class{constructor(host,options){this.time=0;this.state=2;this.ticks=0;this.iframe=document.createElement('iframe');host.replaceWith(this.iframe);window.testPlayer=this;setTimeout(()=>options.events.onReady({target:this}),0)}seekTo(time){this.time=time}playVideo(){this.state=1}pauseVideo(){this.state=2}getCurrentTime(){this.ticks++;return this.time}getPlayerState(){return this.state}getIframe(){return this.iframe}destroy(){this.iframe.remove()}}};window.onYouTubeIframeAPIReady();`,
  }));
  await page.locator('button.play-button').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { testPlayer?: { time: number } }).testPlayer?.time)).toBe(opens.start);
  // The sermon plays to the end of the service; "Chapter only" plays just the matched chapter.
  await expect(page.locator('.chapter-controls [role="status"]')).toHaveText(/^(Playback will stop at the end of the service|Playing to the end of the recording)\.$/);
  const stopAt = await chooseOnly(page, passage);
  await expect(page).toHaveURL(new RegExp(`watch/\\?chapter=${passage.id}$`));
  // The same chapter keeps its position; jumping to the match starts at its beginning.
  if (opens.id !== passage.id) await expect.poll(() => page.evaluate(() => (window as unknown as { testPlayer?: { time: number } }).testPlayer?.time)).toBe(passage.start);
  await page.evaluate((end) => { (window as unknown as { testPlayer: { time: number } }).testPlayer.time = end; }, stopAt);
  await expect(page.getByText(/^Paused at the end of (this chapter|the sermon)\.$/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep playing', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { testPlayer: { state: number } }).testPlayer.state)).toBe(1);
  const ticks = await page.evaluate(() => window.testPlayer.ticks);
  await expect.poll(() => page.evaluate(() => window.testPlayer.ticks)).toBeGreaterThan(ticks + 1);
  expect(await page.evaluate(() => (window as unknown as { testPlayer: { state: number } }).testPlayer.state)).toBe(1);
});
