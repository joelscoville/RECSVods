/** Shared by the offline indexer and the browser worker. Changing this invalidates vectors. */
export const EMBEDDING_CONFIG = Object.freeze({
  model: 'Xenova/all-MiniLM-L6-v2',
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  transformersVersion: '3.8.1',
  runtimeVersion: '1.22.0-dev.20250409-89f8206ba4',
  dtype: 'q8' as const,
  dimension: 384,
  pooling: 'mean' as const,
  normalize: true as const,
  preprocessing: 'nfkc-whitespace-v1',
  documentVersion: 1,
  maxLength: 256,
});

// Hugging Face API /api/models/Xenova/all-MiniLM-L6-v2?blobs=true, checked 2026-09-25.
// Small files have Git blob SHA-1 metadata; LFS publishes SHA-256 for the weights.
export const MODEL_FILES = [
  { path: 'config.json', bytes: 650, blobId: '72147e4ff4426ebedbfa2146c4a0999def51a313' },
  { path: 'tokenizer.json', bytes: 711661, blobId: 'c17ed520ed8438736732a54957a69306b8822215' },
  { path: 'tokenizer_config.json', bytes: 366, blobId: '37fca74771bc76a8e01178ce3a6055a0995f8093' },
  { path: 'special_tokens_map.json', bytes: 125, blobId: 'a8b3208c2884c4efb86e49300fdd3dc877220cdf' },
  { path: 'onnx/model_quantized.onnx', bytes: 22972370, sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1' },
] as const;

export const EMBEDDING_OPTIONS = Object.freeze({
  pooling: EMBEDDING_CONFIG.pooling,
  normalize: EMBEDDING_CONFIG.normalize,
});

/** No task prefixes: this sentence-transformer was not trained with them. */
export function preprocessEmbedding(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

export function isEmbeddingVector(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== EMBEDDING_CONFIG.dimension || !value.every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  const norm = Math.sqrt(value.reduce((sum, v) => sum + v * v, 0));
  return Math.abs(norm - 1) < 0.001;
}

export function isCompatibleEmbeddingConfig(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(EMBEDDING_CONFIG).every(([key, expected]) => (value as Record<string, unknown>)[key] === expected);
}

/** A deployment path, never an external model host. */
export function semanticAssetPaths(base: string) {
  if (!base.startsWith('/') || base.startsWith('//') || /[?#\\]/u.test(base) || base.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error('Semantic base must be a same-origin absolute deployment path');
  }
  const root = `${base.replace(/\/+$/u, '')}/`;
  return { models: `${root}models/`, onnx: `${root}onnx/` };
}
