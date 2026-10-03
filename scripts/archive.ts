import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { BuildMode, SearchUnit } from '../site/lib/display';
import { loadPublicArchive } from '../site/lib/public-archive';
import { loadRecordings } from '../site/lib/recordings';
import { CHAPTER_VECTOR_CONFIG, packChapterVectors } from '../site/lib/chapter-vectors';
import { parseChapterMetadata, type ChapterMetadata, type ScriptureIndex } from '../site/lib/chapter-index';
import { buildScriptureIndex } from '../bible/chapter-index';
import { searchVectorRows } from './search-vectors';

export const CHAPTER_ARTIFACTS = ['chapters.json', 'vectors.bin', 'scripture.json'] as const;
export const artifactFilename = (name: (typeof CHAPTER_ARTIFACTS)[number], metadata: ChapterMetadata) => name === 'vectors.bin' ? metadata.vectors.file : name;
const compact = (value: unknown) => Buffer.from(JSON.stringify(value));

/** Makes one vector row per unit; tests pass their own instead of loading the model. */
export type VectorRows = (root: string, units: readonly SearchUnit[], scripture: ScriptureIndex) => Promise<Int8Array[]>;
/** The public search data: units, their BSB passages, and vectors embedded from that same text. */
export async function chapterArtifacts(root = process.cwd(), mode: BuildMode = 'production', rows: VectorRows = searchVectorRows) {
  const { units } = loadPublicArchive(mode, root);
  const scripture = buildScriptureIndex(units);
  const vectors = Buffer.from(packChapterVectors(await rows(root, units, scripture)));
  const sha256 = createHash('sha256').update(vectors).digest('hex');
  const metadata: ChapterMetadata = parseChapterMetadata({ schemaVersion: 6, model: CHAPTER_VECTOR_CONFIG,
    vectors: { file: `vectors.${sha256}.bin`, sha256 }, units });
  const files: Record<(typeof CHAPTER_ARTIFACTS)[number], Buffer> = {
    'chapters.json': compact(metadata), 'vectors.bin': vectors, 'scripture.json': compact(scripture),
  };
  return { metadata, scripture, files };
}

export async function buildIndex(root = process.cwd(), mode: BuildMode = 'production', rows?: VectorRows): Promise<string> {
  const directory = path.join(root, 'site/public/generated');
  // Clear BEFORE validation, including on a failed build. No stale preview/old index may survive.
  rmSync(directory, { recursive: true, force: true });
  const { files, metadata } = await chapterArtifacts(root, mode, rows);
  mkdirSync(directory, { recursive: true });
  for (const name of CHAPTER_ARTIFACTS) {
    const filename = artifactFilename(name, metadata);
    writeFileSync(path.join(directory, filename), files[name]);
    writeFileSync(path.join(directory, `${filename}.gz`), gzipSync(files[name], { level: 9 }));
  }
  return path.join(directory, 'chapters.json');
}

/** Actual compact public metadata bytes, useful for measuring per-service curation output. */
export function metadataOutputSize(units: readonly SearchUnit[]) {
  const bytes = compact(units);
  return { units: units.length, bytes: bytes.byteLength, gzipBytes: gzipSync(bytes, { level: 9 }).byteLength };
}
export function chapterArtifactReport(directory: string) {
  const metadata = parseChapterMetadata(JSON.parse(readFileSync(path.join(directory, 'chapters.json'), 'utf8')));
  const artifacts = Object.fromEntries(CHAPTER_ARTIFACTS.map((name) => [name, {
    bytes: readFileSync(path.join(directory, artifactFilename(name, metadata))).byteLength,
    gzipBytes: readFileSync(path.join(directory, `${artifactFilename(name, metadata)}.gz`)).byteLength,
  }]));
  const perService = Object.fromEntries([...new Set(metadata.units.map((unit) => unit.recordingId))].map((id) =>
    [id, metadataOutputSize(metadata.units.filter((unit) => unit.recordingId === id))]));
  const searchNames = ['chapters.json', 'vectors.bin', 'scripture.json'] as const;
  return { recordings: Object.keys(perService).length, units: metadata.units.length, artifacts, perService,
    search: { bytes: searchNames.reduce((sum, name) => sum + artifacts[name].bytes, 0),
      gzipBytes: searchNames.reduce((sum, name) => sum + artifacts[name].gzipBytes, 0) } };
}

export async function archiveCli(args = process.argv.slice(2)): Promise<void> {
  const [command, ...options] = args.filter((arg) => arg !== '--');
  const mode = options.length === 0 ? 'production'
    : options.length === 2 && options[0] === '--mode' ? options[1] : undefined;
  if (!['validate', 'build-index', 'report'].includes(command) || !['production', 'preview'].includes(mode ?? '')
    || (command !== 'build-index' && options.length)) {
    throw new Error('Usage: tsx scripts/archive.ts validate | build-index [--mode production|preview] | report');
  }
  if (command === 'validate') {
    const { recordings } = loadRecordings();
    console.log(`Archive valid: ${recordings.length} recording(s).`);
  } else if (command === 'report') console.log(JSON.stringify(chapterArtifactReport(path.join(process.cwd(), 'site/public/generated')), null, 2));
  else console.log(await buildIndex(process.cwd(), mode as BuildMode));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await archiveCli(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
