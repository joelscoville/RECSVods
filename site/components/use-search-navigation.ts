import { useEffect, useRef, useState } from 'react';
import {
  clearSearchHistory,
  getSearchHistory,
  saveSearch,
} from '../lib/local-state';
import { searchUrl } from '../lib/urls';
import type { SearchQuery } from '../lib/search';

const MAX_QUERY_LENGTH = 300;
const QUERY_EDIT_SESSION_MS = 900;

/** Owns URL editing/history and saved searches, without knowing about search workers. */
export function useSearchNavigation(base: string) {
  const [request, setRequest] = useState<SearchQuery>({
    text: '',
    immediate: false,
  });
  const [history, setHistory] = useState<string[]>([]);
  const [historyStatus, setHistoryStatus] = useState('');
  const editing = useRef(false);
  const editTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    function syncFromUrl() {
      const text =
        new URLSearchParams(window.location.search)
          .get('q')
          ?.slice(0, MAX_QUERY_LENGTH) ?? '';
      setRequest((previous) => ({ text, immediate: previous.immediate }));
      editing.current = false;
    }
    function refreshHistory() {
      setHistory(getSearchHistory());
    }
    syncFromUrl();
    const initialQuery = new URLSearchParams(window.location.search).get('q');
    setHistory(
      initialQuery?.trim() ? saveSearch(initialQuery) : getSearchHistory(),
    );
    window.addEventListener('popstate', syncFromUrl);
    window.addEventListener('storage', refreshHistory);
    window.addEventListener('recs-local-state-cleared', refreshHistory);
    window.addEventListener('recs-search-history-cleared', refreshHistory);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
      window.removeEventListener('storage', refreshHistory);
      window.removeEventListener('recs-local-state-cleared', refreshHistory);
      window.removeEventListener('recs-search-history-cleared', refreshHistory);
      clearTimeout(editTimer.current);
    };
  }, [base]);

  function changeQuery(text: string, commit = false) {
    // A new request identity also represents resubmitting an unchanged query.
    setRequest({ text, immediate: commit });
    const url = searchUrl(base, text);
    if (window.location.pathname + window.location.search !== url) {
      if (commit || !editing.current) window.history.pushState({}, '', url);
      else window.history.replaceState({}, '', url);
    }
    editing.current = !commit;
    clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => {
      editing.current = false;
    }, QUERY_EDIT_SESSION_MS);
    if (commit && text.trim()) {
      setHistory(saveSearch(text));
      setHistoryStatus('');
    }
  }
  function clearHistory() {
    const cleared = clearSearchHistory();
    if (cleared) setHistory([]);
    setHistoryStatus(
      cleared
        ? 'Search history cleared on this device. Playback progress is kept.'
        : 'Search history could not be cleared. Check your browser storage settings and try again.',
    );
  }
  return { request, history, historyStatus, changeQuery, clearHistory };
}
