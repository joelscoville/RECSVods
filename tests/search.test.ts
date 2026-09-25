import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { EMBEDDING_CONFIG, EMBEDDING_OPTIONS, isCompatibleEmbeddingConfig, isEmbeddingVector, MODEL_FILES, preprocessEmbedding, semanticAssetPaths } from '../site/lib/embedding-config';
import { buildEmbeddingDocument, search, SEARCH_WEIGHTS, type VectorIndex } from '../site/lib/search';
import { createSemanticClient, type SemanticRequest, type SemanticResponse, type SemanticStatus } from '../site/lib/semantic';
import type { SearchPassage } from '../site/lib/types';
import { buildVectors, embedTexts, prepare, sha256, verifyModelFile } from '../scripts/embeddings';
import { enrichPassages } from '../bible/enrich';

// Fictional test data only; never emitted into an archive or public build.
const fixture: SearchPassage = {
  id: 'fixture', serviceId: 'fixture-service', videoId: 'abcdefghijk', start: 60, end: 120,
  serviceTitle: 'Fixture gathering', title: 'Serving our neighbours', summary: 'A fixture summary about practical care.',
  questions: ['How can we help others?'], topics: ['Community'], scripture: ['Romans 12:1-2'],
  transcript: 'The fixture speaker discusses quiet generosity and practical service.',
  speaker: 'Example Speaker', date: '2026-09-06', type: 'sermon', preview: true,
};
function unit(index = 0): number[] { return Array.from({ length: 384 }, (_, i) => i === index ? 1 : 0); }
function vectorIndex(passages = [fixture], vector = unit()): VectorIndex {
  return { schemaVersion: 1, model: EMBEDDING_CONFIG, passagesSha256: 'test-only',
    vectors: Object.fromEntries(passages.map((p) => [p.id, { document: buildEmbeddingDocument(p), vector }])),
  };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('embedding contract', () => {
  it('constructs only the requested document fields in stable order without mutating display data', () => {
    const original = structuredClone(fixture);
    expect(buildEmbeddingDocument(fixture)).toBe('Serving our neighbours A fixture summary about practical care. How can we help others? Community Romans 12:1-2 The fixture speaker discusses quiet generosity and practical service.');
    expect(fixture).toEqual(original);
    expect(buildEmbeddingDocument(fixture)).not.toContain(fixture.speaker);
    expect(buildEmbeddingDocument(fixture)).not.toContain('query:');
  });
  it('shares normalization, pooling, dimensions, dtype, revision and tokenizer limits', () => {
    expect(preprocessEmbedding('  Ａ\tword\nwith   spaces  ')).toBe('A word with spaces');
    expect(preprocessEmbedding(preprocessEmbedding(' A\nB '))).toBe('A B');
    expect(EMBEDDING_OPTIONS).toEqual({ pooling: 'mean', normalize: true });
    expect(EMBEDDING_CONFIG).toMatchObject({ dtype: 'q8', dimension: 384, maxLength: 256, revision: '751bff37182d3f1213fa05d7196b954e230abad9' });
    expect(isCompatibleEmbeddingConfig(JSON.parse(JSON.stringify(EMBEDDING_CONFIG)))).toBe(true);
    for (const key of Object.keys(EMBEDDING_CONFIG)) expect(isCompatibleEmbeddingConfig({ ...EMBEDDING_CONFIG, [key]: 'different' })).toBe(false);
    expect(isEmbeddingVector(unit())).toBe(true);
    for (const vector of [unit().slice(1), Array(384).fill(0), Array(384).fill(NaN), Array(384).fill(1), null]) expect(isEmbeddingVector(vector)).toBe(false);
  });
  it('builds same-origin assets under any deployment path', () => {
    expect(semanticAssetPaths('/')).toEqual({ models: '/models/', onnx: '/onnx/' });
    expect(semanticAssetPaths('/review/')).toEqual({ models: '/review/models/', onnx: '/review/onnx/' });
    for (const base of ['https://cdn.test/', '//cdn.test/', 'relative', '/a/../', '/a?b', '/a\\b']) expect(() => semanticAssetPaths(base)).toThrow();
  });
  it('rejects a damaged cached model file even when its byte count is correct', () => {
    expect(verifyModelFile(Buffer.alloc(MODEL_FILES[0].bytes), MODEL_FILES[0])).toBe(false);
    expect(verifyModelFile(Buffer.from('{}'), MODEL_FILES[0])).toBe(false);
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('transparent hybrid ranking', () => {
  it('finds singular living sacrifice through actual BSB enrichment, with an honest hidden-text reason', () => {
    const [enriched] = enrichPassages([{ ...fixture, scripture: ['Romans 12:1'] }]);
    expect(search([fixture], 'living sacrifice')).toEqual([]);
    const result = search([enriched], 'living sacrifice')[0];
    expect(result.reasons).toEqual(['Verse-text match (BSB)']);
    expect(result.score).toBe(SEARCH_WEIGHTS.verseText * (1 + SEARCH_WEIGHTS.phraseBonus));
    expect(enriched.transcript).toBe(fixture.transcript);
    expect(buildEmbeddingDocument(enriched)).toContain(enriched.verseText);
    expect(search([enriched], 'unrelated', { vectors: vectorIndex(), queryVector: unit() })).toEqual([]);
  });
  it.each(['Romans 13', 'Rom 13', 'Rom13', 'ROM.13:3', 'Romans 12:21-13:2'])('finds overlapping canonical scripture for %s ahead of hidden text and semantics', (query) => {
    const referenced = { ...fixture, id: 'referenced', scripture: ['Romans 13:1-7'] };
    const other = { ...fixture, id: 'other', scripture: [], verseText: 'Romans 13', transcript: 'Romans 13' };
    const results = search([other, referenced], query, { vectors: vectorIndex([other]), queryVector: unit() });
    expect(results[0].passage.id).toBe('referenced');
    expect(results[0].reasons).toContain('Scripture match (reference)');
    expect(search([referenced], 'Romans 13:8')).toEqual([]);
  });
  it('reports only fields containing the query, and works without embeddings', () => {
    const result = search([fixture], 'quiet generosity')[0];
    expect(result.reasons).toEqual(['Transcript match (exact phrase)']);
    expect(result.score).toBe(SEARCH_WEIGHTS.transcript * (1 + SEARCH_WEIGHTS.phraseBonus));
    expect(search([fixture], 'Community')[0].reasons).toEqual(['Topic match']);
    expect(search([fixture], 'help others')[0].reasons).toEqual(['Question match (exact phrase)']);
    expect(search([fixture], 'Example Speaker')[0].reasons).toEqual(['Speaker match (exact phrase)', 'Transcript match']);
  });
  it.each(['2026-09-06', '6 September 2026', 'September 6 2026', '6 Sep 2026'])('matches the date %s', (query) => {
    expect(search([fixture], query)[0].reasons).toEqual(['Date match (exact phrase)']);
  });
  it.each([
    ['Example Speaker', { speaker: 'Someone Else', transcript: 'Example Speaker' }],
    ['2026-09-06', { date: '2025-01-01', transcript: '2026-09-06' }],
    ['Romans 12:1-2', { scripture: [], transcript: 'Romans 12:1-2' }],
  ])('prioritizes metadata over transcript and semantic similarity for %s', (query, changes) => {
    const other = { ...fixture, ...changes, id: 'other' };
    const vectors = vectorIndex([other]);
    expect(search([other, fixture], query, { vectors, queryVector: unit() })[0].passage.id).toBe(fixture.id);
  });
  it('rewards an exact phrase more than separated words and avoids substring matches', () => {
    const separated = { ...fixture, id: 'separated', transcript: 'Quiet acts of generosity.' };
    expect(search([separated, fixture], 'quiet generosity').map((r) => r.passage.id)).toEqual(['fixture', 'separated']);
    expect(search([fixture], 'generous')).toEqual([]);
    expect(search([{ ...fixture, scripture: ['Romans 12:10'] }], '12:1')).toEqual([]);
  });
  it('supports mixed metadata and topic terms across fields', () => {
    expect(search([fixture], 'Example Speaker community')[0].reasons).toEqual(['Speaker match', 'Topic match', 'Transcript match']);
  });
  it('has honest empty results for empty, stop-word-only, unrelated and weak semantic queries', () => {
    for (const query of ['', '  ', '?!', 'the and', 'zxqvpl']) expect(search([fixture], query)).toEqual([]);
    expect(search([fixture], 'zxqvpl', { vectors: vectorIndex(), queryVector: unit(1) })).toEqual([]);
    expect(search([], 'community')).toEqual([]);
  });
  it('adds semantic reasons only for compatible, normalized, current vectors above threshold', () => {
    const vectors = vectorIndex();
    expect(search([fixture], 'unrelated', { vectors, queryVector: unit() })[0].reasons).toEqual(['Semantic similarity']);
    const near = unit().map((_, i) => i === 0 ? 0.44 : i === 1 ? Math.sqrt(1 - 0.44 ** 2) : 0);
    expect(search([fixture], 'unrelated', { vectors, queryVector: near })).toEqual([]);
    expect(search([fixture], 'community', { vectors, queryVector: unit(1), semanticThreshold: 0 })[0].reasons).not.toContain('Semantic similarity');
    const wrongConfig = { ...vectors, model: { ...EMBEDDING_CONFIG, dimension: 768 } } as unknown as VectorIndex;
    const stale = { ...fixture, summary: 'An edited summary.' };
    const invalid = { ...vectors, vectors: { fixture: { document: buildEmbeddingDocument(fixture), vector: [1, 0] } } };
    for (const options of [{ vectors }, { vectors, queryVector: [1] }, { vectors: wrongConfig, queryVector: unit() }, { vectors: invalid, queryVector: unit() }]) {
      expect(search([fixture], 'community', options)[0].reasons).not.toContain('Semantic similarity');
    }
    expect(search([stale], 'community', { vectors, queryVector: unit() })[0].reasons).not.toContain('Semantic similarity');
  });
  it('orders ties deterministically independent of input order and supports a limit', () => {
    const a = { ...fixture, id: 'a' };
    const b = { ...fixture, id: 'b' };
    const earlier = { ...fixture, id: 'earlier', start: 1 };
    const old = { ...fixture, id: 'old', date: '2025-09-06' };
    const passages = [b, old, a, earlier];
    expect(search(passages, 'community').map((r) => r.passage.id)).toEqual(['earlier', 'a', 'b', 'old']);
    expect(search([...passages].reverse(), 'community')).toEqual(search(passages, 'community'));
    expect(search(passages, 'community', { limit: 2 })).toHaveLength(2);
    expect(search(passages, 'community', { limit: 0 })).toEqual([]);
  });
});

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: SemanticResponse }) => void;
  onerror?: (event: { preventDefault(): void }) => void;
  onmessageerror?: () => void;
  requests: SemanticRequest[] = [];
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: SemanticRequest) { this.requests.push(message); }
  terminate() { this.terminated = true; }
  receive(data: SemanticResponse) { this.onmessage?.({ data }); }
}
function setupClient() {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  const statuses: SemanticStatus[] = [];
  return { client: createSemanticClient('/review/', (state) => statuses.push(state)), statuses };
}
describe('lazy semantic client', () => {
  it('initializes only on embed, forwards download progress, and correlates concurrent requests', async () => {
    const { client, statuses } = setupClient();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(statuses).toEqual([{ state: 'idle' }]);
    const first = client.embed('  First\nquery ');
    const second = client.embed('Second query');
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    expect(worker.requests[0]).toEqual({ type: 'embed', id: 1, query: 'First query', base: '/review/' });
    worker.receive({ type: 'status', status: { state: 'loading', progress: 0.5 } });
    worker.receive({ type: 'status', status: { state: 'ready', progress: 1 } });
    worker.receive({ type: 'result', id: 2, vector: unit(1) });
    worker.receive({ type: 'result', id: 1, vector: unit() });
    expect(await first).toEqual(unit());
    expect(await second).toEqual(unit(1));
    expect(statuses).toContainEqual({ state: 'loading', progress: 0.5 });
    expect(statuses.at(-1)?.state).toBe('ready');
    client.dispose();
    expect(worker.terminated).toBe(true);
  });
  it('rejects failed pending queries, retains lexical search, and retries with a fresh worker', async () => {
    const { client, statuses } = setupClient();
    const first = client.embed('community');
    const second = client.embed('care');
    const assertions = [expect(first).rejects.toThrow('offline'), expect(second).rejects.toThrow('offline')];
    FakeWorker.instances[0].receive({ type: 'error', id: 1, message: 'offline' });
    await Promise.all(assertions);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(statuses.at(-1)?.state).toBe('error');
    expect(search([fixture], 'community')).toHaveLength(1);
    const retry = client.embed('community');
    FakeWorker.instances[1].receive({ type: 'result', id: 3, vector: unit() });
    expect(await retry).toEqual(unit());
    client.dispose();
  });
  it('bounds stalled downloads and disposes pending work', async () => {
    vi.useFakeTimers();
    const { client } = setupClient();
    const timedOut = expect(client.embed('care')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(120_000);
    await timedOut;
    const disposed = expect(client.embed('retry')).rejects.toThrow('disposed');
    client.dispose();
    await disposed;
    await expect(client.embed('again')).rejects.toThrow('disposed');
  });
  it('handles unavailable workers and rejects empty inputs without loading', async () => {
    const { client } = setupClient();
    await expect(client.embed('   ')).rejects.toThrow('empty');
    expect(FakeWorker.instances).toHaveLength(0);
    vi.stubGlobal('Worker', undefined);
    await expect(client.embed('care')).rejects.toThrow();
    client.dispose();
  });
});

describe('generated index', () => {
  it('replaces stale vectors for zero passages without downloading or initializing a model', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'recs-search-test-'));
    const directory = path.join(root, 'site/public/generated');
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'passages.json'), '[]\n');
      await writeFile(path.join(directory, 'vectors.json'), 'stale preview vectors');
      const network = vi.fn(() => { throw new Error('Unexpected download'); });
      vi.stubGlobal('fetch', network);
      const result = await buildVectors(root);
      expect(result).toEqual({ schemaVersion: 1, model: EMBEDDING_CONFIG, passagesSha256: sha256('[]\n'), vectors: {} });
      expect(JSON.parse(await readFile(path.join(directory, 'vectors.json'), 'utf8'))).toEqual(result);
      expect(network).not.toHaveBeenCalled();
      await writeFile(path.join(directory, 'passages.json'), '{}');
      await expect(buildVectors(root)).rejects.toThrow('array');
      await expect(readFile(path.join(directory, 'vectors.json'))).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe.skipIf(process.env.RECS_TEST_EMBEDDINGS !== '1')('prepared real q8 model (opt-in)', () => {
  it('ranks a government question against synthetic passages using real BSB-enriched embeddings', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('Offline check: network forbidden'); });
    const passages = enrichPassages([
      { ...fixture, id: 'civic-fixture', title: 'Synthetic civic discussion',
        summary: 'The fictional speaker discusses Christian responsibilities toward governing authorities.',
        questions: [], topics: [], scripture: ['Rom 13:1-7'], transcript: 'A synthetic discussion of civic responsibilities.' },
      { ...fixture, id: 'care-fixture', scripture: ['Romans 12:1-2'] },
      { ...fixture, id: 'creation-fixture', title: 'Synthetic creation discussion', summary: 'A fictional discussion about the natural world.', questions: [], topics: [], scripture: ['Genesis 1:1-5'], transcript: 'A synthetic discussion of creation.' },
      { ...fixture, id: 'travel-fixture', title: 'Synthetic journey discussion', summary: 'A fictional discussion about journeys.', questions: [], topics: [], scripture: [], transcript: 'A synthetic discussion of travel logistics.' },
    ]);
    const query = 'How should Christians relate to government?';
    const [queryVector, ...vectors] = await embedTexts([query, ...passages.map(buildEmbeddingDocument)]);
    const index: VectorIndex = { schemaVersion: 1, model: EMBEDDING_CONFIG, passagesSha256: 'synthetic-only',
      vectors: Object.fromEntries(passages.map((passage, i) => [passage.id, { document: buildEmbeddingDocument(passage), vector: vectors[i] }])) };
    const results = search(passages, query, { queryVector, vectors: index });
    expect(results.slice(0, 3).map((result) => result.passage.id)).toContain('civic-fixture');
    expect(results.find((result) => result.passage.id === 'civic-fixture')?.reasons).toContain('Semantic similarity');
  }, 60_000);
  it('reuses source-verified cached files offline and produces compatible normalized embeddings', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('Offline check: network forbidden'); });
    const result = await prepare();
    expect(result.downloadedBytes).toBe(0);
    expect(result.reusedBytes).toBe(23685172);
    const texts = ['A person helps a neighbour.', '  A person\nhelps a neighbour. ', 'The spacecraft orbits a distant planet.'];
    const vectors = await embedTexts(texts);
    vectors.forEach((vector) => expect(isEmbeddingVector(vector)).toBe(true));
    expect(vectors[0]).toEqual(vectors[1]);
    const similarity = vectors[0].reduce((sum, value, i) => sum + value * vectors[2][i], 0);
    expect(similarity).toBeLessThan(SEARCH_WEIGHTS.semanticThreshold);
  }, 60_000);
});

describe.skipIf(process.env.RECS_TEST_BROWSER_EMBEDDINGS !== '1')('browser WASM integration (opt-in; requires Playwright Chromium)', () => {
  it('embeds in a real worker at a non-root base with no external requests and agrees with Node', async () => {
    const require = createRequire(import.meta.url);
    const viteEntry = require.resolve('vite', { paths: [path.dirname(require.resolve('vitest/package.json'))] });
    const { createServer } = await import(pathToFileURL(viteEntry).href);
    const { chromium } = await import('@playwright/test');
    const server = await createServer({ configFile: false, root: process.cwd(), base: '/review/', publicDir: 'site/public', server: { host: '127.0.0.1', port: 0 } });
    let browser;
    try {
      await server.listen();
      const origin = new URL(server.resolvedUrls.local[0]).origin;
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const external: string[] = [];
      const requested: string[] = [];
      await page.route('**/*', (route) => {
        const url = route.request().url();
        requested.push(url);
        if (new URL(url).origin !== origin) { external.push(url); return route.abort(); }
        return route.continue();
      });
      // A blank served document; no product UI or content fixture is created.
      await page.route(`${origin}/review/`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Embedding integration check</title>' }));
      await page.goto(`${origin}/review/`);
      // Keep native browser import outside Vitest's SSR import transformation.
      const result = await page.evaluate<{ vector: number[]; statuses: SemanticStatus[] }>(`(async () => {
        const { createSemanticClient } = await import('/review/site/lib/semantic.ts');
        const statuses = [];
        const client = createSemanticClient('/review/', (status) => statuses.push(status));
        try { return { vector: await client.embed('A person helps a neighbour.'), statuses }; }
        finally { client.dispose(); }
      })()`);
      expect(isEmbeddingVector(result.vector)).toBe(true);
      expect(result.statuses.some((status) => status.state === 'loading')).toBe(true);
      expect(result.statuses.some((status) => status.state === 'ready')).toBe(true);
      expect(external).toEqual([]);
      const cacheNames = await page.evaluate(() => globalThis.caches.keys());
      expect(cacheNames).toContain(`recs-embeddings-${EMBEDDING_CONFIG.revision}-${EMBEDDING_CONFIG.dtype}`);
      expect(requested.some((url) => url.includes('/review/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx'))).toBe(true);
      expect(requested.some((url) => url.includes('/review/onnx/') && url.endsWith('.wasm'))).toBe(true);
      const [nodeVector] = await embedTexts(['A person helps a neighbour.']);
      const cosine = nodeVector.reduce((sum, value, i) => sum + value * result.vector[i], 0);
      expect(cosine).toBeGreaterThan(0.999);
    } finally { await browser?.close(); await server.close(); }
  }, 120_000);
});
