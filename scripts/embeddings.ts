import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EMBEDDING_CONFIG, EMBEDDING_OPTIONS, isEmbeddingVector, MODEL_FILES, preprocessEmbedding } from '../site/lib/embedding-config';
import { buildEmbeddingDocument, type VectorIndex } from '../site/lib/search';
import type { SearchPassage } from '../site/lib/types';

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

/** Inference never downloads. Call prepare explicitly or use index, which prepares nonempty inputs. */
export async function embedTexts(texts: readonly string[], root = process.cwd()): Promise<number[][]> {
  if (!texts.length) return [];
  await verifyPackageVersions();
  const { env, pipeline } = await import('@huggingface/transformers');
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
  try {
    const vectors: number[][] = [];
    for (const text of texts) {
      const input = preprocessEmbedding(text);
      if (!input) throw new Error('Cannot embed empty text');
      const tensor = await extractor(input, EMBEDDING_OPTIONS);
      const vector = Array.from(tensor.data, Number);
      if (!isEmbeddingVector(vector)) throw new Error('Model returned a non-normalized or incompatible vector');
      vectors.push(vector);
    }
    return vectors;
  } finally { await extractor.dispose(); }
}

/** Fixed ignored locations only: no public/cache-path override and no symlink redirection. */
async function privateDirectory(root: string, parts: string[]): Promise<string> {
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

export interface BuildVectorOptions {
  /** Recompute every passage; neither read nor write the derived-vector cache. */
  full?: boolean;
  /** Unit-fixture seam only. CLI/build callers always use the pinned local model. */
  encode?: typeof embedTexts;
}

interface CacheEntry {
  schemaVersion: 1;
  modelHash: string;
  documentHash: string;
  vectorSha256: string;
  vector: number[];
}
function cacheIdentity(document: string) {
  return {
    modelHash: sha256(JSON.stringify(EMBEDDING_CONFIG)),
    documentHash: sha256(document),
    key: sha256(JSON.stringify([EMBEDDING_CONFIG, document])),
  };
}
function vectorChecksum(modelHash: string, documentHash: string, vector: number[]): string {
  return sha256(JSON.stringify([modelHash, documentHash, vector]));
}
async function readCachedVector(filename: string, identity: ReturnType<typeof cacheIdentity>): Promise<number[] | undefined> {
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64_000) return undefined;
    const entry: CacheEntry = JSON.parse(await readFile(filename, 'utf8'));
    if (!entry || Object.keys(entry).sort().join(',') !== 'documentHash,modelHash,schemaVersion,vector,vectorSha256'
      || entry.schemaVersion !== 1 || entry.modelHash !== identity.modelHash || entry.documentHash !== identity.documentHash
      || !isEmbeddingVector(entry.vector)
      || entry.vectorSha256 !== vectorChecksum(identity.modelHash, identity.documentHash, entry.vector)) return undefined;
    return entry.vector;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function generateVectors(source: Buffer, root: string, options: BuildVectorOptions): Promise<VectorIndex> {
  const passages: SearchPassage[] = JSON.parse(source.toString('utf8'));
  if (!Array.isArray(passages)) throw new Error('generated/passages.json must contain an array');
  const ids = new Set<string>();
  const documents = passages.map((passage) => {
    if (!passage || typeof passage.id !== 'string' || !passage.id || ids.has(passage.id)) throw new Error('generated/passages.json contains an invalid or duplicate passage ID');
    ids.add(passage.id);
    const document = buildEmbeddingDocument(passage);
    if (!document) throw new Error('Cannot embed empty text');
    return document;
  });
  // Browser assets must still be prepared on an all-hit build. Fixtures never load a model.
  if (passages.length && !options.encode) await prepare(root);
  const encode = options.encode ?? embedTexts;
  let embeddings: number[][] = [];
  if (documents.length && options.full) {
    embeddings = await encode(documents, root);
  } else if (documents.length) {
    const directory = await privateDirectory(root, ['index-cache', cacheIdentity('').modelHash]);
    const unique = [...new Set(documents)];
    const resolved = new Map<string, number[]>();
    const missing: string[] = [];
    for (const document of unique) {
      const identity = cacheIdentity(document);
      const vector = await readCachedVector(path.join(directory, `${identity.key}.json`), identity);
      if (vector) resolved.set(document, vector);
      else missing.push(document);
    }
    if (missing.length) {
      const fresh = await encode(missing, root);
      // Validate the entire result before committing any cache entries.
      if (fresh.length !== missing.length || !missing.every((_, i) => isEmbeddingVector(fresh[i]))) throw new Error('Encoder returned invalid vectors');
      for (const [i, document] of missing.entries()) {
        const { modelHash, documentHash, key } = cacheIdentity(document);
        const vector = fresh[i];
        const entry: CacheEntry = { schemaVersion: 1, modelHash, documentHash,
          vectorSha256: vectorChecksum(modelHash, documentHash, vector), vector };
        await atomicWrite(path.join(directory, `${key}.json`), `${JSON.stringify(entry)}\n`);
        resolved.set(document, vector);
      }
    }
    embeddings = documents.map((document) => resolved.get(document)!);
  }
  if (embeddings.length !== documents.length || !documents.every((_, i) => isEmbeddingVector(embeddings[i]))) throw new Error('Encoder returned invalid vectors');
  const vectors = Object.fromEntries(passages.map((passage, i) => [passage.id, { document: documents[i], vector: embeddings[i] }]));
  return { schemaVersion: 1, model: EMBEDDING_CONFIG, passagesSha256: sha256(source), vectors };
}

/** Stage text-bearing output outside public, including on interruption. Builds are sequential. */
async function replaceVectors<T>(root: string, generate: (source: Buffer) => Promise<{ index: VectorIndex; result: T }>): Promise<T> {
  const directory = path.join(root, 'site/public/generated');
  const filename = path.join(directory, 'vectors.json');
  // Remove before even parsing input: failure must never retain old preview vectors.
  await rm(filename, { force: true });
  // Clean partials from the previous implementation, which staged inside public.
  for (const name of await readdir(directory)) {
    if (/^vectors\.json\..+\.partial$/u.test(name)) await rm(path.join(directory, name), { force: true });
  }
  const staging = await privateDirectory(root, ['index-staging']);
  for (const name of await readdir(staging)) {
    if (/^vectors\.[\w-]+\.partial$/u.test(name)) await rm(path.join(staging, name), { force: true });
  }
  const temporary = path.join(staging, `vectors.${randomUUID()}.partial`);
  try {
    const source = await readFile(path.join(directory, 'passages.json'));
    const { index, result } = await generate(source);
    await writeFile(temporary, `${JSON.stringify(index)}\n`, { flag: 'wx', mode: 0o600 });
    if (!(await readFile(path.join(directory, 'passages.json'))).equals(source)) throw new Error('Passage input changed during vector generation; rebuild sequentially');
    await rename(temporary, filename);
    return result;
  } finally { await rm(temporary, { force: true }); }
}

export async function buildVectors(root = process.cwd(), options: BuildVectorOptions = {}): Promise<VectorIndex> {
  return replaceVectors(root, async (source) => {
    const index = await generateVectors(source, root, options);
    return { index, result: index };
  });
}

/** Exact metadata/ID/document equality, with an explicit finite per-component tolerance. */
export function compareVectorIndexes(incremental: VectorIndex, full: VectorIndex, tolerance = 1e-6) {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('Invalid vector comparison tolerance');
  const ids = Object.keys(full.vectors);
  if (incremental.schemaVersion !== full.schemaVersion || JSON.stringify(incremental.model) !== JSON.stringify(full.model)
    || incremental.passagesSha256 !== full.passagesSha256 || JSON.stringify(Object.keys(incremental.vectors)) !== JSON.stringify(ids)) {
    throw new Error('Incremental/full index metadata or IDs differ');
  }
  let maxAbsoluteDifference = 0;
  for (const id of ids) {
    const a = incremental.vectors[id], b = full.vectors[id];
    if (a.document !== b.document || !isEmbeddingVector(a.vector) || !isEmbeddingVector(b.vector)) throw new Error('Incremental/full document or vector validity differs');
    for (let i = 0; i < b.vector.length; i++) maxAbsoluteDifference = Math.max(maxAbsoluteDifference, Math.abs(a.vector[i] - b.vector[i]));
  }
  if (maxAbsoluteDifference > tolerance) throw new Error(`Incremental/full vectors differ beyond tolerance ${tolerance} (maximum ${maxAbsoluteDifference})`);
  return { passages: ids.length, byteIdentical: JSON.stringify(incremental) === JSON.stringify(full), maxAbsoluteDifference, tolerance };
}

/** Compare before publishing; a mismatch/failure leaves no current vector artifact. */
export async function verifyVectors(root = process.cwd(), options: Pick<BuildVectorOptions, 'encode'> & { tolerance?: number } = {}) {
  return replaceVectors(root, async (source) => {
    const incremental = await generateVectors(source, root, { encode: options.encode });
    const full = await generateVectors(source, root, { encode: options.encode, full: true });
    const result = compareVectorIndexes(incremental, full, options.tolerance);
    return { index: full, result };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  try {
    if (!(args.length === 1 && ['prepare', 'index', 'verify'].includes(args[0]))
      && !(args.length === 2 && args[0] === 'index' && args[1] === '--full')) throw new Error('Usage: tsx scripts/embeddings.ts prepare | index [--full] | verify');
    if (args[0] === 'prepare') console.log(JSON.stringify(await prepare(), null, 2));
    else if (args[0] === 'verify') console.log(JSON.stringify(await verifyVectors(), null, 2));
    else {
      const started = performance.now();
      const index = await buildVectors(process.cwd(), { full: args.includes('--full') || process.env.RECS_FULL_INDEX === '1' });
      console.log(`Indexed ${Object.keys(index.vectors).length} passage(s) in ${((performance.now() - started) / 1000).toFixed(3)}s`);
    }
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
