import { afterEach, describe, expect, it, vi } from 'vitest';
import { canInstall, canRunSemantic, classifyPerformance, observedBytesPerSecond, parsePerformanceMode, type PerformanceEvidence } from '../site/lib/performance-mode';
import { SEMANTIC_ASSETS, SEMANTIC_INSTALL_BYTES, semanticCacheName } from '../site/lib/semantic-assets';
import { semanticCacheWorker } from '../site/workers/semantic-cache';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const evidence: PerformanceEvidence = { installBytes: SEMANTIC_INSTALL_BYTES, samples: [{ transferSize: 1_000_000, responseStart: 10, responseEnd: 110 }],
  readyMs: 900, processingMs: 100, blockingMs: 0, longestTaskMs: 20 };
describe('independent data and compute policy', () => {
  it('requires observed transfer evidence, not a fast cached load or a 4g label', () => {
    expect(classifyPerformance(evidence)).toEqual({ data: 'normal', compute: 'normal' });
    expect(classifyPerformance({ ...evidence, samples: [], connection: { effectiveType: '4g' } }).data).toBe('unknown');
    expect(observedBytesPerSecond([{ transferSize: 0, responseStart: 0, responseEnd: 5 }])).toBeUndefined();
    expect(observedBytesPerSecond([{ transferSize: 2000, responseStart: 0, responseEnd: 1 }])).toBeUndefined();
    expect(observedBytesPerSecond([{ transferSize: Infinity, responseStart: 0, responseEnd: 1 }])).toBeUndefined();
  });
  it('uses enclosing duration for parallel transfers', () => {
    expect(observedBytesPerSecond([{ transferSize: 100_000, responseStart: 0, responseEnd: 100 },
      { transferSize: 100_000, responseStart: 0, responseEnd: 200 }])).toBe(1_000_000);
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
  it('uses the ten-second raw-payload forecast, including the runtime', () => {
    const samples = [{ transferSize: SEMANTIC_INSTALL_BYTES / 10, responseStart: 0, responseEnd: 1000 }];
    expect(classifyPerformance({ ...evidence, samples }).data).toBe('normal');
    expect(classifyPerformance({ ...evidence, samples: [{ ...samples[0], responseEnd: 1001 }] }).data).toBe('save-data');
    expect(classifyPerformance({ ...evidence, readyMs: 4000 }).data).toBe('save-data');
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
  it('uses base-scoped versioned cache names and installs only the used JSEP runtime', () => {
    expect(semanticCacheName('/review/')).not.toBe(semanticCacheName('/other/'));
    expect(() => semanticCacheName('//outside/')).toThrow();
    expect(SEMANTIC_ASSETS.filter(file => file.path.startsWith('onnx/'))).toHaveLength(2);
    expect(SEMANTIC_INSTALL_BYTES).toBe(45325675);
  });
});

/** Executes the exact serialized SW function with a tiny, real-hashed asset contract. */
function workerFixture() {
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
  const fetcher = vi.fn(async (_url?: string, _options?: RequestInit) => new Response('hello'));
  vi.stubGlobal('fetch', fetcher);
  const cache = 'recs-semantic:%2Freview%2F:v1:test';
  const path = 'models/test.onnx';
  const sha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  semanticCacheWorker({ base: '/review/', cache, assets: [{ path, bytes: 5, sha256 }] });
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
  it('bounds a misclassified slow installation', async () => {
    vi.useFakeTimers();
    const fixture = workerFixture();
    fixture.fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('deadline')));
    }));
    const install = fixture.message('recs-semantic-install');
    await vi.advanceTimersByTimeAsync(15_000);
    await install;
    expect(fixture.notifications.at(-1)?.state).toBe('slow');
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
