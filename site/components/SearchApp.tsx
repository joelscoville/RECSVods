import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchPassage } from '../lib/types';
import { search, type VectorIndex } from '../lib/search';
import { createSemanticClient, type SemanticClient, type SemanticStatus } from '../lib/semantic';
import { clearSearchHistory, getSearchHistory, saveSearch } from '../lib/local-state';
import { searchUrl, siteUrl } from '../lib/urls';
import { availableBrowseCategories } from '../lib/browse';
import BrowseNavigation from './BrowseNavigation';
import Header from './Header';
import SearchField from './SearchField';
import Icon from './Icon';
import PassageResult from './PassageResult';
import CopyLink from './CopyLink';

function isPassageIndex(value: unknown): value is SearchPassage[] {
  return Array.isArray(value) && value.every((item) => item &&
    ['id', 'serviceId', 'serviceTitle', 'videoId', 'title', 'summary', 'transcript', 'date', 'type'].every((key) => typeof item[key] === 'string') &&
    ['topics', 'scripture', 'questions'].every((key) => Array.isArray(item[key]) && item[key].every((v: unknown) => typeof v === 'string')) &&
    (item.scriptureDisplay === undefined || (Array.isArray(item.scriptureDisplay) && item.scriptureDisplay.every((reference: unknown) => typeof reference === 'string'))) &&
    typeof item.start === 'number' && Number.isFinite(item.start) && typeof item.end === 'number' && Number.isFinite(item.end) &&
    typeof item.preview === 'boolean' && (item.speaker === undefined || typeof item.speaker === 'string'));
}

export default function SearchApp({ base, initialPassages }: { base: string; initialPassages: SearchPassage[] }) {
  const [query, setQuery] = useState('');
  const [passages, setPassages] = useState(initialPassages);
  const [history, setHistory] = useState<string[]>([]);
  const [historyStatus, setHistoryStatus] = useState('');
  const [indexStatus, setIndexStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [indexAttempt, setIndexAttempt] = useState(0);
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus>({ state: 'idle' });
  const [semanticError, setSemanticError] = useState(false);
  const [semanticAttempt, setSemanticAttempt] = useState(0);
  const [hybrid, setHybrid] = useState<{ query: string; results: ReturnType<typeof search> } | null>(null);
  const client = useRef<SemanticClient | null>(null);
  const vectorCache = useRef<Promise<VectorIndex> | null>(null);
  const generation = useRef(0);
  const editing = useRef(false);
  const editTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const sync = () => { generation.current++; setQuery(new URLSearchParams(window.location.search).get('q')?.slice(0, 300) ?? ''); setHybrid(null); editing.current = false; };
    sync();
    const initialQuery = new URLSearchParams(window.location.search).get('q');
    setHistory(initialQuery?.trim() ? saveSearch(initialQuery) : getSearchHistory());
    client.current = createSemanticClient(base, setSemanticStatus);
    const refreshHistory = () => setHistory(getSearchHistory());
    window.addEventListener('popstate', sync);
    window.addEventListener('storage', refreshHistory);
    window.addEventListener('recs-local-state-cleared', refreshHistory);
    window.addEventListener('recs-search-history-cleared', refreshHistory);
    return () => { generation.current++; client.current?.dispose(); window.removeEventListener('popstate', sync); window.removeEventListener('storage', refreshHistory); window.removeEventListener('recs-local-state-cleared', refreshHistory); window.removeEventListener('recs-search-history-cleared', refreshHistory); clearTimeout(editTimer.current); };
  }, [base]);

  useEffect(() => {
    const abort = new AbortController();
    setIndexStatus('loading');
    fetch(siteUrl(base, 'generated/passages.json'), { signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Archive index unavailable');
      const data: unknown = await response.json();
      if (!isPassageIndex(data)) throw new Error('Archive index unreadable');
      if (!abort.signal.aborted) {
        setPassages(data.filter((passage) => import.meta.env.ARCHIVE_MODE === 'preview' || !passage.preview));
        setIndexStatus('ready');
      }
    }).catch(() => { if (!abort.signal.aborted) setIndexStatus('error'); });
    return () => abort.abort();
  }, [base, indexAttempt]);

  useEffect(() => {
    const version = ++generation.current;
    setSemanticError(false);
    if (!query.trim() || !passages.length) return;
    const timer = setTimeout(async () => {
      try {
        if (!client.current) return;
        vectorCache.current ??= fetch(siteUrl(base, 'generated/vectors.json')).then(async (response) => {
          if (!response.ok) throw new Error('Semantic index unavailable');
          return await response.json() as VectorIndex;
        }).catch((error: unknown) => { vectorCache.current = null; throw error; });
        const [vectors, queryVector] = await Promise.all([vectorCache.current, client.current.embed(query)]);
        if (generation.current === version) setHybrid({ query, results: search(passages, query, { vectors, queryVector, limit: 30 }) });
      } catch {
        if (generation.current === version) { setSemanticError(true); setHybrid(null); }
      }
    }, 300);
    return () => { clearTimeout(timer); generation.current++; };
  }, [base, query, passages, semanticAttempt]);

  const exact = useMemo(() => search(passages, query), [passages, query]);
  const results = hybrid?.query === query ? hybrid.results : exact;
  const categories = availableBrowseCategories([], passages);
  const topics = [...new Set(passages.flatMap((passage) => passage.topics))].slice(0, 8);

  function changeQuery(value: string, commit = false) {
    generation.current++;
    setQuery(value);
    setHybrid(null);
    const url = searchUrl(base, value);
    if (window.location.pathname + window.location.search !== url) {
      if (commit || !editing.current) window.history.pushState({}, '', url);
      else window.history.replaceState({}, '', url);
    }
    editing.current = !commit;
    clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => { editing.current = false; }, 900);
    if (commit && value.trim()) { setHistory(saveSearch(value)); setHistoryStatus(''); }
  }
  const field = (id: string) => <SearchField id={id} compact={id.startsWith('mobile')} base={base} value={query} onChange={changeQuery} onSubmit={() => changeQuery(query, true)} />;
  const choose = (value: string) => changeQuery(value, true);

  return <>
    <Header base={base}>{field('desktop-search-query')}</Header>
    <main id="main" className="search-main page-width" tabIndex={-1}>
      <div className="search-mobile-heading"><a className="icon-button back-button" href={siteUrl(base)} aria-label="Back to home"><Icon name="back" /></a><h1>Search</h1><div className="mobile-query">{field('mobile-search-query')}</div></div>
      <h1 className="desktop-search-title">Search the archive</h1>
      <div className="search-status" role="status" aria-live="polite" aria-atomic="true">
        {indexStatus === 'loading' && <p>Loading the archive…{initialPassages.length > 0 && ' You can search the available passages now.'}</p>}
        {indexStatus === 'error' && <p>The archive could not be refreshed.{passages.length > 0 ? ' Search is using the passages available on this page.' : ' Check your connection and retry.'}</p>}
        {query.trim() && <p>{results.length} {results.length === 1 ? 'passage' : 'passages'} found{hybrid?.query === query ? '.' : ' with exact search.'}</p>}
        {query.trim() && passages.length > 0 && !semanticError && semanticStatus.state === 'loading' && <p>Loading meaning-based search{semanticStatus.progress !== undefined ? ` (${Math.floor(semanticStatus.progress * 100)}%)` : ''}. Exact results are ready below.</p>}
        {query.trim() && semanticError && <p>Meaning-based search is unavailable. Exact search still works.</p>}
      </div>
      {indexStatus === 'error' && <button className="button button-secondary" type="button" onClick={() => setIndexAttempt((attempt) => attempt + 1)}>Retry loading the archive</button>}
      {query.trim() && semanticError && <button className="button button-secondary" type="button" onClick={() => setSemanticAttempt((attempt) => attempt + 1)}>Retry meaning-based search</button>}
      {query.trim() ? <section className="search-results" aria-label="Search results">
        <div className="results-toolbar"><h2>Results for “{query}”</h2><CopyLink href={searchUrl(base, query)} label="Share search" /></div>
        {results.length ? <ol className="result-list">{results.map(({ passage, reasons }) => <li key={passage.id}><PassageResult passage={passage} reasons={reasons} base={base} /></li>)}</ol> : <div className="no-results"><h2>{passages.length ? 'No matching passages' : 'No published passages yet'}</h2><p>{passages.length ? 'Try a speaker’s name, a date, a Bible reference, or fewer words.' : 'Passages will be searchable when recordings are ready to publish.'}</p><button className="button button-secondary" type="button" onClick={() => choose('')}>Clear search</button></div>}
      </section> : <div className="search-browse">
        <section className="history-section"><h2>Your history</h2>{history.length ? <div className="chip-list">{history.map((item) => <button className="chip" type="button" key={item} onClick={() => choose(item)}>{item}</button>)}</div> : <p>Your searches will appear here on this device.</p>}<div className="local-data-controls"><button className="button button-secondary" type="button" onClick={() => {
          const cleared = clearSearchHistory();
          if (cleared) setHistory([]);
          setHistoryStatus(cleared ? 'Search history cleared on this device. Playback progress is kept.' : 'Search history could not be cleared. Check your browser storage settings and try again.');
        }}>Clear search history</button><p role="status">{historyStatus}</p></div></section>
        <section className="category-section"><h2>Search by category</h2><BrowseNavigation base={base} categories={categories} includeIndex />{!categories.length && <p>Categories will appear when passages are published.</p>}</section>
        <section className="topics-section"><h2>Suggested topics</h2>{topics.length ? <div className="chip-list">{topics.map((topic) => <button className="chip" key={topic} type="button" onClick={() => choose(topic)}>{topic}</button>)}</div> : <p>Topics will come from the published archive.</p>}</section>
      </div>}
      <noscript><p>Interactive passage search needs JavaScript. <a href={siteUrl(base)}>Browse the published recordings on the home page.</a></p></noscript>
    </main>
  </>;
}
