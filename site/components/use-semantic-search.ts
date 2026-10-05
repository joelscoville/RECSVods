import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createSemanticSearchSession,
  type SemanticSnapshot,
} from '../lib/semantic-search-session';
import type { SearchQuery } from '../lib/search';
import type { ChapterMetadata } from '../lib/chapter-index';

/** React bridge to the single semantic owner. Results are also identity-filtered
 * during render, before effect cleanup, so old work cannot appear for a new query. */
export function useSemanticSearch(
  base: string,
  query: SearchQuery,
  metadata: ChapterMetadata | undefined,
  allowed: boolean,
) {
  const [snapshot, setSnapshot] = useState<SemanticSnapshot & { base: string }>(
    { base, status: { state: 'idle' }, error: false },
  );
  const [attempt, setAttempt] = useState(0);
  const owner =
    useRef<ReturnType<typeof createSemanticSearchSession>>(undefined);
  useEffect(() => {
    const session = createSemanticSearchSession(base, (value) =>
      setSnapshot({ ...value, base }),
    );
    owner.current = session;
    return () => {
      session.dispose();
      if (owner.current === session) owner.current = undefined;
    };
  }, [base]);
  useEffect(() => {
    const session = owner.current!;
    session.update({ query, metadata, allowed });
    return () => session.cancelQuery();
  }, [base, query, metadata, allowed, attempt]);

  const sameArchive = snapshot.base === base;
  const result =
    sameArchive &&
    allowed &&
    snapshot.result?.query === query &&
    snapshot.result.metadata === metadata
      ? snapshot.result
      : undefined;
  const vectors =
    sameArchive && snapshot.vectors?.metadata === metadata
      ? snapshot.vectors?.index
      : undefined;
  const hasUnavailableRows = useMemo(() => {
    if (!vectors) return false;
    for (
      let offset = 0;
      offset < vectors.values.length;
      offset += vectors.dimension
    ) {
      if (
        vectors.values
          .subarray(offset, offset + vectors.dimension)
          .every((value) => value === 0)
      )
        return true;
    }
    return false;
  }, [vectors]);
  return {
    vectors,
    queryVector: result?.queryVector,
    status: snapshot.status,
    error:
      sameArchive &&
      snapshot.input?.query === query &&
      snapshot.input.metadata === metadata &&
      snapshot.error,
    hasUnavailableRows,
    retry: () => setAttempt((value) => value + 1),
  };
}
