/** Real IFrame API checks. Brief muted playback; no saved media, credentials or source edits. */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from '@playwright/test';
import type { EmbedObservation } from './video-observations';

export function classifyEmbedProbe(result: { code?: number; advanced?: boolean }, checkedAt: string): EmbedObservation {
  if (result.code === 101 || result.code === 150) return { checkedAt, outcome: 'blocked', errorCode: result.code, reason: 'embedding_denied' };
  if (result.code === 100) return { checkedAt, outcome: 'unavailable', errorCode: 100, reason: 'video_unavailable' };
  if (result.code !== undefined) return { checkedAt, outcome: 'inconclusive', errorCode: result.code, reason: 'player_error' };
  return result.advanced ? { checkedAt, outcome: 'playable', reason: 'playback_advanced' }
    : { checkedAt, outcome: 'inconclusive', reason: 'timeout' };
}

export async function probeEmbeds(ids: readonly string[], options: { timeoutMs?: number; browser?: Browser } = {}): Promise<{ videoId: string; observation: EmbedObservation }[]> {
  const timeout = options.timeoutMs ?? 20000;
  if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length || ids.some(id => !/^[A-Za-z0-9_-]{11}$/.test(id))) throw new Error('Select 1–50 unique YouTube IDs');
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 60000) throw new Error('Embed timeout must be 1–60 seconds');
  const selected = new Set(ids);
  const server = createServer((request, response) => {
    const id = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('id');
    if (!id || !selected.has(id)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><html lang="en"><head><title>RECS playback check</title></head><body><div id="player"></div>
      <script>window.probe={};window.onYouTubeIframeAPIReady=function(){window.player=new YT.Player('player',{
      width:640,height:360,host:'https://www.youtube-nocookie.com',videoId:'${id}',playerVars:{origin:location.origin},
      events:{onReady:function(e){e.target.mute();e.target.playVideo()},onError:function(e){window.probe.code=e.data}}})};</script>
      <script src="https://www.youtube.com/iframe_api"></script></body></html>`);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser = options.browser;
  try {
    browser ??= await chromium.launch();
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const results: { videoId: string; observation: EmbedObservation }[] = [];
    for (const videoId of ids) {
      const page = await browser.newPage();
      try {
        await page.goto(`${origin}/?id=${videoId}`, { waitUntil: 'domcontentloaded', timeout });
        const result = await page.evaluate(async limit => {
          const scope = window as unknown as { probe?: { code?: number }; player?: { getCurrentTime(): number; getPlayerState(): number } };
          const started = performance.now(); let firstTime: number | undefined;
          while (performance.now() - started < limit) {
            if (scope.probe?.code !== undefined) return { code: scope.probe.code };
            if (scope.player?.getPlayerState?.() === 1) {
              const time = scope.player.getCurrentTime();
              if (Number.isFinite(time)) {
                firstTime ??= time;
                if (time - firstTime >= 1) return { advanced: true };
              }
            }
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          return {};
        }, timeout);
        results.push({ videoId, observation: classifyEmbedProbe(result, new Date().toISOString()) });
      } catch {
        results.push({ videoId, observation: { checkedAt: new Date().toISOString(), outcome: 'inconclusive', reason: 'network_or_browser_error' } });
      } finally { await page.close(); }
    }
    return results;
  } finally {
    if (!options.browser) await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
