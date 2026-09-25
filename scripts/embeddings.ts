import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  const temporary = `${filename}.${process.pid}.partial`;
  try { await writeFile(temporary, data); await rename(temporary, filename); }
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

export async function buildVectors(root = process.cwd()): Promise<VectorIndex> {
  const directory = path.join(root, 'site/public/generated');
  const filename = path.join(directory, 'vectors.json');
  // Never leave a stale preview vector artifact behind when rebuilding production or on failure.
  await rm(filename, { force: true });
  const source = await readFile(path.join(directory, 'passages.json'));
  const passages: SearchPassage[] = JSON.parse(source.toString('utf8'));
  if (!Array.isArray(passages)) throw new Error('generated/passages.json must contain an array');
  const ids = new Set<string>();
  const documents = passages.map((passage) => {
    if (typeof passage.id !== 'string' || !passage.id || ids.has(passage.id)) throw new Error('generated/passages.json contains an invalid or duplicate passage ID');
    ids.add(passage.id);
    return buildEmbeddingDocument(passage);
  });
  if (passages.length) await prepare(root);
  const embeddings = await embedTexts(documents, root);
  const vectors = Object.fromEntries(passages.map((passage, i) => [passage.id, { document: documents[i], vector: embeddings[i] }]));
  const index: VectorIndex = { schemaVersion: 1, model: EMBEDDING_CONFIG, passagesSha256: sha256(source), vectors };
  await atomicWrite(filename, `${JSON.stringify(index)}\n`);
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  try {
    if (args.length !== 1 || !['prepare', 'index'].includes(args[0])) throw new Error('Usage: tsx scripts/embeddings.ts prepare | index');
    if (args[0] === 'prepare') console.log(JSON.stringify(await prepare(), null, 2));
    else {
      const started = performance.now();
      const index = await buildVectors();
      console.log(`Indexed ${Object.keys(index.vectors).length} passage(s) in ${((performance.now() - started) / 1000).toFixed(3)}s`);
    }
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
