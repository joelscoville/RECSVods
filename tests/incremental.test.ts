import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVectors, compareVectorIndexes, sha256, verifyVectors } from '../scripts/embeddings';
import { EMBEDDING_CONFIG } from '../site/lib/embedding-config';
import { flattenArchive, SOURCE_CHANNEL_ID, type Service } from '../site/lib/archive';
import { buildEmbeddingDocument } from '../site/lib/search';
import type { SearchPassage } from '../site/lib/types';

const roots: string[] = [];
const modelHash = sha256(JSON.stringify(EMBEDDING_CONFIG));
const fixture: SearchPassage = {
  id: 'fictional-passage', serviceId: 'fictional-service', serviceTitle: 'Fictional service',
  videoId: 'AAAAAAAAAAA', start: 0, end: 60, title: 'Fictional title',
  summary: 'A fictional summary for indexing tests.', transcript: 'FICTIONAL UNREVIEWED TRANSCRIPT SENTINEL',
  questions: [], topics: [], scripture: [], date: '2026-01-04', type: 'address', preview: true,
};
// Only unit fixtures use these deterministic numbers; no application/CLI fallback encoder.
function fixtureVector(text: string): number[] {
  const bytes = Buffer.from(sha256(text), 'hex');
  const values = Array.from({ length: EMBEDDING_CONFIG.dimension }, (_, i) => bytes[i % bytes.length] - 128);
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
}
function encoder() { return vi.fn(async (texts: readonly string[]) => texts.map(fixtureVector)); }
async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'recs-incremental-test-'));
  roots.push(directory);
  await mkdir(path.join(directory, 'site/public/generated'), { recursive: true });
  return directory;
}
function generated(directory: string, filename = 'vectors.json') { return path.join(directory, 'site/public/generated', filename); }
async function input(directory: string, passages: SearchPassage[]) {
  await writeFile(generated(directory, 'passages.json'), `${JSON.stringify(passages)}\n`);
}
function cacheDirectory(directory: string) { return path.join(directory, '.local/index-cache', modelHash); }
function cacheFile(directory: string, passage = fixture) {
  const key = sha256(JSON.stringify([EMBEDDING_CONFIG, buildEmbeddingDocument(passage)]));
  return path.join(cacheDirectory(directory), `${key}.json`);
}
async function noPublishedVector(directory: string) {
  await expect(readFile(generated(directory))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await readdir(path.dirname(generated(directory)))).filter((name) => name.startsWith('vectors.'))).toEqual([]);
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unit fixtures must not download a model'); }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('content-addressed incremental vectors', () => {
  it('reuses unchanged input with zero encoder calls and preserves exact public bytes', async () => {
    const directory = await root(), encode = encoder();
    await input(directory, [fixture]);
    const first = await buildVectors(directory, { encode });
    const bytes = await readFile(generated(directory), 'utf8');
    expect(encode).toHaveBeenCalledOnce();
    expect(encode.mock.calls[0][0]).toEqual([buildEmbeddingDocument(fixture)]);
    encode.mockClear();
    expect(await buildVectors(directory, { encode })).toEqual(first);
    expect(await readFile(generated(directory), 'utf8')).toBe(bytes);
    expect(encode).not.toHaveBeenCalled();
    const cached = await readFile(cacheFile(directory), 'utf8');
    expect(Object.keys(JSON.parse(cached)).sort()).toEqual(['documentHash', 'modelHash', 'schemaVersion', 'vector', 'vectorSha256']);
    for (const secret of [fixture.transcript, fixture.title, fixture.id, fixture.serviceId]) expect(cached).not.toContain(secret);
    expect(await readdir(cacheDirectory(directory))).toHaveLength(1);
    expect(await readdir(path.join(directory, '.local/index-staging'))).toEqual([]);
    expect(await readdir(path.join(directory, 'site/public'))).toEqual(['generated']);
  });

  it('encodes only one changed input and drops removed IDs without stale vectors', async () => {
    const directory = await root(), encode = encoder();
    const second = { ...fixture, id: 'second', transcript: 'Another fictional input.' };
    await input(directory, [fixture, second]);
    await buildVectors(directory, { encode });
    encode.mockClear();
    const changed = { ...second, transcript: 'Changed fictional input.' };
    await input(directory, [fixture, changed]);
    const index = await buildVectors(directory, { encode });
    expect(encode).toHaveBeenCalledOnce();
    expect(encode.mock.calls[0][0]).toEqual([buildEmbeddingDocument(changed)]);
    expect(index.vectors.second.document).toBe(buildEmbeddingDocument(changed));
    encode.mockClear();
    await input(directory, [changed]);
    expect(Object.keys((await buildVectors(directory, { encode })).vectors)).toEqual(['second']);
    expect(encode).not.toHaveBeenCalled();
    expect(await readFile(generated(directory), 'utf8')).not.toContain(fixture.transcript);
    await input(directory, []);
    expect((await buildVectors(directory, { encode })).vectors).toEqual({});
    expect(encode).not.toHaveBeenCalled();
  });

  it('reuses normalized documents and exact-only metadata changes, while rebinding the source digest', async () => {
    const directory = await root(), encode = encoder();
    await input(directory, [fixture]);
    const first = await buildVectors(directory, { encode });
    encode.mockClear();
    const changed = { ...fixture, date: '2026-01-11', serviceTitle: 'Changed service metadata', speaker: 'Fictional speaker',
      transcript: `  ${fixture.transcript.replaceAll(' ', '\n')}  `, title: 'Ｆictional title' };
    expect(buildEmbeddingDocument(changed)).toBe(buildEmbeddingDocument(fixture));
    await input(directory, [changed]);
    const next = await buildVectors(directory, { encode });
    expect(next.vectors).toEqual(first.vectors);
    expect(next.passagesSha256).not.toBe(first.passagesSha256);
    expect(encode).not.toHaveBeenCalled();
  });

  it.each(['title', 'summary', 'transcript', 'verseText', 'questions', 'topics', 'scripture'] as const)(
    'invalidates changes to embedding input %s', async (field) => {
      const directory = await root(), encode = encoder();
      await input(directory, [fixture]);
      await buildVectors(directory, { encode });
      encode.mockClear();
      const changed = { ...fixture, [field]: ['questions', 'topics', 'scripture'].includes(field)
        ? [field === 'scripture' ? 'Romans 13:1-7' : 'Changed fictional text'] : 'Changed fictional text' };
      await input(directory, [changed]);
      await buildVectors(directory, { encode });
      expect(encode).toHaveBeenCalledOnce();
      expect(encode.mock.calls[0][0]).toEqual([buildEmbeddingDocument(changed)]);
    });

  it('deduplicates identical inputs for distinct IDs, including a newly added ID', async () => {
    const directory = await root(), encode = encoder();
    await input(directory, [fixture, { ...fixture, id: 'second' }]);
    const index = await buildVectors(directory, { encode });
    expect(encode.mock.calls[0][0]).toHaveLength(1);
    expect(index.vectors.second).toEqual(index.vectors[fixture.id]);
    encode.mockClear();
    await input(directory, [{ ...fixture, id: 'third' }]);
    expect(Object.keys((await buildVectors(directory, { encode })).vectors)).toEqual(['third']);
    expect(encode).not.toHaveBeenCalled();
  });

  it.each(['invalid-json', 'null', 'schema', 'model', 'document', 'checksum', 'dimension', 'norm', 'nonfinite', 'normalized-tamper'])(
    'recomputes safely after cache corruption: %s', async (kind) => {
      const directory = await root(), encode = encoder();
      await input(directory, [fixture]);
      const expected = await buildVectors(directory, { encode });
      const file = cacheFile(directory), original = await readFile(file, 'utf8');
      const entry = JSON.parse(original);
      if (kind === 'schema') entry.schemaVersion = 2;
      if (kind === 'model') entry.modelHash = sha256('other-model');
      if (kind === 'document') entry.documentHash = sha256('other-document');
      if (kind === 'checksum') entry.vectorSha256 = '0'.repeat(64);
      if (kind === 'dimension') entry.vector.pop();
      if (kind === 'norm') entry.vector = entry.vector.map(() => 0);
      if (kind === 'nonfinite') entry.vector[0] = Infinity;
      if (kind === 'normalized-tamper') entry.vector = entry.vector.map((value: number) => -value);
      await writeFile(file, kind === 'invalid-json' ? '{broken' : kind === 'null' ? 'null' : JSON.stringify(entry));
      encode.mockClear();
      expect(await buildVectors(directory, { encode })).toEqual(expected);
      expect(encode).toHaveBeenCalledOnce();
      expect(await readFile(file, 'utf8')).toBe(original);
    });

  it('invalidates the namespace when the shared model configuration changes', async () => {
    const directory = await root(), encode = encoder();
    await input(directory, [fixture]);
    await buildVectors(directory, { encode });
    encode.mockClear();
    vi.doMock('../site/lib/embedding-config', async (importOriginal) => ({
      ...await importOriginal<typeof import('../site/lib/embedding-config')>(),
      EMBEDDING_CONFIG: Object.freeze({ ...EMBEDDING_CONFIG, revision: 'b'.repeat(40) }),
    }));
    vi.resetModules();
    try {
      const revised = await import('../scripts/embeddings');
      const index = await revised.buildVectors(directory, { encode });
      expect(index.model.revision).toBe('b'.repeat(40));
      expect(encode).toHaveBeenCalledOnce();
      expect(await readdir(path.join(directory, '.local/index-cache'))).toHaveLength(2);
    } finally { vi.doUnmock('../site/lib/embedding-config'); vi.resetModules(); }
  });

  it('rejects private-directory symlinks into public before writing cache data', async () => {
    const directory = await root(), encode = encoder();
    await input(directory, [fixture]);
    await symlink(path.join(directory, 'site/public'), path.join(directory, '.local'));
    await expect(buildVectors(directory, { encode })).rejects.toThrow('symlinks');
    expect(await readdir(path.join(directory, 'site/public'))).toEqual(['generated']);
    expect(encode).not.toHaveBeenCalled();
    await noPublishedVector(directory);
  });
});

describe('publication, full rebuilding, and failure cleanup', () => {
  it('uses only current upstream mode-filtered passages, even with a warm preview cache', async () => {
    const directory = await root(), encode = encoder();
    const service: Service = {
      id: 'fictional-service', date: fixture.date, title: fixture.serviceTitle, type: 'service',
      workflow_status: 'complete', editorial_status: 'needs_review', review_notes: [], speakers: [], topics: [],
      videos: [{ id: fixture.videoId, channel_id: SOURCE_CHANNEL_ID, duration: 120, sequence: 1,
        workflow_status: 'complete', media_disposition: 'playable' }],
      sections: [{ id: 'fictional-section', video_id: fixture.videoId, start: 0, end: 60,
        type: 'address', title: fixture.title, confidence: 0.8, review_notes: [] }],
      passages: [{ id: fixture.id, section_id: 'fictional-section', video_id: fixture.videoId,
        start: 0, end: 60, type: 'address', title: fixture.title, summary: fixture.summary, transcript: fixture.transcript,
        questions: [], topics: [], scripture: [], confidence: 0.8, review_notes: [] }],
    };
    await input(directory, flattenArchive([service], 'preview'));
    await buildVectors(directory, { encode });
    encode.mockClear();
    await input(directory, flattenArchive([service], 'production'));
    expect((await buildVectors(directory, { encode })).vectors).toEqual({});
    expect(await readFile(generated(directory), 'utf8')).not.toContain(fixture.transcript);
    // Approval here is fictional fixture state only, never an archive source edit.
    service.editorial_status = 'reviewed';
    service.reviewed_by = 'Fictional reviewer'; service.reviewed_at = '2026-01-05T00:00:00Z';
    await input(directory, flattenArchive([service], 'production'));
    expect(Object.keys((await buildVectors(directory, { encode })).vectors)).toEqual([fixture.id]);
    expect(encode).not.toHaveBeenCalled();
    for (const disposition of ['unassessed', 'failed', 'rejected'] as const) {
      service.videos[0].media_disposition = disposition;
      for (const mode of ['production', 'preview'] as const) {
        await input(directory, flattenArchive([service], mode));
        expect((await buildVectors(directory, { encode })).vectors).toEqual({});
      }
    }
  });

  it('full mode ignores cache bytes, encodes every ID, and does not seed or repair the cache', async () => {
    const directory = await root(), encode = encoder();
    await input(directory, [fixture, { ...fixture, id: 'second' }]);
    const full = await buildVectors(directory, { encode, full: true });
    expect(encode.mock.calls[0][0]).toHaveLength(2);
    await expect(readdir(cacheDirectory(directory))).rejects.toMatchObject({ code: 'ENOENT' });
    const incremental = await buildVectors(directory, { encode });
    expect(compareVectorIndexes(incremental, full, 0).byteIdentical).toBe(true);
    await writeFile(cacheFile(directory), 'broken cache');
    encode.mockClear();
    expect(await buildVectors(directory, { encode, full: true })).toEqual(full);
    expect(encode.mock.calls[0][0]).toHaveLength(2);
    expect(await readFile(cacheFile(directory), 'utf8')).toBe('broken cache');
  });

  it('verifies incremental/full equivalence before publishing and reports exact CPU-fixture equality', async () => {
    const directory = await root(), encode = encoder();
    await input(directory, [fixture]);
    await buildVectors(directory, { encode });
    const previous = await readFile(generated(directory), 'utf8');
    encode.mockClear();
    const report = await verifyVectors(directory, { encode });
    expect(report).toEqual({ passages: 1, byteIdentical: true, maxAbsoluteDifference: 0, tolerance: 1e-6 });
    expect(encode).toHaveBeenCalledOnce(); // Only the mandatory fresh full pass.
    expect(await readFile(generated(directory), 'utf8')).toBe(previous);
    const wrong = vi.fn(async (texts: readonly string[]) => texts.map(() => fixtureVector('Different fictional model result')));
    await expect(verifyVectors(directory, { encode: wrong })).rejects.toThrow('beyond tolerance');
    await noPublishedVector(directory);
  });

  it('compares numerical tolerance while rejecting document, ID, source, and config drift', async () => {
    const directory = await root();
    await input(directory, [fixture]);
    const full = await buildVectors(directory, { encode: encoder(), full: true });
    const close = structuredClone(full);
    close.vectors[fixture.id].vector[0] += 1e-8;
    expect(compareVectorIndexes(close, full).byteIdentical).toBe(false);
    expect(() => compareVectorIndexes(close, full, 0)).toThrow('beyond tolerance');
    for (const tolerance of [-1, Infinity, NaN]) expect(() => compareVectorIndexes(full, full, tolerance)).toThrow('tolerance');
    const document = structuredClone(full); document.vectors[fixture.id].document += ' changed';
    expect(() => compareVectorIndexes(document, full)).toThrow('document');
    expect(() => compareVectorIndexes({ ...full, vectors: {} }, full)).toThrow('IDs');
    expect(() => compareVectorIndexes({ ...full, passagesSha256: 'other-source' }, full)).toThrow('metadata');
    const wrongModel = { ...full.model, revision: 'other-model' } as unknown as typeof EMBEDDING_CONFIG;
    expect(() => compareVectorIndexes({ ...full, model: wrongModel }, full)).toThrow('metadata');
  });

  it('cleans interrupted private and legacy public partials and leaves no stale output on encoder abort', async () => {
    const directory = await root();
    await input(directory, [fixture]);
    await buildVectors(directory, { encode: encoder() });
    await writeFile(generated(directory, 'vectors.json.123.partial'), 'old preview partial');
    const staging = path.join(directory, '.local/index-staging');
    await writeFile(path.join(staging, 'vectors.interrupted.partial'), 'old preview private stage');
    await input(directory, [{ ...fixture, transcript: 'Changed fictional input' }]);
    const abort = vi.fn(async () => {
      await noPublishedVector(directory);
      expect(await readdir(staging)).toEqual([]);
      throw new Error('Fixture encoder interrupted');
    });
    await expect(buildVectors(directory, { encode: abort })).rejects.toThrow('interrupted');
    await noPublishedVector(directory);
    expect(await readdir(staging)).toEqual([]);
    expect((await readdir(cacheDirectory(directory))).some((name) => name.endsWith('.partial'))).toBe(false);
    await buildVectors(directory, { encode: encoder() });
    expect(await readFile(generated(directory), 'utf8')).not.toContain(fixture.transcript);
  });

  it('cleans staged output when the source changes during inference', async () => {
    const directory = await root();
    await input(directory, [fixture]);
    const encode = vi.fn(async (texts: readonly string[]) => {
      await input(directory, []);
      return texts.map(fixtureVector);
    });
    await expect(buildVectors(directory, { encode })).rejects.toThrow('input changed');
    await noPublishedVector(directory);
    expect(await readdir(path.join(directory, '.local/index-staging'))).toEqual([]);
    expect((await buildVectors(directory, { encode })).vectors).toEqual({});
  });

  it.each(['missing', 'malformed', 'duplicate', 'invalid-encoder', 'wrong-count'])(
    'fails closed without poisoning the cache: %s', async (kind) => {
      const directory = await root();
      await writeFile(generated(directory), 'stale preview vectors');
      if (kind !== 'missing') await input(directory, kind === 'duplicate' ? [fixture, fixture] : [fixture]);
      if (kind === 'malformed') await writeFile(generated(directory, 'passages.json'), '{}');
      const encode = vi.fn(async () => kind === 'wrong-count' ? [] : [[0, 1]]);
      await expect(buildVectors(directory, { encode })).rejects.toThrow();
      await noPublishedVector(directory);
      const entries = await readdir(cacheDirectory(directory)).catch(() => []);
      expect(entries).toEqual([]);
      expect(await readdir(path.join(directory, '.local/index-staging'))).toEqual([]);
    });
});
