import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';
import type { Browser, BrowserContext, Page } from '@playwright/test';

// No runtime application imports here: Vite must resolve browser modules and JSON imports.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const KEYS = [
  'initial.rawBytes', 'initial.gzipBytes', 'initial.modelRequests', 'metadata.rawBytes',
  'vectors.rawBytes', 'index.gzipBytes', 'model.hostedBytes', 'runtime.hostedBytes',
  'model.coldAssetBytes', 'model.warmModelBytes',
  'host.largestFileBytes', 'model.coldMs', 'model.warmCacheMs', 'model.warmInferenceP95Ms',
  'model.coldWeightRequests', 'model.warmWeightRequests', 'model.cacheWeightEntries',
  'model.cacheBytes', 'model.coldJsHeapBytes', 'search.exactP95Ms', 'search.rerankP95Ms',
  'search.jsHeapBytes', 'runtime.externalRequests',
] as const;
type BudgetKey = typeof KEYS[number];
const Nonnegative = z.number().finite().nonnegative();
const RuleSchema = z.object({ limit: Nonnegative, operator: z.enum(['<=', '<', '==']), unit: z.enum(['bytes', 'ms', 'requests', 'entries']) }).strict();
const BudgetSchema = z.object({
  schemaVersion: z.literal(1),
  profile: z.object({
    name: z.literal('development-mobile-proxy-v1'), cpuSlowdown: z.literal(4),
    viewport: z.object({ width: z.literal(390), height: z.literal(844) }).strict(),
    network: z.literal('loopback-identity-unshaped-v1'),
    samplesPerQuery: z.number().int().min(3).max(20), warmupRounds: z.number().int().min(1).max(3),
    syntheticRows: z.tuple([z.literal(2000), z.literal(5000)]),
    queries: z.array(z.string().trim().min(1)).min(3).max(10),
    pageTimeoutMs: z.number().int().positive().max(120000),
    runTimeoutMs: z.number().int().positive().max(780000),
  }).strict(),
  budgets: z.record(z.enum(KEYS), RuleSchema).superRefine((rules, ctx) => {
    for (const key of KEYS) if (!rules[key]) ctx.addIssue({ code: 'custom', message: `Missing budget: ${key}` });
    for (const key of KEYS) {
      const unit = key.endsWith('Ms') ? 'ms' : key.endsWith('Bytes') ? 'bytes' : key.endsWith('Entries') ? 'entries' : 'requests';
      if (rules[key] && rules[key]!.unit !== unit) ctx.addIssue({ code: 'custom', message: `Wrong unit: ${key}` });
    }
  }),
}).strict();
export function parseBudgets(value: unknown) { return BudgetSchema.parse(value); }
type Budgets = ReturnType<typeof parseBudgets>;
type Rule = z.infer<typeof RuleSchema>;
const MeasurementSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('measured'), value: Nonnegative }).strict(),
  z.object({ status: z.literal('unsupported'), reason: z.string().trim().min(1) }).strict(),
]);
export type Measurement = z.infer<typeof MeasurementSchema>;
export function compareBudget(rule: Rule, measurement: Measurement) {
  RuleSchema.parse(rule);
  measurement = MeasurementSchema.parse(measurement);
  if (measurement.status === 'unsupported') {
    return { status: 'unsupported' as const, ...rule, reason: measurement.reason };
  }
  const value = Nonnegative.parse(measurement.value);
  const pass = rule.operator === '<' ? value < rule.limit : rule.operator === '==' ? value === rule.limit : value <= rule.limit;
  return { status: pass ? 'pass' as const : 'fail' as const, ...rule, value };
}
/** Nearest-rank percentile; no interpolation, mutation, NaN, or empty-set zero. */
export function percentile(samples: readonly number[], quantile: number): number {
  if (!samples.length || !Number.isFinite(quantile) || quantile <= 0 || quantile > 1) throw new Error('Invalid percentile input');
  samples.forEach((value) => Nonnegative.parse(value));
  return [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * quantile) - 1];
}
export function validateOutputPath(value: string): string {
  if (!/^\.local\/performance[A-Za-z0-9._-]*\.json$/.test(value)) throw new Error('--output must be a direct .local/performance*.json path');
  return value;
}
function parseArgs(args: string[]) {
  if (args[0] === '--') args = args.slice(1);
  const options: { output?: string; label: string } = { label: 'current' };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) throw new Error(`Duplicate option ${key}`);
    seen.add(key);
    if (key === '--output' && args[i + 1]) options.output = validateOutputPath(args[++i]);
    else if (key === '--label' && /^[A-Za-z0-9_-]{1,64}$/.test(args[i + 1] ?? '')) options.label = args[++i];
    else throw new Error('Usage: tsx scripts/benchmark-search.ts [--label before|after] [--output .local/performance-report.json]');
  }
  return options;
}
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const sizes = (data: Buffer) => ({ rawBytes: data.byteLength, gzipBytes: gzipSync(data, { level: 9 }).byteLength, sha256: digest(data) });
async function localDirectory() {
  const directory = path.join(ROOT, '.local');
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== path.join(await realpath(ROOT), '.local')) throw new Error('.local must not be a symlink');
  return directory;
}
async function writeReport(filename: string, report: unknown) {
  validateOutputPath(filename);
  await localDirectory();
  const target = path.join(ROOT, filename);
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Report target must be an ordinary unlinked file');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error('Unsafe report target');
    await file.truncate(0);
    await file.writeFile(`${JSON.stringify(report, null, 2)}\n`);
  } finally { await file.close(); }
}
interface Asset { path: string; rawBytes: number; sha256: string }
async function inventory(directory: string, prefix = ''): Promise<Asset[]> {
  const result: Asset[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error(`Symlink in preview: ${prefix}${entry.name}`);
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await inventory(filename, `${prefix}${entry.name}/`));
    else {
      const data = await readFile(filename);
      result.push({ path: `${prefix}${entry.name}`, rawBytes: data.byteLength, sha256: digest(data) });
    }
  }
  return result;
}
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
interface RequestRecord { phase: string; path: string; status: number; bytes: number }
function staticServer(directory: string, base: string, records: RequestRecord[], getPhase: () => string) {
  return createServer((request, response) => {
    const phase = getPhase();
    void (async () => {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const relative = pathname.startsWith(base) ? pathname.slice(base.length) : null;
      if (relative === null || relative.split('/').some((part) => part === '..' || part.startsWith('.')) || relative.includes('\\')) throw new Error('Invalid static path');
      let filename = path.resolve(directory, relative || 'index.html');
      if (!filename.startsWith(`${directory}${path.sep}`)) throw new Error('Outside preview');
      if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
      const data = await readFile(filename);
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filename)] ?? 'application/octet-stream', 'Content-Length': data.byteLength, 'Cache-Control': 'no-store' });
      response.end(data);
      records.push({ phase, path: path.relative(directory, filename).split(path.sep).join('/'), status: 200, bytes: data.byteLength });
    })().catch(() => {
      records.push({ phase, path: request.url ?? '/', status: 404, bytes: 0 });
      response.writeHead(404); response.end();
    });
  });
}
async function listen(server: Server) {
  server.requestTimeout = 120000;
  server.headersTimeout = 30000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local server port');
  return `http://127.0.0.1:${address.port}`;
}
async function closeServer(server: Server) {
  await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
}
async function bounded<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds} ms`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function instrument(context: BrowserContext, origin: string, budgets: Budgets, external: string[]) {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (new URL(url).origin !== origin) { external.push(url); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(budgets.profile.pageTimeoutMs);
  page.setDefaultNavigationTimeout(budgets.profile.pageTimeoutMs);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: budgets.profile.cpuSlowdown });
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  return page;
}

// Observe the actual emitted application worker, without replacing its implementation.
const OBSERVER = `(() => {
  const state = window.__benchmark = { results: [], ready: [], longTasks: [], errors: [] };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    sent = new Map();
    postMessage(data, ...args) {
      if (data.type === 'embed') this.sent.set(data.id, performance.now());
      return super.postMessage(data, ...args);
    }
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({ data }) => {
        if (data.type === 'result') {
          const at = performance.now();
          const requestAt = this.sent.get(data.id);
          state.results.push({ at, requestAt, elapsedMs: at - requestAt, vector: data.vector });
        }
        if (data.type === 'status' && data.status.state === 'ready') state.ready.push(performance.now());
        if (data.type === 'error') state.errors.push(data.message);
      });
    }
  };
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    new PerformanceObserver((list) => state.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
  }
  state.longTasksSupported = PerformanceObserver.supportedEntryTypes.includes('longtask');
})();`;
interface Observation {
  results: { at: number; requestAt: number; elapsedMs: number; vector: number[] }[]; ready: number[];
  longTasks: { start: number; duration: number }[]; longTasksSupported: boolean; errors: string[];
}
const observation = (page: Page) => page.evaluate<Observation>('window.__benchmark');
async function waitForEmbedding(page: Page, count: number) {
  await page.waitForFunction((n) => {
    const state = (window as unknown as { __benchmark: Observation }).__benchmark;
    if (state.errors.length) throw new Error(state.errors.join('; '));
    return state.results.length > n;
  }, count);
  return (await observation(page)).results[count];
}
async function query(page: Page, text: string) {
  const before = (await observation(page)).results.length;
  const started = await page.evaluate((q) => {
    const start = performance.now();
    const url = new URL(window.location.href); url.searchParams.set('q', q);
    window.history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate'));
    return start;
  }, text);
  const result = await waitForEmbedding(page, before);
  return { vector: result.vector, ms: result.at - started, workerMs: result.elapsedMs, requestAt: result.requestAt };
}

/** Worker JS heap comes from its own isolate, not the page's performance.memory. */
async function coldHeap(browser: Browser, page: Page): Promise<Measurement> {
  const cdp = await browser.newBrowserCDPSession();
  let workerSession: string | undefined;
  try {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const workers = targetInfos.filter((target) => target.type === 'worker' && target.url.includes('semantic'));
    if (workers.length !== 1) throw new Error(`Expected one isolated semantic worker, saw ${workers.length}`);
    workerSession = (await cdp.send('Target.attachToTarget', { targetId: workers[0].targetId, flatten: false })).sessionId;
    const sessionId = workerSession;
    const workerHeap = await bounded(new Promise<number>((resolve, reject) => {
      const listener = (event: { sessionId: string; message: string }) => {
        if (event.sessionId !== sessionId) return;
        const reply = JSON.parse(event.message);
        if (reply.id !== 1) return;
        cdp.off('Target.receivedMessageFromTarget', listener);
        if (reply.error || typeof reply.result?.usedSize !== 'number') reject(new Error('Worker Runtime.getHeapUsage unavailable'));
        else resolve(Nonnegative.parse(reply.result.usedSize));
      };
      cdp.on('Target.receivedMessageFromTarget', listener);
      void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.getHeapUsage' }) }).catch(reject);
    }), 10000, 'Worker JS heap');
    const pageSession = await page.context().newCDPSession(page);
    try {
      const heap = await pageSession.send('Runtime.getHeapUsage');
      return { status: 'measured', value: workerHeap + Nonnegative.parse(heap.usedSize) };
    } finally { await pageSession.detach(); }
  } catch (error) { return { status: 'unsupported', reason: error instanceof Error ? error.message : String(error) }; }
  finally {
    if (workerSession) await cdp.send('Target.detachFromTarget', { sessionId: workerSession }).catch(() => {});
    await cdp.detach();
  }
}
async function cacheInventory(page: Page) {
  return page.evaluate(async () => {
    const result: { cache: string; path: string; bytes: number }[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith('recs-embeddings-')) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (!response) throw new Error('Cache entry vanished');
        result.push({ cache: name, path: new URL(request.url).pathname, bytes: (await response.arrayBuffer()).byteLength });
      }
    }
    return result;
  });
}

interface Scenario {
  label: string; rows: number; synthetic: boolean; initMs: number; prepareMs: number;
  samples: { query: string; exact: number[]; rerank: number[]; exactCount: number; rerankCount: number }[];
  heap: Measurement;
}
// Native browser import string bypasses Node/Vitest SSR; no copied ranking algorithm.
function searchHarness(base: string, profile: Budgets['profile'], queryVectors: number[][], rows: number | null, sha256: string) {
  return `(async () => {
    const { prepareSearchIndex, buildEmbeddingDocument } = await import(${JSON.stringify(`${base}site/lib/search.ts`)});
    const { isEmbeddingVector, isCompatibleEmbeddingConfig } = await import(${JSON.stringify(`${base}site/lib/embedding-config.ts`)});
    const start = performance.now();
    const load = async (file) => {
      const response = await fetch(${JSON.stringify(base)} + 'generated/' + file, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error('Missing preview artifact: ' + file);
      return response.json();
    };
    let [passages, vectors] = await Promise.all([load('passages.json'), load('vectors.json')]);
    if (!Array.isArray(passages) || !passages.length || vectors.schemaVersion !== 1 || !isCompatibleEmbeddingConfig(vectors.model) || vectors.passagesSha256 !== ${JSON.stringify(sha256)}) throw new Error('Invalid/stale preview index');
    if (new Set(passages.map(p => p.id)).size !== passages.length || Object.keys(vectors.vectors).length !== passages.length) throw new Error('Duplicate/missing vector IDs');
    for (const passage of passages) {
      const entry = vectors.vectors[passage.id];
      if (!entry || !isEmbeddingVector(entry.vector) || entry.document !== buildEmbeddingDocument(passage)) throw new Error('Stale/invalid vector: ' + passage.id);
    }
    const target = ${JSON.stringify(rows)};
    if (target !== null) {
      const original = passages;
      const originalVectors = vectors.vectors;
      const entries = {};
      passages = Array.from({ length: target }, (_, i) => {
        const source = original[i % original.length];
        const copy = structuredClone(source);
        copy.id = 'synthetic-' + i + '-' + source.id;
        entries[copy.id] = structuredClone(originalVectors[source.id]);
        return copy;
      });
      vectors = { ...vectors, passagesSha256: 'synthetic-duplication-not-an-artifact', vectors: entries };
    }
    const queryVectors = ${JSON.stringify(queryVectors)};
    if (!queryVectors.every(isEmbeddingVector)) throw new Error('Invalid precomputed query vector');
    const queries = ${JSON.stringify(profile.queries)};
    const prepareStart = performance.now();
    const prepared = prepareSearchIndex(passages, vectors);
    const prepareMs = performance.now() - prepareStart;
    const initMs = performance.now() - start;
    const samples = queries.map(query => ({ query, exact: [], rerank: [], exactCount: 0, rerankCount: 0 }));
    for (let round = -${profile.warmupRounds}; round < ${profile.samplesPerQuery}; round++) {
      for (let i = 0; i < queries.length; i++) {
        // Alternate ordering to reduce systematic exact-vs-rerank order bias.
        for (const mode of (round % 2 === 0 ? ['exact', 'rerank'] : ['rerank', 'exact'])) {
          await new Promise(resolve => setTimeout(resolve, 0));
          const t = performance.now();
          const result = prepared.search(queries[i], mode === 'exact' ? {} : { queryVector: queryVectors[i], limit: 30 });
          const elapsed = performance.now() - t;
          if (round >= 0) samples[i][mode].push(elapsed);
          samples[i][mode + 'Count'] = result.length;
        }
      }
    }
    // Keep live index references through the heap snapshot, without serializing them to Node.
    window.__benchmarkLiveIndex = { passages, vectors, queryVectors, prepared };
    return { rows: passages.length, initMs, prepareMs, samples };
  })()`;
}

export async function benchmark(options: { label: string; output?: string }) {
  if (options.output) validateOutputPath(options.output);
  // Freeze the declared policy before reading/measuring any preview assets.
  const budgetText = await readFile(path.join(ROOT, 'performance/budgets.json'), 'utf8');
  const budgets = parseBudgets(JSON.parse(budgetText));
  const checks: { scope: string; metric: BudgetKey; result: ReturnType<typeof compareBudget> }[] = [];
  const external: string[] = [];
  const scenarios: Scenario[] = [];
  const check = (scope: string, metric: BudgetKey, value: number | Measurement) => {
    checks.push({ scope, metric, result: compareBudget(budgets.budgets[metric]!, typeof value === 'number' ? { status: 'measured', value } : value) });
  };
  const report: Record<string, unknown> = {
    schemaVersion: 1, label: options.label, startedAt: new Date().toISOString(), status: 'incomplete',
    budgetSha256: digest(budgetText), budgets, checks, scenarios,
    host: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramBytes: os.totalmem(), node: process.version },
    assumptions: [
      '4x Chromium main-thread CPU slowdown on this host; mobile viewport, not a physical phone or calibrated device.',
      'Loopback HTTP/1 identity responses, no bandwidth/RTT shaping; offline gzip-9 sizes are estimates, not observed compressed transfers.',
      'Worker inference CPU is not claimed throttled; exhaustive exact/hybrid ranking is on the throttled page.',
      'Ranking reuses the product prepared snapshot; preparation is reported separately and included in initialization.',
      'Fresh isolated context for cold; same context reload for CacheStorage warm, HTTP cache disabled in both.',
      'JS heap snapshots are not peak process memory, WASM linear memory, native allocations, GPU memory or RSS.',
      'Synthetic duplicates stress row count only; neither accuracy nor realistic compression is inferred.',
    ],
  };
  let browser: Browser | undefined;
  let server: Server | undefined;
  let vite: { listen(): Promise<void>; close(): Promise<void>; resolvedUrls: { local: string[] } | null } | undefined;
  let stopped = false;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => cleanupPromise ??= (async () => {
    stopped = true;
    // Close all independently even when one close fails.
    const results = await Promise.allSettled([browser?.close(), vite?.close(), server ? closeServer(server) : undefined]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  })();
  let interrupt: ((error: Error) => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
  const onSignal = () => { stopped = true; interrupt?.(new Error('Benchmark interrupted')); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  const ensureRunning = () => { if (stopped) throw new Error('Benchmark stopped'); };
  const run = async () => {
    const directory = path.join(ROOT, 'dist/preview');
    const mode = JSON.parse(await readFile(path.join(directory, 'build-mode.json'), 'utf8'));
    if (mode.mode !== 'preview' || typeof mode.base !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(mode.base)) throw new Error('Expected existing preview build with valid build-mode.json');
    const base: string = mode.base;
    const assets = await inventory(directory);
    const sourceFiles = ['site/lib/search.ts', 'site/lib/scripture.ts', 'site/lib/embedding-config.ts', 'bible/books.ts', 'bible/verse-counts.json'];
    const sourceHashes = await Promise.all(sourceFiles.map(async filename => ({ path: filename, sha256: digest(await readFile(path.join(ROOT, filename))) })));
    report.searchSource = sourceHashes;
    const passageBytes = await readFile(path.join(directory, 'generated/passages.json'));
    const passageData: unknown = JSON.parse(passageBytes.toString('utf8'));
    if (!Array.isArray(passageData) || !passageData.length) throw new Error('Benchmark requires a nonempty real preview index');
    const metadata = sizes(passageBytes);
    const vectors = sizes(await readFile(path.join(directory, 'generated/vectors.json')));
    const largest = assets.reduce((a, b) => a.rawBytes > b.rawBytes ? a : b);
    report.artifacts = { directory: 'dist/preview', base, rows: passageData.length, metadata, vectors, largest, assets };
    check('real', 'metadata.rawBytes', metadata.rawBytes); check('real', 'vectors.rawBytes', vectors.rawBytes);
    check('real', 'index.gzipBytes', metadata.gzipBytes + vectors.gzipBytes);
    check('real', 'host.largestFileBytes', largest.rawBytes);
    check('real', 'model.hostedBytes', assets.filter(a => a.path.startsWith('models/')).reduce((sum, a) => sum + a.rawBytes, 0));
    check('real', 'runtime.hostedBytes', assets.filter(a => a.path.startsWith('onnx/')).reduce((sum, a) => sum + a.rawBytes, 0));
    const local = await localDirectory();
    ensureRunning();
    const requests: RequestRecord[] = [];
    let phase = 'initial';
    server = staticServer(directory, base, requests, () => phase);
    const origin = await listen(server);
    ensureRunning();
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ headless: true, timeout: 30000, args: ['--enable-precise-memory-info'], handleSIGINT: false, handleSIGTERM: false });
    // A launch completing after timeout must not leak the newly created process.
    if (stopped) { await browser.close(); throw new Error('Stopped during browser launch'); }
    report.browserVersion = browser.version();
    report.externalRequests = external; report.requests = requests;
    const context = await browser.newContext({ viewport: budgets.profile.viewport, serviceWorkers: 'block' });
    await context.addInitScript(OBSERVER);
    const page = await instrument(context, origin, budgets, external);
    await page.goto(`${origin}${base}search/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]') && !document.querySelector('.search-status')?.textContent?.includes('Loading the archive'));
    const initialObservation = await observation(page);
    const initialRequests = requests.filter(r => r.phase === 'initial' && r.status === 200);
    const initialAssets = await Promise.all(initialRequests.map(async (r) => ({ path: r.path, ...sizes(await readFile(path.join(directory, r.path))) })));
    report.initial = { assets: initialAssets, observation: initialObservation, navigation: await page.evaluate(() => performance.getEntriesByType('navigation').map(e => e.toJSON())) };
    check('real', 'initial.rawBytes', initialAssets.reduce((sum, a) => sum + a.rawBytes, 0));
    check('real', 'initial.gzipBytes', initialAssets.reduce((sum, a) => sum + a.gzipBytes, 0));
    check('real', 'initial.modelRequests', initialRequests.filter(r => /^(models|onnx)\//.test(r.path) || r.path.includes('semantic.worker')).length);
    phase = 'cold-model';
    const cold = await query(page, budgets.profile.queries[0]);
    check('real', 'model.coldMs', cold.workerMs);
    const heap = await coldHeap(browser, page);
    check('real', 'model.coldJsHeapBytes', heap);
    const coldObservation = await observation(page);
    const queryVectors = [cold.vector];
    const warmInferenceMs: number[] = [];
    phase = 'warm-inference';
    // These are real browser-model query embeddings, computed outside rank timers.
    for (const text of budgets.profile.queries.slice(1)) {
      const result = await query(page, text); queryVectors.push(result.vector); warmInferenceMs.push(result.workerMs);
    }
    check('real', 'model.warmInferenceP95Ms', percentile(warmInferenceMs, 0.95));
    let cache: Awaited<ReturnType<typeof cacheInventory>> = [];
    try {
      cache = await bounded(cacheInventory(page), budgets.profile.pageTimeoutMs, 'CacheStorage inventory');
      check('real', 'model.cacheWeightEntries', cache.filter(e => e.path.endsWith('/model_quantized.onnx')).length);
      check('real', 'model.cacheBytes', cache.reduce((sum, e) => sum + e.bytes, 0));
    } catch (error) {
      const missing: Measurement = { status: 'unsupported', reason: `CacheStorage inspection: ${String(error)}` };
      check('real', 'model.cacheWeightEntries', missing); check('real', 'model.cacheBytes', missing);
    }
    phase = 'warm-cache';
    await page.goto(`${origin}${base}search/?q=${encodeURIComponent(budgets.profile.queries[0])}`, { waitUntil: 'domcontentloaded' });
    const warm = await waitForEmbedding(page, 0);
    check('real', 'model.warmCacheMs', warm.elapsedMs);
    const weights = (scope: string) => requests.filter(r => r.phase === scope && r.path.endsWith('/model_quantized.onnx') && r.status === 200);
    check('real', 'model.coldWeightRequests', weights('cold-model').length);
    check('real', 'model.warmWeightRequests', weights('warm-cache').length);
    const transferred = (scope: string, accept: (filename: string) => boolean) => requests.filter(r => r.phase === scope && r.status === 200 && accept(r.path)).reduce((sum, r) => sum + r.bytes, 0);
    // Include every additional JS chunk in this phase, including split worker dependencies.
    const modelAsset = (filename: string) => /^(models|onnx|_astro)\//.test(filename);
    const transfers = ['initial', 'cold-model', 'warm-inference', 'warm-cache'].map(scope => ({ phase: scope,
      totalBodyBytes: transferred(scope, () => true),
      modelBodyBytes: transferred(scope, filename => filename.startsWith('models/')),
      runtimeBodyBytes: transferred(scope, filename => filename.startsWith('onnx/')),
      applicationAndWorkerBodyBytes: transferred(scope, filename => filename.startsWith('_astro/')),
      indexBodyBytes: transferred(scope, filename => filename.startsWith('generated/')),
    }));
    report.transfers = transfers;
    check('real', 'model.coldAssetBytes', transferred('cold-model', modelAsset));
    check('real', 'model.warmModelBytes', transferred('warm-cache', filename => filename.startsWith('models/')));
    report.model = { coldMs: cold.workerMs, coldQueryToVectorMs: cold.ms, coldReadyMs: coldObservation.ready.length ? coldObservation.ready[0] - cold.requestAt : null,
      warmCacheMs: warm.elapsedMs, warmNavigationToVectorMs: warm.at, warmInferenceMs, cache, coldJsHeap: heap, coldObservation, warmObservation: await observation(page) };
    await context.close();

    ensureRunning();
    const require = createRequire(import.meta.url);
    const viteEntry = require.resolve('vite', { paths: [path.dirname(require.resolve('vitest/package.json'))] });
    const { createServer: createViteServer } = await import(pathToFileURL(viteEntry).href);
    const harnessBase = '/__performance/';
    vite = await createViteServer({ configFile: false, root: ROOT, base: harnessBase, publicDir: directory,
      cacheDir: path.join(local, 'performance-vite'), server: { host: '127.0.0.1', port: 0, watch: null },
    });
    if (stopped) { await vite!.close(); throw new Error('Stopped during Vite creation'); }
    await vite!.listen();
    if (stopped) { await vite!.close(); throw new Error('Stopped during Vite listen'); }
    ensureRunning();
    const harnessOrigin = new URL(vite!.resolvedUrls!.local[0]).origin;
    for (const rows of [null, ...budgets.profile.syntheticRows]) {
      ensureRunning();
      const label = rows === null ? 'real-preview' : `synthetic-duplicated-${rows}`;
      const isolated = await browser.newContext({ viewport: budgets.profile.viewport, serviceWorkers: 'block' });
      try {
        const harnessPage = await instrument(isolated, harnessOrigin, budgets, external);
        await harnessPage.route(`${harnessOrigin}${harnessBase}`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local search timing harness</title>' }));
        await harnessPage.goto(`${harnessOrigin}${harnessBase}`);
        const result = await bounded(harnessPage.evaluate<Omit<Scenario, 'heap' | 'label' | 'synthetic'>>(searchHarness(harnessBase, budgets.profile, queryVectors, rows, metadata.sha256)), budgets.profile.pageTimeoutMs, label);
        let heap: Measurement;
        try {
          const session = await isolated.newCDPSession(harnessPage);
          try { heap = { status: 'measured', value: Nonnegative.parse((await session.send('Runtime.getHeapUsage')).usedSize) }; }
          finally { await session.detach(); }
        } catch (error) { heap = { status: 'unsupported', reason: String(error) }; }
        scenarios.push({ ...result, label, synthetic: rows !== null, heap });
        // Every query must fit; pooled percentiles could hide one expensive query.
        for (const sample of result.samples) {
          check(`${label}: ${sample.query}`, 'search.exactP95Ms', percentile(sample.exact, 0.95));
          check(`${label}: ${sample.query}`, 'search.rerankP95Ms', percentile(sample.rerank, 0.95));
        }
        check(label, 'search.jsHeapBytes', heap);
      } finally { await isolated.close(); }
    }
    // Detect a concurrent rebuild rather than comparing mixed generations.
    if (JSON.stringify(await inventory(directory)) !== JSON.stringify(assets)) throw new Error('Preview changed during measurement; rerun against a stable build');
    for (const source of sourceHashes) if (digest(await readFile(path.join(ROOT, source.path))) !== source.sha256) throw new Error(`Search source changed during measurement: ${source.path}`);
  };
  try {
    await bounded(Promise.race([run(), interrupted]), budgets.profile.runTimeoutMs, 'Whole benchmark');
    report.status = checks.some(c => c.result.status === 'fail') ? 'failed' : checks.some(c => c.result.status === 'unsupported') ? 'incomplete' : 'passed';
  } catch (error) { report.status = 'incomplete'; report.error = error instanceof Error ? error.message : String(error); }
  finally {
    try { await cleanup(); } catch (error) { report.status = 'incomplete'; report.cleanupError = String(error); }
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
  }
  check('all-contexts', 'runtime.externalRequests', external.length);
  if (checks.some(c => c.result.status === 'fail') && report.status === 'passed') report.status = 'failed';
  report.finishedAt = new Date().toISOString();
  if (options.output) await writeReport(options.output, report);
  console.log(`Static search benchmark: ${report.status} (${options.label}); ${checks.filter(c => c.result.status === 'pass').length}/${checks.length} measured checks passed.`);
  console.log(`${budgets.profile.name}: CPU ${budgets.profile.cpuSlowdown}x; ${budgets.profile.network}; ${os.cpus()[0]?.model ?? 'unknown CPU'}; Chromium ${report.browserVersion ?? 'unavailable'}.`);
  for (const scenario of scenarios) console.log(`${scenario.label}: ${scenario.rows} rows; initialization ${scenario.initMs.toFixed(2)} ms (including preparation ${scenario.prepareMs.toFixed(2)} ms)${scenario.synthetic ? ' (synthetic duplicates, not accuracy/compression evidence)' : ''}.`);
  for (const item of checks) {
    const result = item.result;
    console.log(`${result.status.toUpperCase()} ${item.scope} / ${item.metric}: ${result.status === 'unsupported' ? result.reason : `${result.value.toFixed(2)} ${result.unit} ${result.operator} ${result.limit}`}`);
  }
  if (report.error) console.error(report.error);
  if (report.cleanupError) console.error(report.cleanupError);
  if (options.output) console.log(`Local report: ${options.output}`);
  return { report, exitCode: checks.some(c => c.result.status === 'fail') ? 1 : report.status === 'passed' ? 0 : 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = (await benchmark(parseArgs(process.argv.slice(2)))).exitCode; }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
}
