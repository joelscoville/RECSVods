import { useMemo, useState } from 'react';
import type { SearchUnit } from '../lib/display';
import { prepareSearchIndex } from '../lib/search';
import { prepareVerseSelection } from '../lib/verse-selection';
import { searchUrl, siteUrl } from '../lib/urls';
import { availableBrowseCategories, suggestedTopics } from '../lib/browse';
import { usePerformanceMode } from '../lib/use-performance-mode';
import { canRunSemantic } from '../lib/performance-mode';
import { useSearchNavigation } from './use-search-navigation';
import { useSearchResources } from './use-search-resources';
import { useSemanticSearch } from './use-semantic-search';
import BrowseNavigation from './BrowseNavigation';
import Header from './Header';
import SearchField from './SearchField';
import Icon from './Icon';
import RecordingResult from './RecordingResult';
import { groupByRecording, type HomeItem } from './archive-display';
import CopyLink from './CopyLink';

const RESULTS_PER_PAGE = 20;

/** Composes independent navigation, archive-resource and semantic-search owners. */
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
  const navigation = useSearchNavigation(base);
  const query = navigation.request.text;
  const { history, historyStatus } = navigation;
  const resources = useSearchResources(base, query, initialUnits, {
    semanticAllowed,
    enrichAllowed,
  });
  const { units, metadata, scripture, indexStatus, scriptureStatus } =
    resources;
  const semantic = useSemanticSearch(
    base,
    navigation.request,
    metadata,
    semanticAllowed,
  );
  const {
    status: semanticStatus,
    error: semanticError,
    hasUnavailableRows,
  } = semantic;
  const [visiblePages, setVisiblePages] = useState(1);
  const visibleResults = visiblePages * RESULTS_PER_PAGE;

  const lexical = useMemo(() => prepareSearchIndex(units), [units]);
  const prepared = useMemo(
    () => lexical.withVectors(semantic.vectors),
    [lexical, semantic.vectors],
  );
  const exact = useMemo(() => prepared.search(query), [prepared, query]);
  const hybridResults = useMemo(
    () =>
      semantic.queryVector
        ? prepared.search(query, { queryVector: semantic.queryVector })
        : null,
    [prepared, query, semantic.queryVector],
  );
  // A recording is ranked by its best matching unit; the unit supplies its playback destination.
  const results = useMemo(
    () => groupByRecording(hybridResults ?? exact, recordings, base),
    [hybridResults, exact, recordings, base],
  );
  // BSB is retrieval evidence; the visible links lead to the corresponding ESV verses.
  const verseSelection = useMemo(
    () => (scripture ? prepareVerseSelection(scripture) : undefined),
    [scripture],
  );
  const findBestVerse = useMemo(
    () => (query.trim() ? verseSelection?.(query) : undefined),
    [verseSelection, query],
  );
  // Loading progress must not rerender every card and reparse its references.
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
    setVisiblePages(1);
    navigation.changeQuery(value, commit);
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
            onClick={resources.retryMetadata}
          >
            Retry loading the archive
          </button>
        )}
        {query.trim() && enrichAllowed && scriptureStatus === 'error' && (
          <button
            className="button button-secondary"
            type="button"
            onClick={resources.retryScripture}
          >
            Retry Bible verse search
          </button>
        )}
        {query.trim() && semanticAllowed && semanticError && (
          <button
            className="button button-secondary"
            type="button"
            onClick={semantic.retry}
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
                  onClick={navigation.clearHistory}
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
