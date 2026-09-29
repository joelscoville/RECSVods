import { expect, test, noModel } from './fixtures';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { ServiceSource } from '../../site/lib/types';

const example = parse(readFileSync('services/2026/2026-08-23/service.yaml', 'utf8')) as ServiceSource;

test('the example has one description and an integrated, keyboard-operable subsection tree', { tag: '@responsive' }, async ({ page, context }, testInfo) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const parent = example.chapters.find(chapter => chapter.id === 'c20260823-worship-scripture')!;
  const cue = example.chapters.find(chapter => chapter.parent_id === parent.id)!;
  for (const route of ['services/2026-08-23/', 'watch/?chapter=c20260823-trust-christs-care']) {
    await page.goto(route);
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
    await expect(page.locator('.sermon-description')).toHaveCount(1);
    await expect(page.locator('.sermon-description p')).toHaveText(example.sermon_description!);
    const outline = page.locator(route.startsWith('services/') ? '.service-chapters' : '.chapters');
    await expect(outline.locator('.outline-list > .outline-item')).toHaveCount(9);
    await expect(outline.locator('details, summary')).toHaveCount(0);
    // One toggle reveals every subsection in place: the panel toggle, or the footer toggle on phone watch pages.
    const toggle = route.startsWith('services/') ? outline.locator('.subsection-toggle') : page.locator('.chapters .subsection-toggle, .playback-footer .subsection-button').locator('visible=true');
    await expect(toggle).toHaveText('Show Subsections');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const branch = outline.locator('.outline-item').filter({ has: page.getByText(parent.title, { exact: true }) }).locator('.chapter-subsections');
    await expect(branch).toBeHidden();
    const url = page.url();
    await toggle.focus(); await page.keyboard.press('Enter');
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText('Hide Subsections');
    await expect(branch).toBeVisible();
    await expect(branch.locator('.chapter-row')).toContainText(cue.title);
    expect(page.url()).toBe(url); // Expanding a chapter never starts playback or navigates.
    const outlineText = await outline.innerText();
    for (const chapter of example.chapters) expect(outlineText).not.toContain(chapter.summary);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (route.startsWith('services/')) {
      await outline.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('service-outline-tree.png'), fullPage: false });
    } else {
      await page.screenshot({ path: testInfo.outputPath('watch-outline-tree.png'), fullPage: false });
    }
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(branch).toBeHidden();
    await toggle.click();
    await branch.locator('.chapter-row').click();
    await expect(page).toHaveURL(new RegExp(`watch/\\?chapter=${cue.id}$`));
    await expect(page.locator('h1')).toHaveText(example.title);
    await expect(page.locator('.chapters .chapter-row[aria-current="true"]')).toContainText(cue.title);
  }
});

test('metadata and BSB results precede the model; semantic results merge without blocking chapter playback', { tag: '@model' }, async ({ page, context }, testInfo) => {
  test.skip(noModel, 'Real semantic merging is verified locally, never inferred in CI.');
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  let releaseModel!: () => void, releaseBible!: () => void;
  const model = new Promise<void>(resolve => { releaseModel = resolve; });
  const bible = new Promise<void>(resolve => { releaseBible = resolve; });
  // Asset installation lives in a service worker; hold the inference worker, not its SW-owned fetches.
  await page.route('**/*semantic.worker*', async route => { await model; await route.continue(); });
  await page.route('**/generated/scripture.json*', async route => { await bible; await route.continue(); });
  try {
    await page.goto('search/?q=Romans%2013', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.match-reasons').filter({ hasText: 'Scripture: Romans 13' }).first()).toBeVisible();
    await expect(page.locator('.search-status')).toContainText('with exact search.');
    await expect(page.locator('.search-status')).toContainText('Loading Bible verse search.');
    const input = page.locator('input[type="search"]:visible');
    await input.fill('living sacrifice');
    releaseBible();
    await expect(page.locator('.match-reasons').filter({ hasText: 'Verse-text match (BSB)' }).first()).toBeVisible();
    await expect(page.locator('.search-status')).toContainText('with exact search.');
    releaseModel();
    await expect(page.locator('.search-status').getByText(/^\d+ recordings? found\.$/)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('chapter-search.png'), fullPage: false });
    await page.goto('watch/?chapter=s0927-romans-order');
    await expect(page.locator('.sermon-description')).toHaveCount(1);
    await expect(page.locator('.playback-summary')).toHaveCount(0);
    await expect(page.locator('.transcript-panel')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('chapter-watch.png'), fullPage: false });
  } finally { releaseBible(); releaseModel(); }
});
