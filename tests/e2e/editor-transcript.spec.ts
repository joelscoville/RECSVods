import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { fakeYouTube, player, setPlayerTime } from './archive-fixtures';

const caption = (index: number) => `Caption ${index}: a timed line for checking transcript navigation.`;
async function open(page: Page, time = 400) {
  await page.addInitScript(() => localStorage.setItem('recs-chapter-editor:github-ready', '1'));
  await page.goto(`edit/2026-08-30/?t=${time}`);
  await toggleTranscript(page);
  await page.locator('input[type=file][accept*=".srt"]').setInputFiles({ name: 'follow.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ segments: Array.from({ length: 100 }, (_, i) => ({ start: i * 10, end: i * 10 + 9, text: caption(i) })) })) });
  await expect(page.locator('.ce-tr-lines .is-current')).toHaveText(new RegExp(`Caption ${Math.floor(time / 10)}:`));
}
async function toggleTranscript(page: Page) {
  await page.getByRole('button', { name: 'Windows', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /Transcript$/ }).click();
}
async function scrub(page: Page, seconds: number) {
  await page.getByRole('button', { name: /^Playhead / }).click();
  const input = page.getByRole('textbox', { name: 'Go to time', exact: true });
  await input.fill(String(seconds)); await input.press('Enter');
}
const currentVisible = (page: Page) => page.locator('.ce-tr-lines').evaluate(list => {
  const current = list.querySelector('.is-current');
  if (!current || !list.clientHeight) return false;
  const viewport = list.getBoundingClientRect(), box = current.getBoundingClientRect();
  return box.top >= viewport.top - 1 && box.bottom <= viewport.bottom + 1;
});
const scrollTop = (page: Page) => page.locator('.ce-tr-lines').evaluate(list => list.scrollTop);

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

test('transcript follows forward and backward scrubber moves without an opt-in checkbox @responsive', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('checkbox', { name: 'Follow', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Following now', exact: true })).toBeDisabled();
  await expect.poll(() => currentVisible(page)).toBe(true);
  for (const time of [800, 60, 650]) {
    await scrub(page, time);
    await expect(page.locator('.ce-tr-lines .is-current')).toContainText(caption(time / 10));
    await expect.poll(() => currentVisible(page)).toBe(true);
    await expect(page.getByRole('button', { name: 'Following now', exact: true })).toBeDisabled();
  }
});

test('scrolling away holds the reading position until Return to now, while playback highlight keeps updating', async ({ page }) => {
  await open(page); await fakeYouTube(page);
  await page.getByRole('button', { name: 'Load video', exact: true }).click();
  await expect(page.locator('.ce-host iframe')).toBeVisible();
  await setPlayerTime(page, 600);
  await expect(page.locator('.ce-tr-lines .is-current')).toContainText(caption(60));
  await expect.poll(() => currentVisible(page)).toBe(true);
  await page.locator('.ce-tr-lines').hover(); await page.mouse.wheel(0, -800);
  const back = page.getByRole('button', { name: 'Return to now', exact: true });
  await expect(back).toBeEnabled();
  const readingAt = await scrollTop(page), pageAt = await page.evaluate(() => scrollY);
  // Regression: the previous checkbox implementation stole the view back after four seconds.
  await page.waitForTimeout(4200);
  await setPlayerTime(page, 820);
  await expect(page.locator('.ce-tr-lines .is-current')).toContainText(caption(82));
  expect(await scrollTop(page)).toBeCloseTo(readingAt, 0);
  expect(await page.evaluate(() => scrollY)).toBe(pageAt);
  const playback = await player(page);
  await back.click();
  await expect.poll(() => currentVisible(page)).toBe(true);
  expect((await player(page))!.time).toBe(playback!.time);
  expect((await player(page))!.state).toBe(playback!.state);
  await setPlayerTime(page, 950);
  await expect(page.locator('.ce-tr-lines .is-current')).toContainText(caption(95));
  await expect.poll(() => currentVisible(page)).toBe(true);
});

test('keyboard scrolling browses without seeking, and returning resumes following @responsive', async ({ page }) => {
  await open(page);
  const list = page.getByRole('list', { name: 'Transcript lines', exact: true });
  await list.evaluate(element => { element.style.scrollBehavior = 'smooth'; });
  await list.focus(); await page.keyboard.press('Home');
  await expect(page.getByRole('button', { name: 'Return to now', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Playhead', { exact: true })).toHaveText('6:40');
  await page.getByRole('button', { name: 'Return to now', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(list).toBeFocused();
  await expect.poll(() => currentVisible(page)).toBe(true);
  await expect(page.getByLabel('Playhead', { exact: true })).toHaveText('6:40');
});

test('search can browse away from now, and Return to now restores unfiltered playback context', async ({ page }) => {
  await open(page);
  const search = page.getByRole('searchbox', { name: 'Find in transcript' });
  await search.fill('No such caption');
  await expect(page.locator('.ce-tr-count')).toHaveText('0 lines match');
  await scrub(page, 700);
  await page.getByRole('button', { name: 'Return to now', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.ce-tr-lines .is-current')).toContainText(caption(70));
  await expect.poll(() => currentVisible(page)).toBe(true);
  await page.locator('.ce-tr-lines').focus(); await page.keyboard.press('Home');
  await expect(page.getByRole('button', { name: 'Return to now', exact: true })).toBeEnabled();
  await page.locator('.ce-tr-time').first().click();
  await expect(page.getByLabel('Playhead', { exact: true })).toHaveText('0:00');
  await expect(page.getByRole('button', { name: 'Following now', exact: true })).toBeDisabled();
  await scrub(page, 900); await expect.poll(() => currentVisible(page)).toBe(true);
});

test('reopening and resizing follow the scrubber, but preserve an intentionally browsed position', async ({ page }) => {
  await open(page);
  await toggleTranscript(page); await scrub(page, 850); await toggleTranscript(page);
  await expect.poll(() => currentVisible(page)).toBe(true);
  const splitter = page.getByRole('separator', { name: 'Resize Chapters and Transcript', exact: true });
  await splitter.focus(); await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => currentVisible(page)).toBe(true);
  await page.locator('.ce-tr-lines').focus(); await page.keyboard.press('PageUp'); await page.keyboard.press('PageUp');
  await expect(page.getByRole('button', { name: 'Return to now', exact: true })).toBeEnabled();
  const readingAt = await scrollTop(page);
  expect(readingAt).toBeGreaterThan(0);
  await toggleTranscript(page); await scrub(page, 450); await toggleTranscript(page);
  expect(await scrollTop(page)).toBeCloseTo(readingAt, 0);
  await expect(page.getByRole('button', { name: 'Return to now', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Return to now', exact: true }).click();
  await expect.poll(() => currentVisible(page)).toBe(true);
});
