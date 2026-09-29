/** Automatic, independent data and compute policies. Unknown is deliberately cheap. */
export interface PerformanceMode {
  data: 'unknown' | 'normal' | 'save-data';
  compute: 'unknown' | 'normal' | 'low-compute';
}
export const INITIAL_MODE: PerformanceMode = Object.freeze({ data: 'unknown', compute: 'unknown' });
export const PERFORMANCE_KEY = 'recs-performance:v1';
export const PERFORMANCE_EVENT = 'recs-performance-change';
export const POLICY = Object.freeze({ installSeconds: 10, minimumSampleBytes: 64 * 1024,
  blockingMs: 500, taskMs: 500, processingMs: 1500, readinessMs: 2500 });
export interface ConnectionHint { saveData?: boolean; effectiveType?: string }
export interface TimingSample { transferSize: number; responseStart: number; responseEnd: number }
export interface PerformanceEvidence {
  connection?: ConnectionHint; samples: TimingSample[]; installBytes: number;
  blockingMs: number; longestTaskMs: number; processingMs: number; readyMs: number;
}
export function constrainedConnection(connection?: ConnectionHint): boolean {
  return !!connection?.saveData || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '');
}
/** Sum bytes over the union of active transfer intervals, never add overlapping rates.
 * Dependency/hydration gaps are not transfer time (readiness has its own guard).
 * Cached/zero-sized and sub-millisecond samples are not evidence of a fast connection. */
export function observedBytesPerSecond(samples: readonly TimingSample[]): number | undefined {
  const useful = samples.filter(s => Number.isFinite(s.transferSize) && s.transferSize > 300
    && Number.isFinite(s.responseStart) && s.responseStart >= 0 && Number.isFinite(s.responseEnd) && s.responseEnd - s.responseStart >= 1);
  const bytes = useful.reduce((sum, s) => sum + s.transferSize, 0);
  if (bytes < POLICY.minimumSampleBytes) return undefined;
  const intervals = useful.sort((a, b) => a.responseStart - b.responseStart);
  let elapsed = 0, end = 0;
  for (const sample of intervals) {
    elapsed += Math.max(0, sample.responseEnd - Math.max(end, sample.responseStart));
    end = Math.max(end, sample.responseEnd);
  }
  return bytes / (elapsed / 1000);
}
export function classifyPerformance(evidence: PerformanceEvidence): PerformanceMode {
  const rate = observedBytesPerSecond(evidence.samples);
  const compute = evidence.blockingMs > POLICY.blockingMs || evidence.longestTaskMs > POLICY.taskMs
    || evidence.processingMs > POLICY.processingMs ? 'low-compute' : 'normal';
  const data = constrainedConnection(evidence.connection) ? 'save-data' : rate === undefined ? 'unknown'
    : evidence.installBytes / rate <= POLICY.installSeconds && evidence.readyMs <= POLICY.readinessMs ? 'normal' : 'save-data';
  return { data, compute };
}
export function parsePerformanceMode(value: unknown): PerformanceMode | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as PerformanceMode;
  return ['unknown', 'normal', 'save-data'].includes(item.data) && ['unknown', 'normal', 'low-compute'].includes(item.compute)
    ? { data: item.data, compute: item.compute } : undefined;
}
export function canInstall(mode: PerformanceMode): boolean { return mode.data === 'normal' && mode.compute === 'normal'; }
export function canRunSemantic(mode: PerformanceMode, cached: boolean): boolean { return mode.compute === 'normal' && cached; }
export function currentPerformanceMode(): PerformanceMode {
  if (typeof document === 'undefined') return INITIAL_MODE;
  return parsePerformanceMode({ data: document.documentElement.dataset.dataMode, compute: document.documentElement.dataset.computeMode }) ?? INITIAL_MODE;
}
export function publishPerformanceMode(mode: PerformanceMode): void {
  const previous = currentPerformanceMode();
  document.documentElement.dataset.dataMode = mode.data;
  document.documentElement.dataset.computeMode = mode.compute;
  try { sessionStorage.setItem(PERFORMANCE_KEY, JSON.stringify(mode)); } catch { /* In-memory behavior remains usable. */ }
  if (previous.data !== mode.data || previous.compute !== mode.compute) window.dispatchEvent(new Event(PERFORMANCE_EVENT));
}
