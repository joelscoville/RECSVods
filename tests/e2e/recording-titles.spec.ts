import { test, expect } from './fixtures';

for (const recording of [
  { id: '2026-06-21', title: 'The Third Person', date: '21 June 2026', catalogue: 'browse/all/' },
  { id: '2026-09-13', title: 'Simple but Demanding', date: '13 September 2026', catalogue: '' },
]) test(`recording title stays consistent from catalogue to watch, service and search: ${recording.title}`, async ({ page, context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.route('**/*semantic.worker*', route => route.abort());
  await page.goto(recording.catalogue);
  const card = page.locator('.video-card').filter({ has: page.getByRole('heading', { level: 2, name: recording.title, exact: true }) });
  await expect(card).toHaveCount(1);
  await expect(card.locator('.thumb-title')).toHaveText(recording.title);
  await expect(card.locator('.thumb-date')).toHaveText(recording.date);
  await expect(card.locator('time')).toHaveText(recording.date);
  await card.locator('a.video-card-link').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(recording.title);
  await expect(page).toHaveTitle(`${recording.title} | RECS Replay`);
  await expect(page.getByRole('button', { name: `Play ${recording.title}`, exact: true })).toBeVisible();
  await expect(page.locator('.playback-identity time')).toHaveText(recording.date);
  await page.getByRole('link', { name: 'View full service', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(recording.title);
  await expect(page).toHaveTitle(`${recording.title} | RECS Replay`);
  await page.goto(`search/?q=${encodeURIComponent(recording.title)}`);
  const result = page.locator(`.recording-result[data-service="${recording.id}"]`);
  await expect(result.locator('h2')).toHaveText(recording.title);
  await result.locator('h2 a').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(recording.title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
