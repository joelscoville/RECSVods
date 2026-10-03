import type { InstallPolicy, SemanticAsset } from '../lib/semantic-assets';

/** Serialized by the static endpoint. All runtime dependencies must be inside this function.
 * This worker owns ONLY immutable semantic assets: never navigation, metadata or media. */
export function semanticCacheWorker(config: { cache: string; base: string; assets: readonly SemanticAsset[]; policy?: Partial<InstallPolicy> }) {
  // Defaults mirror INSTALL_POLICY; the endpoint passes the real values.
  const policy = { budgetMs: 60_000, warmupBytes: 512 * 1024, warmupMs: 1_000, windowMs: 3_000, stallMs: 10_000, ceilingMs: 300_000, ...config.policy };
  type Client = { id: string; url: string; postMessage(data: unknown): void };
  const scope = globalThis as unknown as {
    location: Location; skipWaiting(): Promise<void>;
    clients: { claim(): Promise<void>; matchAll(options: { includeUncontrolled: boolean; type: string }): Promise<Client[]> };
    addEventListener(type: string, callback: (event: never) => void): void;
  };
  const root = new URL(config.base, scope.location.origin).href;
  const assets = new Map(config.assets.map(file => [new URL(file.path, root).href, file]));
  let running: Promise<void> | undefined;
  let abort: AbortController | undefined;
  const notify = async (state: string) => {
    for (const client of await scope.clients.matchAll({ includeUncontrolled: true, type: 'window' })) {
      if (client.url.startsWith(root)) client.postMessage({ type: 'recs-semantic-install', state });
    }
  };
  async function install() {
    const controller = new AbortController();
    abort = controller;
    const started = Date.now();
    // A safety net only; the meter below normally decides long before this.
    const ceiling = setTimeout(() => controller.abort('slow'), policy.ceilingMs);
    let meter: ReturnType<typeof setInterval> | undefined;
    try {
      const cache = await caches.open(config.cache);
      await notify('installing');
      // Only what is still missing counts: a resumed install measures the remaining bytes.
      const missing: [string, SemanticAsset][] = [];
      for (const [url, file] of assets) {
        if ((await cache.match(url))?.headers.get('x-recs-sha256') !== file.sha256) missing.push([url, file]);
      }
      const total = missing.reduce((sum, [, file]) => sum + file.bytes, 0);
      // A speed test on the real download: throughput counts from the first byte (connection setup excluded),
      // over a recent window, and projects the time left. Too slow, or silent for too long, stops it.
      let received = 0, firstByte: number | undefined, lastByte = Date.now();
      const history: [number, number][] = [];
      meter = setInterval(() => {
        const now = Date.now();
        if (now - lastByte > policy.stallMs) { controller.abort('slow'); return; }
        if (firstByte === undefined || received < policy.warmupBytes || now - firstByte < policy.warmupMs) return;
        while (history.length > 1 && now - history[1][0] >= policy.windowMs) history.shift();
        const [since, before] = history[0];
        const bytesPerMs = (received - before) / Math.max(1, now - since);
        if (bytesPerMs > 0 && now - started + (total - received) / bytesPerMs > policy.budgetMs) controller.abort('slow');
      }, 1_000);
      for (const [url, file] of missing) {
        controller.signal.throwIfAborted();
        const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
        if (!response.ok) throw new Error('Asset unavailable');
        const parts: Uint8Array[] = [];
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Asset unavailable');
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          const now = Date.now();
          if (firstByte === undefined) { firstByte = now; history.push([now, received]); }
          received += value.byteLength; lastByte = now; history.push([now, received]);
        }
        const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
        parts.reduce((offset, part) => { bytes.set(part, offset); return offset + part.byteLength; }, 0);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
        if (bytes.byteLength !== file.bytes || hash !== file.sha256) throw new Error('Asset integrity mismatch');
        controller.signal.throwIfAborted();
        // Reconstructed response contains decoded bytes: never retain Content-Encoding.
        await cache.put(url, new Response(bytes, { headers: { 'content-type': file.path.endsWith('.wasm') ? 'application/wasm'
          : file.path.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream', 'x-recs-sha256': hash } }));
        // Hashing and caching are local work, not a stalled connection.
        lastByte = Date.now();
      }
      // Keep one previous generation for open tabs; never touch another Pages application's cache.
      const prefix = `recs-semantic:${encodeURIComponent(config.base)}:`;
      const older = (await caches.keys()).filter(name => name.startsWith(prefix) && name !== config.cache);
      for (const name of older.slice(0, -1)) await caches.delete(name);
      await notify('cached');
    } catch {
      await notify(controller.signal.reason === 'slow' ? 'slow' : controller.signal.aborted ? 'paused' : 'error');
    } finally { clearTimeout(ceiling); clearInterval(meter); abort = undefined; }
  }
  scope.addEventListener('install', (event: { waitUntil(promise: Promise<unknown>): void }) => event.waitUntil(scope.skipWaiting()));
  scope.addEventListener('activate', (event: { waitUntil(promise: Promise<unknown>): void }) => event.waitUntil(scope.clients.claim()));
  scope.addEventListener('message', (event: { data: { type?: string }; source?: Client; waitUntil(promise: Promise<unknown>): void }) => {
    if (!event.source?.url.startsWith(root)) return;
    if (event.data?.type === 'recs-semantic-pause') abort?.abort('pause');
    if (event.data?.type === 'recs-semantic-install') {
      running ??= install().finally(() => { running = undefined; });
      event.waitUntil(running);
    }
  });
  scope.addEventListener('fetch', (event: { request: Request; respondWith(response: Promise<Response>): void }) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    const cacheOnly = url.searchParams.has('recs-cache');
    const generationMatches = url.searchParams.get('recs-cache') === config.cache;
    if (cacheOnly) url.searchParams.delete('recs-cache');
    const file = assets.get(url.href);
    if (!file) return;
    event.respondWith((async () => {
      if (cacheOnly && !generationMatches) return new Response('Semantic generation changed', { status: 503 });
      const cached = await (await caches.open(config.cache)).match(url.href);
      if (cached?.headers.get('x-recs-sha256') === file.sha256) return cached;
      // Missing cached WASM must not turn data saver into a 22 MB network request.
      return cacheOnly ? new Response('Semantic asset is not cached', { status: 503 }) : fetch(event.request);
    })());
  });
}
