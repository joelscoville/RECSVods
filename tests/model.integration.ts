import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { EMBEDDING_CONFIG, isEmbeddingVector } from '../site/lib/embedding-config';
import { CHAPTER_VECTOR_CONFIG } from '../site/lib/chapter-vectors';
import { SEARCH_WEIGHTS } from '../site/lib/search';
import { createEmbeddingSession, embedTexts, prepare } from '../scripts/embeddings';
import { chapterTokenWindows } from '../scripts/chapter-vectors';
import type { SemanticStatus } from '../site/lib/semantic';

afterEach(() => vi.unstubAllGlobals());
// Selected explicitly by vitest.model.config.ts; missing assets are failures, never silent skips.
it('reuses verified cache offline and produces compatible normalized query embeddings', async () => {
  vi.stubGlobal('fetch', () => { throw new Error('Offline check: network forbidden'); });
  const result = await prepare(); expect(result.downloadedBytes).toBe(0); expect(result.reusedBytes).toBe(23685172);
  const vectors = await embedTexts(['A person helps a neighbour.', '  A person\nhelps a neighbour. ', 'The spacecraft orbits a distant planet.']);
  vectors.forEach(vector => expect(isEmbeddingVector(vector)).toBe(true));
  expect(vectors[0]).toEqual(vectors[1]);
  expect(vectors[0].reduce((sum, value, i) => sum + value * vectors[2][i], 0)).toBeLessThan(SEARCH_WEIGHTS.semanticThreshold);
}, 60_000);

it('matches the query pipeline and exercises real tokenizer boundaries', async () => {
  const session = await createEmbeddingSession();
  try {
    const text = 'A short sentence about hope and peace.';
    const direct = await session.embedTokenIds(session.tokenize(text)), query = await session.embedText(text);
    expect(Math.max(...direct.map((v, i) => Math.abs(v - query[i])))).toBeLessThan(1e-6);
    const windows = chapterTokenWindows(session.tokenize('Uncharacteristically hopeful, multilingual scripture. '.repeat(100)));
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].length + CHAPTER_VECTOR_CONFIG.windowing.specialTokens).toBe(256);
    const vector = await session.embedTokenIds(windows[0]);
    expect(vector).toHaveLength(384);
    expect(Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))).toBeCloseTo(1, 5);
  } finally { await session.dispose(); }
}, 120_000);

it('embeds in a real non-root worker without external requests and agrees with Node', async () => {
  const require = createRequire(import.meta.url);
  const viteEntry = require.resolve('vite', { paths: [path.dirname(require.resolve('vitest/package.json'))] });
  const { createServer } = await import(pathToFileURL(viteEntry).href);
  const server = await createServer({ configFile: false, root: process.cwd(), cacheDir: '.local/model-test-vite', base: '/review/', publicDir: 'site/public', server: { host: '127.0.0.1', port: 0 } });
  const { chromium } = await import('@playwright/test');
  let browser;
  try {
    await server.listen(); const origin = new URL(server.resolvedUrls.local[0]).origin;
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    const external: string[] = [], requested: string[] = [];
    await page.route('**/*', route => {
      const url = route.request().url(); requested.push(url);
      if (new URL(url).origin !== origin) { external.push(url); return route.abort(); }
      return route.continue();
    });
    await page.route(`${origin}/review/`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Embedding integration check</title>' }));
    await page.goto(`${origin}/review/`);
    const result = await page.evaluate<{ vector: number[]; statuses: SemanticStatus[] }>(`(async () => {
      const { createSemanticClient } = await import('/review/site/lib/semantic.ts');
      const statuses = []; const client = createSemanticClient('/review/', status => statuses.push(status));
      try { return { vector: await client.embed('A person helps a neighbour.'), statuses }; }
      finally { client.dispose(); }
    })()`);
    expect(isEmbeddingVector(result.vector)).toBe(true);
    expect(result.statuses.some(status => status.state === 'ready')).toBe(true); expect(external).toEqual([]);
    expect(await page.evaluate(() => globalThis.caches.keys())).toContain(`recs-embeddings-${EMBEDDING_CONFIG.revision}-${EMBEDDING_CONFIG.dtype}`);
    expect(requested.some(url => url.includes('/review/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx'))).toBe(true);
    expect(requested.some(url => url.includes('/review/onnx/') && url.endsWith('.wasm'))).toBe(true);
    const [nodeVector] = await embedTexts(['A person helps a neighbour.']);
    expect(nodeVector.reduce((sum, value, i) => sum + value * result.vector[i], 0)).toBeGreaterThan(0.999);
  } finally { await browser?.close(); await server.close(); }
}, 120_000);
