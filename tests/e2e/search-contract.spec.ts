import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import type { SearchChapter } from '../../site/lib/types';

const metadata = JSON.parse(readFileSync('dist/preview/generated/chapters.json', 'utf8'));
// Reuse a real recording identity so grouping cannot silently discard the synthetic chapter.
const source = (metadata.chapters as SearchChapter[]).find(chapter => !chapter.parentId)!;
const chapter = { ...source, title: 'Synthetic search contract', summary: 'Read Romans 12:1; John 3:16.',
  keywords: [], topics: [], scripture: [], scriptureDisplay: [] };
const scripture = { schemaVersion: 1, references: {
  'John 3:16': ['John 3:16'], '1 John 2:15-16': ['1 John 2:15'],
}, verses: {
  'John 3:16': 'For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.',
  '1 John 2:15': 'Do not love the world or anything in the world. If anyone loves the world, the love of the Father is not in him.',
} };

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});
async function ready(page: Page) {
  await expect(page.locator('.search-status')).not.toContainText('Loading the archive');
  await expect(page.locator('.search-status')).not.toContainText('Loading Bible verse search');
}

test('separate written references retain identity after metadata loads', async ({ page }) => {
  await page.route('**/generated/chapters.json*', route => route.fulfill({ json: { ...metadata, chapters: [chapter] } }));
  await page.route('**/generated/scripture.json*', route => route.fulfill({ json: { schemaVersion: 1, references: {}, verses: {} } }));
  await page.goto('search/?q=John%203%3A16');
  await ready(page);
  await expect(page.locator('.recording-result')).toHaveCount(1);
  await expect(page.locator('.matched-chapter')).toContainText(chapter.title);
  await expect(page.locator('.match-reasons')).toContainText('Mentions John 3:16');
  await page.getByRole('searchbox', { name: 'Search chapters, dates or Bible references' }).fill('1 John 3:16');
  await expect(page.getByRole('heading', { name: 'No matching recordings' })).toBeVisible();
});

test('negation selects the right visible verse and explicit references take priority', async ({ page }) => {
  const references = Object.keys(scripture.references);
  await page.route('**/generated/chapters.json*', route => route.fulfill({ json: { ...metadata, chapters: [{ ...chapter, summary: 'A reading.', scripture: references, scriptureDisplay: references }] } }));
  await page.route('**/generated/scripture.json*', route => route.fulfill({ json: scripture }));
  await page.goto('search/?q=do%20not%20love%20the%20world');
  await ready(page);
  const first = page.locator('.recording-result .scripture a').first();
  await expect(first).toHaveAttribute('aria-label', 'Read 1 John 2:15 in the ESV');
  await expect(first).toHaveAttribute('href', 'https://www.esv.org/1%20John%202%3A15/');
  for (const text of Object.values(scripture.verses)) await expect(page.getByRole('main')).not.toContainText(text);
  await page.getByRole('searchbox', { name: 'Search chapters, dates or Bible references' }).fill('John 3');
  await expect(first).toHaveAttribute('aria-label', 'Read John 3:16 in the ESV');
});

test('delayed verse text enriches the current query rather than restoring an older selection', async ({ page }) => {
  const references = Object.keys(scripture.references);
  await page.route('**/generated/chapters.json*', route => route.fulfill({ json: { ...metadata, chapters: [{ ...chapter, scripture: references, scriptureDisplay: references }] } }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/generated/scripture.json*', async route => { await gate; await route.fulfill({ json: scripture }); });
  try {
    await page.goto('search/?q=John%203', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.search-status')).toContainText('Loading Bible verse search');
    await page.getByRole('searchbox', { name: 'Search chapters, dates or Bible references' }).fill('do not love the world');
    release();
    await expect(page.locator('.recording-result .scripture a').first()).toHaveAttribute('aria-label', 'Read 1 John 2:15 in the ESV');
    await expect(page.getByRole('heading', { name: 'Results for “do not love the world”' })).toBeVisible();
  } finally { release(); }
});
