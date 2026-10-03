import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { applyOverride, canInstall, canRunSemantic, classifyPerformance, parsePerformanceMode, parsePerformanceOverride, type PerformanceEvidence } from '../site/lib/performance-mode';
import { SEMANTIC_ASSETS, SEMANTIC_INSTALL_BYTES, semanticCacheName } from '../site/lib/semantic-assets';
import { semanticCacheWorker } from '../site/workers/semantic-cache';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const evidence: PerformanceEvidence = { processingMs: 100, blockingMs: 0, longestTaskMs: 20 };
describe('independent data and compute policy', () => {
  it('lets the measured download decide: page loads never veto it', () => {
    // Small page files measure request delay, not bandwidth, so they are not evidence either way.
    expect(classifyPerformance(evidence)).toEqual({ data: 'normal', compute: 'normal' });
    expect(classifyPerformance({ ...evidence, connection: { effectiveType: '4g' } }).data).toBe('normal');
    expect(canInstall(classifyPerformance(evidence))).toBe(true);
  });
  it('honors Save-Data and 3G independently of fast CPU evidence', () => {
    for (const connection of [{ saveData: true }, { effectiveType: '3g' }, { effectiveType: '2g' }]) {
      const result = classifyPerformance({ ...evidence, connection });
      expect(result).toEqual({ data: 'save-data', compute: 'normal' });
      expect(canInstall(result)).toBe(false);
      expect(canRunSemantic(result, true)).toBe(true);
      expect(canRunSemantic(result, false)).toBe(false);
    }
  });
  it('never runs or installs a model on low compute, even if cached', () => {
    expect(classifyPerformance({ ...evidence, longestTaskMs: 250, blockingMs: 200 }).compute).toBe('normal');
    for (const fields of [{ longestTaskMs: 501 }, { blockingMs: 501 }, { processingMs: 1501 }]) {
      const mode = classifyPerformance({ ...evidence, ...fields });
      expect(mode.compute).toBe('low-compute');
      expect(canRunSemantic(mode, true)).toBe(false);
      expect(canInstall(mode)).toBe(false);
    }
    expect(parsePerformanceMode({ data: 'bogus', compute: 'normal' })).toBeUndefined();
    expect(parsePerformanceMode(null)).toBeUndefined();
  });
  it('lets /dev switches force either mode without trusting junk', () => {
    const measured = { data: 'normal', compute: 'normal' } as const;
    expect(applyOverride(measured, { compute: 'low-compute' })).toEqual({ data: 'normal', compute: 'low-compute' });
    expect(applyOverride({ data: 'save-data', compute: 'low-compute' }, { data: 'normal', compute: 'normal' })).toEqual(measured);
    expect(applyOverride(measured, {})).toEqual(measured);
    expect(parsePerformanceOverride({ data: 'unknown', compute: 'fast', extra: 1 })).toEqual({});
    expect(parsePerformanceOverride(null)).toEqual({});
    expect(parsePerformanceOverride({ data: 'save-data' })).toEqual({ data: 'save-data' });
  });
  it('uses base-scoped versioned cache names and installs only the used JSEP runtime', () => {
    expect(semanticCacheName('/review/')).not.toBe(semanticCacheName('/other/'));
    expect(() => semanticCacheName('//outside/')).toThrow();
    expect(SEMANTIC_ASSETS.filter(file => file.path.startsWith('onnx/'))).toHaveLength(2);
    expect(SEMANTIC_INSTALL_BYTES).toBe(45325675);
  });
});

/** Executes the exact serialized SW function with a tiny, real-hashed asset contract. */
function workerFixture(content = 'hello') {
  type Handler = (event: unknown) => void;
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, Response>>();
  const notifications: { state: string }[] = [];
  const nativeCaches = { keys: async () => [...stores.keys()], delete: async (key: string) => stores.delete(key),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return { match: async (url: string) => store.get(url)?.clone(), put: async (url: string, response: Response) => { store.set(url, response.clone()); } };
    } };
  vi.stubGlobal('caches', nativeCaches);
  vi.stubGlobal('location', { origin: 'https://example.test' });
  vi.stubGlobal('addEventListener', (type: string, handler: Handler) => handlers.set(type, handler));
  vi.stubGlobal('clients', { claim: async () => {}, matchAll: async () => [{ url: 'https://example.test/review/search/', postMessage: (data: { state: string }) => notifications.push(data) }] });
  vi.stubGlobal('skipWaiting', async () => {});
  const fetcher = vi.fn(async (_url?: string, _options?: RequestInit) => new Response(content));
  vi.stubGlobal('fetch', fetcher);
  const cache = 'recs-semantic:%2Freview%2F:v1:test';
  const path = 'models/test.onnx';
  const sha256 = createHash('sha256').update(content).digest('hex');
  semanticCacheWorker({ base: '/review/', cache, assets: [{ path, bytes: Buffer.byteLength(content), sha256 }] });
  const message = (type: string, url = 'https://example.test/review/') => {
    let task: Promise<unknown> = Promise.resolve();
    handlers.get('message')!({ data: { type }, source: { url }, waitUntil: (promise: Promise<unknown>) => { task = promise; } });
    return task;
  };
  const request = (url: string) => {
    let response: Promise<Response> | undefined;
    handlers.get('fetch')!({ request: new Request(url), respondWith: (promise: Promise<Response>) => { response = promise; } });
    return response;
  };
  return { message, request, cache, fetcher, stores, notifications, url: `https://example.test/review/${path}` };
}
describe('semantic-only asset worker', () => {
  it('deduplicates concurrent installation and resumes completed files after pause', async () => {
    const fixture = workerFixture();
    fixture.fetcher.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const first = fixture.message('recs-semantic-install');
    const second = fixture.message('recs-semantic-install');
    await vi.waitFor(() => expect(fixture.fetcher).toHaveBeenCalledTimes(1));
    await fixture.message('recs-semantic-pause');
    await Promise.all([first, second]);
    expect(fixture.notifications.at(-1)?.state).toBe('paused');
    await fixture.message('recs-semantic-install');
    expect(fixture.notifications.at(-1)?.state).toBe('cached');
    expect(fixture.fetcher).toHaveBeenCalledTimes(2);
  });
  it('stops a download that goes silent', async () => {
    vi.useFakeTimers();
    const fixture = workerFixture();
    fixture.fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('stalled')));
    }));
    const install = fixture.message('recs-semantic-install');
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fixture.notifications.at(-1)?.state).toBe('installing');
    await vi.advanceTimersByTimeAsync(3_000);
    await install;
    expect(fixture.notifications.at(-1)?.state).toBe('slow');
  });
  it('measures the real download like a speed test: fast finishes, too slow stops', async () => {
    vi.useFakeTimers();
    const content = 'x'.repeat(8 * 1024 * 1024);
    /** Streams `content` in 64 KB chunks at `bytesPerSecond`, after a 400 ms connection delay. */
    const stream = (bytesPerSecond: number) => (_url?: string, options?: RequestInit) => new Promise<Response>(resolve => setTimeout(() => {
      let offset = 0;
      const chunk = 64 * 1024, gap = Math.max(1, Math.round(chunk / bytesPerSecond * 1000));
      resolve(new Response(new ReadableStream({
        pull: controller => new Promise(done => setTimeout(() => {
          if (options?.signal?.aborted) controller.error(new Error('aborted'));
          else if (offset >= content.length) controller.close();
          else { controller.enqueue(new TextEncoder().encode(content.slice(offset, offset + chunk))); offset += chunk; }
          done();
        }, gap)),
      })));
    }, 400));
    // 8 MB at 1 MB/s projects about 8.4 s: well inside the 60 s budget, so it completes.
    const fast = workerFixture(content);
    fast.fetcher.mockImplementation(stream(1024 * 1024));
    const done = fast.message('recs-semantic-install');
    await vi.advanceTimersByTimeAsync(12_000);
    await done;
    expect(fast.notifications.at(-1)?.state).toBe('cached');
    // 8 MB at 64 KB/s projects about 2 minutes: stopped once the warm-up gives a reliable rate.
    const slow = workerFixture(content);
    slow.fetcher.mockImplementation(stream(64 * 1024));
    const stopped = slow.message('recs-semantic-install');
    await vi.advanceTimersByTimeAsync(12_000);
    await stopped;
    expect(slow.notifications.at(-1)?.state).toBe('slow');
  });
  it('verifies and reuses complete files, leaving navigation and other bases alone', async () => {
    const fixture = workerFixture();
    await fixture.message('recs-semantic-install');
    expect(fixture.notifications.at(-1)?.state).toBe('cached');
    await fixture.message('recs-semantic-install');
    expect(fixture.fetcher).toHaveBeenCalledTimes(1);
    expect(await (await fixture.request(fixture.url))?.text()).toBe('hello');
    expect(fixture.request('https://example.test/review/search/')).toBeUndefined();
    expect(fixture.request('https://example.test/other/models/test.onnx')).toBeUndefined();
    expect(fixture.request('https://example.test/review/generated/chapters.json')).toBeUndefined();
  });
  it('rejects damaged downloads and cache-only misses without network fallback', async () => {
    const fixture = workerFixture();
    fixture.fetcher.mockImplementation(async () => new Response('wrong'));
    await fixture.message('recs-semantic-install');
    expect(fixture.notifications.at(-1)?.state).toBe('error');
    const response = await fixture.request(`${fixture.url}?recs-cache=${encodeURIComponent(fixture.cache)}`);
    expect(response?.status).toBe(503);
    expect(fixture.fetcher).toHaveBeenCalledTimes(1);
    expect((await fixture.request(`${fixture.url}?recs-cache=old-generation`))?.status).toBe(503);
  });
  it('rejects out-of-scope messages and cleans only excess owned generations', async () => {
    const fixture = workerFixture();
    await fixture.message('recs-semantic-install', 'https://example.test/other/');
    expect(fixture.fetcher).not.toHaveBeenCalled();
    fixture.stores.set('unrelated', new Map());
    fixture.stores.set('recs-semantic:%2Fother%2F:old', new Map());
    fixture.stores.set('recs-semantic:%2Freview%2F:oldest', new Map());
    fixture.stores.set('recs-semantic:%2Freview%2F:previous', new Map());
    await fixture.message('recs-semantic-install');
    expect([...fixture.stores.keys()]).toEqual(expect.arrayContaining(['unrelated', 'recs-semantic:%2Fother%2F:old', 'recs-semantic:%2Freview%2F:previous', fixture.cache]));
    expect(fixture.stores.has('recs-semantic:%2Freview%2F:oldest')).toBe(false);
  });
});
