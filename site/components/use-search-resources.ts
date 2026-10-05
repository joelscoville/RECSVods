import { useEffect, useMemo, useState } from 'react';
import {
  enrichUnits,
  loadChapterMetadata,
  loadScriptureIndex,
  type ChapterMetadata,
  type ScriptureIndex,
} from '../lib/chapter-index';
import type { SearchUnit } from '../lib/display';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Owns archive resources and retries. Query edits do not restart an in-flight
 * catalogue/BSB request; base identity prevents reuse across different archives. */
export function useSearchResources(
  base: string,
  query: string,
  initialUnits: SearchUnit[],
  permissions: {
    semanticAllowed: boolean;
    enrichAllowed: boolean;
  },
) {
  const { semanticAllowed, enrichAllowed } = permissions;
  const hasQuery = Boolean(query.trim());
  const [metadata, setMetadata] = useState<{
    base: string;
    index: ChapterMetadata;
  }>();
  const [scripture, setScripture] = useState<{
    base: string;
    index: ScriptureIndex;
  }>();
  const [indexStatus, setIndexStatus] = useState<LoadStatus>('idle');
  const [scriptureStatus, setScriptureStatus] = useState<LoadStatus>('idle');
  const [indexAttempt, setIndexAttempt] = useState(0);
  const [scriptureAttempt, setScriptureAttempt] = useState(0);
  const currentMetadata = metadata?.base === base ? metadata.index : undefined;
  const currentScripture =
    scripture?.base === base ? scripture.index : undefined;
  const units = useMemo(() => {
    const available = currentMetadata?.units ?? initialUnits;
    return currentScripture
      ? enrichUnits(available, currentScripture)
      : available;
  }, [currentMetadata, initialUnits, currentScripture]);

  useEffect(() => {
    if ((!semanticAllowed && !enrichAllowed) || !hasQuery || currentMetadata)
      return;
    const abort = new AbortController();
    setIndexStatus('loading');
    async function loadMetadata() {
      try {
        const index = await loadChapterMetadata(base, abort.signal);
        if (
          import.meta.env.ARCHIVE_MODE !== 'preview' &&
          index.units.some((unit) => unit.preview)
        ) {
          throw new Error('Ineligible archive index');
        }
        if (!abort.signal.aborted) {
          setMetadata({ base, index });
          setIndexStatus('ready');
        }
      } catch {
        if (!abort.signal.aborted) setIndexStatus('error');
      }
    }
    void loadMetadata();
    return () => abort.abort();
  }, [
    base,
    indexAttempt,
    semanticAllowed,
    enrichAllowed,
    hasQuery,
    currentMetadata,
  ]);

  useEffect(() => {
    if (!enrichAllowed || !hasQuery || scripture?.base === base) return;
    const abort = new AbortController();
    setScriptureStatus('loading');
    async function loadScripture() {
      try {
        const index = await loadScriptureIndex(base, abort.signal);
        if (!abort.signal.aborted) {
          setScripture({ base, index });
          setScriptureStatus('ready');
        }
      } catch {
        if (!abort.signal.aborted) setScriptureStatus('error');
      }
    }
    void loadScripture();
    return () => abort.abort();
  }, [base, scriptureAttempt, enrichAllowed, hasQuery, scripture]);

  return {
    units,
    metadata: currentMetadata,
    scripture: currentScripture,
    indexStatus,
    scriptureStatus,
    retryMetadata: () => setIndexAttempt((attempt) => attempt + 1),
    retryScripture: () => setScriptureAttempt((attempt) => attempt + 1),
  };
}
