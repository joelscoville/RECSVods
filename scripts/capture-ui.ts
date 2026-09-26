import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const milestone2 = process.argv.includes('--milestone2');
const milestone3 = process.argv.includes('--milestone3');
const catalogue = milestone2 || milestone3;
const output = milestone3 ? '.local/ui-review-m3' : milestone2 ? '.local/ui-review-m2' : '.local/ui-review';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['node_modules/astro/astro.js', 'preview', '--host', '127.0.0.1', '--port', '4180'], {
  env: { ...process.env, SITE_BASE_PATH: '/replay-check/', ARCHIVE_MODE: 'preview' }, stdio: 'ignore',
});
const base = 'http://127.0.0.1:4180/replay-check/';
const browser = await chromium.launch();
try {
  const deadline = Date.now() + 15_000;
  while (true) {
    try { if ((await fetch(base)).ok) break; } catch { /* Wait for the local server. */ }
    if (Date.now() > deadline) throw new Error('Preview server did not start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const results: unknown[] = [];
  for (const [name, width, height] of [['desktop', 1728, 1000], ['portrait', 390, 844], ['landscape', 844, 390]] as const) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const routes = [['', 'home'], ['search/', 'search'], ['watch/?id=p0906-learn-by-praying', 'watch']];
    if (catalogue) routes.push(['search/?q=Romans+13', 'results'], ['browse/scripture/romans/', 'browse']);
    if (milestone3) routes.push(['services/2020-07-19/', 'service']);
    for (const [route, suffix] of routes) {
      await page.goto(base + route);
      await page.locator('astro-island[ssr]').evaluateAll(async (islands) => {
        await Promise.all(islands.map((island) => new Promise<void>((resolve) => {
          if (!island.hasAttribute('ssr')) resolve();
          else island.addEventListener('astro:hydrate', () => resolve(), { once: true });
        })));
      });
      await page.evaluate(() => document.fonts.ready);
      if (suffix === 'results' || suffix === 'search') await expect(page.locator('.search-status')).not.toContainText('Loading', { timeout: 30_000 });
      await page.screenshot({ path: `${output}/${name}-${suffix}.png`, fullPage: true });
      if (milestone3 || suffix === 'watch') await page.screenshot({ path: `${output}/${name}-${suffix}-viewport.png`, fullPage: false });
      results.push({ name, route, ...(await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))) });
    }
    // Real provider acceptance check on desktop; no mock API injection here.
    if (name === 'desktop' && !catalogue) {
      const requests: string[] = [];
      page.on('request', (request) => { if (request.url().includes('youtube-nocookie.com/embed/')) requests.push(request.url().split('&origin=')[0]); });
      await page.locator('button.play-button').click();
      await page.waitForTimeout(10_000);
      const iframe = page.locator('iframe');
      results.push({ actualYouTube: { embedRequests: requests, iframeCount: await iframe.count(), playerMessage: await page.locator('.player-column').innerText() } });
      await page.screenshot({ path: `${output}/desktop-youtube.png`, fullPage: false });
      const media = page.frameLocator('iframe').locator('video').first();
      const started = await media.evaluate((element) => ({ time: (element as HTMLVideoElement).currentTime, paused: (element as HTMLVideoElement).paused }));
      results.push({ actualYouTubeStart: started });
      // Seek the real provider's video near the endpoint to test soft-stop wiring
      // without waiting through the whole passage. No mock player is installed.
      await media.evaluate((element) => { (element as HTMLVideoElement).currentTime = 3219; });
      await page.getByText('Passage finished. Playback is paused.').waitFor({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Continue watching', exact: true }).click();
      await page.getByText('Continuing through the full recording.').waitFor();
      await page.waitForTimeout(2000);
      await page.getByRole('button', { name: 'Replay passage', exact: true }).click();
      await page.getByText('Playback will pause at the end of this passage.').waitFor();
      results.push({ actualYouTubeSoftEndpoint: 'observed', continueWatching: 'observed', replay: 'observed' });
    }
    if (catalogue) {
      await page.evaluate(() => localStorage.setItem('recs-replay:resume:v1', JSON.stringify({ serviceId: '2026-09-06', videoId: 'ZTDYIJUDb0M', time: 3200 })));
      await page.goto(base);
      await expect(page.locator('.featured-returning')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${output}/${name}-returning.png`, fullPage: true });
    }
    await page.close();
  }
  await writeFile(`${output}/measurements.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.kill('SIGTERM');
  await new Promise<void>((resolve) => { if (server.exitCode !== null) resolve(); else server.once('exit', () => resolve()); });
}
