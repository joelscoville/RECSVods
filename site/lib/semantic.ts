import { isEmbeddingVector, preprocessEmbedding, semanticAssetPaths } from './embedding-config';

export interface SemanticStatus { state: 'idle' | 'loading' | 'ready' | 'error'; progress?: number }
export type SemanticRequest = { type: 'embed'; id: number; query: string; base: string; cacheOnly?: boolean }
  | { type: 'prepare'; id: number; base: string; cacheOnly?: boolean } | { type: 'cancel'; id: number };
export type SemanticResponse =
  | { type: 'status'; status: SemanticStatus }
  | { type: 'result'; id: number; vector: number[] }
  | { type: 'prepared'; id: number }
  | { type: 'cancelled'; id: number }
  | { type: 'error'; id: number; message: string };
export interface SemanticClient { embed(query: string): Promise<number[]>; prepare(): Promise<void>; cancel(): void; dispose(): void }

/** Lazy module worker; a rejected embed leaves lexical results usable. Next embed retries. */
export function createSemanticClient(base: string, onStatus: (status: SemanticStatus) => void = () => {}, cacheOnly = false): SemanticClient {
  semanticAssetPaths(base);
  let worker: Worker | undefined;
  let disposed = false;
  let nextId = 0;
  const pending = new Map<number, { kind: 'prepare' | 'embed'; resolve: (vector: number[]) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  const fail = (message: string) => {
    worker?.terminate();
    worker = undefined;
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error(message)); }
    pending.clear();
    onStatus({ state: 'error' });
  };
  onStatus({ state: 'idle' });
  function request(kind: 'prepare' | 'embed', query = '') {
      if (disposed) return Promise.reject(new Error('Semantic client is disposed'));
      const text = preprocessEmbedding(query);
      if (kind === 'embed' && !text) return Promise.reject(new Error('Cannot embed an empty query'));
      return new Promise<number[]>((resolve, reject) => {
        const id = ++nextId;
        const timeout = setTimeout(() => fail('Semantic model request timed out; retry is available'), 120_000);
        pending.set(id, { kind, resolve, reject, timeout });
        try {
          if (!worker) {
            onStatus({ state: 'loading', progress: 0 });
            worker = new Worker(new URL('../workers/semantic.worker.ts', import.meta.url), { type: 'module' });
            worker.onmessage = ({ data }: MessageEvent<SemanticResponse>) => {
              if (data.type === 'status') { onStatus(data.status); return; }
              if (data.type === 'error') { fail(data.message); return; }
              const request = pending.get(data.id);
              if (!request) return;
              clearTimeout(request.timeout);
              pending.delete(data.id);
              if (data.type === 'cancelled') { request.reject(new DOMException('Superseded query', 'AbortError')); return; }
              if (data.type === 'prepared') { request.resolve([]); return; }
              if (!isEmbeddingVector(data.vector)) { request.reject(new Error('Incompatible vector')); fail('Semantic worker returned an incompatible vector'); return; }
              request.resolve(data.vector);
            };
            worker.onerror = (event) => { event.preventDefault(); fail('Semantic model unavailable; exact search is still available'); };
            worker.onmessageerror = () => fail('Could not read semantic worker response');
          }
          worker.postMessage({ type: kind, id, ...(kind === 'embed' ? { query: text } : {}), base,
            ...(cacheOnly ? { cacheOnly: true } : {}) } as SemanticRequest);
        } catch (error) { fail(error instanceof Error ? error.message : 'Semantic worker unavailable'); }
      });
  }
  return {
    embed: query => request('embed', query),
    prepare: () => request('prepare').then(() => {}),
    cancel() {
      for (const [id, item] of pending) if (item.kind === 'embed') {
        clearTimeout(item.timeout); item.reject(new DOMException('Superseded query', 'AbortError')); pending.delete(id);
        worker?.postMessage({ type: 'cancel', id } satisfies SemanticRequest);
      }
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = undefined;
      for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error('Semantic client disposed')); }
      pending.clear();
      onStatus({ state: 'idle' });
    },
  };
}
