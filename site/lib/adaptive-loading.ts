import { canInstall, classifyPerformance, constrainedConnection, currentPerformanceMode, PERFORMANCE_EVENT, POLICY, publishPerformanceMode, type ConnectionHint } from './performance-mode';
import { SEMANTIC_INSTALL_BYTES, semanticAssetsCached } from './semantic-assets';

/** Tiny global coordinator. No Transformers import and no inference outside search. */
export function startAdaptiveLoading(base: string, hasSearchContent: boolean): void {
  const connection = (navigator as Navigator & { connection?: ConnectionHint & EventTarget }).connection;
  let blockingMs = 0, longestTaskMs = 0, lastBusy = performance.now(), playback = false;
  let recentTasks: { startTime: number; duration: number }[] = [];
  let registration: ServiceWorkerRegistration | undefined;
  let installRequested = false;
  let idleTimer: ReturnType<typeof setTimeout>;
  let alive = true;
  let ready = false;
  let readyAt = 0;
  const pause = () => (registration?.active ?? navigator.serviceWorker?.controller)?.postMessage({ type: 'recs-semantic-pause' });
  const publishCached = async () => {
    const controller = navigator.serviceWorker?.controller;
    const controlled = controller?.scriptURL === new URL(`${base}semantic-sw.js`, location.origin).href;
    document.documentElement.dataset.semanticCached = String(controlled && await semanticAssetsCached(base));
    window.dispatchEvent(new Event('recs-semantic-cache-change'));
  };
  const update = () => {
    if (!ready) return;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const result = classifyPerformance({ connection,
      samples: [nav, ...resources].filter((entry): entry is PerformanceResourceTiming => !!entry && new URL(entry.name).origin === location.origin
        && !/\/(models|onnx)\//.test(entry.name)), installBytes: SEMANTIC_INSTALL_BYTES,
      blockingMs, longestTaskMs, processingMs: nav ? Math.max(0, nav.domInteractive - nav.responseEnd) : 0,
      readyMs: readyAt });
    const previous = currentPerformanceMode();
    // Downgrades are sticky for this tab session. A cached navigation is not new speed evidence.
    if (previous.data === 'save-data') result.data = 'save-data';
    else if (result.data === 'unknown' && previous.data === 'normal') result.data = 'normal';
    if (previous.compute === 'low-compute') result.compute = 'low-compute';
    publishPerformanceMode(result);
    if (!canInstall(result)) pause();
  };
  let observer: PerformanceObserver | undefined;
  try {
    observer = new PerformanceObserver(list => {
      const now = performance.now();
      recentTasks = [...recentTasks, ...list.getEntries()].filter(entry => entry.startTime + entry.duration >= now - 2000);
      blockingMs = recentTasks.reduce((sum, entry) => sum + Math.max(0, entry.duration - 50), 0);
      longestTaskMs = Math.max(0, ...recentTasks.map(entry => entry.duration));
      lastBusy = now;
      if (ready && (blockingMs > POLICY.blockingMs || longestTaskMs > POLICY.taskMs)) update();
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch { /* Timing classification still works where longtask observation is unavailable. */ }
  const schedule = () => {
    clearTimeout(idleTimer);
    if (!alive || document.hidden || playback) return;
    idleTimer = setTimeout(() => {
      if (!alive || document.hidden || playback) return;
      if (performance.now() - lastBusy < 500) { schedule(); return; }
      const begin = async () => {
        if (document.hidden || playback || !canInstall(currentPerformanceMode()) || installRequested || !hasSearchContent) return;
        if (performance.now() - lastBusy < 500) { schedule(); return; }
        installRequested = true;
        try {
          if (!('serviceWorker' in navigator) || !('caches' in globalThis)) return;
          registration = await navigator.serviceWorker.register(`${base}semantic-sw.js`, { scope: base });
          await navigator.serviceWorker.ready;
          if (document.hidden || playback || !canInstall(currentPerformanceMode())) return;
          registration.active?.postMessage({ type: 'recs-semantic-install' });
        } catch { /* Optional installation never blocks navigation or exact search. */ }
      };
      if ('requestIdleCallback' in window) window.requestIdleCallback(() => { void begin(); }, { timeout: 2000 });
      else void begin();
    }, 750);
  };
  const loaded = () => {
    if (!alive) return;
    // window.load can precede Astro's dynamic React hydration downloads.
    if (document.querySelector('astro-island[client="load"][ssr]')) { idleTimer = setTimeout(loaded, 100); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => {
    readyAt = performance.now();
    ready = true; update(); document.documentElement.dataset.essentialReady = 'true';
    window.dispatchEvent(new Event(PERFORMANCE_EVENT)); performance.mark('recs-essential-ready');
    window.dispatchEvent(new Event('recs-essential-ready')); schedule();
    }));
  };
  if (document.readyState === 'complete') loaded(); else window.addEventListener('load', loaded, { once: true });
  if (constrainedConnection(connection)) publishPerformanceMode({ ...currentPerformanceMode(), data: 'save-data' });
  void publishCached();
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type !== 'recs-semantic-install') return;
    if (event.data.state === 'cached') void publishCached();
    if (event.data.state === 'slow' || event.data.state === 'error') publishPerformanceMode({ ...currentPerformanceMode(), data: 'save-data' });
    if (event.data.state === 'paused') installRequested = false;
  });
  navigator.serviceWorker?.addEventListener('controllerchange', () => { void publishCached(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else schedule(); });
  document.addEventListener('input', () => { lastBusy = performance.now(); });
  connection?.addEventListener('change', () => { update(); schedule(); });
  window.addEventListener('recs-playback-start', () => { playback = true; pause(); });
  window.addEventListener(PERFORMANCE_EVENT, () => { if (!canInstall(currentPerformanceMode())) pause(); });
  window.addEventListener('pagehide', () => { alive = false; observer?.disconnect(); clearTimeout(idleTimer); });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { alive = true; update(); void publishCached(); schedule(); }
  });
}
