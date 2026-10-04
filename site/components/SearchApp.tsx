import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchUnit } from '../lib/display';
import { prepareSearchIndex, type DecodedChapterVectors } from '../lib/search';
import { prepareVerseSelection } from '../lib/verse-selection';
import {
  enrichUnits,
  loadChapterMetadata,
  loadChapterVectors,
  loadScriptureIndex,
  type ChapterMetadata,
  type ScriptureIndex,
} from '../lib/chapter-index';
import {
  createSemanticClient,
  type SemanticClient,
  type SemanticStatus,
} from '../lib/semantic';
import {
  clearSearchHistory,
  getSearchHistory,
  saveSearch,
} from '../lib/local-state';
import { searchUrl, siteUrl } from '../lib/urls';
import { availableBrowseCategories, suggestedTopics } from '../lib/browse';
import BrowseNavigation from './BrowseNavigation';
import Header from './Header';
import SearchField from './SearchField';
import Icon from './Icon';
import RecordingResult from './RecordingResult';
import { groupByRecording, type HomeItem } from './archive-display';
import CopyLink from './CopyLink';
import { usePerformanceMode } from '../lib/use-performance-mode';
import { canRunSemantic } from '../lib/performance-mode';

const RESULTS_PER_PAGE = 20;
const MAX_QUERY_LENGTH = 300;
const SEMANTIC_QUERY_DELAY_MS = 175;
const QUERY_EDIT_SESSION_MS = 900;

export default function SearchApp({
  base,
  initialUnits,
  recordings,
}: {
  base: string;
  initialUnits: SearchUnit[];
  recordings: HomeItem[];
}) {
  const mode = usePerformanceMode();
  const semanticAllowed = mode.ready && canRunSemantic(mode, mode.cached);
  const enrichAllowed =
    mode.ready && mode.data === 'normal' && mode.compute === 'normal';
  const [visiblePages, setVisiblePages] = useState(1);
  const visibleResults = visiblePages * RESULTS_PER_PAGE;
  const submitted = useRef(false);
  const [query, setQuery] = useState('');
  const [metadata, setMetadata] = useState<{
    base: string;
    index: ChapterMetadata;
  } | null>(null);
  const [scripture, setScripture] = useState<{
    base: string;
    index: ScriptureIndex;
  } | null>(null);
  const [scriptureStatus, setScriptureStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [scriptureAttempt, setScriptureAttempt] = useState(0);
  const currentMetadata = metadata?.base === base ? metadata.index : undefined;
  const units = useMemo(() => {
    const available = currentMetadata?.units ?? initialUnits;
    return scripture?.base === base
      ? enrichUnits(available, scripture.index)
      : available;
  }, [currentMetadata, initialUnits, scripture, base]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyStatus, setHistoryStatus] = useState('');
  const [indexStatus, setIndexStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [indexAttempt, setIndexAttempt] = useState(0);
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus>({
    state: 'idle',
  });
  const [semanticError, setSemanticError] = useState(false);
  const [semanticAttempt, setSemanticAttempt] = useState(0);
  const [vectors, setVectors] = useState<{
    metadata: ChapterMetadata;
    index: DecodedChapterVectors;
  } | null>(null);
  const [hybrid, setHybrid] = useState<{
    query: string;
    queryVector: number[];
    metadata: ChapterMetadata;
    base: string;
  } | null>(null);
  const lexical = useMemo(() => prepareSearchIndex(units), [units]);
  const prepared = useMemo(
    () =>
      lexical.withVectors(
        vectors?.metadata === currentMetadata ? vectors?.index : undefined,
      ),
    [lexical, vectors, currentMetadata],
  );
  const hasUnavailableRows = useMemo(() => {
    if (!vectors || vectors.metadata !== currentMetadata) return false;
    const { values, dimension } = vectors.index;
    for (let offset = 0; offset < values.length; offset += dimension) {
      if (
        values
          .subarray(offset, offset + dimension)
          .every((value) => value === 0)
      )
        return true;
    }
    return false;
  }, [vectors, currentMetadata]);
  const client = useRef<SemanticClient | null>(null);
  const vectorCache = useRef<{
    metadata: ChapterMetadata;
    promise: Promise<DecodedChapterVectors>;
  } | null>(null);
  const generation = useRef(0);
  const editing = useRef(false);
  const editTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    vectorCache.current = null;
    setVectors(null);

    function syncQueryFromUrl() {
      const queryFromUrl = new URLSearchParams(window.location.search).get('q');
      generation.current++;
      setQuery(queryFromUrl?.slice(0, MAX_QUERY_LENGTH) ?? '');
      setSemanticAttempt((attempt) => attempt + 1);
      setHybrid(null);
      editing.current = false;
    }

    function refreshHistory() {
      setHistory(getSearchHistory());
    }

    syncQueryFromUrl();
    const initialQuery = new URLSearchParams(window.location.search).get('q');
    setHistory(
      initialQuery?.trim() ? saveSearch(initialQuery) : getSearchHistory(),
    );
    client.current = createSemanticClient(base, setSemanticStatus, true);

    window.addEventListener('popstate', syncQueryFromUrl);
    window.addEventListener('storage', refreshHistory);
    window.addEventListener('recs-local-state-cleared', refreshHistory);
    window.addEventListener('recs-search-history-cleared', refreshHistory);

    return () => {
      generation.current++;
      client.current?.dispose();
      window.removeEventListener('popstate', syncQueryFromUrl);
      window.removeEventListener('storage', refreshHistory);
      window.removeEventListener('recs-local-state-cleared', refreshHistory);
      window.removeEventListener('recs-search-history-cleared', refreshHistory);
      clearTimeout(editTimer.current);
    };
  }, [base]);

  useEffect(() => {
    if (!semanticAllowed) {
      client.current?.dispose();
      client.current = null;
      setHybrid(null);
      return;
    }
    client.current ??= createSemanticClient(base, setSemanticStatus, true);
    void client.current.prepare().catch(() => setSemanticError(true));
    return () => {
      client.current?.cancel();
    };
  }, [base, semanticAllowed]);

  useEffect(() => {
    if (
      (!semanticAllowed && !enrichAllowed) ||
      !query.trim() ||
      currentMetadata
    ) {
      return;
    }
    const abort = new AbortController();
    setIndexStatus('loading');

    async function refreshMetadata() {
      try {
        const data = await loadChapterMetadata(base, abort.signal);
        // Filtering mixed-mode metadata would shift the corresponding binary rows.
        if (
          import.meta.env.ARCHIVE_MODE !== 'preview' &&
          data.units.some((unit) => unit.preview)
        ) {
          throw new Error('Ineligible archive index');
        }
        if (abort.signal.aborted) {
          return;
        }
        setMetadata({ base, index: data });
        setIndexStatus('ready');
      } catch {
        if (!abort.signal.aborted) {
          setIndexStatus('error');
        }
      }
    }

    void refreshMetadata();
    return () => abort.abort();
  }, [
    base,
    indexAttempt,
    semanticAllowed,
    enrichAllowed,
    Boolean(query.trim()),
    currentMetadata,
  ]);

  useEffect(() => {
    if (!enrichAllowed || !query.trim() || scripture?.base === base) {
      return;
    }
    const abort = new AbortController();
    setScriptureStatus('loading');

    async function loadVerseText() {
      try {
        const index = await loadScriptureIndex(base, abort.signal);
        if (abort.signal.aborted) {
          return;
        }
        setScripture({ base, index });
        setScriptureStatus('ready');
      } catch {
        if (!abort.signal.aborted) {
          setScriptureStatus('error');
        }
      }
    }

    void loadVerseText();
    return () => abort.abort();
  }, [base, scriptureAttempt, enrichAllowed, Boolean(query.trim()), scripture]);

  useEffect(() => {
    const version = ++generation.current;
    client.current?.cancel();
    setSemanticError(false);
    if (!semanticAllowed || !query.trim() || !currentMetadata?.units.length) {
      return;
    }
    const queryMetadata = currentMetadata;

    function vectorsFor(
      metadata: ChapterMetadata,
    ): Promise<DecodedChapterVectors> {
      if (vectorCache.current?.metadata === metadata) {
        return vectorCache.current.promise;
      }

      const promise = loadChapterVectors(base, metadata).then((index) => {
        if (index.rowCount !== metadata.units.length) {
          throw new Error('Search vector row mismatch');
        }
        if (!index.values.some((value) => value !== 0)) {
          throw new Error('No usable search vectors');
        }
        return index;
      });
      const entry = { metadata, promise };
      vectorCache.current = entry;
      void promise.catch(() => {
        if (vectorCache.current === entry) {
          vectorCache.current = null;
        }
      });
      return promise;
    }

    async function searchByMeaning() {
      try {
        if (!client.current) {
          return;
        }
        const [index, queryVector] = await Promise.all([
          vectorsFor(queryMetadata),
          client.current.embed(query),
        ]);
        if (generation.current === version) {
          setVectors((current) =>
            current?.metadata === queryMetadata && current.index === index
              ? current
              : { metadata: queryMetadata, index },
          );
          setHybrid({ query, queryVector, metadata: queryMetadata, base });
        }
      } catch {
        if (generation.current === version) {
          setSemanticError(true);
          setHybrid(null);
        }
      }
    }

    const delay = submitted.current ? 0 : SEMANTIC_QUERY_DELAY_MS;
    const timer = setTimeout(searchByMeaning, delay);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [base, query, currentMetadata, semanticAttempt, semanticAllowed]);

  const exact = useMemo(() => prepared.search(query), [prepared, query]);
  const hybridResults = useMemo(
    () =>
      hybrid?.query === query &&
      hybrid.metadata === currentMetadata &&
      hybrid.base === base
        ? prepared.search(query, { queryVector: hybrid.queryVector })
        : null,
    [prepared, hybrid, query, currentMetadata, base],
  );
  // Results are recordings, ranked by their best match; a matched point or part is offered under the player.
  const results = useMemo(
    () => groupByRecording(hybridResults ?? exact, recordings, base),
    [hybridResults, exact, recordings, base],
  );
  // Which verse of each cited passage the search's words best match (BSB text; never displayed).
  const verseSelection = useMemo(
    () =>
      scripture?.base === base
        ? prepareVerseSelection(scripture.index)
        : undefined,
    [scripture, base],
  );
  const findBestVerse = useMemo(
    () => (query.trim() ? verseSelection?.(query) : undefined),
    [verseSelection, query],
  );
  // Loading/progress messages must not rerender every recording and reparse its references.
  const resultItems = useMemo(
    () =>
      results.slice(0, visibleResults).map(({ recording, unit, reasons }) => (
        <li key={recording.id}>
          <RecordingResult
            recording={recording}
            unit={unit}
            units={units}
            reasons={reasons}
            query={query}
            findBestVerse={findBestVerse}
          />
        </li>
      )),
    [results, visibleResults, query, findBestVerse, units],
  );
  const categories = availableBrowseCategories(
    units.filter((unit) => unit.kind === 'recording'),
  );
  const topics = useMemo(() => suggestedTopics(units), [units]);

  function changeQuery(value: string, commit = false) {
    submitted.current = commit;
    client.current?.cancel();
    setVisiblePages(1);
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
    editTimer.current = setTimeout(() => {
      editing.current = false;
    }, QUERY_EDIT_SESSION_MS);
    if (commit && value.trim()) {
      setHistory(saveSearch(value));
      setHistoryStatus('');
    }
  }
  const field = (id: string) => (
    <SearchField
      id={id}
      compact={id.startsWith('mobile')}
      base={base}
      value={query}
      onChange={changeQuery}
      onSubmit={() => changeQuery(query, true)}
    />
  );
  const choose = (value: string) => changeQuery(value, true);

  return (
    <>
      <Header base={base}>{field('desktop-search-query')}</Header>
      <main id="main" className="search-main page-width" tabIndex={-1}>
        <div className="search-mobile-heading">
          <a
            className="icon-button back-button"
            href={siteUrl(base)}
            aria-label="Back to home"
          >
            <Icon name="back" />
          </a>
          <h1>Search</h1>
          <div className="mobile-query">{field('mobile-search-query')}</div>
        </div>
        <h1 className="desktop-search-title">Search the archive</h1>
        <div
          className="search-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {mode.compute === 'low-compute' ? (
            <p>
              Search is optimized for this device. Meaning-based search is off.
            </p>
          ) : (
            mode.data === 'save-data' && (
              <p>
                Search is saving data.
                {mode.cached
                  ? ' Cached meaning-based search is available.'
                  : ' Meaning-based search has not been downloaded.'}
              </p>
            )
          )}
          {indexStatus === 'loading' && (semanticAllowed || enrichAllowed) && (
            <p>
              Loading the archive…
              {initialUnits.length > 0 &&
                ' You can search the available recordings now.'}
            </p>
          )}
          {indexStatus === 'error' && (
            <p>
              The archive could not be refreshed.
              {units.length > 0
                ? ' Search is using the recordings available on this page.'
                : ' Check your connection and retry.'}
            </p>
          )}
          {query.trim() && (
            <p>
              {results.length}{' '}
              {results.length === 1 ? 'recording' : 'recordings'} found
              {hybridResults ? '.' : ' with exact search.'}
            </p>
          )}
          {query.trim() &&
            enrichAllowed &&
            units.length > 0 &&
            scriptureStatus === 'loading' && (
              <p>
                Loading Bible verse search. Titles, summaries and references are
                ready.
              </p>
            )}
          {query.trim() && scriptureStatus === 'error' && (
            <p>
              Bible verse search is unavailable. Titles, summaries and
              references still work.
            </p>
          )}
          {query.trim() &&
            semanticAllowed &&
            units.length > 0 &&
            !semanticError &&
            semanticStatus.state === 'loading' && (
              <p>
                Loading meaning-based search
                {semanticStatus.progress !== undefined
                  ? ` (${Math.floor(semanticStatus.progress * 100)}%)`
                  : ''}
                . Exact results are ready below.
              </p>
            )}
          {query.trim() && semanticAllowed && semanticError && (
            <p>
              Meaning-based search is unavailable. Exact search still works.
            </p>
          )}
          {query.trim() && hybridResults && hasUnavailableRows && (
            <p>
              Some recordings have no meaning-based match data. They remain
              available through exact search.
            </p>
          )}
        </div>
        {indexStatus === 'error' && (semanticAllowed || enrichAllowed) && (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setIndexAttempt((attempt) => attempt + 1)}
          >
            Retry loading the archive
          </button>
        )}
        {query.trim() && enrichAllowed && scriptureStatus === 'error' && (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setScriptureAttempt((attempt) => attempt + 1)}
          >
            Retry Bible verse search
          </button>
        )}
        {query.trim() && semanticAllowed && semanticError && (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setSemanticAttempt((attempt) => attempt + 1)}
          >
            Retry meaning-based search
          </button>
        )}
        {query.trim() ? (
          <section className="search-results" aria-label="Search results">
            <div className="results-toolbar">
              <h2>Results for “{query}”</h2>
              <CopyLink href={searchUrl(base, query)} label="Share search" />
            </div>
            {results.length ? (
              <>
                <ol className="result-list">{resultItems}</ol>
                {results.length > visibleResults && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setVisiblePages((count) => count + 1)}
                  >
                    Show more recordings
                  </button>
                )}
              </>
            ) : (
              <div className="no-results">
                <h2>
                  {units.length
                    ? 'No matching recordings'
                    : 'No published recordings yet'}
                </h2>
                <p>
                  {units.length
                    ? 'Try a date, a Bible reference, a topic, or fewer words.'
                    : 'Recordings will be searchable when they are ready to publish.'}
                </p>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => choose('')}
                >
                  Clear search
                </button>
              </div>
            )}
          </section>
        ) : (
          <div className="search-browse">
            <section className="history-section">
              <h2>Your history</h2>
              {history.length ? (
                <div className="chip-list">
                  {history.map((item) => (
                    <button
                      className="chip"
                      type="button"
                      key={item}
                      onClick={() => choose(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ) : (
                <p>Your searches will appear here on this device.</p>
              )}
              <div className="local-data-controls">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    const cleared = clearSearchHistory();
                    if (cleared) setHistory([]);
                    setHistoryStatus(
                      cleared
                        ? 'Search history cleared on this device. Playback progress is kept.'
                        : 'Search history could not be cleared. Check your browser storage settings and try again.',
                    );
                  }}
                >
                  Clear search history
                </button>
                <p role="status">{historyStatus}</p>
              </div>
            </section>
            <section className="category-section">
              <h2>Search by category</h2>
              <BrowseNavigation base={base} categories={categories} />
              {!categories.length && (
                <p>Categories will appear when recordings are published.</p>
              )}
            </section>
            <section className="topics-section">
              <h2>Suggested topics</h2>
              {topics.length ? (
                <div className="chip-list">
                  {topics.map((topic) => (
                    <button
                      className="chip"
                      key={topic}
                      type="button"
                      onClick={() => choose(topic)}
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              ) : (
                <p>Topics will come from the published archive.</p>
              )}
            </section>
          </div>
        )}
        <noscript>
          <p>
            Interactive search needs JavaScript.{' '}
            <a href={siteUrl(base)}>
              Browse the published recordings on the home page.
            </a>
          </p>
        </noscript>
      </main>
    </>
  );
}
