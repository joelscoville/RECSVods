import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { flattenChapters, loadArchive, type BuildMode, type Service } from '../site/lib/archive';
import { CHAPTER_VECTOR_CONFIG, packChapterVectors } from '../site/lib/chapter-vectors';
import { validateChapterVectorManifest } from './chapter-vectors';
import { parseChapterMetadata, parseLegacyChapterMap, type ChapterMetadata, type LegacyChapterMap } from '../site/lib/chapter-index';
import type { SearchChapter } from '../site/lib/types';
import { buildScriptureIndex } from '../bible/chapter-index';
import { validateBackfill } from '../site/lib/backfill';

export const CHAPTER_ARTIFACTS = ['chapters.json', 'vectors.bin', 'scripture.json', 'legacy-chapters.json'] as const;
const compact = (value: unknown) => Buffer.from(JSON.stringify(value));

/** Sidecars may never redirect a build into private ASR/evidence directories. */
function readSidecar(root: string, filename: string): Buffer {
  const absolute = path.resolve(root, filename);
  if (realpathSync(absolute) !== path.join(realpathSync(root), filename) || !lstatSync(absolute).isFile()) {
    throw new Error(`Sidecar must be a regular file without symlinks: ${filename}`);
  }
  return readFileSync(absolute);
}
function serviceDirectory(service: Service): string {
  return `services/${service.date.slice(0, 4)}/${service.id}`;
}

/** Only committed quantized rows are read. No inference, tokenization or transcript inputs. */
export function committedChapterRows(root: string, services: readonly Service[], chapters: readonly SearchChapter[]): Int8Array[] {
  const selected = new Set(chapters.map((chapter) => chapter.serviceId));
  const rows = new Map<string, Int8Array>();
  for (const service of services.filter((candidate) => selected.has(candidate.id))) {
    const directory = serviceDirectory(service);
    const bytes = readSidecar(root, `${directory}/chapter-vectors.bin`);
    const manifest = JSON.parse(readSidecar(root, `${directory}/chapter-vectors.json`).toString('utf8'));
    const decoded = validateChapterVectorManifest(manifest, bytes, service.chapters);
    for (const [i, binding] of decoded.manifest.bindings.entries()) {
      const row = decoded.values.slice(i * decoded.dimension, (i + 1) * decoded.dimension);
      rows.set(binding.id, row);
    }
  }
  return chapters.map((chapter) => {
    const row = rows.get(chapter.id);
    if (!row) throw new Error(`Missing committed vector for ${chapter.id}`);
    return row;
  });
}

/** Accept the shared source map and/or service-local maps; all are ID-only, never internal YAML. */
export function eligibleLegacyChapters(root: string, services: readonly Service[], chapters: readonly SearchChapter[]): LegacyChapterMap {
  const eligible = new Set(chapters.map((chapter) => chapter.id));
  const known = new Set(services.flatMap((service) => service.chapters.map((chapter) => chapter.id)));
  const source: LegacyChapterMap = Object.create(null);
  for (const filename of ['services/legacy-chapters.json', ...services.map((service) => `${serviceDirectory(service)}/legacy-chapters.json`)]) {
    if (!existsSync(path.join(root, filename))) continue;
    const mapping = parseLegacyChapterMap(JSON.parse(readSidecar(root, filename).toString('utf8')));
    for (const [legacy, chapter] of Object.entries(mapping)) {
      if (!known.has(chapter) || known.has(legacy) || (Object.hasOwn(source, legacy) && source[legacy] !== chapter)) {
        throw new Error(`Invalid or conflicting legacy chapter mapping: ${legacy}`);
      }
      source[legacy] = chapter;
    }
  }
  return Object.fromEntries(Object.entries(source).filter(([, chapter]) => eligible.has(chapter)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

/** Pure artifact calculation shared with output verification; does not read internal material. */
export function chapterArtifacts(root = process.cwd(), mode: BuildMode = 'production') {
  const services = loadArchive(root);
  validateBackfill(root, services);
  const metadata: ChapterMetadata = parseChapterMetadata({ schemaVersion: 2, model: CHAPTER_VECTOR_CONFIG,
    chapters: flattenChapters(services, mode) });
  const vectors = Buffer.from(packChapterVectors(committedChapterRows(root, services, metadata.chapters)));
  const scripture = buildScriptureIndex(metadata.chapters);
  const legacy = eligibleLegacyChapters(root, services, metadata.chapters);
  const files: Record<(typeof CHAPTER_ARTIFACTS)[number], Buffer> = {
    'chapters.json': compact(metadata), 'vectors.bin': vectors,
    'scripture.json': compact(scripture), 'legacy-chapters.json': compact(legacy),
  };
  return { metadata, scripture, legacy, files };
}

export function buildIndex(root = process.cwd(), mode: BuildMode = 'production'): string {
  const directory = path.join(root, 'site/public/generated');
  // Clear BEFORE validation, including on a failed build. No stale preview/old index may survive.
  rmSync(directory, { recursive: true, force: true });
  const { files } = chapterArtifacts(root, mode);
  mkdirSync(directory, { recursive: true });
  for (const name of CHAPTER_ARTIFACTS) {
    writeFileSync(path.join(directory, name), files[name]);
    writeFileSync(path.join(directory, `${name}.gz`), gzipSync(files[name], { level: 9 }));
  }
  return path.join(directory, 'chapters.json');
}

/** Actual compact public metadata bytes, useful for measuring per-service curation output. */
export function metadataOutputSize(chapters: readonly SearchChapter[]) {
  const bytes = compact(chapters);
  return { chapters: chapters.length, bytes: bytes.byteLength, gzipBytes: gzipSync(bytes, { level: 9 }).byteLength };
}
export function chapterArtifactReport(directory: string) {
  const metadata = parseChapterMetadata(JSON.parse(readFileSync(path.join(directory, 'chapters.json'), 'utf8')));
  const artifacts = Object.fromEntries(CHAPTER_ARTIFACTS.map((name) => [name, {
    bytes: readFileSync(path.join(directory, name)).byteLength,
    gzipBytes: readFileSync(path.join(directory, `${name}.gz`)).byteLength,
  }]));
  const perService = Object.fromEntries([...new Set(metadata.chapters.map((chapter) => chapter.serviceId))].map((id) =>
    [id, metadataOutputSize(metadata.chapters.filter((chapter) => chapter.serviceId === id))]));
  const searchNames = ['chapters.json', 'vectors.bin', 'scripture.json'] as const;
  return { services: Object.keys(perService).length, chapters: metadata.chapters.length, artifacts, perService,
    search: { bytes: searchNames.reduce((sum, name) => sum + artifacts[name].bytes, 0),
      gzipBytes: searchNames.reduce((sum, name) => sum + artifacts[name].gzipBytes, 0) } };
}

export function archiveCli(args = process.argv.slice(2)): void {
  const [command, ...options] = args.filter((arg) => arg !== '--');
  const mode = options.length === 0 ? 'production'
    : options.length === 2 && options[0] === '--mode' ? options[1] : undefined;
  if (!['validate', 'build-index', 'report'].includes(command) || !['production', 'preview'].includes(mode ?? '')
    || (command !== 'build-index' && options.length)) {
    throw new Error('Usage: tsx scripts/archive.ts validate | build-index [--mode production|preview] | report');
  }
  if (command === 'validate') {
    const services = loadArchive();
    validateBackfill(process.cwd(), services);
    console.log(`Archive valid: ${services.length} interpreted service(s).`);
  } else if (command === 'report') console.log(JSON.stringify(chapterArtifactReport(path.join(process.cwd(), 'site/public/generated')), null, 2));
  else console.log(buildIndex(process.cwd(), mode as BuildMode));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { archiveCli(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
