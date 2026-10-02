import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { browserEndpoints } from '../../scripts/testing-config';

const path = 'services/2026-08-23.yaml';
const sourceText = readFileSync(path, 'utf8');
const title = /^recordingTitle: (.*)$/m.exec(sourceText)![1];

/** Stands in for the public repository: one draft recording, one published copy of it, and the shared lists. */
async function serveRepository(page: Page) {
  const published = sourceText.replace('serviceDate: 2026-08-23', 'serviceDate: 2026-08-30')
    .replace(`recordingTitle: ${title}`, 'recordingTitle: Already Approved').replace('status: draft', 'status: published')
    .replace(/youtubeId: (\S+)/g, 'youtubeId: PUBLISHED01');
  const files: Record<string, string> = { [path]: sourceText, 'services/2026-08-30.yaml': published,
    'taxonomy/topics.yaml': readFileSync('taxonomy/topics.yaml', 'utf8'), 'taxonomy/series.yaml': '[]\n' };
  await page.context().route('https://api.github.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    tree: [...Object.keys(files).map(file => ({ path: file, type: 'blob' })), { path: 'README.md', type: 'blob' }],
  }) }));
  await page.context().route('https://raw.githubusercontent.com/**', route => {
    const file = Object.keys(files).find(name => route.request().url().endsWith(name));
    return file ? route.fulfill({ contentType: 'text/plain', body: files[file] }) : route.fulfill({ status: 404 });
  });
}

test('/dev lists recordings waiting for approval from GitHub, even on production', async ({ page }) => {
  await serveRepository(page);
  await page.goto(`${browserEndpoints().production}dev/`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByText('1 recording waiting for approval.')).toBeVisible();
  const card = page.locator('.dev-card').filter({ hasText: title });
  await expect(card).toContainText('Draft');
  await expect(card.getByRole('link', { name: 'Open here' })).toHaveCount(0);
  await card.getByText('Chapters', { exact: true }).click();
  await expect(card.locator('.dev-chapters li').first()).toBeVisible();
  await expect(card.getByRole('link', { name: 'Check it in the editor' })).toHaveAttribute('href', /\/dev\/edit\/\?id=2026-08-23$/);
  await page.getByLabel('Show published too').check();
  await expect(page.locator('.dev-card').filter({ hasText: 'Already Approved' }).getByRole('link', { name: 'Check it in the editor' })).toHaveCount(0);
  await expect(page.locator('.dev-card').filter({ hasText: 'Already Approved' })).toBeVisible();
});

test('/dev switches force the search modes on every page until set back', async ({ page }) => {
  await serveRepository(page);
  await page.goto('dev/');
  await expect(page.locator('.dev-badge')).toBeHidden();
  await page.getByText('Slow', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-compute-mode', 'low-compute');
  await page.goto('');
  await expect(page.locator('html')).toHaveAttribute('data-compute-mode', 'low-compute');
  await expect(page.locator('.dev-badge')).toHaveCount(0);
  await page.goto('dev/');
  await page.getByRole('button', { name: 'Turn every switch off' }).click();
  await page.goto('');
  await expect(page.locator('html')).toHaveAttribute('data-essential-ready', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-compute-mode', 'low-compute');
  await expect(page.locator('.dev-badge')).toBeHidden();
});

test('the Unapproved switch adds a home page category that opens recordings in the dev player', async ({ page }) => {
  await serveRepository(page);
  await page.route('https://www.youtube.com/**', route => route.abort());
  const production = browserEndpoints().production;
  await page.goto(`${production}dev/`);
  await page.getByText('On the home page', { exact: true }).click();
  await expect(page.locator('.dev-badge')).toHaveCount(0);
  await page.goto(production);
  const chip = page.getByRole('link', { name: /^Unapproved/ });
  await expect(chip).toHaveText('Unapproved (1)');
  await chip.click();
  await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
  const card = page.locator('.video-card').filter({ hasText: title });
  await expect(card).toHaveCount(1);
  await card.locator('a').first().click();
  await expect(page).toHaveURL(/\/dev\/watch\/\?/);
  await expect(page.getByText('Developer view · waiting for approval · not published')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
  await expect(page.getByRole('link', { name: 'View full service' })).toHaveCount(0);
  // Switched off, the home page makes no GitHub requests at all.
  await page.goto(`${production}dev/`);
  await page.getByText('Hidden', { exact: true }).click();
  const requests: string[] = [];
  page.on('request', request => { if (/github/.test(request.url())) requests.push(request.url()); });
  await page.goto(production);
  await expect(page.getByRole('link', { name: /^Unapproved/ })).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('a draft opens in the editor from /dev; sending publishes it', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Clipboard permissions are Chromium-specific here.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await serveRepository(page);
  await page.context().route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>GitHub editor stand-in</title>' }));
  await page.addInitScript(() => localStorage.setItem('recs-chapter-editor:github-ready', '1'));
  await page.goto(`${browserEndpoints().production}dev/edit/?id=2026-08-23`);
  await expect(page.locator('.ce-chapter').first()).toBeVisible();
  await page.getByRole('button', { name: 'Review & send', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send your changes' });
  await expect(dialog).toContainText('marks the recording as checked');
  await dialog.getByRole('button', { name: 'Copy my changes' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('status: published');
  expect(copied).not.toContain('status: draft');
});
