import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EMBEDDING_CONFIG, EMBEDDING_OPTIONS, isEmbeddingVector, MODEL_FILES, preprocessEmbedding } from '../site/lib/embedding-config';

type ModelFile = (typeof MODEL_FILES)[number];
interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
  source: string;
  sourceSha256?: string;
  sourceBlobId?: string;
}
export function sha256(data: Uint8Array | string): string { return createHash('sha256').update(data).digest('hex'); }

/** Verify cached AND newly fetched bytes against pinned upstream metadata, not a mutable cache manifest. */
export function verifyModelFile(data: Uint8Array, file: ModelFile): boolean {
  if (data.byteLength !== file.bytes) return false;
  if ('sha256' in file) return sha256(data) === file.sha256;
  return createHash('sha1').update(`blob ${data.byteLength}\0`).update(data).digest('hex') === file.blobId;
}

async function atomicWrite(filename: string, data: Uint8Array | string): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.partial`;
  try { await writeFile(temporary, data, { flag: 'wx', mode: 0o600 }); await rename(temporary, filename); }
  finally { await rm(temporary, { force: true }); }
}
async function cachedBytes(filename: string): Promise<Buffer | undefined> {
  try { return await readFile(filename); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

function installedPackages() {
  const require = createRequire(import.meta.url);
  const transformersEntry = require.resolve('@huggingface/transformers');
  const runtimeEntry = createRequire(transformersEntry).resolve('onnxruntime-web');
  return { transformersRoot: path.dirname(path.dirname(transformersEntry)), runtimeRoot: path.dirname(path.dirname(runtimeEntry)) };
}
async function verifyPackageVersions() {
  const packages = installedPackages();
  const transformers = JSON.parse(await readFile(path.join(packages.transformersRoot, 'package.json'), 'utf8'));
  const runtime = JSON.parse(await readFile(path.join(packages.runtimeRoot, 'package.json'), 'utf8'));
  if (transformers.version !== EMBEDDING_CONFIG.transformersVersion || runtime.version !== EMBEDDING_CONFIG.runtimeVersion) {
    throw new Error('Embedding dependency version changed; deliberately update the shared config and rebuild vectors/assets');
  }
  return packages;
}

/** Build-time networking only. Valid caches need no model-server access. */
export async function prepare(root = process.cwd()) {
  const started = performance.now();
  const { runtimeRoot } = await verifyPackageVersions();
  const publicRoot = path.join(root, 'site/public');
  const files: ManifestFile[] = [];
  let downloadedBytes = 0;
  let reusedBytes = 0;
  for (const file of MODEL_FILES) {
    const relative = `models/${EMBEDDING_CONFIG.model}/${file.path}`;
    const filename = path.join(publicRoot, relative);
    const source = `https://huggingface.co/${EMBEDDING_CONFIG.model}/resolve/${EMBEDDING_CONFIG.revision}/${file.path}`;
    let data = await cachedBytes(filename);
    if (data && verifyModelFile(data, file)) reusedBytes += data.byteLength;
    else {
      const response = await fetch(source, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Model download ${file.path}: HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
      if (!verifyModelFile(data, file)) throw new Error(`Model integrity check failed: ${file.path}`);
      await atomicWrite(filename, data);
      downloadedBytes += data.byteLength;
    }
    files.push({ path: relative, bytes: data.byteLength, sha256: sha256(data), source,
      ...('sha256' in file ? { sourceSha256: file.sha256 } : { sourceBlobId: file.blobId }),
    });
  }
  // Transformers' web build uses JSEP; also copy the plain WASM pair for runtime compatibility.
  for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
    const data = await readFile(path.join(runtimeRoot, 'dist', name));
    const relative = `onnx/${name}`;
    const cached = await cachedBytes(path.join(publicRoot, relative));
    if (!cached || sha256(cached) !== sha256(data)) await atomicWrite(path.join(publicRoot, relative), data);
    files.push({ path: relative, bytes: data.byteLength, sha256: sha256(data), source: `npm:onnxruntime-web@${EMBEDDING_CONFIG.runtimeVersion}/dist/${name}` });
  }
  const manifest = { schemaVersion: 1, model: EMBEDDING_CONFIG, files };
  await atomicWrite(path.join(publicRoot, 'models/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    modelBytes: MODEL_FILES.reduce((sum, file) => sum + file.bytes, 0),
    runtimeBytes: files.filter((file) => file.path.startsWith('onnx/')).reduce((sum, file) => sum + file.bytes, 0),
    downloadedBytes, reusedBytes, elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(3)),
  };
}

export interface EmbeddingSession {
  /** Full content tokenization: no specials, padding, truncation, or decode/re-tokenize cycle. */
  tokenize(text: string): number[];
  embedTokenIds(contentIds: readonly number[]): Promise<number[]>;
  embedText(text: string): Promise<number[]>;
  dispose(): Promise<void>;
}

/** One pinned extractor reusable across every window/service. Inference never downloads. */
export async function createEmbeddingSession(root = process.cwd()): Promise<EmbeddingSession> {
  await verifyPackageVersions();
  for (const file of MODEL_FILES) {
    const data = await cachedBytes(path.join(root, 'site/public/models', EMBEDDING_CONFIG.model, file.path));
    if (!data || !verifyModelFile(data, file)) throw new Error('Pinned model missing or invalid; run model:prepare first');
  }
  const { env, pipeline, Tensor, mean_pooling } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useFSCache = false;
  // Keep Transformers' native cache location writable even with read-only pinned packages.
  env.cacheDir = await privateDirectory(root, ['embedding-cache']);
  env.localModelPath = `${path.join(root, 'site/public/models')}${path.sep}`;
  const extractor = await pipeline<'feature-extraction'>('feature-extraction', EMBEDDING_CONFIG.model, {
    revision: EMBEDDING_CONFIG.revision, dtype: EMBEDDING_CONFIG.dtype, device: 'cpu', local_files_only: true,
    session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
  });
  extractor.tokenizer.model_max_length = EMBEDDING_CONFIG.maxLength;
  const specials = extractor.tokenizer.encode('', { add_special_tokens: true });
  if (specials.length !== 2 || specials[0] !== 101 || specials[1] !== 102) {
    await extractor.dispose();
    throw new Error('Pinned MiniLM special-token recipe changed');
  }
  function checked(data: ArrayLike<number | bigint>): number[] {
    const vector = Array.from(data, Number);
    if (!isEmbeddingVector(vector)) throw new Error('Model returned a non-normalized or incompatible vector');
    return vector;
  }
  return {
    tokenize(text) { return extractor.tokenizer.encode(preprocessEmbedding(text), { add_special_tokens: false }); },
    async embedTokenIds(contentIds) {
      if (!contentIds.length || contentIds.length > EMBEDDING_CONFIG.maxLength - 2
        || contentIds.some((id) => !Number.isSafeInteger(id) || id < 0 || id >= 30522)) throw new Error('Invalid MiniLM content token window');
      const ids = [specials[0], ...contentIds, specials[1]];
      const dims = [1, ids.length];
      const input_ids = new Tensor('int64', BigInt64Array.from(ids, BigInt), dims);
      const attention_mask = new Tensor('int64', new BigInt64Array(ids.length).fill(1n), dims);
      const token_type_ids = new Tensor('int64', new BigInt64Array(ids.length), dims);
      // Identical to FeatureExtractionPipeline's mean pooling + normalization, with
      // exact sliced IDs: decoding WordPieces first would change boundary tokens.
      const outputs = await extractor.model({ input_ids, attention_mask, token_type_ids });
      const hidden = outputs.last_hidden_state ?? outputs.logits ?? outputs.token_embeddings;
      return checked(mean_pooling(hidden, attention_mask).normalize(2, -1).data);
    },
    async embedText(text) {
      const input = preprocessEmbedding(text);
      if (!input) throw new Error('Cannot embed empty text');
      const tensor = await extractor(input, EMBEDDING_OPTIONS);
      return checked(tensor.data);
    },
    async dispose() { await extractor.dispose(); },
  };
}

/** Query embeddings for acceptance tooling; chapter processing uses token windows. */
export async function embedTexts(texts: readonly string[], root = process.cwd()): Promise<number[][]> {
  if (!texts.length) return [];
  const session = await createEmbeddingSession(root);
  try {
    const vectors: number[][] = [];
    for (const text of texts) vectors.push(await session.embedText(text));
    return vectors;
  } finally { await session.dispose(); }
}

/** Fixed ignored locations only: no public/cache-path override and no symlink redirection. */
export async function privateDirectory(root: string, parts: string[]): Promise<string> {
  if (parts.some((part) => !/^[a-zA-Z0-9_-]+$/u.test(part))) throw new Error('Invalid private directory component');
  let directory = await realpath(root);
  for (const part of ['.local', ...parts]) {
    directory = path.join(directory, part);
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Embedding private directories must be real directories, never public symlinks');
  }
  return directory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  try {
    if (args.length !== 1 || args[0] !== 'prepare') throw new Error('Usage: tsx scripts/embeddings.ts prepare. Chapter vectors: tsx scripts/chapter-vectors.ts generate|verify --all');
    console.log(JSON.stringify(await prepare(), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
