import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { cosineChapterVector, decodeChapterVectors, packChapterVectors } from '../site/lib/chapter-vectors';
import { averageChapterWindows, chapterTokenWindows, clipChapterEvidence, createChapterVectorManifest,
  loadServiceChapterVectors, parseChapterEvidence, processChapterVectors, quantizeChapterVector,
  stripEditorialAnnotations, validateChapterVectorManifest, type ChapterVectorBinding, type ChapterVectorChapter } from '../scripts/chapter-vectors';
import type { EmbeddingSession } from '../scripts/embeddings';

const DIM = 384, VIDEO = 'abcdefghijk', OTHER = 'lmnopqrstuv';
const chapter: ChapterVectorChapter = { id: 'chapter-a', video_id: VIDEO, start: 0, end: 10 };
function unit(index = 0): number[] { return Array.from({ length: DIM }, (_, i) => i === index ? 1 : 0); }
function binding(overrides: Partial<ChapterVectorBinding> = {}): ChapterVectorBinding {
  return { ...chapter, windows: 1, has_text: true, input_sha256: 'a'.repeat(64), source_kind: 'legacy_passages', ...overrides };
}
function normalized(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return values.map((v) => v / norm);
}

describe('browser chapter codec', () => {
  it('encodes the exact LE header, signed rows and offset views', () => {
    const row = new Int8Array(DIM); row[0] = -127; row[1] = 127;
    const bytes = packChapterVectors([row, new Int8Array(DIM)]);
    expect(Array.from(bytes.subarray(0, 16))).toEqual([82, 69, 67, 83, 67, 72, 48, 49, 128, 1, 1, 0, 2, 0, 0, 0]);
    expect(bytes.length).toBe(16 + 2 * DIM);
    const padded = new Uint8Array(bytes.length + 7); padded.set(bytes, 3);
    const decoded = decodeChapterVectors(padded.subarray(3, 3 + bytes.length));
    expect(decoded.dimension).toBe(DIM); expect(decoded.rowCount).toBe(2);
    expect(decoded.values[0]).toBe(-127); expect(decoded.values[1]).toBe(127);
    expect(decodeChapterVectors(bytes.buffer as ArrayBuffer).values).toEqual(decoded.values);
    expect(decodeChapterVectors(packChapterVectors([])).rowCount).toBe(0);
  });

  it('rejects malformed headers, length mismatches and out-of-recipe int8', () => {
    const original = packChapterVectors([new Int8Array(DIM)]);
    for (const [offset, value] of [[0, 0], [8, 127], [10, 2], [12, 2], [16, 128]]) {
      const bytes = original.slice(); bytes[offset] = value;
      expect(() => decodeChapterVectors(bytes)).toThrow();
    }
    expect(() => decodeChapterVectors(original.subarray(0, 15))).toThrow(/header/u);
    expect(() => decodeChapterVectors(original.subarray(0, -1))).toThrow(/length/u);
    expect(() => decodeChapterVectors(new Uint8Array([...original, 0]))).toThrow(/length/u);
    expect(() => packChapterVectors([new Int8Array(383)])).toThrow();
    expect(() => packChapterVectors([new Int8Array(DIM).fill(-128)])).toThrow();
  });

  it('normalizes both row and query; skips zero rows and rejects invalid queries', () => {
    const row = new Int8Array(DIM); row[0] = 3; row[1] = 4;
    const query = unit(); query[0] = 6; query[1] = 8;
    const file = decodeChapterVectors(packChapterVectors([row, new Int8Array(DIM)]));
    expect(cosineChapterVector(file, 0, query)).toBeCloseTo(1, 12);
    expect(cosineChapterVector(file, 0, query.map((v) => -v))).toBeCloseTo(-1, 12);
    expect(cosineChapterVector(file, 1, query)).toBe(0);
    expect(cosineChapterVector(file, 0, new Float32Array(DIM))).toBe(0);
    expect(() => cosineChapterVector(file, -1, query)).toThrow();
    expect(() => cosineChapterVector(file, 2, query)).toThrow();
    expect(() => cosineChapterVector(file, 0, [1])).toThrow();
    expect(() => cosineChapterVector(file, 0, new Array(DIM).fill(NaN))).toThrow();
  });

  it('has low cosine quantization error and symmetric rounding', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const source = normalized(Array.from({ length: DIM }, (_, i) => Math.sin(i * seed + 0.37)));
      const quantized = quantizeChapterVector(source);
      expect(Math.max(...quantized.map(Math.abs))).toBe(127);
      const file = decodeChapterVectors(packChapterVectors([quantized]));
      expect(cosineChapterVector(file, 0, source)).toBeGreaterThan(0.99998);
      const query = normalized(Array.from({ length: DIM }, (_, i) => Math.cos(i * (seed + 0.5))));
      const expected = source.reduce((sum, v, i) => sum + v * query[i], 0);
      expect(Math.abs(cosineChapterVector(file, 0, query) - expected)).toBeLessThan(0.001);
    }
    const v = new Array(DIM).fill(0); v[0] = 127; v[1] = 0.5; v[2] = -0.5;
    expect(Array.from(quantizeChapterVector(v).subarray(0, 3))).toEqual([127, 1, -1]);
    expect(quantizeChapterVector(new Array(DIM).fill(0))).toEqual(new Int8Array(DIM));
    expect(() => quantizeChapterVector(new Array(DIM).fill(Infinity))).toThrow();
  });
});

describe('manifest bindings', () => {
  const bytes = packChapterVectors([quantizeChapterVector(unit())]);
  it('checks SHA, exact recipe, ordered metadata, counts and no-text flags', () => {
    const manifest = createChapterVectorManifest(bytes, [binding()]);
    expect(validateChapterVectorManifest(manifest, bytes, [chapter]).rowCount).toBe(1);
    for (const change of [{ id: 'wrong' }, { video_id: OTHER }, { start: 1 }, { end: 11 }]) {
      expect(() => validateChapterVectorManifest(manifest, bytes, [{ ...chapter, ...change }])).toThrow(/mismatch/u);
    }
    expect(() => validateChapterVectorManifest(manifest, bytes, [])).toThrow(/count/u);
    expect(() => validateChapterVectorManifest({ ...manifest, binary_sha256: '0'.repeat(64) }, bytes, [chapter])).toThrow(/checksum/u);
    expect(() => validateChapterVectorManifest({ ...manifest, model: { ...manifest.model, revision: 'wrong' } }, bytes, [chapter])).toThrow(/recipe/u);
    expect(() => validateChapterVectorManifest({ ...manifest, model: { ...manifest.model, windowing: { contentTokens: 256 } } }, bytes, [chapter])).toThrow();
    expect(() => validateChapterVectorManifest({ ...manifest, text: 'private' }, bytes, [chapter])).toThrow();
    for (const change of [{ has_text: false }, { windows: 0 }, { windows: -1 }, { input_sha256: 'bad' },
      { source_kind: 'none' }, { source_kind: '/private/path' }, { transcript: 'private' }]) {
      expect(() => validateChapterVectorManifest({ ...manifest, bindings: [{ ...binding(), ...change }] }, bytes, [chapter])).toThrow();
    }
    const zero = packChapterVectors([new Int8Array(DIM)]);
    expect(() => createChapterVectorManifest(zero, [binding()])).toThrow(/no-text/u);
    expect(() => createChapterVectorManifest(bytes, [binding({ windows: 0, has_text: false })])).toThrow(/no-text/u);
    expect(createChapterVectorManifest(zero, [binding({ windows: 0, has_text: false, source_kind: 'none' })]).bindings[0].has_text).toBe(false);
  });

  it('rejects row order changes, missing bindings and duplicate IDs', () => {
    const second = { ...chapter, id: 'chapter-b', start: 10, end: 20 };
    const binary = packChapterVectors([quantizeChapterVector(unit()), quantizeChapterVector(unit(1))]);
    const manifest = createChapterVectorManifest(binary, [binding(), binding(second)]);
    expect(() => validateChapterVectorManifest(manifest, binary, [second, chapter])).toThrow();
    expect(() => validateChapterVectorManifest({ ...manifest, bindings: manifest.bindings.slice(1) }, binary, [chapter, second])).toThrow();
    expect(() => createChapterVectorManifest(binary, [binding(), binding()])).toThrow();
  });
});

describe('deterministic working inputs and windows', () => {
  it.each([0, 1, 190, 254, 255, 444, 445, 1000])('fits 256 including specials for %i content tokens, with exact 64 overlap', (length) => {
    const ids = Array.from({ length }, (_, i) => i + 1000), windows = chapterTokenWindows(ids);
    expect(windows).toEqual(chapterTokenWindows(ids));
    expect(windows.length).toBe(length ? 1 + Math.ceil(Math.max(0, length - 254) / 190) : 0);
    for (const [i, window] of windows.entries()) {
      expect(window.length + 2).toBeLessThanOrEqual(256);
      if (i) expect(window.slice(0, 64)).toEqual(windows[i - 1].slice(-64));
    }
    const reconstructed = windows.flatMap((window, i) => i ? window.slice(64) : window);
    expect(reconstructed).toEqual(ids);
  });

  it('averages normalized windows and L2 normalizes before quantization', () => {
    const vector = averageChapterWindows([unit(), unit(1)]);
    expect(vector[0]).toBeCloseTo(Math.SQRT1_2, 12); expect(vector[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(quantizeChapterVector(vector).subarray(0, 2)).toEqual(new Int8Array([127, 127]));
    expect(averageChapterWindows([])).toEqual(new Array(DIM).fill(0));
    expect(() => averageChapterWindows([unit(), unit().map((v) => -v)])).toThrow(/cancel/u);
  });

  it('clips timed words by midpoint, segment fallback otherwise, with half-open boundaries', () => {
    const evidence = parseChapterEvidence({ video_id: VIDEO, segments: [
      { start: 0, end: 20, text: 'must not use this segment text', words: [
        { start: 0, end: 0, word: 'start' }, { start: 8, end: 10, word: 'inside' },
        { start: 9, end: 11, word: 'next' }, { start: 20, end: 20, word: 'end' },
      ] },
      { start: 4, end: 8, text: 'segment-only' },
      { start: 8, end: 12, text: 'boundary-segment', words: [{ word: 'no-timing' }] },
    ] }, VIDEO);
    expect(clipChapterEvidence(evidence, { start: 0, end: 10 })).toBe('start inside segment-only');
    expect(clipChapterEvidence(evidence, { start: 10, end: 20 })).toBe('next boundary-segment');
    expect(() => parseChapterEvidence({ video_id: OTHER, segments: [] }, VIDEO)).toThrow(/ID/u);
    expect(() => parseChapterEvidence({ video_id: VIDEO, segments: [{ start: 0, end: -1, text: 'invalid' }] }, VIDEO)).toThrow();
    expect(() => parseChapterEvidence({ video_id: VIDEO, segments: [{ start: 0, end: 1, text: 'invalid', words: [{ start: NaN, word: 'bad' }] }] }, VIDEO)).toThrow();
  });

  it('accepts canonical primary-whisper and normalized-caption evidence without transcription', () => {
    const evidence = parseChapterEvidence({ schema_version: 1, youtube_id: VIDEO,
      segments: [{ start: 1, end: 2, text: 'normalized caption' }] }, VIDEO);
    expect(evidence.source_kind).toBe('canonical_evidence_json');
    expect(clipChapterEvidence(evidence, chapter)).toBe('normalized caption');
    expect(stripEditorialAnnotations('Before [Scripture quotation omitted; reference only.] after [unclear phrase].')).toBe('Before after .');
    expect(stripEditorialAnnotations('[Lyrics omitted.]')).toBe('');
    expect(stripEditorialAnnotations('Spoken [omitted [nested reference] editorial note] again.')).toBe('Spoken again.');
  });
});

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'recs-chapter-vector-test-')); roots.push(root);
  const directory = path.join(root, 'services/2026/fixture-service');
  await mkdir(directory, { recursive: true });
  const chapters = [chapter, { ...chapter, id: 'chapter-b', start: 10, end: 20 },
    { ...chapter, id: 'chapter-c', video_id: OTHER, start: 0, end: 10 }];
  await writeFile(path.join(directory, 'service.yaml'), stringify({ id: 'fixture-service', chapters,
    summary: 'metadata must never be embedded' }));
  const legacy = `# Preserve this exact file, including comments and block whitespace.\npassages:\n  - id: old-a\n    section_id: chapter-a\n    video_id: ${VIDEO}\n    start: 0\n    end: 10\n    transcript: |\n      legacyspoken [Quotation omitted.]\n      secondline\n  - id: old-b\n    section_id: chapter-b\n    video_id: ${VIDEO}\n    start: 10\n    end: 20\n    transcript: '[Lyrics omitted; reference only.]'\n  - id: old-c\n    section_id: chapter-c\n    video_id: ${OTHER}\n    start: 0\n    end: 10\n    transcript: '[Instrumental; no speech.]'\n`;
  await writeFile(path.join(directory, 'passages.internal.yaml'), legacy);
  const state = { created: 0, disposed: 0, texts: [] as string[], windows: [] as number[][] };
  async function createSession(): Promise<EmbeddingSession> {
    state.created++;
    return {
      tokenize(text) { state.texts.push(text); return Array.from(text, (char) => char.codePointAt(0)!); },
      async embedTokenIds(ids) { state.windows.push([...ids]); return unit(ids.reduce((sum, id) => sum + id, 0) % DIM); },
      async embedText() { throw new Error('Processor must use token IDs'); },
      async dispose() { state.disposed++; },
    };
  }
  return { root, directory, chapters, legacy, state, createSession };
}

describe('isolated private processor', () => {
  it('binds explicit caption processing to accepted evidence and never replaces it with missing or altered input', async () => {
    const f = await fixture(), transcripts = path.join(f.root, 'private-captions');
    await mkdir(path.join(transcripts, VIDEO), { recursive: true });
    const raw = JSON.stringify({ youtube_id: VIDEO, engine: { name: 'youtube-auto-captions' }, segments: [{ start: 0, end: 10, text: 'acceptedspoken' }] });
    const { sha256 } = await import('../scripts/embeddings');
    await writeFile(path.join(f.directory, 'service.yaml'), stringify({ chapters: [chapter],
      videos: [{ id: VIDEO, caption_provenance: { evidence_sha256: sha256(raw) } }] }));
    const run = () => processChapterVectors({ fixtureRoot: f.root, all: true, transcriptsDir: transcripts, createSession: f.createSession });
    await expect(run()).rejects.toThrow('Caption evidence is missing or differs');
    await writeFile(path.join(transcripts, VIDEO, 'evidence.json'), raw);
    await expect(run()).resolves.toMatchObject({ chapters: 1, writtenServices: 1 });
    const before = await readFile(path.join(f.directory, 'chapter-vectors.bin'));
    await writeFile(path.join(transcripts, VIDEO, 'evidence.json'), raw.replace('acceptedspoken', 'alteredspoken'));
    await expect(run()).rejects.toThrow('Caption evidence is missing or differs');
    expect(await readFile(path.join(f.directory, 'chapter-vectors.bin'))).toEqual(before);
  });
  it('embeds a regrouped span from unchanged legacy section membership rather than its new ID or synopsis', async () => {
    const f = await fixture();
    await writeFile(path.join(f.directory, 'service.yaml'), stringify({ chapters: [{ ...chapter, id: 'new-parent', end: 20,
      source_chapters: ['chapter-a', 'chapter-b'], summary: 'Must never become speech' }] }));
    const report = await processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession });
    expect(report).toMatchObject({ chapters: 1, skippedSemantic: 0 });
    expect(f.state.texts).toEqual(['legacyspoken secondline']);
    expect(await readFile(path.join(f.directory, 'passages.internal.yaml'), 'utf8')).toBe(f.legacy);
    expect(loadServiceChapterVectors(f.directory).manifest.bindings[0]).toMatchObject({ id: 'new-parent', start: 0, end: 20, has_text: true });
  });
  it('preserves fallback bytes, emits explicit zero rows, reuses sidecars, and build loading needs no evidence', async () => {
    const f = await fixture();
    const source = await readFile(path.join(f.directory, 'service.yaml'));
    const report = await processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession });
    expect(report).toMatchObject({ services: 1, chapters: 3, skippedSemantic: 2, embeddedWindows: 1, writtenServices: 1 });
    expect(f.state).toMatchObject({ created: 1, disposed: 1, texts: ['legacyspoken secondline'] });
    expect(await readFile(path.join(f.directory, 'passages.internal.yaml'), 'utf8')).toBe(f.legacy);
    expect(await readFile(path.join(f.directory, 'service.yaml'))).toEqual(source);
    const first = await readFile(path.join(f.directory, 'chapter-vectors.bin'));
    const manifestBytes = await readFile(path.join(f.directory, 'chapter-vectors.json'), 'utf8');
    expect(manifestBytes).not.toMatch(/legacyspoken|secondline|metadata must|passages\.internal|transcripts|\.local/u);
    const loaded = loadServiceChapterVectors(f.root, 'services/2026/fixture-service/service.yaml');
    expect(loaded.manifest.bindings.map((item) => [item.windows, item.has_text, item.source_kind])).toEqual([
      [1, true, 'legacy_passages'], [0, false, 'legacy_passages'], [0, false, 'legacy_passages'],
    ]);
    const repeat = await processChapterVectors({ fixtureRoot: f.root, service: 'fixture-service', createSession: f.createSession });
    expect(repeat).toMatchObject({ reusedServices: 1, embeddedWindows: 0, writtenServices: 0 });
    expect(f.state.created).toBe(1);
    expect(await readFile(path.join(f.directory, 'chapter-vectors.bin'))).toEqual(first);
    expect(await readFile(path.join(f.directory, 'chapter-vectors.json'), 'utf8')).toBe(manifestBytes);
    await rm(path.join(f.directory, 'passages.internal.yaml'));
    expect(loadServiceChapterVectors(f.directory).values).toEqual(loaded.values);
    await writeFile(path.join(f.directory, 'service.yaml'), stringify({ chapters: [{ ...chapter, end: 9 }, ...f.chapters.slice(1)] }));
    expect(() => loadServiceChapterVectors(f.directory)).toThrow(/boundary/u);
  });

  it('prefers exact raw video JSON, never falls back for uncovered raw chapters, rejects wrong IDs', async () => {
    const f = await fixture(), transcripts = path.join(f.root, 'private-transcripts');
    await mkdir(transcripts);
    await writeFile(path.join(transcripts, `${VIDEO}.json`), JSON.stringify({ video_id: VIDEO, segments: [
      { start: 0, end: 10, text: 'rawpreferred' },
    ] }));
    await mkdir(path.join(transcripts, VIDEO));
    await writeFile(path.join(transcripts, VIDEO, 'evidence.json'), JSON.stringify({ youtube_id: VIDEO,
      segments: [{ start: 0, end: 10, text: 'lower-priority-canonical' }] }));
    const report = await processChapterVectors({ fixtureRoot: f.root, all: true, transcriptsDir: transcripts, createSession: f.createSession });
    expect(f.state.texts).toEqual(['rawpreferred']); expect(report.skippedSemantic).toBe(2);
    const loaded = loadServiceChapterVectors(f.directory);
    expect(loaded.manifest.bindings[0].source_kind).toBe('raw_colab_json');
    expect(loaded.manifest.bindings[1]).toMatchObject({ source_kind: 'raw_colab_json', has_text: false, windows: 0 });
    expect(await readFile(path.join(f.directory, 'passages.internal.yaml'), 'utf8')).toBe(f.legacy);
    await writeFile(path.join(transcripts, `${VIDEO}.json`), JSON.stringify({ video_id: OTHER, segments: [] }));
    await expect(processChapterVectors({ fixtureRoot: f.root, all: true, transcriptsDir: transcripts, createSession: f.createSession })).rejects.toThrow(/ID/u);
  });

  it('supports canonical evidence paths and exact matching without fuzzy filenames', async () => {
    const f = await fixture(), transcripts = path.join(f.root, 'private-transcripts');
    await mkdir(path.join(transcripts, VIDEO), { recursive: true });
    await writeFile(path.join(transcripts, VIDEO, 'evidence.json'), JSON.stringify({ schema_version: 1, youtube_id: VIDEO,
      segments: [{ start: 0, end: 20, text: 'segment', words: [{ start: 1, end: 2, text: 'canonicalword' }] }] }));
    await writeFile(path.join(transcripts, `prefix-${OTHER}.json`), JSON.stringify({ video_id: OTHER, segments: [{ start: 0, end: 1, text: 'mustignore' }] }));
    await processChapterVectors({ fixtureRoot: f.root, all: true, transcriptsDir: transcripts, createSession: f.createSession });
    expect(f.state.texts).toEqual(['canonicalword']);
    expect(loadServiceChapterVectors(f.directory).manifest.bindings[0].source_kind).toBe('canonical_evidence_json');
    expect(loadServiceChapterVectors(f.directory).manifest.bindings[2].has_text).toBe(false);
  });

  it('uses one extractor across services and a deterministic hash/vector-only private cache', async () => {
    const f = await fixture(), otherDirectory = path.join(f.root, 'services/2026/second-service');
    await mkdir(otherDirectory);
    await writeFile(path.join(otherDirectory, 'service.yaml'), stringify({ chapters: [chapter] }));
    await writeFile(path.join(otherDirectory, 'passages.internal.yaml'), f.legacy);
    const first = await processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession });
    expect(first).toMatchObject({ services: 2, embeddedWindows: 1, cachedWindows: 1 });
    expect(f.state.created).toBe(1); expect(f.state.disposed).toBe(1);
    const original = await readFile(path.join(f.directory, 'chapter-vectors.bin'));
    const originalManifest = await readFile(path.join(f.directory, 'chapter-vectors.json'));
    await rm(path.join(f.directory, 'chapter-vectors.bin')); await rm(path.join(f.directory, 'chapter-vectors.json'));
    const repeat = await processChapterVectors({ fixtureRoot: f.root, service: 'fixture-service', createSession: f.createSession });
    expect(repeat).toMatchObject({ embeddedWindows: 0, cachedWindows: 1 });
    expect(await readFile(path.join(f.directory, 'chapter-vectors.bin'))).toEqual(original);
    expect(await readFile(path.join(f.directory, 'chapter-vectors.json'))).toEqual(originalManifest);
    const cacheRoot = path.join(f.root, '.local/chapter-vector-cache');
    const [recipe] = await readdir(cacheRoot);
    const files = await readdir(path.join(cacheRoot, recipe));
    expect(recipe).toMatch(/^[a-f0-9]{64}$/u);
    expect(files).toHaveLength(1); expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/u);
    const cache = await readFile(path.join(cacheRoot, recipe, files[0]), 'utf8');
    expect(Object.keys(JSON.parse(cache)).sort()).toEqual(['input_sha256', 'recipe_sha256', 'vector', 'vector_sha256']);
    expect(cache).not.toMatch(/legacyspoken|secondline|chapter-a|fixture-service/u);
    // Corrupt the derived cache and remove sidecars: explicit processing must recompute.
    await writeFile(path.join(cacheRoot, recipe, files[0]), '{}');
    await rm(path.join(f.directory, 'chapter-vectors.bin'));
    await rm(path.join(f.directory, 'chapter-vectors.json'));
    const repaired = await processChapterVectors({ fixtureRoot: f.root, service: 'fixture-service', createSession: f.createSession });
    expect(repaired.embeddedWindows).toBe(1);
  });

  it.each(['bin', 'json'])('does not overwrite the surviving artifact when its %s companion is missing', async suffix => {
    const f = await fixture();
    await processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession });
    const survivor = path.join(f.directory, `chapter-vectors.${suffix === 'bin' ? 'json' : 'bin'}`);
    const before = await readFile(survivor);
    await rm(path.join(f.directory, `chapter-vectors.${suffix}`));
    await expect(processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession })).rejects.toThrow('Incomplete chapter vector pair');
    expect(await readFile(survivor)).toEqual(before);
  });
  it('never initializes a model for an entirely no-text service or substitutes chapter metadata', async () => {
    const f = await fixture();
    await rm(path.join(f.directory, 'passages.internal.yaml'));
    await expect(processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession })).rejects.toThrow('Evidence unavailable');
    const report = await processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession, allowEmpty: f.chapters.map(chapter => chapter.id) });
    expect(report).toMatchObject({ skippedSemantic: 3, windows: 0, embeddedWindows: 0 });
    expect(f.state.created).toBe(0);
    expect(loadServiceChapterVectors(f.directory).values.every((v) => v === 0)).toBe(true);
  });

  it('detects changed private input and chapter bounds on an explicit generation pass', async () => {
    const f = await fixture();
    await processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession });
    const before = loadServiceChapterVectors(f.directory).manifest;
    await writeFile(path.join(f.directory, 'passages.internal.yaml'), f.legacy.replace('legacyspoken', 'changedspoken'));
    await processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession });
    const changed = loadServiceChapterVectors(f.directory).manifest;
    expect(changed.bindings[0].input_sha256).not.toBe(before.bindings[0].input_sha256);
    await writeFile(path.join(f.directory, 'service.yaml'), stringify({ chapters: [{ ...chapter, end: 9 }, ...f.chapters.slice(1)] }));
    await expect(processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession })).rejects.toThrow('outside regrouped chapter bounds');
    await writeFile(path.join(f.directory, 'service.yaml'), stringify({ chapters: [{ ...chapter, end: 11 }, ...f.chapters.slice(1)] }));
    await processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession });
    expect(loadServiceChapterVectors(f.directory).manifest.bindings[0].input_sha256).not.toBe(changed.bindings[0].input_sha256);
  });
  it('preserves prior nonzero vectors when private evidence is absent or unexpectedly empty', async () => {
    const f = await fixture();
    await processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession });
    const binary = await readFile(path.join(f.directory, 'chapter-vectors.bin'));
    const manifest = await readFile(path.join(f.directory, 'chapter-vectors.json'));
    await rm(path.join(f.directory, 'passages.internal.yaml'));
    await expect(processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession })).rejects.toThrow('Evidence unavailable');
    expect(await readFile(path.join(f.directory, 'chapter-vectors.bin'))).toEqual(binary);
    expect(await readFile(path.join(f.directory, 'chapter-vectors.json'))).toEqual(manifest);
    await writeFile(path.join(f.directory, 'passages.internal.yaml'), f.legacy.replace('legacyspoken', '[omitted]').replace('secondline', '[omitted]'));
    await expect(processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession })).rejects.toThrow('text-bearing');
    expect(await readFile(path.join(f.directory, 'chapter-vectors.bin'))).toEqual(binary);
    await expect(processChapterVectors({ fixtureRoot: f.root, all: true, createSession: f.createSession, allowEmpty: ['chapter-a'] })).resolves.toMatchObject({ skippedSemantic: 3 });
  });
});
