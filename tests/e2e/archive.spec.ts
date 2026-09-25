import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { SearchPassage } from '../../site/lib/types';

const passages = JSON.parse(readFileSync('dist/preview/generated/passages.json', 'utf8')) as SearchPassage[];
const production = JSON.parse(readFileSync('dist/production/generated/passages.json', 'utf8')) as SearchPassage[];

test('production excludes every unreviewed passage', async ({ request }) => {
  const response = await request.get('http://127.0.0.1:4174/replay-check/generated/passages.json');
  expect(response.ok()).toBe(true);
  const index = await response.json() as SearchPassage[];
  expect(index).toEqual(production);
  expect(index.every((p) => !p.preview)).toBe(true);
  const approvedIds = new Set(index.map((p) => p.id));
  for (const passage of passages.filter((p) => p.preview)) expect(approvedIds.has(passage.id)).toBe(false);
});

test('home, focused search, and policies stay usable at the viewport', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: /No matching passages|No published passages yet/ })).toBeVisible();
  expect(await input.evaluate((element) => element.getBoundingClientRect().top >= 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('keyboard skip link, labelled search, and shareable URL state', async ({ page }) => {
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

test('real preview passage search opens a reload-safe player and soft endpoint', async ({ page }) => {
  test.skip(!passages.length, 'Real content is not yet available; this cannot satisfy the milestone gate.');
  const passage = passages[0];
  // Exact results must work even when semantic assets cannot load.
  await page.route('**/models/**', (route) => route.abort());
  await page.goto(`search/?q=${encodeURIComponent(passage.title)}`);
  await expect(page.getByRole('heading', { name: passage.title, exact: true }).first()).toBeVisible();
  if (passage.preview) await expect(page.getByText(/Unreviewed preview/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Play passage', exact: true }).first().click();
  await expect(page).toHaveURL(/watch\/\?id=/);
  await page.reload();
  await expect(page.getByRole('heading', { name: passage.title, exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Exercise the real UI/controller with a deterministic IFrame API adapter.
  // This does not replace the required manual check of actual YouTube playback.
  await page.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.YT={Player:class{constructor(host,options){this.time=0;this.state=2;this.iframe=document.createElement('iframe');host.replaceWith(this.iframe);window.testPlayer=this;setTimeout(()=>options.events.onReady({target:this}),0)}seekTo(time){this.time=time}playVideo(){this.state=1}pauseVideo(){this.state=2}getCurrentTime(){return this.time}getPlayerState(){return this.state}getIframe(){return this.iframe}destroy(){this.iframe.remove()}}};window.onYouTubeIframeAPIReady();`,
  }));
  await page.locator('button.play-button').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { testPlayer?: { time: number } }).testPlayer?.time)).toBe(passage.start);
  await page.evaluate((end) => { (window as unknown as { testPlayer: { time: number } }).testPlayer.time = end; }, passage.end);
  await expect(page.getByText('Passage finished. Playback is paused.')).toBeVisible();
  await page.getByRole('button', { name: /Continue watching/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { testPlayer: { state: number } }).testPlayer.state)).toBe(1);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as { testPlayer: { state: number } }).testPlayer.state)).toBe(1);
});
