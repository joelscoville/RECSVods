import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAdaptiveLoading } from '../site/lib/adaptive-loading';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** Real coordinator with browser event targets, controllable registration and observation.
 * No product mode override: normal mode is derived from the supplied fast transfer evidence. */
function browserFixture() {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const dataset: Record<string, string> = { dataMode: 'unknown', computeMode: 'unknown' };
  const window = Object.assign(new EventTarget(), {
    requestIdleCallback: (callback: () => void) => setTimeout(callback, 1),
    cancelIdleCallback: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });
  const document = Object.assign(new EventTarget(), {
    hidden: false, readyState: 'complete', documentElement: { dataset }, querySelector: () => null,
  });
  const messages: { type: string }[] = [];
  const active = { scriptURL: 'https://example.test/review/semantic-sw.js', postMessage: (message: { type: string }) => messages.push(message) };
  const registration = { active } as unknown as ServiceWorkerRegistration;
  const registered = deferred<ServiceWorkerRegistration>();
  const activated = deferred<ServiceWorkerRegistration>();
  activated.resolve(registration);
  const serviceWorker = Object.assign(new EventTarget(), { register: vi.fn(() => registered.promise), ready: activated.promise, controller: active });
  const observations: PerformanceObserverInit[] = [];
  let connected = false, callback: PerformanceObserverCallback;
  class Observer {
    constructor(value: PerformanceObserverCallback) { callback = value; }
    observe(options: PerformanceObserverInit) { observations.push(options); connected = true; }
    disconnect() { connected = false; }
  }
  vi.stubGlobal('PerformanceObserver', Observer);
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('location', { origin: 'https://example.test' });
  vi.stubGlobal('navigator', { serviceWorker, connection: Object.assign(new EventTarget(), { effectiveType: '4g', saveData: false }) });
  vi.stubGlobal('caches', { has: async () => false });
  vi.stubGlobal('sessionStorage', { setItem: vi.fn() });
  vi.stubGlobal('performance', { now: () => Date.now(), mark: vi.fn(), getEntriesByType: (type: string) => type === 'navigation' ? [{
    name: 'https://example.test/review/', transferSize: 1_000_000, responseStart: 0, responseEnd: 10, domInteractive: 20,
  }] : [] });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 1));
  const visibility = (hidden: boolean) => { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); };
  const restored = () => window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  const hidePage = () => window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  const task = (duration: number, startTime = Date.now()) => {
    if (connected) callback({ getEntries: () => [{ startTime, duration }] } as unknown as PerformanceObserverEntryList, {} as PerformanceObserver);
  };
  const message = (state: string) => serviceWorker.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'recs-semantic-install', state } }));
  return { dataset, window, document, serviceWorker, registration, registered, messages, observations, visibility, restored, hidePage, task, message };
}

describe('adaptive browser lifecycle', () => {
  it('does not duplicate installation when visibility returns before registration resolves', async () => {
    const browser = browserFixture();
    startAdaptiveLoading('/review/', true);
    await vi.advanceTimersByTimeAsync(1000);
    browser.visibility(true); browser.visibility(false);
    await vi.advanceTimersByTimeAsync(1000);
    browser.registered.resolve(browser.registration);
    await vi.advanceTimersByTimeAsync(100);
    expect(browser.serviceWorker.register).toHaveBeenCalledOnce();
    expect(browser.messages.filter(message => message.type === 'recs-semantic-install')).toHaveLength(1);
  });

  it('resumes when hidden during registration, without pretending installation was sent', async () => {
    const browser = browserFixture();
    startAdaptiveLoading('/review/', true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.serviceWorker.register).toHaveBeenCalledOnce();
    browser.visibility(true);
    browser.registered.resolve(browser.registration);
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.messages.filter(message => message.type === 'recs-semantic-install')).toEqual([]);
    browser.visibility(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.messages.filter(message => message.type === 'recs-semantic-install')).toHaveLength(1);
  });

  it('also resumes if visibility changes while waiting for service-worker activation', async () => {
    const browser = browserFixture(), activated = deferred<ServiceWorkerRegistration>();
    browser.serviceWorker.ready = activated.promise;
    browser.registered.resolve(browser.registration);
    startAdaptiveLoading('/review/', true);
    await vi.advanceTimersByTimeAsync(1000);
    browser.visibility(true); activated.resolve(browser.registration);
    await vi.advanceTimersByTimeAsync(100);
    expect(browser.messages.filter(message => message.type === 'recs-semantic-install')).toEqual([]);
    browser.visibility(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.messages.filter(message => message.type === 'recs-semantic-install')).toHaveLength(1);
  });

  it('resumes after a pause acknowledgement arriving after visibility returns', async () => {
    const browser = browserFixture();
    browser.registered.resolve(browser.registration);
    startAdaptiveLoading('/review/', true);
    await vi.advanceTimersByTimeAsync(1000);
    browser.visibility(true); browser.visibility(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.messages.filter(message => message.type === 'recs-semantic-install')).toHaveLength(1);
    browser.message('paused');
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.messages.filter(message => message.type === 'recs-semantic-install')).toHaveLength(2);
    expect(browser.serviceWorker.register).toHaveBeenCalledOnce();
  });

  it('does not install from a registration continuation while the page is in BFCache', async () => {
    const browser = browserFixture();
    startAdaptiveLoading('/review/', true);
    await vi.advanceTimersByTimeAsync(1000);
    browser.hidePage(); browser.registered.resolve(browser.registration);
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.messages.filter(message => message.type === 'recs-semantic-install')).toEqual([]);
    browser.restored();
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.messages.filter(message => message.type === 'recs-semantic-install')).toHaveLength(1);
  });

  it('can retry a failed registration on a later resume', async () => {
    const browser = browserFixture();
    browser.serviceWorker.register.mockRejectedValueOnce(new Error('registration failed'));
    startAdaptiveLoading('/review/', true);
    await vi.advanceTimersByTimeAsync(1000);
    browser.visibility(true); browser.visibility(false);
    browser.registered.resolve(browser.registration);
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.serviceWorker.register).toHaveBeenCalledTimes(2);
    expect(browser.messages.filter(message => message.type === 'recs-semantic-install')).toHaveLength(1);
  });

  it('cancels scheduled work before readiness and resumes readiness after BFCache', async () => {
    const browser = browserFixture();
    startAdaptiveLoading('/review/', true);
    browser.hidePage();
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.dataset.essentialReady).toBeUndefined();
    expect(browser.serviceWorker.register).not.toHaveBeenCalled();
    browser.restored(); browser.registered.resolve(browser.registration);
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.dataset.essentialReady).toBe('true');
    expect(browser.messages.filter(message => message.type === 'recs-semantic-install')).toHaveLength(1);
  });

  it('resumes long-task observation after a persisted pageshow', async () => {
    const browser = browserFixture();
    startAdaptiveLoading('/review/', true);
    await vi.advanceTimersByTimeAsync(100);
    expect(browser.dataset.computeMode).toBe('normal');
    browser.hidePage();
    await vi.advanceTimersByTimeAsync(100);
    browser.restored();
    browser.task(600);
    expect(browser.dataset.computeMode).toBe('low-compute');
    expect(browser.observations.at(-1)).toEqual({ type: 'longtask', buffered: false });
  });

  it('starts a fresh observation window without losing a previously established low-compute mode', async () => {
    const browser = browserFixture();
    startAdaptiveLoading('/review/', true);
    await vi.advanceTimersByTimeAsync(100);
    browser.task(300);
    browser.hidePage(); await vi.advanceTimersByTimeAsync(100);
    browser.restored();
    // The old 300 ms and this 310 ms would together exceed the blocking budget.
    browser.task(310);
    expect(browser.dataset.computeMode).toBe('normal');
    // Even an explicitly replayed pre-freeze entry is ignored.
    browser.task(600, 0);
    expect(browser.dataset.computeMode).toBe('normal');
    browser.task(600);
    expect(browser.dataset.computeMode).toBe('low-compute');
    browser.hidePage(); await vi.advanceTimersByTimeAsync(100); browser.restored();
    expect(browser.dataset.computeMode).toBe('low-compute');
    expect(browser.observations).toEqual([{ type: 'longtask', buffered: true }, { type: 'longtask', buffered: false }, { type: 'longtask', buffered: false }]);
  });

  it('does not register on HTTP-style environments without service workers or caching', async () => {
    const browser = browserFixture();
    vi.stubGlobal('navigator', {}); vi.stubGlobal('caches', undefined);
    startAdaptiveLoading('/review/', true);
    await vi.advanceTimersByTimeAsync(1000);
    browser.visibility(true); browser.visibility(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.serviceWorker.register).not.toHaveBeenCalled();
    expect(browser.dataset.semanticCached).toBe('false');
  });
});
