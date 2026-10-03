import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { fakeYouTube, player } from './archive-fixtures';
const KEY = 'recs-chapter-editor:layout:v2';
async function open(page: Page) {
  await page.addInitScript(() => localStorage.setItem('recs-chapter-editor:github-ready', '1'));
  await page.goto('edit/2026-08-30/?t=1985');
  await expect(page.locator('.ce-dock')).toBeVisible();
}
async function show(page: Page, name: string) {
  await page.getByRole('button', { name: 'Windows', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name, exact: true }).click();
}
async function move(page: Page, name: string, target: string, position: string) {
  await page.getByRole('button', { name: `Move ${name}`, exact: true }).click();
  const form = page.locator('.ce-dock-move-popover:visible');
  await form.getByRole('combobox', { name: 'Position', exact: true }).selectOption(position);
  await form.getByRole('combobox', { name: 'Relative to', exact: true }).selectOption(target);
  await form.getByRole('button', { name: 'Move panel', exact: true }).click();
}
async function transcript(page: Page) {
  await show(page, 'Transcript');
  await page.locator('input[type=file][accept*=".srt"]').setInputFiles({ name: 'docking.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:33:05,000 --> 00:33:15,000\nA transcript kept while moving panels.\n\n2\n00:33:15,000 --> 00:33:25,000\nA second line for searching.\n') });
}
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

test('transcript opens full width and both split directions resize with keyboard and pointer', async ({ page }) => {
  await open(page); await transcript(page);
  const transcriptPanel = page.locator('#dock-panel-readalong'), editor = page.locator('#dock-panel-editor');
  const viewport = (await page.locator('.ce-dock').boundingBox())!;
  const box = (await transcriptPanel.boundingBox())!;
  expect(box.width).toBeCloseTo(viewport.width, 0);
  expect(box.y).toBeGreaterThan((await editor.boundingBox())!.y + (await editor.boundingBox())!.height);
  const before = (await editor.boundingBox())!.width;
  const vertical = page.getByRole('separator', { name: 'Resize Edit chapter and Video', exact: true });
  await vertical.focus(); await page.keyboard.press('ArrowLeft');
  expect((await editor.boundingBox())!.width).toBeLessThan(before);
  const divider = page.getByRole('separator', { name: 'Resize Chapters and Transcript', exact: true });
  const handle = (await divider.boundingBox())!, height = (await transcriptPanel.boundingBox())!.height;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2, handle.y - 50); await page.mouse.up();
  expect((await transcriptPanel.boundingBox())!.height).toBeGreaterThan(height + 30);
});

test('moving video preserves the iframe, playback, title draft, and loaded transcript', async ({ page }) => {
  await open(page); await transcript(page); await fakeYouTube(page);
  await page.getByRole('button', { name: 'Load video', exact: true }).click();
  await expect(page.locator('.ce-host iframe')).toBeVisible();
  const frame = await page.locator('.ce-host iframe').elementHandle();
  const title = page.getByRole('textbox', { name: 'Chapter title', exact: true });
  await title.fill('An unsent title while arranging'); await title.press('Enter');
  const search = page.getByRole('searchbox', { name: 'Find in transcript' });
  await search.fill('second');
  const time = (await player(page))!.time;
  await move(page, 'Video', 'chapters', 'left');
  expect(await frame!.evaluate(element => element === document.querySelector('.ce-host iframe'))).toBe(true);
  expect((await player(page))!.time).toBe(time);
  await expect(title).toHaveValue('An unsent title while arranging');
  await expect(search).toHaveValue('second');
  await expect(page.locator('.ce-tr-text')).toHaveText('A second line for searching.');
  await move(page, 'Video', 'editor', 'tab');
  expect(await frame!.evaluate(element => element === document.querySelector('.ce-host iframe'))).toBe(true);
  await page.getByRole('tab', { name: 'Edit chapter', exact: true }).click();
  await expect(title).toHaveValue('An unsent title while arranging');
  await page.getByRole('tab', { name: 'Video', exact: true }).click();
  await move(page, 'Video', 'editor', 'right');
  expect(await frame!.evaluate(element => element === document.querySelector('.ce-host iframe'))).toBe(true);
});

test('header dragging previews a destination, supports cancellation, and persists the dropped position', async ({ page }) => {
  await open(page);
  const original = await page.evaluate(key => localStorage.getItem(key), KEY);
  const from = page.getByRole('tab', { name: 'Video', exact: true }), target = page.locator('#dock-panel-editor');
  const a = (await from.boundingBox())!, b = (await target.boundingBox())!;
  await page.mouse.move(a.x + 30, a.y + 15); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await expect(page.locator('.ce-dock-drop-preview')).toContainText('Group as tabs');
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(original);
  await from.dragTo(target, { targetPosition: { x: 8, y: b.height / 2 } });
  const moved = await page.evaluate(key => localStorage.getItem(key), KEY);
  expect(moved).not.toBe(original);
  expect((await page.locator('#dock-panel-video').boundingBox())!.x).toBeLessThan((await target.boundingBox())!.x);
  await page.reload(); await expect(page.locator('.ce-dock')).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY)).toEqual(JSON.parse(moved!));
  expect((await page.locator('#dock-panel-video').boundingBox())!.x).toBeLessThan((await target.boundingBox())!.x);
});

test('tab groups support keyboard switching, close/reopen, and reset without losing transcript state', async ({ page }) => {
  await open(page); await transcript(page); await show(page, 'Markers');
  const moveMarkers = page.getByRole('button', { name: 'Move Markers', exact: true });
  await moveMarkers.click(); await page.keyboard.press('Escape');
  await expect(page.locator('.ce-dock-move-popover:visible')).toHaveCount(0);
  await expect(moveMarkers).toBeFocused();
  await page.getByRole('tab', { name: 'Transcript', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Markers', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.ce-tr-text').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close Transcript', exact: true }).click();
  await show(page, 'Transcript'); await expect(page.locator('.ce-tr-text').first()).toBeVisible();
  await move(page, 'Transcript', 'video', 'right');
  await page.getByRole('button', { name: 'Windows', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reset the layout', exact: true }).click();
  await expect(page.locator('#dock-panel-readalong')).toBeHidden();
  await show(page, 'Transcript'); await expect(page.locator('.ce-tr-text').first()).toBeVisible();
  expect((await page.locator('#dock-panel-readalong').boundingBox())!.width).toBeCloseTo((await page.locator('.ce-dock').boundingBox())!.width, 0);
});

test('compact screens keep the desktop arrangement and avoid page overflow @responsive', async ({ page }) => {
  await open(page); await transcript(page);
  const saved = await page.evaluate(key => localStorage.getItem(key), KEY);
  for (const width of [1100, 844, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(saved);
  }
});
