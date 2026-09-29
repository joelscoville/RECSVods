import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBEDDING_CONFIG, EMBEDDING_OPTIONS, isEmbeddingVector, MODEL_FILES, preprocessEmbedding, semanticAssetPaths } from '../lib/embedding-config';
import type { SemanticRequest, SemanticResponse } from '../lib/semantic';
import { semanticCacheName } from '../lib/semantic-assets';

const context = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SemanticRequest>) => void) | null;
  postMessage: (response: SemanticResponse) => void;
};
let extractor: FeatureExtractionPipeline | undefined;
let pending: Exclude<SemanticRequest, { type: 'cancel' }> | undefined;
let running = false;
const cancelled = new Set<number>();
let activeId: number | undefined;

async function embed(request: Exclude<SemanticRequest, { type: 'cancel' }>) {
  if (!extractor) {
    const paths = semanticAssetPaths(request.base);
    if (env.version !== EMBEDDING_CONFIG.transformersVersion) throw new Error('Incompatible browser embedding library version');
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = paths.models;
    // The library's default cache keys use unversioned local paths. Separate revisions
    // so an upgrade cannot silently reuse old weights under new vector metadata.
    env.useBrowserCache = false;
    env.useCustomCache = false;
    try {
      const cache = await globalThis.caches.open(request.cacheOnly ? semanticCacheName(request.base) : `recs-embeddings-${EMBEDDING_CONFIG.revision}-${EMBEDDING_CONFIG.dtype}`);
      env.customCache = request.cacheOnly ? {
        async match(key: RequestInfo | URL) {
          const response = await cache.match(key);
          if (!response) throw new Error('Semantic asset is no longer cached');
          return response;
        },
        async put() { throw new Error('Cache-only inference cannot download models'); },
      } : cache;
      env.useCustomCache = true;
    } catch (error) { if (request.cacheOnly) throw error; }
    const wasm = env.backends.onnx.wasm!;
    // Absolute same-origin URLs also work from the emitted /_astro/ worker URL.
    wasm.wasmPaths = new URL(paths.onnx, globalThis.location.origin).href;
    if (request.cacheOnly) {
      const suffix = `?recs-cache=${encodeURIComponent(semanticCacheName(request.base))}`;
      wasm.wasmPaths = {
        mjs: new URL(`${paths.onnx}ort-wasm-simd-threaded.jsep.mjs${suffix}`, globalThis.location.origin).href,
        wasm: new URL(`${paths.onnx}ort-wasm-simd-threaded.jsep.wasm${suffix}`, globalThis.location.origin).href,
      };
      // Transformers' cache helper swallows match errors. Prevent any cache-miss fallback.
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), globalThis.location.href);
        if (url.pathname.includes('/models/')) return Promise.reject(new Error('Cache-only model unavailable'));
        return nativeFetch(input, init);
      };
    }
    wasm.numThreads = 1; // GitHub Pages does not provide cross-origin isolation headers.
    wasm.proxy = false;
    const loaded = new Map<string, number>();
    const total = MODEL_FILES.reduce((sum, file) => sum + file.bytes, 0);
    context.postMessage({ type: 'status', status: { state: 'loading', progress: 0 } });
    extractor = await pipeline<'feature-extraction'>('feature-extraction', EMBEDDING_CONFIG.model, {
      revision: EMBEDDING_CONFIG.revision, dtype: EMBEDDING_CONFIG.dtype,
      device: 'wasm', local_files_only: true,
      progress_callback: (event) => {
        if (event.status === 'progress') loaded.set(event.file, event.loaded);
        if (event.status === 'done') {
          const file = MODEL_FILES.find((file) => file.path === event.file);
          if (file) loaded.set(event.file, file.bytes);
        }
        const progress = Math.min(0.99, [...loaded.values()].reduce((sum, value) => sum + value, 0) / total);
        context.postMessage({ type: 'status', status: { state: 'loading', progress } });
      },
    });
    // FeatureExtractionPipeline truncates to tokenizer.model_max_length; it ignores max_length options.
    extractor.tokenizer.model_max_length = EMBEDDING_CONFIG.maxLength;
    context.postMessage({ type: 'status', status: { state: 'ready', progress: 1 } });
  }
  if (request.type === 'prepare') { context.postMessage({ type: 'prepared', id: request.id }); return; }
  if (cancelled.has(request.id)) return;
  const tensor = await extractor(preprocessEmbedding(request.query), EMBEDDING_OPTIONS);
  const vector = Array.from(tensor.data, Number);
  if (!isEmbeddingVector(vector)) throw new Error('Model returned an incompatible embedding');
  if (!cancelled.has(request.id)) context.postMessage({ type: 'result', id: request.id, vector });
}

context.onmessage = ({ data }) => {
  if (data.type === 'cancel') {
    if (activeId === data.id) cancelled.add(data.id);
    if (pending?.id === data.id) pending = undefined;
    return;
  }
  if (pending) context.postMessage({ type: 'cancelled', id: pending.id });
  pending = data;
  if (running) return;
  running = true;
  void (async () => {
    while (pending) {
      const request = pending; pending = undefined; activeId = request.id;
      try { await embed(request); }
      catch (error) { context.postMessage({ type: 'error', id: request.id, message: error instanceof Error ? error.message : 'Semantic model unavailable' }); }
      finally { cancelled.delete(request.id); activeId = undefined; }
    }
    running = false;
  })();
};
