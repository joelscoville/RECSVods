import type { Page } from '@playwright/test';

/** Deterministic browser evidence, not a product override. Real throttled traces use native timing. */
export async function performanceEvidence(page: Page, data: 'fast' | 'slow' | 'unknown' = 'fast', compute: 'normal' | 'low' = 'normal') {
  await page.addInitScript(({ data, compute }) => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: Object.assign(new EventTarget(), {
      saveData: data === 'slow', effectiveType: data === 'slow' ? '3g' : '4g',
    }) });
    const original = performance.getEntriesByType.bind(performance);
    performance.getEntriesByType = (type: string) => {
      if (type === 'navigation') return [{ name: location.href, transferSize: data === 'unknown' ? 0 : 200_000,
        responseStart: 0, responseEnd: 10, domInteractive: 20, loadEventEnd: 40, toJSON() { return {}; } }] as unknown as PerformanceEntry[];
      if (type === 'resource') return [];
      return original(type);
    };
    const Original = PerformanceObserver;
    window.PerformanceObserver = class extends Original {
      callback: PerformanceObserverCallback;
      constructor(callback: PerformanceObserverCallback) { super(callback); this.callback = callback; }
      observe(options: PerformanceObserverInit) {
        if (options.type !== 'longtask') { super.observe(options); return; }
        if (compute === 'low') this.callback({ getEntries: () => [{ startTime: performance.now(), duration: 600 }] } as unknown as PerformanceObserverEntryList, this);
      }
    };
  }, { data, compute });
}
