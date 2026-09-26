import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { stringify } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildIndex, CHAPTER_ARTIFACTS, chapterArtifactReport, metadataOutputSize } from '../scripts/archive';
import { createChapterVectorManifest } from '../scripts/chapter-vectors';
import { CHAPTER_VECTOR_CONFIG, decodeChapterVectors, packChapterVectors } from '../site/lib/chapter-vectors';
import { enrichChapters, loadChapterMetadata, loadChapterVectors, loadScriptureIndex, parseChapterMetadata,
  resolveLegacyChapter, type ChapterMetadata } from '../site/lib/chapter-index';
import { SOURCE_CHANNEL_ID, type Service } from '../site/lib/archive';
import { buildScriptureIndex } from '../bible/chapter-index';
import { loadBible } from '../scripts/bible';

const roots: string[] = [];
function root() { const value = mkdtempSync(path.join(tmpdir(), 'recs-chapter-index-')); roots.push(value); return value; }
function put(root: string, name: string, data: string | Uint8Array) {
  const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, data);
}
function fixture(id = 'fixture', reviewed = false, videoId = 'AAAAAAAAAAA'): Service {
  return { id, date: '2026-01-04', title: 'Fixture service', type: 'service', workflow_status: 'complete',
    editorial_status: reviewed ? 'reviewed' : 'needs_review',
    ...(reviewed ? { reviewed_by: 'Fixture Reviewer', reviewed_at: '2026-01-05T00:00:00Z' } : {}),
    review_notes: ['Private editorial note'], speakers: [], topics: [],
    videos: [{ id: videoId, channel_id: SOURCE_CHANNEL_ID, duration: 120, sequence: 1,
      workflow_status: 'complete', media_disposition: 'playable' }],
    chapters: [{ id: `${id}-chapter`, video_id: videoId, start: 0, end: 100, type: 'address',
      title: 'Reading the passage', summary: 'An introduction to the reading.', keywords: ['steadfast love'],
      topics: [], scripture: ['John 3:16-17'], confidence: 0.8, review_notes: ['Private uncertainty'] }],
  };
}
function source(root: string, service: Service, vectorValue = 127) {
  const directory = `services/2026/${service.id}`;
  put(root, `${directory}/service.yaml`, stringify(service));
  const binary = packChapterVectors(service.chapters.map(() => new Int8Array(384).fill(vectorValue)));
  const manifest = createChapterVectorManifest(binary, service.chapters.map((chapter) => ({
    id: chapter.id, video_id: chapter.video_id, start: chapter.start, end: chapter.end,
    windows: vectorValue ? 1 : 0, has_text: Boolean(vectorValue), input_sha256: 'a'.repeat(64),
    source_kind: vectorValue ? 'legacy_passages' : 'none',
  })));
  put(root, `${directory}/chapter-vectors.bin`, binary);
  put(root, `${directory}/chapter-vectors.json`, JSON.stringify(manifest));
  put(root, `${directory}/legacy-chapters.json`, JSON.stringify({ [`${service.id}-p001`]: service.chapters[0].id }));
}
function metadata(root: string): ChapterMetadata {
  return JSON.parse(readFileSync(path.join(root, 'site/public/generated/chapters.json'), 'utf8'));
}
afterEach(() => { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); vi.unstubAllGlobals(); });

describe('chapter artifact generation from committed vectors', () => {
  it('builds without ASR or internal material, with compact metadata and verified gzip companions', () => {
    const directory = root(); source(directory, fixture());
    buildIndex(directory, 'preview');
    const data = metadata(directory);
    expect(data.schemaVersion).toBe(2); expect(data.model).toEqual(CHAPTER_VECTOR_CONFIG);
    expect(data.chapters).toHaveLength(1);
    for (const field of ['verseText', 'confidence', 'review_notes', 'transcript', 'questions', 'rawBody']) expect(data.chapters[0]).not.toHaveProperty(field);
    expect(existsSync(path.join(directory, '.local'))).toBe(false);
    expect(existsSync(path.join(directory, 'services/2026/fixture/passages.internal.yaml'))).toBe(false);
    for (const name of CHAPTER_ARTIFACTS) {
      const filename = path.join(directory, 'site/public/generated', name);
      const bytes = readFileSync(filename);
      expect(gunzipSync(readFileSync(`${filename}.gz`))).toEqual(bytes);
      if (name.endsWith('.json')) expect(bytes.toString()).toBe(JSON.stringify(JSON.parse(bytes.toString())));
    }
    const report = chapterArtifactReport(path.join(directory, 'site/public/generated'));
    expect(report.perService.fixture).toEqual(metadataOutputSize(data.chapters));
    expect(report.artifacts['vectors.bin'].bytes).toBe(16 + 384);
    expect(report.search.gzipBytes).toBeGreaterThan(0);
  });

  it('filters before selecting rows and redirects, preserving row order and removing every stale artifact', () => {
    const directory = root();
    source(directory, fixture('reviewed', true), 63);
    source(directory, fixture('draft', false, 'BBBBBBBBBBB'), -127);
    buildIndex(directory, 'preview');
    expect(metadata(directory).chapters.map((c) => c.id)).toEqual(['draft-chapter', 'reviewed-chapter']);
    put(directory, 'site/public/generated/passages.json', 'STALE PRIVATE CONTENT');
    put(directory, 'site/public/generated/vectors.json', 'STALE PRIVATE CONTENT');
    // An excluded service does not even need a sidecar at production build time.
    rmSync(path.join(directory, 'services/2026/draft/chapter-vectors.bin'));
    buildIndex(directory, 'production');
    expect(metadata(directory).chapters.map((c) => c.id)).toEqual(['reviewed-chapter']);
    const generated = path.join(directory, 'site/public/generated');
    const binary = decodeChapterVectors(readFileSync(path.join(generated, 'vectors.bin')));
    expect(binary.rowCount).toBe(1); expect([...binary.values]).toEqual(Array(384).fill(63));
    expect(JSON.parse(readFileSync(path.join(generated, 'legacy-chapters.json'), 'utf8'))).toEqual({ 'reviewed-p001': 'reviewed-chapter' });
    expect(existsSync(path.join(generated, 'passages.json'))).toBe(false);
    expect(existsSync(path.join(generated, 'vectors.json'))).toBe(false);
  });

  it('filters nonplayable chapters within a service before binary and redirect publication', () => {
    const directory = root(), service = fixture('mixed', true);
    service.videos.push({ ...service.videos[0], id: 'BBBBBBBBBBB', sequence: 2, media_disposition: 'unassessed' });
    service.chapters.push({ ...service.chapters[0], id: 'hidden-chapter', video_id: 'BBBBBBBBBBB' });
    source(directory, service);
    put(directory, 'services/2026/mixed/legacy-chapters.json', JSON.stringify({ oldVisible: 'mixed-chapter', oldHidden: 'hidden-chapter' }));
    buildIndex(directory);
    expect(metadata(directory).chapters.map((c) => c.id)).toEqual(['mixed-chapter']);
    const generated = path.join(directory, 'site/public/generated');
    expect(decodeChapterVectors(readFileSync(path.join(generated, 'vectors.bin'))).rowCount).toBe(1);
    expect(JSON.parse(readFileSync(path.join(generated, 'legacy-chapters.json'), 'utf8'))).toEqual({ oldVisible: 'mixed-chapter' });
  });

  it('invalidates stale bounds/checksums instead of inferring or retaining preview output', () => {
    const directory = root(), service = fixture(); source(directory, service); buildIndex(directory, 'preview');
    service.chapters[0].end = 99;
    put(directory, 'services/2026/fixture/service.yaml', stringify(service));
    expect(() => buildIndex(directory, 'preview')).toThrow(/boundary|binding/i);
    expect(existsSync(path.join(directory, 'site/public/generated/chapters.json'))).toBe(false);
  });

  it('deduplicates overlapping normalized references and enriches copies only', () => {
    const directory = root(); source(directory, fixture()); buildIndex(directory, 'preview');
    const chapters = metadata(directory).chapters;
    chapters[0].scripture = ['John 3:16-17', 'John 3:16'];
    const index = buildScriptureIndex(chapters);
    expect(Object.keys(index.verses)).toEqual(['John 3:16', 'John 3:17']);
    expect(index.verses['John 3:16']).toBe(loadBible().John[2][15]);
    const enriched = enrichChapters(chapters, index);
    expect(enriched[0].verseText).toBe(Object.values(index.verses).join('\n'));
    expect(chapters[0]).not.toHaveProperty('verseText');
    expect(() => parseChapterMetadata({ ...metadata(directory), chapters: enriched })).toThrow();
  });

  it('writes a valid empty binary and empty scripture index for an empty production archive', () => {
    const directory = root(); buildIndex(directory);
    expect(metadata(directory).chapters).toEqual([]);
    expect(decodeChapterVectors(readFileSync(path.join(directory, 'site/public/generated/vectors.bin'))).rowCount).toBe(0);
  });
});

describe('portable independent browser artifact loaders', () => {
  const empty: ChapterMetadata = { schemaVersion: 2, model: CHAPTER_VECTOR_CONFIG, chapters: [] };
  it('loads raw gzip without fetching BSB, vectors, compatibility data or a model', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array(gzipSync(JSON.stringify(empty)))));
    vi.stubGlobal('fetch', fetcher);
    expect(await loadChapterMetadata('/replay')).toEqual(empty);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual(['/replay/generated/chapters.json.gz', { signal: undefined }]);
  });
  it('accepts already-decoded bodies even with a stale gzip Content-Encoding header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(empty), { headers: { 'Content-Encoding': 'gzip' } })));
    expect(await loadChapterMetadata('/')).toEqual(empty);
  });
  it('falls back to raw files when gzip is missing or corrupt', async () => {
    for (const first of [new Response('', { status: 404 }), new Response(new Uint8Array([0x1f, 0x8b, 0])), new Response('<html>Static host fallback</html>')]) {
      const fetcher = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(new Response(JSON.stringify(empty)));
      vi.stubGlobal('fetch', fetcher);
      expect(await loadChapterMetadata('/')).toEqual(empty);
      expect(fetcher.mock.calls[1][0]).toBe('/generated/chapters.json');
    }
  });
  it('uses raw files without DecompressionStream and loads scripture and binary independently', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    const scripture = { schemaVersion: 1, references: {}, verses: {} };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(scripture)))
      .mockResolvedValueOnce(new Response(new Uint8Array(packChapterVectors([]))));
    vi.stubGlobal('fetch', fetcher);
    expect(await loadScriptureIndex('/base/')).toEqual(scripture);
    expect((await loadChapterVectors('/base/')).rowCount).toBe(0);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(['/base/generated/scripture.json', '/base/generated/vectors.bin']);
  });
  it('resolves only own compatibility IDs and propagates aborts without another request', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"old-p001":"chapter-1"}')));
    expect(await resolveLegacyChapter('/', 'old-p001')).toBe('chapter-1');
    expect(await resolveLegacyChapter('/', 'constructor')).toBeUndefined();
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')); vi.stubGlobal('fetch', fetcher);
    await expect(loadChapterMetadata('/', controller.signal)).rejects.toThrow('Aborted');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
