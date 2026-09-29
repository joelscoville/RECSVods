import { canInstall, classifyPerformance, constrainedConnection, currentPerformanceMode, PERFORMANCE_EVENT, POLICY, publishPerformanceMode, type ConnectionHint } from './performance-mode';
import { SEMANTIC_INSTALL_BYTES, semanticAssetsCached } from './semantic-assets';

type PagePhase = 'loading' | 'ready' | 'suspended';
type InstallPhase = 'idle' | 'scheduled' | 'registering' | 'installing' | 'pausing' | 'suspended' | 'cached' | 'unavailable';

/** Tiny global coordinator. No Transformers import and no inference outside search. */
export function startAdaptiveLoading(base: string, hasSearchContent: boolean): void {
  const connection = (navigator as Navigator & { connection?: ConnectionHint & EventTarget }).connection;
  const workerUrl = new URL(`${base}semantic-sw.js`, location.origin).href;
  let pagePhase: PagePhase = 'loading';
  let installPhase: InstallPhase = 'idle';
  let readyAt = 0, lastBusy = performance.now(), playback = false;
  let blockingMs = 0, longestTaskMs = 0, observationStart = 0;
  let recentTasks: { startTime: number; duration: number }[] = [];
  let registration: ServiceWorkerRegistration | undefined;
  let registrationTask: Promise<ServiceWorkerRegistration> | undefined;
  let attempt = 0, pageEpoch = 0;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  let installTimer: ReturnType<typeof setTimeout> | undefined;
  let idleCallback: number | undefined;
  const eligible = () => pagePhase === 'ready' && !document.hidden && !playback && hasSearchContent && canInstall(currentPerformanceMode());
  const worker = () => registration?.active ?? (navigator.serviceWorker?.controller?.scriptURL === workerUrl ? navigator.serviceWorker.controller : undefined);

  function cancelSchedule() {
    clearTimeout(installTimer);
    if (idleCallback !== undefined) window.cancelIdleCallback?.(idleCallback);
    idleCallback = undefined;
  }
  function suspendInstallation() {
    cancelSchedule();
    // Invalidates continuations already awaiting registration/activation. Registration itself
    // is shared and may still complete; only a fresh eligible attempt may send installation.
    attempt++;
    if (installPhase === 'installing' || installPhase === 'pausing') installPhase = 'pausing';
    else if (installPhase !== 'cached' && installPhase !== 'unavailable') installPhase = 'suspended';
    worker()?.postMessage({ type: 'recs-semantic-pause' });
  }
  const publishCached = async () => {
    const controlled = navigator.serviceWorker?.controller?.scriptURL === workerUrl;
    document.documentElement.dataset.semanticCached = String(controlled && await semanticAssetsCached(base));
    window.dispatchEvent(new Event('recs-semantic-cache-change'));
  };
  function update() {
    if (pagePhase !== 'ready') return;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const result = classifyPerformance({ connection,
      samples: [nav, ...resources].filter((entry): entry is PerformanceResourceTiming => !!entry && new URL(entry.name).origin === location.origin
        && !/\/(models|onnx)\//.test(entry.name)), installBytes: SEMANTIC_INSTALL_BYTES,
      blockingMs, longestTaskMs, processingMs: nav ? Math.max(0, nav.domInteractive - nav.responseEnd) : 0, readyMs: readyAt });
    const previous = currentPerformanceMode();
    // A restored page keeps its session classification, but not its old measurement window.
    if (previous.data === 'save-data') result.data = 'save-data';
    else if (result.data === 'unknown' && previous.data === 'normal') result.data = 'normal';
    if (previous.compute === 'low-compute') result.compute = 'low-compute';
    publishPerformanceMode(result);
    if (!canInstall(result)) suspendInstallation();
  }
  let observer: PerformanceObserver | undefined;
  function observeTasks(buffered: boolean) {
    try {
      observer ??= new PerformanceObserver(list => {
        if (pagePhase === 'suspended') return;
        const now = performance.now();
        recentTasks = [...recentTasks, ...list.getEntries()].filter(entry => entry.startTime >= observationStart && entry.startTime + entry.duration >= now - 2000);
        blockingMs = recentTasks.reduce((sum, entry) => sum + Math.max(0, entry.duration - 50), 0);
        longestTaskMs = Math.max(0, ...recentTasks.map(entry => entry.duration));
        lastBusy = now;
        if (blockingMs > POLICY.blockingMs || longestTaskMs > POLICY.taskMs) update();
      });
      observer.observe({ type: 'longtask', buffered });
    } catch { /* Timing classification still works without long-task observation. */ }
  }

  async function beginInstallation() {
    if (installPhase !== 'scheduled') return;
    if (!eligible()) { suspendInstallation(); return; }
    if (performance.now() - lastBusy < 500) { schedule(); return; }
    if (!navigator.serviceWorker || !('caches' in globalThis)) { installPhase = 'unavailable'; return; }
    const ticket = ++attempt;
    installPhase = 'registering';
    try {
      registrationTask ??= navigator.serviceWorker.register(`${base}semantic-sw.js`, { scope: base }).then(async registered => {
        await navigator.serviceWorker.ready;
        return registered;
      }).catch(error => { registrationTask = undefined; throw error; });
      registration = await registrationTask;
      if (ticket !== attempt || !eligible() || installPhase !== 'registering') return;
      // An active worker is required; a successful register() alone is not an install request.
      if (!registration.active) return;
      registration.active.postMessage({ type: 'recs-semantic-install' });
      installPhase = 'installing';
    } catch { /* Optional installation never blocks exact search; a later resume can retry. */ }
    finally {
      if (ticket === attempt && installPhase === 'registering') installPhase = eligible() ? 'idle' : 'suspended';
    }
  }
  function schedule() {
    cancelSchedule();
    if (!eligible()) return;
    if (installPhase !== 'idle' && installPhase !== 'scheduled' && installPhase !== 'suspended') return;
    installPhase = 'scheduled';
    installTimer = setTimeout(() => {
      if ('requestIdleCallback' in window) idleCallback = window.requestIdleCallback(() => { void beginInstallation(); }, { timeout: 2000 });
      else void beginInstallation();
    }, 750);
  }
  function loaded() {
    if (pagePhase !== 'loading') return;
    // window.load can precede Astro's dynamic React hydration downloads.
    if (document.querySelector('astro-island[client="load"][ssr]')) { loadTimer = setTimeout(loaded, 100); return; }
    const epoch = pageEpoch;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (pagePhase !== 'loading' || epoch !== pageEpoch) return;
      readyAt = performance.now(); pagePhase = 'ready'; update();
      document.documentElement.dataset.essentialReady = 'true';
      window.dispatchEvent(new Event(PERFORMANCE_EVENT)); performance.mark('recs-essential-ready');
      window.dispatchEvent(new Event('recs-essential-ready')); schedule();
    }));
  }
  observeTasks(true);
  if (document.readyState === 'complete') loaded(); else window.addEventListener('load', loaded, { once: true });
  if (constrainedConnection(connection)) publishPerformanceMode({ ...currentPerformanceMode(), data: 'save-data' });
  void publishCached();
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type !== 'recs-semantic-install') return;
    if (event.data.state === 'cached') { installPhase = 'cached'; void publishCached(); }
    if (event.data.state === 'slow' || event.data.state === 'error') {
      installPhase = 'unavailable'; publishPerformanceMode({ ...currentPerformanceMode(), data: 'save-data' });
    }
    if (event.data.state === 'paused') {
      installPhase = 'suspended';
      // Visibility can return before the worker acknowledges pause; this is the resume edge.
      schedule();
    }
  });
  navigator.serviceWorker?.addEventListener('controllerchange', () => { void publishCached(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspendInstallation(); else schedule(); });
  document.addEventListener('input', () => { lastBusy = performance.now(); });
  connection?.addEventListener('change', () => { update(); schedule(); });
  window.addEventListener('recs-playback-start', () => { playback = true; suspendInstallation(); });
  window.addEventListener(PERFORMANCE_EVENT, () => { if (!canInstall(currentPerformanceMode())) suspendInstallation(); });
  window.addEventListener('pagehide', () => {
    pagePhase = 'suspended'; pageEpoch++; observer?.disconnect(); clearTimeout(loadTimer); suspendInstallation();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    pagePhase = document.documentElement.dataset.essentialReady === 'true' ? 'ready' : 'loading';
    // Never replay buffered pre-freeze work or add it to a fresh two-second window.
    observationStart = performance.now(); lastBusy = observationStart;
    recentTasks = []; blockingMs = 0; longestTaskMs = 0;
    observeTasks(false);
    // Pause/completion notifications may have been missed while frozen. Sending install again
    // is idempotent in the SW and resumes only missing files.
    if (installPhase !== 'cached' && installPhase !== 'unavailable') installPhase = 'suspended';
    update(); void publishCached();
    if (pagePhase === 'loading') loaded(); else schedule();
  });
}
