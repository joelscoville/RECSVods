import { test, expect } from './fixtures';
import { probeEmbeds } from '../../scripts/probe-embeds';
import { previewChapters, readServiceFixture } from './archive-fixtures';

const flagged = previewChapters.find(chapter => readServiceFixture(`services/${chapter.date.slice(0, 4)}/${chapter.serviceId}/service.yaml`).videos.find(video => video.id === chapter.videoId)?.quirks?.includes('embed_blocked'));

test('a known embed-blocked video stays searchable and opens on YouTube without loading an iframe', async ({ page, context }) => {
  test.skip(!flagged, 'No current embed-blocked recording; the rendering contract is also covered by isolated unit tests.');
  const chapter = flagged!;
  const requests: string[] = [];
  page.on('request', request => { if (/youtube(?:-nocookie)?\.com/.test(request.url())) requests.push(request.url()); });
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`watch/?chapter=${chapter.id}`);
  const external = page.locator('.external-playback');
  await expect(external).toBeVisible();
  await expect(external.getByRole('link', { name: /Watch on YouTube from/ })).toHaveAttribute('href', `https://www.youtube.com/watch?v=${chapter.videoId}&t=${Math.floor(chapter.start)}`);
  await expect(page.locator('.youtube-host iframe')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try embedded player', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Recording notes' })).toContainText('Opens on YouTube');
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sermon = previewChapters.find(item => item.serviceId === chapter.serviceId && item.videoId === chapter.videoId && item.type === 'sermon' && !item.parentId);
  if (sermon && sermon.id !== chapter.id) {
    await page.goto(`watch/?chapter=${sermon.id}&match=${chapter.id}`);
    await page.getByRole('button', { name: 'Go to matching chapter', exact: true }).click();
    await expect(external.getByRole('link', { name: /Watch on YouTube from/ })).toHaveAttribute('href', `https://www.youtube.com/watch?v=${chapter.videoId}&t=${Math.floor(chapter.start)}`);
    expect(requests).toEqual([]);
  }
  await page.route('**/*semantic.worker*', route => route.abort());
  await page.goto(`search/?q=${encodeURIComponent(chapter.serviceTitle)}`);
  await expect(page.locator(`.recording-result[data-service="${chapter.serviceId}"]`)).toBeVisible();
});

test('the live checker requires advancing playback and does not mistake 153 or readiness for an embed block', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The checker has no viewport-dependent behavior.');
  for (const [code, readyOnly, expected] of [[150, false, 'blocked'], [100, false, 'unavailable'], [153, false, 'inconclusive'], [undefined, true, 'inconclusive'], [undefined, false, 'playable']] as const) {
    const instrumented = Object.create(browser) as typeof browser;
    instrumented.newPage = async () => {
      const page = await browser.newPage();
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: `
        window.YT={Player:class{constructor(h,o){this.started=0;setTimeout(()=>{o.events.onReady({target:this});${code !== undefined ? `o.events.onError({data:${code}})` : ''}},0)}
        mute(){}playVideo(){this.started=performance.now()}getPlayerState(){return ${readyOnly ? '2' : '1'}}getCurrentTime(){return (performance.now()-this.started)/1000}}};window.onYouTubeIframeAPIReady();` }));
      return page;
    };
    const [result] = await probeEmbeds(['AAAAAAAAAAA'], { browser: instrumented, timeoutMs: 1800 });
    expect(result.observation.outcome).toBe(expected);
  }
});
