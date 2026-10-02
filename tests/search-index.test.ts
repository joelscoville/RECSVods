import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildIndex, CHAPTER_ARTIFACTS, chapterArtifactReport, metadataOutputSize, artifactFilename } from '../scripts/archive';
import { CHAPTER_VECTOR_CONFIG, decodeChapterVectors, packChapterVectors } from '../site/lib/chapter-vectors';
import { enrichUnits, loadChapterMetadata, loadChapterVectors, loadScriptureIndex, parseChapterMetadata, type ChapterMetadata } from '../site/lib/chapter-index';
import { buildScriptureIndex } from '../bible/chapter-index';
import { loadBible } from '../scripts/bible';
import { fakeRows, source, writeArchive } from './recording-fixtures';

const roots: string[] = [];
function root() { const value = mkdtempSync(path.join(tmpdir(), 'recs-search-index-')); roots.push(value); return value; }
function put(root: string, name: string, data: string | Uint8Array) {
  const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, data);
}
/** Every row filled with one value, so a build's rows can be told apart. */
const fill = (value: number) => async (_root: string, list: readonly unknown[]) => list.map(() => new Int8Array(384).fill(value));
function metadata(root: string): ChapterMetadata {
  return JSON.parse(readFileSync(path.join(root, 'site/public/generated/chapters.json'), 'utf8'));
}
const generated = (root: string) => path.join(root, 'site/public/generated');
afterEach(() => { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); vi.unstubAllGlobals(); });

describe('search artifacts built from the recording files', () => {
  it('builds compact public units with verified gzip companions and nothing private', async () => {
    const directory = root(); writeArchive(directory, { '2026-09-06': source() });
    await buildIndex(directory, 'production', fakeRows);
    const data = metadata(directory);
    expect(data.schemaVersion).toBe(5); expect(data.model).toEqual(CHAPTER_VECTOR_CONFIG);
    expect(data.units.filter(unit => unit.kind === 'subchapter').map(unit => unit.title)).toEqual(['Holy Communion', 'Practise Small Hospitality']);
    expect(data.units.filter(unit => unit.kind === 'point')).toHaveLength(3);
    expect(data.units.filter(unit => unit.kind === 'point').every(unit => unit.end === undefined)).toBe(true);
    for (const field of ['verseText', 'markers', 'transcript', 'status']) expect(data.units[0]).not.toHaveProperty(field);
    for (const name of CHAPTER_ARTIFACTS) {
      const filename = path.join(generated(directory), artifactFilename(name, data));
      const bytes = readFileSync(filename);
      expect(gunzipSync(readFileSync(`${filename}.gz`))).toEqual(bytes);
      if (name.endsWith('.json')) expect(bytes.toString()).toBe(JSON.stringify(JSON.parse(bytes.toString())));
    }
    const report = chapterArtifactReport(generated(directory));
    expect(report.perService['2026-09-06']).toEqual(metadataOutputSize(data.units));
    expect(report.artifacts['vectors.bin'].bytes).toBe(16 + data.units.length * 384);
  });

  it('publishes drafts only in preview, one vector row per unit, and removes stale artifacts', async () => {
    const directory = root();
    writeArchive(directory, { '2026-09-06': source(), '2026-09-13': source({ serviceDate: '2026-09-13', status: 'draft', uploads: [{ youtubeId: 'BBBBBBBBBBB', uploadDuration: '1:30:00' }] }) });
    await buildIndex(directory, 'preview', fakeRows);
    expect(new Set(metadata(directory).units.map((unit) => unit.recordingId))).toEqual(new Set(['2026-09-06', '2026-09-13']));
    expect(metadata(directory).units.find((unit) => unit.recordingId === '2026-09-13')?.preview).toBe(true);
    put(directory, 'site/public/generated/passages.json', 'STALE PRIVATE CONTENT');
    await buildIndex(directory, 'production', fill(63));
    expect(new Set(metadata(directory).units.map((unit) => unit.recordingId))).toEqual(new Set(['2026-09-06']));
    const binary = decodeChapterVectors(readFileSync(path.join(generated(directory), metadata(directory).vectors.file)));
    expect(binary.rowCount).toBe(metadata(directory).units.length); expect(binary.values[0]).toBe(63);
    expect(existsSync(path.join(generated(directory), 'passages.json'))).toBe(false);
  });

  it('leaves no output behind when the archive is invalid', async () => {
    const directory = root(); writeArchive(directory, { '2026-09-06': source() });
    await buildIndex(directory, 'production', fakeRows);
    writeArchive(directory, { '2026-09-20': source() });
    await expect(buildIndex(directory, 'production', fakeRows)).rejects.toThrow('file name must be the service date');
    expect(existsSync(path.join(generated(directory), 'chapters.json'))).toBe(false);
  });

  it('deduplicates overlapping references and enriches copies only', async () => {
    const directory = root(); writeArchive(directory, { '2026-09-06': source({ sermonScripture: ['John 3:16-17'] }) });
    await buildIndex(directory, 'production', fakeRows);
    const units = metadata(directory).units;
    units[0].scripture = ['John 3:16-17', 'John 3:16'];
    const index = buildScriptureIndex(units);
    expect(Object.keys(index.verses)).toEqual(['John 3:16', 'John 3:17']);
    expect(index.verses['John 3:16']).toBe(loadBible().John[2][15]);
    const enriched = enrichUnits(units, index);
    expect(enriched[0].verseText).toBe(Object.values(index.verses).join('\n'));
    expect(units[0]).not.toHaveProperty('verseText');
    expect(() => parseChapterMetadata({ ...metadata(directory), units: enriched })).toThrow();
  });

  it('writes a valid empty binary and scripture index for an empty production archive', async () => {
    const directory = root(); writeArchive(directory, {});
    await buildIndex(directory, 'production', fakeRows);
    expect(metadata(directory).units).toEqual([]);
    expect(decodeChapterVectors(readFileSync(path.join(generated(directory), metadata(directory).vectors.file))).rowCount).toBe(0);
  });
});

describe('portable independent browser artifact loaders', () => {
  const sha256 = createHash('sha256').update(packChapterVectors([])).digest('hex');
  const empty: ChapterMetadata = { schemaVersion: 5, model: CHAPTER_VECTOR_CONFIG, vectors: { file: `vectors.${sha256}.bin`, sha256 }, units: [] };
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
    expect((await loadChapterVectors('/base/', empty)).rowCount).toBe(0);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(['/base/generated/scripture.json', `/base/generated/${empty.vectors.file}`]);
  });
  it('rejects another generation with the same row count and never uses an unversioned URL', async () => {
    const directory = root(); writeArchive(directory, { '2026-09-06': source() });
    await buildIndex(directory, 'preview', fill(127));
    const generationA = metadata(directory);
    await buildIndex(directory, 'preview', fill(-127));
    const generationB = metadata(directory);
    expect(generationA.vectors.file).not.toBe(generationB.vectors.file);
    const wrong = readFileSync(path.join(directory, 'site/public/generated', generationB.vectors.file));
    const fetcher = vi.fn(async (_url: string) => new Response(new Uint8Array(wrong)));
    vi.stubGlobal('fetch', fetcher);
    await expect(loadChapterVectors('/base/', generationA)).rejects.toThrow('checksum mismatch');
    expect(fetcher.mock.calls.every(call => String(call[0]).includes(generationA.vectors.file))).toBe(true);
    expect((await loadChapterVectors('/base/', generationB)).values[0]).toBe(-127);
  });
  it('propagates aborts without another request', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')); vi.stubGlobal('fetch', fetcher);
    await expect(loadChapterMetadata('/', controller.signal)).rejects.toThrow('Aborted');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
