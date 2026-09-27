import { isEmbeddingVector, preprocessEmbedding, semanticAssetPaths } from './embedding-config';

export interface SemanticStatus { state: 'idle' | 'loading' | 'ready' | 'error'; progress?: number }
export interface SemanticRequest { type: 'embed'; id: number; query: string; base: string }
export type SemanticResponse =
  | { type: 'status'; status: SemanticStatus }
  | { type: 'result'; id: number; vector: number[] }
  | { type: 'error'; id: number; message: string };
export interface SemanticClient { embed(query: string): Promise<number[]>; dispose(): void }

/** Lazy module worker; a rejected embed leaves lexical results usable. Next embed retries. */
export function createSemanticClient(base: string, onStatus: (status: SemanticStatus) => void = () => {}): SemanticClient {
  semanticAssetPaths(base);
  let worker: Worker | undefined;
  let disposed = false;
  let nextId = 0;
  const pending = new Map<number, { resolve: (vector: number[]) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  const fail = (message: string) => {
    worker?.terminate();
    worker = undefined;
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error(message)); }
    pending.clear();
    onStatus({ state: 'error' });
  };
  onStatus({ state: 'idle' });
  return {
    embed(query) {
      if (disposed) return Promise.reject(new Error('Semantic client is disposed'));
      const text = preprocessEmbedding(query);
      if (!text) return Promise.reject(new Error('Cannot embed an empty query'));
      return new Promise<number[]>((resolve, reject) => {
        const id = ++nextId;
        const timeout = setTimeout(() => fail('Semantic model request timed out; retry is available'), 120_000);
        pending.set(id, { resolve, reject, timeout });
        try {
          if (!worker) {
            onStatus({ state: 'loading', progress: 0 });
            worker = new Worker(new URL('../workers/semantic.worker.ts', import.meta.url), { type: 'module' });
            worker.onmessage = ({ data }: MessageEvent<SemanticResponse>) => {
              if (data.type === 'status') { onStatus(data.status); return; }
              if (data.type === 'error') { fail(data.message); return; }
              const request = pending.get(data.id);
              if (!request) return;
              if (!isEmbeddingVector(data.vector)) { fail('Semantic worker returned an incompatible vector'); return; }
              clearTimeout(request.timeout);
              pending.delete(data.id);
              request.resolve(data.vector);
            };
            worker.onerror = (event) => { event.preventDefault(); fail('Semantic model unavailable; exact search is still available'); };
            worker.onmessageerror = () => fail('Could not read semantic worker response');
          }
          worker.postMessage({ type: 'embed', id, query: text, base } satisfies SemanticRequest);
        } catch (error) { fail(error instanceof Error ? error.message : 'Semantic worker unavailable'); }
      });
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
