import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import type { SearchUnit } from '../../site/lib/display';
import { fakeYouTube, player, previewUnits, setPlayerTime } from './archive-fixtures';
import { browserEndpoints } from '../../scripts/testing-config';

const production = JSON.parse(readFileSync('dist/production/generated/chapters.json', 'utf8')).units as SearchUnit[];

test('production excludes every draft recording', async ({ request }) => {
  const response = await request.get(`${browserEndpoints().production}generated/chapters.json`);
  expect(response.ok()).toBe(true);
  const index = (await response.json()).units as SearchUnit[];
  expect(index).toEqual(production);
  expect(index.every((unit) => !unit.preview)).toBe(true);
  const published = new Set(index.map((unit) => unit.id));
  for (const unit of previewUnits.filter((item) => item.preview)) expect(published.has(unit.id)).toBe(false);
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
  await expect(page.getByRole('heading', { name: /No matching recordings|No published recordings yet/ })).toBeVisible();
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

test('a matched subchapter opens its recording and can be played on its own', { tag: '@responsive' }, async ({ page }) => {
  const point = previewUnits.find((unit) => unit.kind === 'subchapter' && unit.recordingId === '2026-09-06')!;
  const recording = previewUnits.find((unit) => unit.id === point.recordingId)!;
  const end = point.end!;
  // Exact results must work even when semantic assets cannot load.
  await page.route('**/models/**', (route) => route.abort());
  await page.goto(`search/?q=${encodeURIComponent(point.title)}`);
  const focus = point.entryId!;
  const result = page.locator(`.recording-result[data-match="${focus}"]`);
  await expect(result.locator('.matched-chapter')).toContainText(point.title);
  if (point.preview) await expect(page.getByText(/Unreviewed preview/).first()).toBeVisible();
  await result.locator('h2 a').click();
  await expect(page).toHaveURL(new RegExp(`watch/\\?r=${point.recordingId}&t=\\d+&focus=${focus}$`));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: recording.recordingTitle, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await fakeYouTube(page);
  await page.locator('button.play-button').click();
  await expect(page.locator('.chapter-controls [role="status"]')).toHaveText('Playing to the end of the recording.');
  await page.locator('.chapter-controls').getByRole('button', { name: 'Chapter only', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`watch/\\?r=${point.recordingId}&t=${Math.floor(point.start)}&focus=${focus}$`));
  await expect(page.locator('.chapter-controls [role="status"]')).toHaveText(`Playback will stop at the end of “${point.title}”.`);
  await expect.poll(async () => (await player(page))?.time).toBe(point.start);
  await setPlayerTime(page, end);
  await expect(page.getByText(`Paused at the end of “${point.title}”.`)).toBeVisible();
  await page.getByRole('button', { name: 'Keep playing', exact: true }).click();
  await expect.poll(async () => (await player(page))?.state).toBe(1);
  const ticks = (await player(page))!.ticks;
  await expect.poll(async () => (await player(page))!.ticks).toBeGreaterThan(ticks + 1);
});
