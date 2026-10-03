import { useSyncExternalStore } from 'react';
import { currentPerformanceMode, INITIAL_MODE, PERFORMANCE_EVENT, type PerformanceMode } from './performance-mode';

function subscribe(callback: () => void) {
  window.addEventListener(PERFORMANCE_EVENT, callback);
  window.addEventListener('recs-semantic-cache-change', callback);
  return () => { window.removeEventListener(PERFORMANCE_EVENT, callback); window.removeEventListener('recs-semantic-cache-change', callback); };
}
const snapshot = () => {
  const mode = currentPerformanceMode();
  return `${mode.data}/${mode.compute}/${document.documentElement.dataset.semanticCached === 'true'}/${document.documentElement.dataset.essentialReady === 'true'}`;
};
/** The modes only decide whether the search model may download and run. */
export function usePerformanceMode(): PerformanceMode & { cached: boolean; ready: boolean } {
  const state = useSyncExternalStore(subscribe, snapshot, () => `${INITIAL_MODE.data}/${INITIAL_MODE.compute}/false/false`);
  const [data, compute, cached, ready] = state.split('/');
  return { data: data as PerformanceMode['data'], compute: compute as PerformanceMode['compute'], cached: cached === 'true', ready: ready === 'true' };
}
