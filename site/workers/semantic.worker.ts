import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBEDDING_CONFIG, EMBEDDING_OPTIONS, isEmbeddingVector, MODEL_FILES, preprocessEmbedding, semanticAssetPaths } from '../lib/embedding-config';
import type { SemanticRequest, SemanticResponse } from '../lib/semantic';

const context = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SemanticRequest>) => void) | null;
  postMessage: (response: SemanticResponse) => void;
};
let extractor: FeatureExtractionPipeline | undefined;
let queue = Promise.resolve();

async function embed(request: SemanticRequest) {
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
      env.customCache = await globalThis.caches.open(`recs-embeddings-${EMBEDDING_CONFIG.revision}-${EMBEDDING_CONFIG.dtype}`);
      env.useCustomCache = true;
    } catch { /* Cache storage may be disabled; same-origin fetching still works. */ }
    const wasm = env.backends.onnx.wasm!;
    // Absolute same-origin URLs also work from the emitted /_astro/ worker URL.
    wasm.wasmPaths = new URL(paths.onnx, globalThis.location.origin).href;
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
  const tensor = await extractor(preprocessEmbedding(request.query), EMBEDDING_OPTIONS);
  const vector = Array.from(tensor.data, Number);
  if (!isEmbeddingVector(vector)) throw new Error('Model returned an incompatible embedding');
  context.postMessage({ type: 'result', id: request.id, vector });
}

context.onmessage = ({ data }) => {
  if (data.type !== 'embed') return;
  queue = queue.then(() => embed(data)).catch((error: unknown) => {
    context.postMessage({ type: 'error', id: data.id, message: error instanceof Error ? error.message : 'Semantic model unavailable' });
  });
};
