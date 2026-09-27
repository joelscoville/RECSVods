import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { loadArchive } from '../site/lib/archive';
import { chapterArtifactReport } from './archive';
import { loadBible } from './bible';

const gzipBytes = (value: unknown) => gzipSync(JSON.stringify(value), { level: 9 }).byteLength;

/** Measurements only: no generated content, inferred transcripts or synthetic compression claims. */
export function chapterMigrationReport(root = process.cwd()) {
  const directory = path.join(root, 'dist/preview/generated');
  const current = chapterArtifactReport(directory);
  const services = loadArchive(root);
  const publicMetadata = JSON.parse(readFileSync(path.join(directory, 'chapters.json'), 'utf8')) as { chapters: { parentId?: string }[] };
  const source = services.map(service => {
    const directory = path.join(root, 'services', service.date.slice(0, 4), service.id);
    return { id: service.id, chapters: service.chapters.length,
      yamlBytes: statSync(path.join(directory, 'service.yaml')).size,
      vectorBytes: statSync(path.join(directory, 'chapter-vectors.bin')).size,
      manifestBytes: statSync(path.join(directory, 'chapter-vectors.json')).size };
  });
  const scripture = JSON.parse(readFileSync(path.join(directory, 'scripture.json'), 'utf8'));
  const bible = loadBible();
  const fullVerseMap = Object.fromEntries(Object.entries(bible).flatMap(([book, chapters]) =>
    chapters.flatMap((verses, chapter) => verses.map((text, verse) => [`${book} ${chapter + 1}:${verse + 1}`, text]))));
  const fullBibleVerseGzipBytes = gzipBytes(fullVerseMap);
  const currentReferenceGzipBytes = gzipBytes(scripture.references);
  const futureServices = 700 - current.services;
  const projections = [8, 10, 12, 15].map(searchUnitsPerNewService => {
    // Preserve the unusually dense migrated corpus instead of pretending to resegment it.
    const chapters = current.chapters + futureServices * searchUnitsPerNewService;
    const ratio = chapters / current.chapters;
    const metadataGzipBytes = Math.ceil(current.artifacts['chapters.json'].gzipBytes * ratio);
    const vectorGzipEstimateBytes = Math.ceil((current.artifacts['vectors.bin'].gzipBytes - 16) * ratio + 16);
    const vectorRawBytes = chapters * 384 + 16;
    const referenceGzipEstimateBytes = Math.ceil(currentReferenceGzipBytes * ratio);
    return { services: 700, searchUnitsPerNewService, searchUnits: chapters, metadataGzipBytes, vectorGzipEstimateBytes, vectorRawBytes,
      fullBibleVerseGzipBytes, referenceGzipEstimateBytes,
      searchGzipEstimateBytes: metadataGzipBytes + vectorGzipEstimateBytes + fullBibleVerseGzipBytes + referenceGzipEstimateBytes,
      searchWithUncompressedVectorsBytes: metadataGzipBytes + vectorRawBytes + fullBibleVerseGzipBytes + referenceGzipEstimateBytes };
  });
  return { current: { ...current, primaryChapters: publicMetadata.chapters.filter(chapter => !chapter.parentId).length,
      subsections: publicMetadata.chapters.filter(chapter => chapter.parentId).length }, source,
    sourceTotals: {
      services: source.length, chapters: source.reduce((n, item) => n + item.chapters, 0),
      yamlBytes: source.reduce((n, item) => n + item.yamlBytes, 0),
      vectorBytes: source.reduce((n, item) => n + item.vectorBytes, 0),
      manifestBytes: source.reduce((n, item) => n + item.manifestBytes, 0),
    },
    bible: { currentUniqueVerses: Object.keys(scripture.verses).length, fullUniqueVerses: Object.keys(fullVerseMap).length,
      fullBibleVerseGzipBytes, currentReferenceGzipBytes }, projections,
    assumptions: [
      'Model and application assets excluded; compatibility map loads only for legacy links.',
      `Existing ${current.chapters} eligible search units remain intact; projections count both primary chapters and selected subsections in each new service.`,
      'Metadata/vector/reference gzip ratios are observed-current-corpus extrapolations, not measured future payloads.',
      'Bible scenario includes every official BSB verse once, plus separately compressed reference mappings scaled by chapter count.',
      'Future vocabulary, summary length, reference density and compression can differ; verify actual growth against these estimates.',
      'Internal preservation files and legacy mapping are excluded from newly authored per-service output totals.',
    ] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(chapterMigrationReport(), null, 2));
}
