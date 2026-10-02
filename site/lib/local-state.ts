const HISTORY_KEY = 'recs-replay:search-history:v1';
const RESUME_KEY = 'recs-replay:resume:v2';
/** Where a recording was left, on its own clock. */
export interface SavedPlayback { recordingId: string; time: number }

function read(key: string): unknown {
  try { return JSON.parse(window.localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function write(key: string, value: unknown): boolean {
  try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function getSearchHistory(): string[] {
  const value = read(HISTORY_KEY);
  return Array.isArray(value) ? value.filter((q): q is string => typeof q === 'string' && q.trim().length > 0 && q.length <= 300).slice(0, 8) : [];
}
export function saveSearch(query: string): string[] {
  const text = query.trim().slice(0, 300);
  const history = text ? [text, ...getSearchHistory().filter((item) => item.toLowerCase() !== text.toLowerCase())].slice(0, 8) : getSearchHistory();
  write(HISTORY_KEY, history);
  return history;
}
export function clearSearchHistory(): boolean {
  try {
    window.localStorage.removeItem(HISTORY_KEY);
    window.dispatchEvent(new Event('recs-search-history-cleared'));
    return true;
  } catch { return false; }
}
export function getSavedPlayback(): SavedPlayback | null {
  const value = read(RESUME_KEY) as Partial<SavedPlayback> | null;
  if (!value || typeof value.recordingId !== 'string' || typeof value.time !== 'number' || !Number.isFinite(value.time) || value.time < 0) return null;
  return { recordingId: value.recordingId, time: value.time };
}
export function savePlayback(value: SavedPlayback): boolean {
  if (!Number.isFinite(value.time) || value.time < 0) return false;
  return write(RESUME_KEY, { ...value, time: Math.floor(value.time) });
}
export function clearLocalState(): boolean {
  try {
    window.localStorage.removeItem(HISTORY_KEY);
    window.localStorage.removeItem(RESUME_KEY);
    window.localStorage.removeItem('recs-replay:resume:v1');
    window.dispatchEvent(new Event('recs-local-state-cleared'));
    return true;
  } catch { return false; }
}
