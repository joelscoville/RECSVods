import type { SemanticAsset } from '../lib/semantic-assets';

/** Serialized by the static endpoint. All runtime dependencies must be inside this function.
 * This worker owns ONLY immutable semantic assets: never navigation, metadata or media. */
export function semanticCacheWorker(config: { cache: string; base: string; assets: readonly SemanticAsset[] }) {
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
    // A misclassified connection must not silently download for minutes.
    const deadline = setTimeout(() => controller.abort('deadline'), 15_000);
    try {
      const cache = await caches.open(config.cache);
      await notify('installing');
      for (const [url, file] of assets) {
        controller.signal.throwIfAborted();
        const existing = await cache.match(url);
        if (existing?.headers.get('x-recs-sha256') === file.sha256) continue;
        const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
        if (!response.ok) throw new Error('Asset unavailable');
        const bytes = await response.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
        if (bytes.byteLength !== file.bytes || hash !== file.sha256) throw new Error('Asset integrity mismatch');
        controller.signal.throwIfAborted();
        // Reconstructed response contains decoded bytes: never retain Content-Encoding.
        await cache.put(url, new Response(bytes, { headers: { 'content-type': file.path.endsWith('.wasm') ? 'application/wasm'
          : file.path.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream', 'x-recs-sha256': hash } }));
      }
      // Keep one previous generation for open tabs; never touch another Pages application's cache.
      const prefix = `recs-semantic:${encodeURIComponent(config.base)}:`;
      const older = (await caches.keys()).filter(name => name.startsWith(prefix) && name !== config.cache);
      for (const name of older.slice(0, -1)) await caches.delete(name);
      await notify('cached');
    } catch {
      await notify(controller.signal.reason === 'deadline' ? 'slow' : controller.signal.aborted ? 'paused' : 'error');
    } finally { clearTimeout(deadline); abort = undefined; }
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
