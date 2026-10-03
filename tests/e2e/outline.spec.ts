import { expect, test, noModel } from './fixtures';
import { readRecording, seconds } from './archive-fixtures';

const example = readRecording('2026-08-23');
const parent = example.chapters.find(chapter => chapter.subchapters?.length)!;
const child = parent.subchapters![0];

test('the example keeps its named outline, one sermon description, and hidden point text', { tag: '@responsive' }, async ({ page, context }, testInfo) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  for (const route of ['services/2026-08-23/', 'watch/?r=2026-08-23']) {
    await page.goto(route);
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
    await expect(page.locator('.sermon-description')).toHaveCount(1);
    await expect(page.locator('.sermon-description p')).toHaveText(example.sermonDescription!.replace(/\s+/g, ' '));
    const outline = page.locator(route.startsWith('services/') ? '.service-chapters' : '.chapters');
    await expect(outline.locator('.outline-list > .outline-item > .outline-entry .chapter-row strong')).toHaveText(example.chapters.map(chapter => chapter.chapterTitle));
    await expect(outline.locator('details, summary')).toHaveCount(0);
    // One toggle reveals every key point and part in place: the panel toggle, or the footer toggle on phone watch pages.
    const toggle = route.startsWith('services/') ? outline.locator('.subsection-toggle') : page.locator('.chapters .subsection-toggle, .playback-footer .subsection-button').locator('visible=true');
    await expect(toggle).toHaveText('Show Subchapters');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const branch = outline.locator('.outline-item').filter({ has: page.getByText(parent.chapterTitle, { exact: true }) }).locator('.chapter-subsections');
    await expect(branch).toBeHidden();
    const url = page.url();
    await toggle.focus(); await page.keyboard.press('Enter');
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText('Hide Subchapters');
    await expect(branch).toBeVisible();
    await expect(branch.locator('.chapter-row')).toHaveCount(parent.subchapters!.length);
    expect(page.url()).toBe(url); // Expanding never starts playback or navigates.
    // Key point summaries are for search; the outline shows titles only.
    const text = await outline.innerText();
    for (const section of example.chapters.flatMap(chapter => [chapter, ...(chapter.subchapters ?? [])])) for (const point of section.points ?? []) expect(text).not.toContain(point.pointText.replace(/\s+/g, ' '));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(route.startsWith('services/') ? 'service-outline.png' : 'watch-outline.png'), fullPage: false });
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(branch).toBeHidden();
    await toggle.click();
    await branch.locator('.chapter-row').filter({ hasText: child.chapterTitle }).click();
    if (route.startsWith('services/')) await expect(page).toHaveURL(new RegExp(`watch/\\?r=2026-08-23&t=${Math.floor(seconds(child.chapterStart))}&focus=${child.chapterId}$`));
    await expect(page.locator('h1')).toHaveText(example.recordingTitle);
    await expect(page.locator('.chapters .chapter-row[aria-current="true"]')).toContainText(child.chapterTitle);
  }
});

test('metadata and BSB results precede the model; semantic results merge without blocking playback', { tag: '@model' }, async ({ page, context }, testInfo) => {
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
    await page.locator('input[type="search"]:visible').fill('living sacrifice');
    releaseBible();
    await expect(page.locator('.match-reasons').filter({ hasText: 'Verse-text match (BSB)' }).first()).toBeVisible();
    await expect(page.locator('.search-status')).toContainText('with exact search.');
    releaseModel();
    await expect(page.locator('.search-status').getByText(/^\d+ recordings? found\.$/)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('search.png'), fullPage: false });
    await page.goto('watch/?r=2020-09-27');
    await expect(page.locator('.sermon-description')).toHaveCount(1);
    await expect(page.locator('.transcript-panel')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { releaseBible(); releaseModel(); }
});
