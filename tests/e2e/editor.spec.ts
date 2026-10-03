import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { parse } from 'yaml';
import { expect, test } from './fixtures';
import { formatTimecode, parseTimecode } from '../../site/lib/timecode';
import type { RecordingSource } from '../../site/lib/recording-schema';
import { fakeYouTube, player, setPlayerTime } from './archive-fixtures';

const id = '2026-08-23', file = `services/${id}.yaml`, sourceText = readFileSync(file, 'utf8');
const recording = parse(sourceText) as RecordingSource;
const sermon = recording.chapters.find(chapter => chapter.chapterKind === 'sermon')!;
const child = recording.chapters.flatMap(chapter => chapter.subchapters ?? []).find(chapter => chapter.chapterKind === 'sermon')!;
const entries = recording.chapters.flatMap(chapter => [chapter, ...(chapter.subchapters ?? [])]);
const points = entries.flatMap(chapter => chapter.points ?? []);
const draftKey = `recs-recording-editor:v3:${id}`;
const chapterTypes = ['acts', 'opening', 'sermon', 'closing', 'communion', 'music', 'qa', 'other'];
const selected = (page: Page) => page.locator('.ce-editor-pane .ce-point-note.is-selected, .ce-section-editor:not(:has(.ce-point-note.is-selected))');
const currentTitle = (page: Page) => page.locator('.ce-list .ce-entry.is-current > .ce-row .ce-title');
const row = (page: Page, entryId: string) => page.locator(`.ce-entry[data-entry="${entryId}"]`);
const clock = (time: number) => formatTimecode(Math.round(time * 100) / 100).replace(/\.(\d)$/, (_, digit: string) => `.${digit}0`);
async function openEditor(page: Page, time?: number, recordingId = id) {
  await page.addInitScript(() => localStorage.setItem('recs-chapter-editor:github-ready', '1'));
  await page.goto(`edit/${recordingId}/${time === undefined ? '' : `?t=${time}`}`);
  await expect(selected(page)).toBeVisible();
}
async function select(page: Page, entryId: string) {
  if (!await row(page, entryId).isVisible() && await page.getByRole('button', { name: 'Back to chapters', exact: true }).isVisible()) await page.getByRole('button', { name: 'Back to chapters', exact: true }).click();
  const parent = recording.chapters.find(chapter => chapter.subchapters?.some(child => child.chapterId === entryId));
  if (parent && !await row(page, entryId).isVisible()) await row(page, parent.chapterId).getByRole('button', { name: `Expand ${parent.chapterTitle}`, exact: true }).click();
  await row(page, entryId).locator(':scope > .ce-row .ce-title').click();
}
async function rename(page: Page, entryId: string, title: string) {
  await select(page, entryId);
  const input = selected(page).getByRole('textbox', { name: /chapter title/i });
  await input.fill(title); await input.press('Enter');
}
async function loadVideo(page: Page) {
  await fakeYouTube(page); await page.getByRole('button', { name: 'Load video', exact: true }).click();
  await expect(page.locator('.ce-host iframe')).toBeVisible();
}
async function serveFromGitHub(page: Page, text = sourceText) {
  await page.context().route('https://raw.githubusercontent.com/**', route => route.request().url().endsWith(`/main/${file}`)
    ? route.fulfill({ contentType: 'text/plain', body: text }) : route.fulfill({ status: 404, body: 'Not found' }));
  await page.context().route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>GitHub stand-in</title>' }));
}
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

test('selection exposes full editable content in a separate pane @responsive', async ({ page }) => {
  await openEditor(page);
  await select(page, sermon.chapterId);
  await expect(page.locator('.ce-chapter')).toHaveCount(entries.length);
  await expect(page.locator('.ce-point-note')).toHaveCount(sermon.points?.length ?? 0);
  await expect(row(page, sermon.chapterId).locator(':scope > .ce-row .ce-title')).toHaveText(sermon.chapterTitle);
  await expect(page.getByRole('textbox', { name: 'Chapter title', exact: true })).toHaveValue(sermon.chapterTitle);
  await expect(page.locator('.ce-list textarea')).toHaveCount(0);
  for (const field of await page.locator('.ce-editor-pane textarea').all()) {
    expect(await field.evaluate(element => element.scrollHeight <= element.clientHeight + 2)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.tl-empty-hint')).toHaveCount(0);
});

test('every chapter level has an editable title and all eight types @responsive', async ({ page }) => {
  await openEditor(page);
  for (const [entry, title] of [[sermon, 'A Chapter I Named'], [child, 'A Subchapter I Named']] as const) {
    await rename(page, entry.chapterId, title);
    const type = selected(page).getByRole('combobox', { name: 'Type', exact: true });
    await expect(type).toBeVisible();
    expect(await type.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(chapterTypes);
    for (const kind of chapterTypes) {
      await type.selectOption(kind);
      await expect(currentTitle(page)).toHaveText(title);
      await expect(selected(page)).toHaveAttribute('data-entry', entry.chapterId);
    }
  }
});

test('points are diamonds with a time and text, not public chapter ranges @responsive', async ({ page }) => {
  await openEditor(page, parseTimecode(child.chapterStart) + 5);
  await expect(page.locator('.tl-lane[data-lane="point"] .tl-point')).toHaveCount(points.length);
  await expect(page.locator('.tl-lane[data-lane="point"] .tl-block')).toHaveCount(0);
  await page.locator('.ce-root').focus(); await page.keyboard.press('k');
  await expect(selected(page)).toHaveAttribute('data-lane', 'point');
  await selected(page).getByRole('textbox', { name: /^Description at/ }).fill('The preacher explains the promise here.');
  await expect(selected(page).locator('.ce-title, .ce-check, .ce-row')).toHaveCount(0);
  await expect(selected(page).getByRole('group', { name: 'End', exact: true })).toHaveCount(0);
  await expect(page.locator('.tl-point')).toHaveCount(points.length + 1);
  const state = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, draftKey);
  expect(state.points.at(-1)).toMatchObject({ parentId: child.chapterId, time: parseTimecode(child.chapterStart) + 5, text: 'The preacher explains the promise here.' });
  expect(state.points.at(-1)).not.toHaveProperty('end');
});

test('the sidebar nests by ownership, collapses sections, and reveals a point chosen on the timeline @responsive', async ({ page }) => {
  await openEditor(page);
  if (await page.getByRole('button', { name: 'Back to chapters', exact: true }).isVisible()) await page.getByRole('button', { name: 'Back to chapters', exact: true }).click();
  const parent = recording.chapters.find(chapter => chapter.subchapters?.some(item => item.chapterId === child.chapterId))!;
  const parentRow = row(page, parent.chapterId), children = parentRow.locator(':scope > .ce-children');
  const toggle = parentRow.locator(':scope > .ce-row .ce-expand');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await expect(children.locator(`:scope > [data-entry="${child.chapterId}"]`)).toBeVisible();
  await toggle.click(); await expect(children).toBeHidden();
  const pointId = `${child.chapterId}/point-1`;
  await page.locator(`.tl-point[data-point="${pointId}"]`).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.ce-section-editor')).toHaveAttribute('data-entry', child.chapterId);
  await expect(selected(page)).toHaveAttribute('data-entry', pointId);
  await expect(selected(page).getByRole('textbox', { name: /^Description at/ })).toHaveValue(child.points![0].pointText);
  await expect(page.getByLabel('Playhead', { exact: true })).toHaveText(clock(parseTimecode(child.points![0].pointTime)));
  await expect(selected(page).locator('.ce-title, .ce-check')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Point \d+$/ })).toHaveCount(0);
});

test('saving and restoring a draft retains undo, redo and an undoable start over @responsive', async ({ page }) => {
  await openEditor(page); await rename(page, sermon.chapterId, 'My Saved Chapter');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(currentTitle(page)).toHaveText(sermon.chapterTitle);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(currentTitle(page)).toHaveText('My Saved Chapter');
  await page.reload(); await expect(page.getByText('Draft restored')).toBeVisible();
  await expect(row(page, sermon.chapterId).locator(':scope > .ce-row .ce-title')).toHaveText('My Saved Chapter');
  await page.getByRole('button', { name: 'Start over', exact: true }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(row(page, sermon.chapterId).locator(':scope > .ce-row .ce-title')).toHaveText('My Saved Chapter');
  await page.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)!); saved.state.chapters = [{}]; localStorage.setItem(key, JSON.stringify(saved)); }, draftKey);
  await page.reload(); await expect(page.getByText('Draft restored')).toHaveCount(0);
});

test('undoing every edit clears the saved draft and reload cannot restore discarded changes', async ({ page }) => {
  await openEditor(page); await rename(page, sermon.chapterId, 'A correction that will be undone');
  await expect.poll(() => page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key) ?? 'null')?.state.chapters.find((chapter: { id: string }) => chapter.id === id)?.title,
    { key: draftKey, id: sermon.chapterId })).toBe('A correction that will be undone');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(currentTitle(page)).toHaveText(sermon.chapterTitle);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull();
  await page.reload();
  await expect(row(page, sermon.chapterId).locator(':scope > .ce-row .ce-title')).toHaveText(sermon.chapterTitle);
  await expect(page.getByText('Draft restored')).toHaveCount(0);
});

test('editing without video or sending makes no external requests', async ({ page }) => {
  const external: string[] = []; page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
  await openEditor(page); await rename(page, sermon.chapterId, 'A Changed Title');
  await page.getByRole('button', { name: 'Help and shortcuts' }).click();
  await expect(page.getByRole('dialog')).toContainText('diamond');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(external).toEqual([]);
  await page.getByRole('button', { name: 'Review & send', exact: true }).click();
  await expect.poll(() => external.length).toBeGreaterThan(0);
  expect(external.every(url => url === `https://raw.githubusercontent.com/example/archive-corrections/main/${file}`)).toBe(true);
});

test('sending preserves the source file and sends changed chapter names and types', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); await serveFromGitHub(page);
  await openEditor(page); await rename(page, child.chapterId, 'A Reviewed Subchapter');
  await selected(page).getByRole('combobox', { name: 'Type', exact: true }).selectOption('qa');
  await page.getByRole('button', { name: 'Review & send', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button', { name: 'Copy my changes' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy my changes' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText()), result = parse(copied) as RecordingSource;
  const edited = result.chapters.flatMap(chapter => chapter.subchapters ?? []).find(chapter => chapter.chapterId === child.chapterId)!;
  expect(edited.chapterTitle).toBe('A Reviewed Subchapter'); expect(edited.chapterKind).toBe('qa'); expect(result.status).toBe('published');
  expect(edited.points).toEqual(child.points);
  expect(copied.split('\n')[0]).toBe(sourceText.split('\n')[0]);
  const opened = context.waitForEvent('page'); await dialog.getByRole('button', { name: 'Open GitHub' }).click();
  const github = await opened; await github.waitForLoadState(); expect(new URL(github.url()).pathname).toBe(`/example/archive-corrections/edit/main/${file}`);
});

test('sending refuses concurrent changes to the edited chapter', async ({ page }) => {
  await serveFromGitHub(page, sourceText.replace(`chapterTitle: ${sermon.chapterTitle}`, 'chapterTitle: Someone Else Changed This'));
  await openEditor(page); await rename(page, sermon.chapterId, 'My Changed Chapter');
  await page.getByRole('button', { name: 'Review & send', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('changed this recording on GitHub');
  await expect(page.getByRole('button', { name: 'Copy my changes' })).toHaveCount(0);
});

test('a missing title blocks sending and leads back to the correct chapter', async ({ page }) => {
  await openEditor(page); await rename(page, child.chapterId, '');
  await page.getByRole('button', { name: 'Review & send', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('A few things need fixing');
  await page.locator('.ce-issues button').first().click();
  await expect(selected(page)).toHaveAttribute('data-entry', child.chapterId);
});

test('a reviewer can add a named subchapter inside a sermon and undo it', async ({ page }) => {
  await openEditor(page, parseTimecode(sermon.chapterStart) + 1);
  await page.getByRole('toolbar').getByRole('button', { name: 'Subchapter', exact: true }).click();
  const input = selected(page).getByRole('textbox', { name: 'Subchapter title' });
  await input.fill('A New Subchapter'); await input.press('Enter');
  await expect(selected(page)).toHaveAttribute('data-lane', 'subchapter');
  await expect(selected(page).getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('sermon');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.ce-chapter[data-lane="subchapter"]')).toHaveCount(entries.length - recording.chapters.length);
});

test('moving a chapter start also moves its touching neighbour and first note', async ({ page }) => {
  await openEditor(page); await loadVideo(page);
  const start = parseTimecode(sermon.chapterStart); await setPlayerTime(page, start + 2);
  await expect(page.getByLabel('Playhead', { exact: true })).not.toHaveText('0:00');
  await select(page, sermon.chapterId);
  await selected(page).getByRole('group', { name: 'Start', exact: true }).getByRole('button', { name: /^Set to/ }).click();
  const state = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, draftKey);
  expect(state.chapters.find((chapter: { id: string }) => chapter.id === sermon.chapterId).start).toBe(start + 2);
  expect(state.points.find((point: { parentId: string }) => point.parentId === sermon.chapterId).time).toBe(start + 2);
});

test('selecting a row does not move playback; clicking its time does', async ({ page }) => {
  await openEditor(page, 42); await loadVideo(page); await select(page, child.chapterId);
  expect((await player(page))!.time).toBe(42);
  await row(page, child.chapterId).locator(':scope > .ce-row .ce-range').click();
  await expect.poll(async () => (await player(page))?.time).toBe(parseTimecode(child.chapterStart));
});

test('review markers stay local unless selected for sending', async ({ page }) => {
  await openEditor(page, 60); await page.locator('.ce-root').focus(); await page.keyboard.press('m');
  const marker = page.locator('.ce-marker.is-mine').last(); await marker.getByRole('textbox').fill('Check this moment.');
  await expect(marker.getByLabel('Send with my changes')).not.toBeChecked();
  await marker.getByLabel('Send with my changes').check();
  await serveFromGitHub(page); await page.getByRole('button', { name: 'Review & send', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button', { name: 'Copy my changes' })).toBeVisible();
  await dialog.getByText(/^See what you changed/).click(); await expect(dialog.locator('.ce-diff-added')).toContainText([/markerNote: Check this moment/]);
});

test('a local transcript stays in the browser and its time moves the playhead', async ({ page }) => {
  await openEditor(page); await page.getByRole('button', { name: 'Windows', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Transcript', exact: true }).click();
  await page.locator('input[type="file"][accept*=".srt"]').setInputFiles({ name: 'notes.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:12,000 --> 00:00:15,000\nA local transcript line.\n') });
  await expect(page.locator('.ce-tr-text')).toHaveText('A local transcript line.');
  await page.locator('.ce-tr-time').click(); await expect(page.getByLabel('Playhead', { exact: true })).toHaveText('0:12');
});

test('switching from a local file back to YouTube keeps the recording time', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, set() {
      Object.defineProperties(this, { duration: { configurable: true, value: 6000 }, currentTime: { configurable: true, writable: true, value: 0 } });
      queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')));
    } });
    HTMLMediaElement.prototype.play = async () => {}; HTMLMediaElement.prototype.pause = () => {}; HTMLMediaElement.prototype.load = () => {};
  });
  await fakeYouTube(page); await openEditor(page, 1800);
  await page.locator('input[type="file"][accept="video/*"]').setInputFiles({ name: 'local.mp4', mimeType: 'video/mp4', buffer: Buffer.from('test local player') });
  await expect(page.locator('.ce-host video')).toBeVisible(); await page.getByRole('button', { name: 'Use YouTube instead' }).click();
  await expect(page.locator('.ce-host iframe')).toBeVisible(); await expect.poll(async () => (await player(page))?.time).toBe(1800);
});

test('first visit explains GitHub, and the editor remembers the answer', async ({ page }) => {
  await page.goto(`edit/${id}/`); await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible();
  await page.getByRole('button', { name: 'Just look around first' }).click();
  await expect(page.locator('.ce-chapter').first()).toBeVisible(); await page.reload();
  await expect(page.locator('.ce-chapter').first()).toBeVisible(); await expect(page.getByRole('heading', { name: 'Before you start' })).toHaveCount(0);
});

test('a timestamped description goes to its own time and never selects its parent @responsive', async ({ page }) => {
  await openEditor(page, 42);
  const pointId = `${child.chapterId}/point-1`, time = parseTimecode(child.points![0].pointTime);
  await page.locator(`.tl-point[data-point="${pointId}"]`).click();
  await expect(selected(page)).toHaveAttribute('data-entry', pointId);
  await expect(page.getByLabel('Playhead', { exact: true })).toHaveText(clock(time));
  await page.getByRole('button', { name: /^Playhead / }).click();
  await page.getByRole('textbox', { name: 'Go to time', exact: true }).fill('0:42');
  await page.getByRole('textbox', { name: 'Go to time', exact: true }).press('Enter');
  await selected(page).getByRole('textbox', { name: /^Description at/ }).click();
  await expect(page.getByLabel('Playhead', { exact: true })).toHaveText('0:42');
  await selected(page).getByRole('button', { name: `Go to ${clock(time)}`, exact: true }).click();
  await expect(page.getByLabel('Playhead', { exact: true })).toHaveText(clock(time));
  const box = await selected(page).boundingBox();
  await selected(page).click({ position: { x: box!.width - 2, y: box!.height - 2 } });
  await expect(selected(page)).toHaveAttribute('data-entry', pointId);
  await expect(selected(page).locator('.ce-title, .ce-check, .ce-row, select')).toHaveCount(0);
});

test('a small hand movement while clicking a diamond does not move the description', async ({ page }) => {
  await openEditor(page);
  const diamond = page.locator('.tl-point').nth(3), before = await diamond.getAttribute('aria-label');
  const box = await diamond.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 1, box!.y + box!.height / 2); await page.mouse.up();
  await expect(diamond).toHaveAttribute('aria-label', before!);
  await expect(page.locator('.ce-status')).toContainText('0 changes');
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull();
});

test('sidebar selection keeps the clicked header in place instead of scrolling the whole page', async ({ page }) => {
  await openEditor(page);
  const target = recording.chapters.at(-1)!, header = row(page, target.chapterId).locator(':scope > .ce-row');
  await header.scrollIntoViewIfNeeded();
  const before = (await header.boundingBox())!.y, pageY = await page.evaluate(() => scrollY);
  await header.locator('.ce-title').click();
  await expect(selected(page)).toHaveAttribute('data-entry', target.chapterId);
  expect(Math.abs((await header.boundingBox())!.y - before)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => scrollY)).toBe(pageY);
});

test('Escape cancels a rename and Undo reverses one completed rename at a time', async ({ page }) => {
  await openEditor(page); await select(page, sermon.chapterId);
  await selected(page).getByRole('textbox', { name: 'Chapter title', exact: true }).fill('This should be cancelled');
  await selected(page).getByRole('textbox', { name: 'Chapter title', exact: true }).press('Escape');
  await expect(currentTitle(page)).toHaveText(sermon.chapterTitle);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await rename(page, sermon.chapterId, 'First completed rename');
  await rename(page, sermon.chapterId, 'Second completed rename');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(currentTitle(page)).toHaveText('First completed rename');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(currentTitle(page)).toHaveText('Second completed rename');
});

test('time entry is keyboard accessible and keeps invalid input visible with an explanation', async ({ page }) => {
  await openEditor(page);
  await selected(page).getByRole('group', { name: 'Start', exact: true }).locator('button.ce-edge-time').focus();
  await page.keyboard.press('F2');
  const boundary = page.getByRole('textbox', { name: 'Start time', exact: true });
  await boundary.fill('not a time'); await boundary.press('Enter');
  await expect(boundary).toHaveValue('not a time'); await expect(boundary).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toContainText('Enter a time like 33:05');
  await page.getByRole('button', { name: 'Review & send', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(boundary).toBeFocused();
  await boundary.press('Escape'); await expect(boundary).toHaveCount(0);
  await expect(page.locator('.ce-status')).toContainText('0 changes');
  await page.getByRole('button', { name: /^Playhead / }).click();
  const go = page.getByRole('textbox', { name: 'Go to time', exact: true });
  await go.fill('still invalid'); await go.press('Enter'); await expect(go).toBeVisible();
  await go.fill('0:42'); await go.press('Enter'); await expect(page.getByLabel('Playhead', { exact: true })).toHaveText('0:42');
});

test('invalid boundary commands are disabled consistently and shortcuts cannot invert a chapter', async ({ page }) => {
  await openEditor(page, 0); await select(page, sermon.chapterId);
  await expect(page.getByRole('toolbar').getByRole('button', { name: 'End here', exact: true })).toBeDisabled();
  await expect(selected(page).getByRole('group', { name: 'End', exact: true }).getByRole('button', { name: 'Set to 0:00', exact: true })).toBeDisabled();
  await page.locator('.ce-root').focus(); await page.keyboard.press('o');
  await expect(page.locator('.ce-status')).toContainText('0 changes');
  await currentTitle(page).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /^End here \(0:00\)/ })).toBeDisabled();
});

test('closing a menu returns keyboard focus and Tab continues beside its trigger', async ({ page }) => {
  await openEditor(page);
  const windows = page.getByRole('button', { name: 'Windows', exact: true });
  await windows.focus(); await page.keyboard.press('Enter'); await expect(windows).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
  await expect(windows).toBeFocused(); await expect(windows).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Help and shortcuts', exact: true })).toBeFocused();
});

test('local edits can be cleared even when GitHub cannot be reached', async ({ page }) => {
  await page.context().route('https://raw.githubusercontent.com/**', route => route.fulfill({ status: 404, body: 'Not found' }));
  await openEditor(page); await rename(page, sermon.chapterId, 'A local correction');
  await page.getByRole('button', { name: 'Review & send', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Could not get the latest recording file from GitHub');
  await page.getByText('Discard local draft', { exact: true }).click();
  await page.getByRole('button', { name: 'Clear my changes here', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row(page, sermon.chapterId).locator(':scope > .ce-row .ce-title')).toHaveText(sermon.chapterTitle);
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull();
});
