import { loadChapterVectors, type ChapterMetadata } from './chapter-index';
import {
  createSemanticClient,
  type SemanticClient,
  type SemanticStatus,
} from './semantic';
import type { DecodedChapterVectors, SearchQuery } from './search';

const SEMANTIC_QUERY_DELAY_MS = 175;
export interface SemanticInput {
  query: SearchQuery;
  metadata?: ChapterMetadata;
  allowed: boolean;
}
export interface SemanticSnapshot {
  status: SemanticStatus;
  error: boolean;
  input?: SemanticInput;
  vectors?: { metadata: ChapterMetadata; index: DecodedChapterVectors };
  result?: {
    query: SearchQuery;
    metadata: ChapterMetadata;
    queryVector: number[];
  };
}

interface SemanticDependencies {
  createClient: typeof createSemanticClient;
  loadVectors: typeof loadChapterVectors;
}

/** One owner for client lifetime, query cancellation and vector reuse. Navigation
 * supplies a value, never a worker or generation counter. Each update invalidates
 * the previous query; only its generation may publish a result or error. Model
 * preparation is client-scoped, while vectors are metadata-identity-scoped. */
export function createSemanticSearchSession(
  base: string,
  onChange: (snapshot: SemanticSnapshot) => void,
  dependencies: SemanticDependencies = {
    createClient: createSemanticClient,
    loadVectors: loadChapterVectors,
  },
) {
  let client: SemanticClient | undefined;
  let clientEpoch = 0;
  let generation = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let vectorCache:
    | { metadata: ChapterMetadata; promise: Promise<DecodedChapterVectors> }
    | undefined;
  let snapshot: SemanticSnapshot = { status: { state: 'idle' }, error: false };

  function publish(change: Partial<SemanticSnapshot>) {
    if (disposed) return;
    snapshot = { ...snapshot, ...change };
    onChange(snapshot);
  }
  function cancelQuery() {
    generation++;
    clearTimeout(timer);
    client?.cancel();
  }
  function stopClient() {
    clientEpoch++;
    client?.dispose();
    client = undefined;
    publish({ status: { state: 'idle' } });
  }
  function ensureClient() {
    if (client) return client;
    const epoch = ++clientEpoch;
    client = dependencies.createClient(
      base,
      (status) => {
        if (epoch === clientEpoch) publish({ status });
      },
      true,
    );
    void client.prepare().catch(() => {
      if (epoch === clientEpoch) publish({ error: true });
    });
    return client;
  }
  function vectorsFor(metadata: ChapterMetadata) {
    if (vectorCache?.metadata === metadata) return vectorCache.promise;
    const promise = dependencies.loadVectors(base, metadata).then((index) => {
      if (index.rowCount !== metadata.units.length)
        throw new Error('Search vector row mismatch');
      if (!index.values.some((value) => value !== 0))
        throw new Error('No usable search vectors');
      return index;
    });
    const entry = { metadata, promise };
    vectorCache = entry;
    void promise.catch(() => {
      if (vectorCache === entry) vectorCache = undefined;
    });
    return promise;
  }

  function update(input: SemanticInput) {
    if (disposed) return;
    cancelQuery();
    publish({ input, error: false, result: undefined });
    if (!input.allowed) {
      stopClient();
      return;
    }
    const activeClient = ensureClient();
    const metadata = input.metadata;
    if (!input.query.text.trim() || !metadata?.units.length) return;
    const queryMetadata = metadata;
    const ticket = generation;
    const current = () => !disposed && ticket === generation;
    async function runQuery() {
      try {
        const [index, queryVector] = await Promise.all([
          vectorsFor(queryMetadata),
          activeClient.embed(input.query.text),
        ]);
        if (!current()) return;
        const vectors =
          snapshot.vectors?.metadata === queryMetadata &&
          snapshot.vectors.index === index
            ? snapshot.vectors
            : { metadata: queryMetadata, index };
        publish({
          vectors,
          result: { query: input.query, metadata: queryMetadata, queryVector },
        });
      } catch {
        if (current()) publish({ error: true, result: undefined });
      }
    }
    timer = setTimeout(
      runQuery,
      input.query.immediate ? 0 : SEMANTIC_QUERY_DELAY_MS,
    );
  }

  function dispose() {
    cancelQuery();
    disposed = true;
    clientEpoch++;
    client?.dispose();
    client = undefined;
  }
  return { update, cancelQuery, dispose };
}
