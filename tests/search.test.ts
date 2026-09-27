import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { EMBEDDING_CONFIG, EMBEDDING_OPTIONS, isCompatibleEmbeddingConfig, isEmbeddingVector, MODEL_FILES, preprocessEmbedding, semanticAssetPaths } from '../site/lib/embedding-config';
import { parseFullDateQuery, search, SEARCH_WEIGHTS } from '../site/lib/search';
import { CHAPTER_VECTOR_CONFIG, decodeChapterVectors, packChapterVectors } from '../site/lib/chapter-vectors';
import { enrichChapters, parseChapterMetadata } from '../site/lib/chapter-index';
import { createSemanticClient, type SemanticRequest, type SemanticResponse, type SemanticStatus } from '../site/lib/semantic';
import type { SearchChapter } from '../site/lib/types';
import { embedTexts, prepare, sha256, verifyModelFile } from '../scripts/embeddings';

// Fictional metadata and compact vector rows; never emitted into an archive.
const fixture: SearchChapter = {
  id: 'fixture', serviceId: 'fixture-service', videoId: 'abcdefghijk', start: 60, end: 120,
  serviceTitle: 'Fixture gathering', title: 'Serving our neighbours', summary: 'Practical care and quiet generosity.',
  keywords: ['generosity', 'daily practice'], topics: ['Community'], scripture: ['Romans 12:1-2'],
  speaker: 'Example Speaker', date: '2026-09-06', type: 'sermon', preview: true,
};
function unit(index = 0): number[] { return Array.from({ length: 384 }, (_, i) => i === index ? 1 : 0); }
function vectors(indices = [0]) {
  return decodeChapterVectors(packChapterVectors(indices.map((index) => Int8Array.from(unit(index), (value) => value * 127))));
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('embedding and chapter metadata contracts', () => {
  it('shares normalization, pooling, dimensions, dtype, revision and tokenizer limits', () => {
    expect(preprocessEmbedding('  Ａ\tword\nwith   spaces  ')).toBe('A word with spaces');
    expect(EMBEDDING_OPTIONS).toEqual({ pooling: 'mean', normalize: true });
    expect(EMBEDDING_CONFIG).toMatchObject({ dtype: 'q8', dimension: 384, maxLength: 256, revision: '751bff37182d3f1213fa05d7196b954e230abad9' });
    expect(isCompatibleEmbeddingConfig(JSON.parse(JSON.stringify(EMBEDDING_CONFIG)))).toBe(true);
    for (const key of Object.keys(EMBEDDING_CONFIG)) expect(isCompatibleEmbeddingConfig({ ...EMBEDDING_CONFIG, [key]: 'different' })).toBe(false);
    expect(isEmbeddingVector(unit())).toBe(true);
    for (const vector of [unit().slice(1), Array(384).fill(0), Array(384).fill(NaN), Array(384).fill(1), null]) expect(isEmbeddingVector(vector)).toBe(false);
  });
  it('validates the full chapter recipe before a binary row can be paired with metadata', () => {
    const hash = sha256(packChapterVectors([new Int8Array(384).fill(127)]));
    const metadata = { schemaVersion: 3, model: CHAPTER_VECTOR_CONFIG, vectors: { file: `vectors.${hash}.bin`, sha256: hash }, chapters: [fixture] };
    expect(parseChapterMetadata(metadata).chapters).toEqual([fixture]);
    for (const key of Object.keys(CHAPTER_VECTOR_CONFIG)) expect(() => parseChapterMetadata({ ...metadata, model: { ...CHAPTER_VECTOR_CONFIG, [key]: 'different' } })).toThrow();
    expect(() => parseChapterMetadata({ ...metadata, chapters: [{ ...fixture, verseText: 'browser-only' }] })).toThrow();
  });
  it('builds same-origin model assets under any deployment path', () => {
    expect(semanticAssetPaths('/review/')).toEqual({ models: '/review/models/', onnx: '/review/onnx/' });
    for (const base of ['https://cdn.test/', '//cdn.test/', 'relative', '/a/../', '/a?b', '/a\\b']) expect(() => semanticAssetPaths(base)).toThrow();
  });
  it('rejects damaged model bytes even at the correct byte count', () => {
    expect(verifyModelFile(Buffer.alloc(MODEL_FILES[0].bytes), MODEL_FILES[0])).toBe(false);
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('transparent chapter ranking', () => {
  it('finds metadata immediately without BSB, vectors or a model', () => {
    expect(search([fixture], 'daily practice')[0].reasons).toEqual(['Keyword']);
    expect(search([fixture], 'quiet generosity')[0].reasons).toEqual(['Keyword', 'Summary match (exact phrase)']);
    expect(search([fixture], 'Community')[0].reasons).toEqual(['Topic match']);
    expect(search([fixture], 'Example Speaker')[0].reasons).toEqual(['Speaker match (exact phrase)']);
    expect(search([fixture], 'neighbours')[0].reasons).toEqual(['Title match']);
    expect(search([fixture], 'neigh')).toEqual([]);
  });
  it('ignores question scaffolding but preserves negation and meaningful title words', () => {
    const records = ['Daily practice', 'Not willing', 'Willing', 'Only'].map((title, i) => ({ ...fixture, id: String(i), title, keywords: [], summary: 'A musician describes practice.' }));
    expect(search(records, 'Should my daily practice matter if I am being a musician?').map((r) => r.chapter.id)).toEqual(['0']);
    expect(search(records, 'not willing').map((r) => r.chapter.id)).toEqual(['1']);
    expect(search(records, 'only')[0].chapter.id).toBe('3');
  });
  it('matches optional series as a general metadata field', () => {
    const chapter = { ...fixture, series: { id: 'orchard', name: 'Fictional orchard' } };
    expect(search([chapter], 'fictional orchard')[0].reasons).toEqual(['Series match (exact phrase)']);
    expect(search([chapter], 'orchard')[0].score).toBe(SEARCH_WEIGHTS.series * (1 + SEARCH_WEIGHTS.phraseBonus));
    expect(search([fixture], 'fictional orchard')).toEqual([]);
  });
  it('matches inflected metadata words without prefix matching or changing source text', () => {
    const chapter = { ...fixture, keywords: ['stumbling', 'gardeners'], title: 'Restoring the garden', summary: 'Plants need careful tending.' };
    for (const query of ['stumble', 'gardener', 'restore', 'plant']) expect(search([chapter], query)[0]?.chapter).toBe(chapter);
    expect(search([chapter], 'gard')).toEqual([]);
    expect(chapter.keywords).toEqual(['stumbling', 'gardeners']);
  });
  it('admits distinctive two-term metadata cues in longer questions without generic partial flooding', () => {
    const target = { ...fixture, id: 'target', title: 'Orchard pruning', summary: 'Annual care for trees.', keywords: ['orchard'], scripture: [] };
    const common = Array.from({ length: 50 }, (_, i) => ({ ...fixture, id: `other-${i}`, title: 'Annual care', summary: 'Care for our community.', keywords: [], scripture: [] }));
    expect(search([target, ...common], 'What does annual orchard pruning mean for a healthy future?')[0]?.chapter.id).toBe('target');
    expect(search([target, ...common], 'orchard unknownone unknowntwo')).toEqual([]);
  });
  it('adds hidden BSB matches only after enrichment, without mutating metadata', () => {
    const original = structuredClone(fixture);
    const [enriched] = enrichChapters([fixture], { schemaVersion: 1, references: { 'Romans 12:1-2': ['Romans 12:1'] }, verses: { 'Romans 12:1': 'living sacrifices' } });
    expect(search([fixture], 'living sacrifice')).toEqual([]);
    expect(search([enriched], 'living sacrifice')[0].reasons).toEqual(['Verse-text match (BSB)']);
    expect(fixture).toEqual(original);
  });
  it.each(['Romans 13', 'Rom 13', 'Rom13', 'ROM.13:3', 'Romans 12:21-13:2'])('prioritizes overlapping scripture for %s', (query) => {
    const referenced = { ...fixture, id: 'referenced', scripture: ['Romans 13:1-7'] };
    const other = { ...fixture, id: 'other', scripture: [], summary: 'Romans 13' };
    const result = search([other, referenced], query, { vectors: vectors([0, -1]), queryVector: unit() });
    expect(result[0].chapter.id).toBe('referenced');
    expect(result[0].reasons.some((reason) => reason.startsWith('Scripture: '))).toBe(true);
    expect(search([referenced], 'Romans 13:8')).toEqual([]);
  });
  it('keeps per-value phrase boundaries and combines field coverage', () => {
    const separated = { ...fixture, id: 'separated', keywords: ['quiet', 'generosity'], summary: '' };
    const phrase = { ...separated, id: 'phrase', keywords: ['quiet generosity'] };
    expect(search([separated, phrase], 'quiet generosity').map((r) => r.chapter.id)).toEqual(['phrase', 'separated']);
    expect(search([fixture], 'Example Speaker community')[0].reasons).toEqual(['Speaker match', 'Topic match']);
  });
  it('scores int8 cosine, skips zero rows, rejects mismatched shape and invalid query vectors', () => {
    expect(search([fixture], 'unrelated', { vectors: vectors(), queryVector: unit() })[0].reasons).toEqual(['Similar in meaning']);
    for (const index of [vectors([-1]), vectors([1]), { ...vectors(), dimension: 768 }, vectors([0, 0])]) {
      expect(search([fixture], 'unrelated', { vectors: index, queryVector: unit() })).toEqual([]);
    }
    for (const queryVector of [[1], Array(384).fill(0), Array(384).fill(NaN)]) expect(search([fixture], 'unrelated', { vectors: vectors(), queryVector })).toEqual([]);
    const near = unit().map((_, i) => i === 0 ? 0.44 : i === 1 ? Math.sqrt(1 - 0.44 ** 2) : 0);
    expect(search([fixture], 'unrelated', { vectors: vectors(), queryVector: near })).toEqual([]);
    expect(search([fixture], 'unrelated', { vectors: vectors([-1]), queryVector: unit(), semanticThreshold: 0 })).toEqual([]);
  });
  it('has honest empty results and deterministic ties with limits applied after ranking', () => {
    for (const query of ['', '  ', '?!', 'the and', 'zxqvpl']) expect(search([fixture], query)).toEqual([]);
    const chapters = [{ ...fixture, id: 'b' }, { ...fixture, id: 'a' }, { ...fixture, id: 'early', start: 1 }, { ...fixture, id: 'old', date: '2025-09-06' }];
    expect(search(chapters, 'community').map((r) => r.chapter.id)).toEqual(['early', 'a', 'b', 'old']);
    expect(search([...chapters].reverse(), 'community')).toEqual(search(chapters, 'community'));
    expect(search(chapters, 'community', { limit: 2 })).toHaveLength(2);
    expect(search(chapters, 'community', { limit: 0 })).toEqual([]);
  });
  it('reevaluates caller edits; metadata edits do not fabricate or invalidate transcript-derived rows', () => {
    const chapter = structuredClone(fixture), index = vectors();
    const options = { vectors: index, queryVector: unit() };
    chapter.summary = 'An edited public summary.'; chapter.topics = ['Orchard'];
    expect(search([chapter], 'unrelated', options)[0].reasons).toEqual(['Similar in meaning']);
    index.values[0] = 0;
    expect(search([chapter], 'unrelated', options)).toEqual([]);
    expect(search([chapter], 'orchard')[0].chapter).toBe(chapter);
    expect(Object.isFrozen(chapter)).toBe(false);
  });
});

describe('whole-query calendar scope', () => {
  it.each([['2026-07-05', '2026-07-05'], ['5 July 2026', '2026-07-05'], ['July 5, 2026', '2026-07-05'], ['  05 JUL.\n2020 ', '2020-07-05'], ['29 Feb 2000', '2000-02-29'], ['February 29, 2024', '2024-02-29'], ['1 Jan 0099', '0099-01-01']])('parses %s generically and scopes before semantics', (query, date) => {
    expect(parseFullDateQuery(query)).toBe(date);
    const target = { ...fixture, date };
    const incidental = { ...fixture, id: 'other', date: '2025-01-01', title: query };
    expect(search([incidental, target], query, { vectors: vectors([0, 0]), queryVector: unit() }).map((r) => r.chapter.id)).toEqual(['fixture']);
  });
  it.each(['2026-02-29', '29 February 1900', '31 Apr 2024', '2026-13-05', '2026-00-05', '2026-07-00', '32 July 2026', '5 Jule 2026', '5 July 0000', 'July', '2026-7-5', 'on 5 July 2026', '5 July 2026 prayer'])('keeps %s ordinary text without rolling over', (query) => {
    expect(parseFullDateQuery(query)).toBeUndefined();
    expect(search([{ ...fixture, title: query }], query)).toHaveLength(1);
  });
});

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: SemanticResponse }) => void;
  onerror?: (event: { preventDefault(): void }) => void;
  onmessageerror?: () => void;
  requests: SemanticRequest[] = []; terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: SemanticRequest) { this.requests.push(message); }
  terminate() { this.terminated = true; }
  receive(data: SemanticResponse) { this.onmessage?.({ data }); }
}
function setupClient() {
  FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker);
  const statuses: SemanticStatus[] = [];
  return { client: createSemanticClient('/review/', (state) => statuses.push(state)), statuses };
}
describe('lazy semantic client', () => {
  it('initializes only on embed and correlates out-of-order replies', async () => {
    const { client, statuses } = setupClient();
    expect(FakeWorker.instances).toHaveLength(0); expect(statuses).toEqual([{ state: 'idle' }]);
    const first = client.embed('  First\nquery '), second = client.embed('Second query');
    const worker = FakeWorker.instances[0];
    expect(worker.requests[0]).toEqual({ type: 'embed', id: 1, query: 'First query', base: '/review/' });
    worker.receive({ type: 'status', status: { state: 'loading', progress: 0.5 } });
    worker.receive({ type: 'result', id: 2, vector: unit(1) }); worker.receive({ type: 'result', id: 1, vector: unit() });
    expect(await first).toEqual(unit()); expect(await second).toEqual(unit(1));
    expect(statuses).toContainEqual({ state: 'loading', progress: 0.5 });
    client.dispose(); expect(worker.terminated).toBe(true);
  });
  it('rejects failed pending queries and retries with a fresh worker while exact search works', async () => {
    const { client, statuses } = setupClient();
    const assertions = [expect(client.embed('community')).rejects.toThrow('offline'), expect(client.embed('care')).rejects.toThrow('offline')];
    FakeWorker.instances[0].receive({ type: 'error', id: 1, message: 'offline' }); await Promise.all(assertions);
    expect(statuses.at(-1)?.state).toBe('error'); expect(search([fixture], 'community')).toHaveLength(1);
    const retry = client.embed('community'); FakeWorker.instances[1].receive({ type: 'result', id: 3, vector: unit() });
    expect(await retry).toEqual(unit()); client.dispose();
  });
  it('bounds stalled downloads and disposes pending work', async () => {
    vi.useFakeTimers(); const { client } = setupClient();
    const timedOut = expect(client.embed('care')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(120_000); await timedOut;
    const disposed = expect(client.embed('retry')).rejects.toThrow('disposed'); client.dispose(); await disposed;
    await expect(client.embed('again')).rejects.toThrow('disposed');
  });
  it('handles unavailable workers and rejects empty inputs without loading', async () => {
    const { client } = setupClient(); await expect(client.embed('   ')).rejects.toThrow('empty');
    expect(FakeWorker.instances).toHaveLength(0); vi.stubGlobal('Worker', undefined);
    await expect(client.embed('care')).rejects.toThrow(); client.dispose();
  });
});

describe.skipIf(process.env.RECS_TEST_EMBEDDINGS !== '1')('prepared real q8 model (opt-in)', () => {
  it('reuses verified cache offline and produces compatible normalized query embeddings', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('Offline check: network forbidden'); });
    const result = await prepare(); expect(result.downloadedBytes).toBe(0); expect(result.reusedBytes).toBe(23685172);
    const queryVectors = await embedTexts(['A person helps a neighbour.', '  A person\nhelps a neighbour. ', 'The spacecraft orbits a distant planet.']);
    queryVectors.forEach((vector) => expect(isEmbeddingVector(vector)).toBe(true));
    expect(queryVectors[0]).toEqual(queryVectors[1]);
    expect(queryVectors[0].reduce((sum, value, i) => sum + value * queryVectors[2][i], 0)).toBeLessThan(SEARCH_WEIGHTS.semanticThreshold);
  }, 60_000);
});

describe.skipIf(process.env.RECS_TEST_BROWSER_EMBEDDINGS !== '1')('browser WASM integration (opt-in)', () => {
  it('embeds in a real non-root worker without external requests and agrees with Node', async () => {
    const require = createRequire(import.meta.url);
    const viteEntry = require.resolve('vite', { paths: [path.dirname(require.resolve('vitest/package.json'))] });
    const { createServer } = await import(pathToFileURL(viteEntry).href);
    const { chromium } = await import('@playwright/test');
    const server = await createServer({ configFile: false, root: process.cwd(), base: '/review/', publicDir: 'site/public', server: { host: '127.0.0.1', port: 0 } });
    let browser;
    try {
      await server.listen(); const origin = new URL(server.resolvedUrls.local[0]).origin;
      browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
      const external: string[] = [], requested: string[] = [];
      await page.route('**/*', (route) => {
        const url = route.request().url(); requested.push(url);
        if (new URL(url).origin !== origin) { external.push(url); return route.abort(); }
        return route.continue();
      });
      await page.route(`${origin}/review/`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Embedding integration check</title>' }));
      await page.goto(`${origin}/review/`);
      const result = await page.evaluate<{ vector: number[]; statuses: SemanticStatus[] }>(`(async () => {
        const { createSemanticClient } = await import('/review/site/lib/semantic.ts');
        const statuses = []; const client = createSemanticClient('/review/', (status) => statuses.push(status));
        try { return { vector: await client.embed('A person helps a neighbour.'), statuses }; }
        finally { client.dispose(); }
      })()`);
      expect(isEmbeddingVector(result.vector)).toBe(true);
      expect(result.statuses.some((status) => status.state === 'ready')).toBe(true); expect(external).toEqual([]);
      expect(await page.evaluate(() => globalThis.caches.keys())).toContain(`recs-embeddings-${EMBEDDING_CONFIG.revision}-${EMBEDDING_CONFIG.dtype}`);
      expect(requested.some((url) => url.includes('/review/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx'))).toBe(true);
      expect(requested.some((url) => url.includes('/review/onnx/') && url.endsWith('.wasm'))).toBe(true);
      const [nodeVector] = await embedTexts(['A person helps a neighbour.']);
      expect(nodeVector.reduce((sum, value, i) => sum + value * result.vector[i], 0)).toBeGreaterThan(0.999);
    } finally { await browser?.close(); await server.close(); }
  }, 120_000);
});
