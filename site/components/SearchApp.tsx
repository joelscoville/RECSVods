import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchChapter } from '../lib/types';
import { prepareSearchIndex, type DecodedChapterVectors } from '../lib/search';
import { enrichChapters, loadChapterMetadata, loadChapterVectors, loadScriptureIndex, type ChapterMetadata, type ScriptureIndex } from '../lib/chapter-index';
import { createSemanticClient, type SemanticClient, type SemanticStatus } from '../lib/semantic';
import { clearSearchHistory, getSearchHistory, saveSearch } from '../lib/local-state';
import { searchUrl, siteUrl } from '../lib/urls';
import { availableBrowseCategories, suggestedTopics } from '../lib/browse';
import BrowseNavigation from './BrowseNavigation';
import Header from './Header';
import SearchField from './SearchField';
import Icon from './Icon';
import RecordingResult from './RecordingResult';
import { groupByRecording, type HomeItem } from './archive-display';
import CopyLink from './CopyLink';

export default function SearchApp({ base, initialChapters, recordings }: { base: string; initialChapters: SearchChapter[]; recordings: HomeItem[] }) {
  const [query, setQuery] = useState('');
  const [metadata, setMetadata] = useState<{ base: string; index: ChapterMetadata } | null>(null);
  const [scripture, setScripture] = useState<{ base: string; index: ScriptureIndex } | null>(null);
  const [scriptureStatus, setScriptureStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [scriptureAttempt, setScriptureAttempt] = useState(0);
  const currentMetadata = metadata?.base === base ? metadata.index : undefined;
  const chapters = useMemo(() => {
    const available = currentMetadata?.chapters ?? initialChapters;
    return scripture?.base === base ? enrichChapters(available, scripture.index) : available;
  }, [currentMetadata, initialChapters, scripture, base]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyStatus, setHistoryStatus] = useState('');
  const [indexStatus, setIndexStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [indexAttempt, setIndexAttempt] = useState(0);
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus>({ state: 'idle' });
  const [semanticError, setSemanticError] = useState(false);
  const [semanticAttempt, setSemanticAttempt] = useState(0);
  const [vectors, setVectors] = useState<{ metadata: ChapterMetadata; index: DecodedChapterVectors } | null>(null);
  const [hybrid, setHybrid] = useState<{ query: string; queryVector: number[]; metadata: ChapterMetadata; base: string } | null>(null);
  const prepared = useMemo(() => prepareSearchIndex(chapters, vectors?.metadata === currentMetadata ? vectors?.index : undefined), [chapters, vectors, currentMetadata]);
  const hasUnavailableRows = useMemo(() => {
    if (!vectors || vectors.metadata !== currentMetadata) return false;
    const { values, dimension } = vectors.index;
    for (let offset = 0; offset < values.length; offset += dimension) {
      if (values.subarray(offset, offset + dimension).every((value) => value === 0)) return true;
    }
    return false;
  }, [vectors, currentMetadata]);
  const client = useRef<SemanticClient | null>(null);
  const vectorCache = useRef<{ metadata: ChapterMetadata; promise: Promise<DecodedChapterVectors> } | null>(null);
  const generation = useRef(0);
  const editing = useRef(false);
  const editTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    vectorCache.current = null;
    setVectors(null);
    const sync = () => { generation.current++; setQuery(new URLSearchParams(window.location.search).get('q')?.slice(0, 300) ?? ''); setSemanticAttempt((attempt) => attempt + 1); setHybrid(null); editing.current = false; };
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
    loadChapterMetadata(base, abort.signal).then((data) => {
      // Reject a mixed-mode artifact rather than filtering and shifting binary row ordinals.
      if (import.meta.env.ARCHIVE_MODE !== 'preview' && data.chapters.some((chapter) => chapter.preview)) throw new Error('Ineligible archive index');
      if (!abort.signal.aborted) {
        setMetadata({ base, index: data });
        setIndexStatus('ready');
      }
    }).catch(() => { if (!abort.signal.aborted) setIndexStatus('error'); });
    return () => abort.abort();
  }, [base, indexAttempt]);

  useEffect(() => {
    const abort = new AbortController();
    setScriptureStatus('loading');
    loadScriptureIndex(base, abort.signal).then((index) => {
      if (!abort.signal.aborted) { setScripture({ base, index }); setScriptureStatus('ready'); }
    }).catch(() => { if (!abort.signal.aborted) setScriptureStatus('error'); });
    return () => abort.abort();
  }, [base, scriptureAttempt]);

  useEffect(() => {
    const version = ++generation.current;
    setSemanticError(false);
    if (!query.trim() || !currentMetadata?.chapters.length) return;
    const timer = setTimeout(async () => {
      try {
        if (!client.current) return;
        if (vectorCache.current?.metadata !== currentMetadata) {
          const promise = loadChapterVectors(base, currentMetadata).then((index) => {
            if (index.rowCount !== currentMetadata.chapters.length) throw new Error('Chapter vector row mismatch');
            if (!index.values.some((value) => value !== 0)) throw new Error('No usable chapter vectors');
            return index;
          });
          const entry = { metadata: currentMetadata, promise };
          vectorCache.current = entry;
          void promise.catch(() => { if (vectorCache.current === entry) vectorCache.current = null; });
        }
        const [index, queryVector] = await Promise.all([vectorCache.current.promise, client.current.embed(query)]);
        if (generation.current === version) {
          setVectors((current) => current?.metadata === currentMetadata && current.index === index ? current : { metadata: currentMetadata, index });
          setHybrid({ query, queryVector, metadata: currentMetadata, base });
        }
      } catch {
        if (generation.current === version) { setSemanticError(true); setHybrid(null); }
      }
    }, 300);
    return () => { clearTimeout(timer); generation.current++; };
  }, [base, query, currentMetadata, semanticAttempt]);

  const exact = useMemo(() => prepared.search(query), [prepared, query]);
  const hybridResults = useMemo(() => hybrid?.query === query && hybrid.metadata === currentMetadata && hybrid.base === base
    ? prepared.search(query, { queryVector: hybrid.queryVector }) : null, [prepared, hybrid, query, currentMetadata, base]);
  // Results are recordings, ranked by their best chapter; that chapter is offered after the sermon.
  const results = useMemo(() => groupByRecording(hybridResults ?? exact, recordings, base), [hybridResults, exact, recordings, base]);
  const categories = availableBrowseCategories([], chapters);
  const topics = useMemo(() => suggestedTopics(chapters), [chapters]);

  function changeQuery(value: string, commit = false) {
    generation.current++;
    setQuery(value);
    setSemanticAttempt((attempt) => attempt + 1);
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
        {indexStatus === 'loading' && <p>Loading the archive…{initialChapters.length > 0 && ' You can search the available chapters now.'}</p>}
        {indexStatus === 'error' && <p>The archive could not be refreshed.{chapters.length > 0 ? ' Search is using the chapters available on this page.' : ' Check your connection and retry.'}</p>}
        {query.trim() && <p>{results.length} {results.length === 1 ? 'recording' : 'recordings'} found{hybridResults ? '.' : ' with exact search.'}</p>}
        {query.trim() && chapters.length > 0 && scriptureStatus === 'loading' && <p>Loading Bible verse search. Chapter keywords and references are ready.</p>}
        {query.trim() && scriptureStatus === 'error' && <p>Bible verse search is unavailable. Chapter keywords and references still work.</p>}
        {query.trim() && chapters.length > 0 && !semanticError && semanticStatus.state === 'loading' && <p>Loading meaning-based search{semanticStatus.progress !== undefined ? ` (${Math.floor(semanticStatus.progress * 100)}%)` : ''}. Exact results are ready below.</p>}
        {query.trim() && semanticError && <p>Meaning-based search is unavailable. Exact search still works.</p>}
        {query.trim() && hybridResults && hasUnavailableRows && <p>Some chapters have no meaning-based match data. They remain available through exact search.</p>}
      </div>
      {indexStatus === 'error' && <button className="button button-secondary" type="button" onClick={() => setIndexAttempt((attempt) => attempt + 1)}>Retry loading the archive</button>}
      {query.trim() && scriptureStatus === 'error' && <button className="button button-secondary" type="button" onClick={() => setScriptureAttempt((attempt) => attempt + 1)}>Retry Bible verse search</button>}
      {query.trim() && semanticError && <button className="button button-secondary" type="button" onClick={() => setSemanticAttempt((attempt) => attempt + 1)}>Retry meaning-based search</button>}
      {query.trim() ? <section className="search-results" aria-label="Search results">
        <div className="results-toolbar"><h2>Results for “{query}”</h2><CopyLink href={searchUrl(base, query)} label="Share search" /></div>
        {results.length ? <ol className="result-list">{results.map(({ recording, chapter, reasons }) => <li key={recording.id}><RecordingResult recording={recording} chapter={chapter} reasons={reasons} /></li>)}</ol> : <div className="no-results"><h2>{chapters.length ? 'No matching recordings' : 'No published chapters yet'}</h2><p>{chapters.length ? 'Try a speaker’s name, a date, a Bible reference, or fewer words.' : 'Chapters will be searchable when recordings are ready to publish.'}</p><button className="button button-secondary" type="button" onClick={() => choose('')}>Clear search</button></div>}
      </section> : <div className="search-browse">
        <section className="history-section"><h2>Your history</h2>{history.length ? <div className="chip-list">{history.map((item) => <button className="chip" type="button" key={item} onClick={() => choose(item)}>{item}</button>)}</div> : <p>Your searches will appear here on this device.</p>}<div className="local-data-controls"><button className="button button-secondary" type="button" onClick={() => {
          const cleared = clearSearchHistory();
          if (cleared) setHistory([]);
          setHistoryStatus(cleared ? 'Search history cleared on this device. Playback progress is kept.' : 'Search history could not be cleared. Check your browser storage settings and try again.');
        }}>Clear search history</button><p role="status">{historyStatus}</p></div></section>
        <section className="category-section"><h2>Search by category</h2><BrowseNavigation base={base} categories={categories} />{!categories.length && <p>Categories will appear when chapters are published.</p>}</section>
        <section className="topics-section"><h2>Suggested topics</h2>{topics.length ? <div className="chip-list">{topics.map((topic) => <button className="chip" key={topic} type="button" onClick={() => choose(topic)}>{topic}</button>)}</div> : <p>Topics will come from the published archive.</p>}</section>
      </div>}
      <noscript><p>Interactive chapter search needs JavaScript. <a href={siteUrl(base)}>Browse the published recordings on the home page.</a></p></noscript>
    </main>
  </>;
}
