/** Real IFrame API checks. Brief muted playback; no saved media, credentials or source edits. */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from '@playwright/test';
import type { EmbedObservation } from './video-observations';

export const MAX_EMBED_BATCH_SIZE = 50;
export interface EmbedProbeResult { videoId: string; observation: EmbedObservation }

export function classifyEmbedProbe(result: { code?: number; advanced?: boolean }, checkedAt: string): EmbedObservation {
  if (result.code === 101 || result.code === 150) return { checkedAt, outcome: 'blocked', errorCode: result.code, reason: 'embedding_denied' };
  if (result.code === 100) return { checkedAt, outcome: 'unavailable', errorCode: 100, reason: 'video_unavailable' };
  if (result.code !== undefined) return { checkedAt, outcome: 'inconclusive', errorCode: result.code, reason: 'player_error' };
  return result.advanced ? { checkedAt, outcome: 'playable', reason: 'playback_advanced' }
    : { checkedAt, outcome: 'inconclusive', reason: 'timeout' };
}

async function observePlayback(page: Page, url: string, deadlineMs: number) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.max(1, deadlineMs - Date.now()) });
  return page.evaluate(async limit => {
    const scope = window as unknown as { probe?: { code?: number }; player?: { getCurrentTime(): number; getPlayerState(): number } };
    const started = performance.now();
    let firstTime: number | undefined;
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
  }, Math.max(0, deadlineMs - Date.now()));
}

/** Returns an ordered prefix if the shared archive-check deadline is reached. */
export async function probeEmbeds(ids: readonly string[], options: { timeoutMs?: number; deadlineMs?: number; browser?: Browser } = {}): Promise<EmbedProbeResult[]> {
  const timeout = options.timeoutMs ?? 20000;
  if (!ids.length || ids.length > MAX_EMBED_BATCH_SIZE || new Set(ids).size !== ids.length || ids.some(id => !/^[A-Za-z0-9_-]{11}$/.test(id))) throw new Error('Select 1–50 unique YouTube IDs');
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 60000) throw new Error('Embed timeout must be 1–60 seconds');
  if (options.deadlineMs !== undefined && !Number.isFinite(options.deadlineMs)) throw new Error('Embed deadline must be finite');
  const deadline = options.deadlineMs ?? Infinity;
  if (Date.now() >= deadline) return [];
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
    if (Date.now() >= deadline) return [];
    if (!browser) {
      try {
        browser = await chromium.launch({ timeout: Math.max(1, Math.min(30000, deadline - Date.now())) });
      } catch (error) {
        if (Date.now() >= deadline) return [];
        throw error;
      }
    }
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const results: EmbedProbeResult[] = [];
    for (const videoId of ids) {
      if (Date.now() >= deadline) break;
      const page = await browser.newPage();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const limit = Math.min(timeout, deadline - Date.now());
        if (limit <= 0) break;
        // One deadline covers navigation AND playback, even if page evaluation stalls.
        const result = await Promise.race([
          observePlayback(page, `${origin}/?id=${videoId}`, Date.now() + limit),
          new Promise<{ code?: number; advanced?: boolean }>(resolve => { timer = setTimeout(() => resolve({}), limit); }),
        ]);
        results.push({ videoId, observation: classifyEmbedProbe(result, new Date().toISOString()) });
      } catch {
        results.push({ videoId, observation: { checkedAt: new Date().toISOString(), outcome: 'inconclusive', reason: 'network_or_browser_error' } });
      } finally {
        clearTimeout(timer);
        await page.close();
      }
    }
    return results;
  } finally {
    try {
      if (!options.browser) await browser?.close();
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
}
