/** Automatic, independent data and compute policies. Unknown is deliberately cheap. */
export interface PerformanceMode {
  data: 'unknown' | 'normal' | 'save-data';
  compute: 'unknown' | 'normal' | 'low-compute';
}
export const INITIAL_MODE: PerformanceMode = Object.freeze({ data: 'unknown', compute: 'unknown' });
export const PERFORMANCE_KEY = 'recs-performance:v1';
export const PERFORMANCE_EVENT = 'recs-performance-change';
export const POLICY = Object.freeze({ blockingMs: 500, taskMs: 500, processingMs: 1500 });
export interface ConnectionHint { saveData?: boolean; effectiveType?: string }
export interface PerformanceEvidence {
  connection?: ConnectionHint; blockingMs: number; longestTaskMs: number; processingMs: number;
}
export function constrainedConnection(connection?: ConnectionHint): boolean {
  return !!connection?.saveData || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '');
}
/** Page loads cannot tell bandwidth from request delay, so they never veto the model download. Only the
 * browser's own Data Saver/2G/3G signal does; otherwise the service worker measures the real download
 * and stops it if it is too slow (see INSTALL_POLICY). */
export function classifyPerformance(evidence: PerformanceEvidence): PerformanceMode {
  const compute = evidence.blockingMs > POLICY.blockingMs || evidence.longestTaskMs > POLICY.taskMs
    || evidence.processingMs > POLICY.processingMs ? 'low-compute' : 'normal';
  return { data: constrainedConnection(evidence.connection) ? 'save-data' : 'normal', compute };
}
export function parsePerformanceMode(value: unknown): PerformanceMode | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as PerformanceMode;
  return ['unknown', 'normal', 'save-data'].includes(item.data) && ['unknown', 'normal', 'low-compute'].includes(item.compute)
    ? { data: item.data, compute: item.compute } : undefined;
}
export function canInstall(mode: PerformanceMode): boolean { return mode.data === 'normal' && mode.compute === 'normal'; }
export function canRunSemantic(mode: PerformanceMode, cached: boolean): boolean { return mode.compute === 'normal' && cached; }
/** Forced modes from the /dev page, kept in this browser until reset there. They change what the page does,
 * never the stored measurement, so returning to automatic restores the measured modes. */
export const OVERRIDE_KEY = 'recs-dev:performance';
export type PerformanceOverride = { data?: 'normal' | 'save-data'; compute?: 'normal' | 'low-compute' };
export function parsePerformanceOverride(value: unknown): PerformanceOverride {
  const item = (value && typeof value === 'object' ? value : {}) as PerformanceOverride;
  return {
    ...(item.data === 'normal' || item.data === 'save-data' ? { data: item.data } : {}),
    ...(item.compute === 'normal' || item.compute === 'low-compute' ? { compute: item.compute } : {}),
  };
}
export function readPerformanceOverride(): PerformanceOverride {
  try { return parsePerformanceOverride(JSON.parse(localStorage.getItem(OVERRIDE_KEY) || 'null')); } catch { return {}; }
}
export function writePerformanceOverride(override: PerformanceOverride): void {
  const clean = parsePerformanceOverride(override);
  try {
    if (Object.keys(clean).length) localStorage.setItem(OVERRIDE_KEY, JSON.stringify(clean)); else localStorage.removeItem(OVERRIDE_KEY);
  } catch { /* Storage unavailable: nothing to force. */ }
  refreshDevBadge();
  publishPerformanceMode(measuredPerformanceMode());
}
/** The "Dev settings on" badge shows while any /dev switch is on. */
export function refreshDevBadge(): void {
  let unapproved = false;
  try { unapproved = localStorage.getItem('recs-dev:unapproved') === '1'; } catch { /* storage blocked */ }
  if (Object.keys(readPerformanceOverride()).length || unapproved) document.documentElement.dataset.devOverride = 'true';
  else delete document.documentElement.dataset.devOverride;
}
export const applyOverride = (mode: PerformanceMode, override: PerformanceOverride = readPerformanceOverride()): PerformanceMode => ({ ...mode, ...override });
/** The modes this browser measured, before any /dev override. */
export function measuredPerformanceMode(): PerformanceMode {
  try {
    const stored = parsePerformanceMode(JSON.parse(sessionStorage.getItem(PERFORMANCE_KEY) || 'null'));
    if (stored) return stored;
  } catch { /* Fall back to the page state. */ }
  return Object.keys(readPerformanceOverride()).length ? INITIAL_MODE : currentPerformanceMode();
}
export function currentPerformanceMode(): PerformanceMode {
  if (typeof document === 'undefined') return INITIAL_MODE;
  return parsePerformanceMode({ data: document.documentElement.dataset.dataMode, compute: document.documentElement.dataset.computeMode }) ?? INITIAL_MODE;
}
/** Stores the measured `mode` and shows it, with any /dev override applied. */
export function publishPerformanceMode(mode: PerformanceMode): void {
  const previous = currentPerformanceMode(), shown = applyOverride(mode);
  document.documentElement.dataset.dataMode = shown.data;
  document.documentElement.dataset.computeMode = shown.compute;
  try { sessionStorage.setItem(PERFORMANCE_KEY, JSON.stringify(mode)); } catch { /* In-memory behavior remains usable. */ }
  if (previous.data !== shown.data || previous.compute !== shown.compute) window.dispatchEvent(new Event(PERFORMANCE_EVENT));
}
