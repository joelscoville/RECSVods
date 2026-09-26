import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';
import { CHAPTER_VECTOR_CONFIG, decodeChapterVectors, packChapterVectors, type ChapterVectorFile } from '../site/lib/chapter-vectors';
import { isEmbeddingVector, preprocessEmbedding } from '../site/lib/embedding-config';
import { createEmbeddingSession, prepare, privateDirectory, sha256, type EmbeddingSession } from './embeddings';

export interface ChapterVectorChapter { id: string; video_id: string; start: number; end: number }
export type ChapterVectorSourceKind = 'raw_colab_json' | 'canonical_evidence_json' | 'legacy_passages' | 'none';
export interface ChapterVectorBinding extends ChapterVectorChapter {
  windows: number;
  has_text: boolean;
  input_sha256: string;
  source_kind: ChapterVectorSourceKind;
}
export interface ChapterVectorManifest {
  schemaVersion: 1;
  model: typeof CHAPTER_VECTOR_CONFIG;
  binary_sha256: string;
  bindings: ChapterVectorBinding[];
}
export interface LoadedServiceChapterVectors extends ChapterVectorFile { manifest: ChapterVectorManifest }

const HASH = /^[0-9a-f]{64}$/u;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;
const SOURCE_KINDS: readonly string[] = ['raw_colab_json', 'canonical_evidence_json', 'legacy_passages', 'none'];
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}
function span(value: Record<string, unknown>): { start: number; end: number } {
  const { start, end } = value;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)
    || start < 0 || end < start) throw new Error('Invalid source timestamps');
  return { start, end };
}
function chapter(value: unknown): ChapterVectorChapter {
  const item = record(value), { start, end } = span(item);
  if (typeof item.id !== 'string' || !item.id.trim() || typeof item.video_id !== 'string'
    || !VIDEO_ID.test(item.video_id) || end <= start) throw new Error('Invalid chapter binding metadata');
  return { id: item.id, video_id: item.video_id, start, end };
}
interface WorkingChapter extends ChapterVectorChapter { source_chapters?: string[] }
function chaptersFromSource(source: unknown): WorkingChapter[] {
  const value = record(source);
  if (!Array.isArray(value.chapters)) throw new Error('Chapter metadata must be ready before vector generation');
  const chapters = value.chapters.map((raw): WorkingChapter => {
    const item = record(raw), identity = chapter(raw);
    if (item.source_chapters !== undefined && (!Array.isArray(item.source_chapters) || !item.source_chapters.length
      || item.source_chapters.some((id) => typeof id !== 'string' || !id))) throw new Error('Invalid preserved chapter lineage');
    return { ...identity, ...(item.source_chapters ? { source_chapters: item.source_chapters as string[] } : {}) };
  });
  if (new Set(chapters.map((item) => item.id)).size !== chapters.length) throw new Error('Duplicate chapter IDs');
  return chapters;
}
function safeJson(data: string): unknown {
  try { return JSON.parse(data); } catch { throw new Error('Invalid JSON (private content withheld)'); }
}
function safeYaml(data: string): unknown {
  try { return parse(data); } catch { throw new Error('Invalid YAML (private content withheld)'); }
}

/** Checks recipe, byte checksum, exact ordered ID/video/bounds binding, and no-text row semantics. */
export function validateChapterVectorManifest(
  manifest: unknown, bytes: Uint8Array, chapters: readonly ChapterVectorChapter[],
): LoadedServiceChapterVectors {
  const value = record(manifest);
  if (!keys(value, ['schemaVersion', 'model', 'binary_sha256', 'bindings']) || value.schemaVersion !== 1
    || !isDeepStrictEqual(value.model, CHAPTER_VECTOR_CONFIG)) throw new Error('Incompatible chapter vector manifest/model recipe');
  if (typeof value.binary_sha256 !== 'string' || !HASH.test(value.binary_sha256)
    || value.binary_sha256 !== sha256(bytes)) throw new Error('Chapter vector binary checksum mismatch');
  const file = decodeChapterVectors(bytes);
  if (!Array.isArray(value.bindings) || value.bindings.length !== chapters.length || file.rowCount !== chapters.length) {
    throw new Error('Chapter vector binding/row count mismatch');
  }
  const ids = new Set<string>();
  value.bindings.forEach((raw: unknown, i: number) => {
    const binding = record(raw), identity = chapter(binding), expected = chapter(chapters[i]);
    if (!keys(binding, ['id', 'video_id', 'start', 'end', 'windows', 'has_text', 'input_sha256', 'source_kind'])
      || !isDeepStrictEqual(identity, expected) || ids.has(identity.id)) throw new Error('Chapter vector ID/video/boundary/order mismatch');
    ids.add(identity.id);
    if (typeof binding.has_text !== 'boolean' || typeof binding.windows !== 'number' || !Number.isSafeInteger(binding.windows)
      || binding.windows < 0 || binding.has_text !== (binding.windows > 0)
      || typeof binding.input_sha256 !== 'string' || !HASH.test(binding.input_sha256)
      || typeof binding.source_kind !== 'string' || !SOURCE_KINDS.includes(binding.source_kind)
      || (binding.source_kind === 'none' && binding.has_text)) throw new Error('Invalid chapter vector provenance');
    const row = file.values.subarray(i * file.dimension, (i + 1) * file.dimension);
    if (row.some((v) => v !== 0) !== binding.has_text) throw new Error('Chapter no-text flag/vector mismatch');
  });
  return { ...file, manifest: manifest as ChapterVectorManifest };
}

export function createChapterVectorManifest(bytes: Uint8Array, bindings: readonly ChapterVectorBinding[]): ChapterVectorManifest {
  // Explicit projection prevents accidental text/path/private metadata serialization.
  const manifest: ChapterVectorManifest = { schemaVersion: 1, model: CHAPTER_VECTOR_CONFIG, binary_sha256: sha256(bytes),
    bindings: bindings.map(({ id, video_id, start, end, windows, has_text, input_sha256, source_kind }) =>
      ({ id, video_id, start, end, windows, has_text, input_sha256, source_kind })) };
  validateChapterVectorManifest(manifest, bytes, bindings);
  return manifest;
}

/** Build-only read path: reads service metadata and committed sidecars, never private evidence/model/cache. */
export function loadServiceChapterVectors(rootOrSourcePath: string, sourcePath?: string): LoadedServiceChapterVectors {
  const source = sourcePath === undefined ? path.resolve(rootOrSourcePath) : path.resolve(rootOrSourcePath, sourcePath);
  const filename = source.endsWith('.yaml') ? source : path.join(source, 'service.yaml');
  const directory = path.dirname(filename);
  const chapters = chaptersFromSource(safeYaml(readFileSync(filename, 'utf8')));
  return validateChapterVectorManifest(safeJson(readFileSync(path.join(directory, 'chapter-vectors.json'), 'utf8')),
    readFileSync(path.join(directory, 'chapter-vectors.bin')), chapters);
}

/** All bracketed spans in curated fallback transcripts are editorial, never spoken input. */
export function stripEditorialAnnotations(text: string): string {
  let depth = 0, working = '';
  for (const character of text) {
    if (character === '[') { if (!depth) working += ' '; depth++; }
    else if (character === ']' && depth) depth--;
    else if (!depth) working += character;
  }
  return preprocessEmbedding(working);
}

interface EvidenceWord { start: number; end: number; word: string }
export interface EvidenceSegment { start: number; end: number; text: string; words?: EvidenceWord[] }
export interface ChapterEvidence { source_kind: 'raw_colab_json' | 'canonical_evidence_json'; segments: EvidenceSegment[] }

/** Accept raw Colab or canonical seconds-based evidence; never infer a video ID from approximate names. */
export function parseChapterEvidence(payload: unknown, videoId: string): ChapterEvidence {
  const value = record(payload);
  if (!VIDEO_ID.test(videoId) || (value.video_id ?? value.youtube_id) !== videoId
    || (value.video_id !== undefined && value.video_id !== videoId)
    || (value.youtube_id !== undefined && value.youtube_id !== videoId)) throw new Error('Private transcript video ID mismatch');
  if (!Array.isArray(value.segments)) throw new Error('Private evidence requires segments');
  const segments = value.segments.map((raw): EvidenceSegment => {
    const item = record(raw), times = span(item);
    if (typeof item.text !== 'string') throw new Error('Private segment requires text');
    let words: EvidenceWord[] | undefined;
    if (item.words !== undefined) {
      if (!Array.isArray(item.words)) throw new Error('Invalid private words array');
      const supplied = item.words.map((rawWord) => {
        const word = record(rawWord);
        if (typeof (word.word ?? word.text) !== 'string') throw new Error('Invalid private word text');
        // Partial/absent word alignment uses the entire segment's midpoint. Invalid
        // supplied timings still fail rather than quietly substituting other evidence.
        for (const key of ['start', 'end']) if (word[key] !== undefined
          && (typeof word[key] !== 'number' || !Number.isFinite(word[key]) || (word[key] as number) < 0)) throw new Error('Invalid word timestamp');
        return word.start === undefined || word.end === undefined ? undefined
          : { ...span(word), word: (word.word ?? word.text) as string };
      });
      if (supplied.length && supplied.every((word) => word !== undefined)) words = supplied as EvidenceWord[];
    }
    return { ...times, text: item.text, ...(words ? { words } : {}) };
  });
  return { source_kind: value.youtube_id !== undefined || value.schema_version !== undefined ? 'canonical_evidence_json' : 'raw_colab_json',
    segments: segments.sort((a, b) => a.start - b.start || a.end - b.end) };
}

export function clipChapterEvidence(evidence: ChapterEvidence, bounds: Pick<ChapterVectorChapter, 'start' | 'end'>): string {
  const included = (item: { start: number; end: number }) => {
    const midpoint = item.start + (item.end - item.start) / 2;
    return midpoint >= bounds.start && midpoint < bounds.end;
  };
  const parts: string[] = [];
  for (const segment of evidence.segments) {
    if (segment.words) {
      // Do not prefilter on segment bounds: some supplied word alignments extend past them.
      for (const word of segment.words) if (included(word)) parts.push(word.word);
    } else if (included(segment)) parts.push(segment.text);
  }
  return preprocessEmbedding(parts.join(' '));
}

export function chapterTokenWindows(contentIds: readonly number[]): number[][] {
  if (contentIds.some((id) => !Number.isSafeInteger(id) || id < 0)) throw new Error('Invalid content token IDs');
  const { contentTokens, overlapTokens } = CHAPTER_VECTOR_CONFIG.windowing;
  const windows: number[][] = [];
  for (let start = 0; start < contentIds.length; start += contentTokens - overlapTokens) {
    windows.push(contentIds.slice(start, start + contentTokens));
    if (start + contentTokens >= contentIds.length) break;
  }
  return windows;
}

export function quantizeChapterVector(vector: ArrayLike<number>): Int8Array {
  if (vector.length !== CHAPTER_VECTOR_CONFIG.dimension) throw new Error('Invalid chapter vector dimension');
  let max = 0;
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) throw new Error('Nonfinite chapter vector');
    max = Math.max(max, Math.abs(vector[i]));
  }
  if (!max) return new Int8Array(vector.length);
  return Int8Array.from(Array.from(vector, (v) => Math.sign(v) * Math.min(127, Math.floor(Math.abs(v) / max * 127 + 0.5))));
}

export function averageChapterWindows(vectors: readonly number[][]): number[] {
  const average = new Array<number>(CHAPTER_VECTOR_CONFIG.dimension).fill(0);
  if (!vectors.length) return average;
  for (const vector of vectors) {
    if (!isEmbeddingVector(vector)) throw new Error('Invalid normalized window vector');
    for (let i = 0; i < average.length; i++) average[i] += vector[i] / vectors.length;
  }
  const norm = Math.sqrt(average.reduce((sum, v) => sum + v * v, 0));
  if (!norm) throw new Error('Text-bearing window vectors cancel to zero');
  return average.map((v) => v / norm);
}

async function optionalFile(filename: string): Promise<Buffer | undefined> {
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected a regular private/source file');
    return await readFile(filename);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function atomicWrite(filename: string, data: Uint8Array | string): Promise<void> {
  const temporary = `${filename}.${randomUUID()}.partial`;
  try { await writeFile(temporary, data, { flag: 'wx', mode: 0o600 }); await rename(temporary, filename); }
  finally { await rm(temporary, { force: true }); }
}

interface WorkingInput { text: string; input_sha256: string; source_kind: ChapterVectorSourceKind }
async function serviceInputs(directory: string, chapters: WorkingChapter[], transcriptsDir?: string): Promise<WorkingInput[]> {
  const evidence = new Map<string, { data: ChapterEvidence; hash: string }>();
  if (transcriptsDir) for (const videoId of new Set(chapters.map((item) => item.video_id))) {
    // Flat Colab raw wins over normalized evidence. No recursive scan, fuzzy match, or network.
    for (const relative of [`${videoId}.json`, `${videoId}/evidence.json`, `${videoId}.evidence.json`]) {
      const bytes = await optionalFile(path.join(transcriptsDir, relative));
      if (bytes) { evidence.set(videoId, { data: parseChapterEvidence(safeJson(bytes.toString('utf8')), videoId), hash: sha256(bytes) }); break; }
    }
  }
  let passages: Record<string, unknown>[] = [];
  if (chapters.some((item) => !evidence.has(item.video_id))) {
    const bytes = await optionalFile(path.join(directory, 'passages.internal.yaml'));
    if (bytes) {
      const payload = safeYaml(bytes.toString('utf8'));
      const array = Array.isArray(payload) ? payload : record(payload).passages;
      if (!Array.isArray(array)) throw new Error('Internal passages must be an array or {passages: array}');
      passages = array.map(record);
      for (const item of passages) {
        if (typeof item.section_id !== 'string' || typeof item.transcript !== 'string'
          || typeof item.video_id !== 'string') throw new Error('Invalid internal passage input');
        span(item);
      }
      passages.sort((a, b) => (a.start as number) - (b.start as number) || (a.end as number) - (b.end as number));
    }
  }
  return chapters.map((item) => {
    const raw = evidence.get(item.video_id);
    const selected = passages.filter((passage) => (item.source_chapters ?? [item.id]).includes(passage.section_id as string));
    if (!raw && selected.some((passage) => passage.video_id !== item.video_id)) throw new Error('Internal passage/chapter video mismatch');
    if (!raw && selected.some((passage) => (passage.start as number) < item.start || (passage.end as number) > item.end)) throw new Error('Internal passage lies outside regrouped chapter bounds');
    const source_kind: ChapterVectorSourceKind = raw?.data.source_kind ?? (selected.length ? 'legacy_passages' : 'none');
    const working = raw ? clipChapterEvidence(raw.data, item)
      : stripEditorialAnnotations(selected.map((passage) => passage.transcript as string).join(' '));
    const text = /[\p{L}\p{N}]/u.test(working) ? working : '';
    // Hash source evidence as well as exact working input/bounds, without persisting text.
    const sourceHash = raw?.hash ?? sha256(JSON.stringify(selected.map(({ section_id, video_id, start, end, transcript }) =>
      ({ section_id, video_id, start, end, transcript }))));
    return { text, source_kind, input_sha256: sha256(JSON.stringify([CHAPTER_VECTOR_CONFIG, item, source_kind, sourceHash, text])) };
  });
}

export interface ChapterVectorProcessOptions {
  root?: string;
  /** Explicit isolated-root seam for tests; never a CLI switch. */
  fixtureRoot?: string;
  service?: string;
  all?: boolean;
  transcriptsDir?: string;
  /** Tests only, requires fixtureRoot. Real callers always use verified pinned weights. */
  createSession?: () => Promise<EmbeddingSession>;
}
export interface ChapterVectorReport {
  services: number; chapters: number; windows: number; embeddedWindows: number; cachedWindows: number;
  reusedServices: number; writtenServices: number; skippedSemantic: number; binaryBytes: number;
  elapsedSeconds: number; modelSeconds: number; inferenceSeconds: number;
  serviceReports: { id: string; chapters: number; windows: number; skippedSemantic: number; reused: boolean; elapsedSeconds: number }[];
}
const seconds = (started: number) => Number(((performance.now() - started) / 1000).toFixed(3));

async function servicePaths(root: string): Promise<string[]> {
  const result: string[] = [];
  const services = path.join(root, 'services');
  let years;
  try { years = await readdir(services, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  for (const year of years.filter((entry) => entry.isDirectory()).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    for (const entry of (await readdir(path.join(services, year.name), { withFileTypes: true })).filter((item) => item.isDirectory())
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const filename = path.join(services, year.name, entry.name, 'service.yaml');
      if (await optionalFile(filename)) result.push(filename);
    }
  }
  return result;
}

/** Explicit private processing only. Never called by the static builder. */
export async function processChapterVectors(options: ChapterVectorProcessOptions): Promise<ChapterVectorReport> {
  if (Boolean(options.service) === Boolean(options.all)) throw new Error('Select exactly one service or all services');
  if (options.createSession && !options.fixtureRoot) throw new Error('Injected encoders require fixtureRoot');
  const root = path.resolve(options.fixtureRoot ?? options.root ?? process.cwd());
  if (options.transcriptsDir && !(await lstat(options.transcriptsDir)).isDirectory()) throw new Error('Transcript input must be a directory');
  const paths = await servicePaths(root);
  const selected = options.all ? paths : paths.filter((filename) => path.basename(path.dirname(filename)) === options.service
    || filename === path.resolve(root, options.service!) || path.dirname(filename) === path.resolve(root, options.service!));
  if (!options.all && selected.length !== 1) throw new Error('Service selector must match exactly one source service');
  const started = performance.now();
  const report: ChapterVectorReport = { services: 0, chapters: 0, windows: 0, embeddedWindows: 0, cachedWindows: 0,
    reusedServices: 0, writtenServices: 0, skippedSemantic: 0, binaryBytes: 0, elapsedSeconds: 0,
    modelSeconds: 0, inferenceSeconds: 0, serviceReports: [] };
  let session: EmbeddingSession | undefined, cache: string | undefined;
  const memory = new Map<string, number[]>();
  const recipeHash = sha256(JSON.stringify(CHAPTER_VECTOR_CONFIG));
  async function getSession(): Promise<EmbeddingSession> {
    if (!session) {
      const modelStart = performance.now();
      if (options.createSession) session = await options.createSession();
      else { await prepare(root); session = await createEmbeddingSession(root); }
      report.modelSeconds += seconds(modelStart);
    }
    return session;
  }
  async function windowVector(ids: number[]): Promise<number[]> {
    const inputHash = sha256(JSON.stringify(ids)), key = sha256(JSON.stringify([recipeHash, inputHash]));
    let vector = memory.get(key);
    cache ??= await privateDirectory(root, ['chapter-vector-cache', recipeHash]);
    const filename = path.join(cache, `${key}.json`);
    if (!vector) {
      const bytes = await optionalFile(filename);
      if (bytes) {
        try {
          const entry = record(safeJson(bytes.toString('utf8')));
          if (keys(entry, ['recipe_sha256', 'input_sha256', 'vector_sha256', 'vector'])
            && entry.recipe_sha256 === recipeHash && entry.input_sha256 === inputHash && isEmbeddingVector(entry.vector)
            && entry.vector_sha256 === sha256(JSON.stringify([recipeHash, inputHash, entry.vector]))) vector = entry.vector;
        } catch { /* Invalid derived cache entries are recomputed, never trusted. */ }
      }
    }
    if (vector) report.cachedWindows++;
    else {
      const encoder = await getSession(), inferenceStart = performance.now();
      vector = await encoder.embedTokenIds(ids);
      report.inferenceSeconds += seconds(inferenceStart);
      if (!isEmbeddingVector(vector)) throw new Error('Encoder returned invalid chapter window');
      report.embeddedWindows++;
      await atomicWrite(filename, `${JSON.stringify({ recipe_sha256: recipeHash, input_sha256: inputHash,
        vector_sha256: sha256(JSON.stringify([recipeHash, inputHash, vector])), vector })}\n`);
    }
    memory.set(key, vector);
    return vector;
  }
  try {
    for (const filename of selected) {
      const serviceStart = performance.now(), sourceBytes = (await optionalFile(filename))!;
      const source = record(safeYaml(sourceBytes.toString('utf8'))), chapters = chaptersFromSource(source);
      const directory = path.dirname(filename), id = typeof source.id === 'string' ? source.id : path.basename(directory);
      const inputs = await serviceInputs(directory, chapters, options.transcriptsDir);
      const binaryPath = path.join(directory, 'chapter-vectors.bin'), manifestPath = path.join(directory, 'chapter-vectors.json');
      const previousBytes = await optionalFile(binaryPath), previousManifest = await optionalFile(manifestPath);
      let previous: LoadedServiceChapterVectors | undefined;
      if (previousBytes && previousManifest) {
        try { previous = validateChapterVectorManifest(safeJson(previousManifest.toString('utf8')), previousBytes, chapters); }
        catch { /* Explicit processing replaces stale/corrupt artifacts; build-only loading fails closed. */ }
      }
      const reused = Boolean(previous && previous.manifest.bindings.every((binding, i) =>
        binding.input_sha256 === inputs[i].input_sha256 && binding.source_kind === inputs[i].source_kind));
      let manifest: ChapterVectorManifest, bytes: Uint8Array;
      if (reused) { manifest = previous!.manifest; bytes = previousBytes!; report.reusedServices++; }
      else {
        const bindings: ChapterVectorBinding[] = [], rows: Int8Array[] = [];
        for (const [i, item] of chapters.entries()) {
          const input = inputs[i];
          const ids = input.text ? (await getSession()).tokenize(input.text) : [];
          const windows = chapterTokenWindows(ids), vectors: number[][] = [];
          for (const window of windows) vectors.push(await windowVector(window));
          rows.push(quantizeChapterVector(averageChapterWindows(vectors)));
          bindings.push({ ...item, windows: windows.length, has_text: windows.length > 0,
            input_sha256: input.input_sha256, source_kind: input.source_kind });
        }
        bytes = packChapterVectors(rows); manifest = createChapterVectorManifest(bytes, bindings);
        if (!(await readFile(filename)).equals(sourceBytes)) throw new Error('Chapter metadata changed during processing');
        // A crash between replacements is detectable by the binary checksum; no stale pair can build.
        await atomicWrite(binaryPath, bytes);
        await atomicWrite(manifestPath, `${JSON.stringify(manifest)}\n`);
        report.writtenServices++;
      }
      const windows = manifest.bindings.reduce((sum, binding) => sum + binding.windows, 0);
      const skippedSemantic = manifest.bindings.filter((binding) => !binding.has_text).length;
      report.services++; report.chapters += chapters.length; report.windows += windows;
      report.skippedSemantic += skippedSemantic; report.binaryBytes += bytes.byteLength;
      report.serviceReports.push({ id, chapters: chapters.length, windows, skippedSemantic, reused, elapsedSeconds: seconds(serviceStart) });
    }
  } finally { await session?.dispose(); }
  report.elapsedSeconds = seconds(started);
  return report;
}

export async function chapterVectorsCli(args = process.argv.slice(2)): Promise<ChapterVectorReport | { services: number; chapters: number; skippedSemantic: number }> {
  const [command, ...flags] = args.filter((arg) => arg !== '--');
  const options: ChapterVectorProcessOptions = {};
  const seen = new Set<string>();
  const usage = 'Usage: tsx scripts/chapter-vectors.ts generate|verify (--service <id-or-source-path> | --all) [--transcripts-dir <private-directory>]';
  if (!['generate', 'verify'].includes(command)) throw new Error(usage);
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (seen.has(flag)) throw new Error(usage);
    seen.add(flag);
    if (flag === '--all') options.all = true;
    else if (flag === '--service' || (flag === '--transcripts-dir' && command === 'generate')) {
      const value = flags[++i];
      if (!value || value.startsWith('--')) throw new Error(usage);
      if (flag === '--service') options.service = value; else options.transcriptsDir = path.resolve(value);
    } else throw new Error(usage);
  }
  if (Boolean(options.service) === Boolean(options.all)) throw new Error(usage);
  if (command === 'generate') return processChapterVectors(options);
  const root = process.cwd(), paths = await servicePaths(root);
  const selected = options.all ? paths : paths.filter((filename) => path.basename(path.dirname(filename)) === options.service
    || filename === path.resolve(root, options.service!) || path.dirname(filename) === path.resolve(root, options.service!));
  if (!options.all && selected.length !== 1) throw new Error('Service selector must match exactly one source service');
  const result = { services: 0, chapters: 0, skippedSemantic: 0 };
  for (const filename of selected) {
    const loaded = loadServiceChapterVectors(filename);
    result.services++; result.chapters += loaded.rowCount;
    result.skippedSemantic += loaded.manifest.bindings.filter((binding) => !binding.has_text).length;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await chapterVectorsCli(), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Chapter vector processing failed'); process.exitCode = 1; }
}
