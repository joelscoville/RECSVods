/** End-to-end adaptive loading evidence. Server shaping also covers service-worker requests. */
import { createServer, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const root = path.resolve('dist/preview'), base = '/replay-check/';
const profiles = [
  { name: 'slow-3g', mbps: 0.4, latency: 400, cpu: 4 },
  { name: 'fast-3g', mbps: 1.6, latency: 150, cpu: 4 },
  { name: '10-mbps', mbps: 10, latency: 50, cpu: 1 },
  { name: '50-mbps', mbps: 50, latency: 20, cpu: 1 },
  { name: '200-mbps', mbps: 200, latency: 5, cpu: 1 },
  { name: 'fast-low-cpu', mbps: 50, latency: 20, cpu: 8 },
];
const browser = await chromium.launch();
const reports: unknown[] = [];
try {
  for (const profile of profiles) {
    const requests: { path: string; bytes: number; sent: number; at: number }[] = [];
    const queue: { response: ServerResponse; bytes: Buffer; offset: number; record: (typeof requests)[number] }[] = [];
    const started = performance.now();
    // One shared budget, divided across concurrent responses; no per-request bandwidth multiplication.
    const tick = setInterval(() => {
      let budget = Math.floor(profile.mbps * 1_000_000 / 8 * 0.02);
      while (queue.length && budget > 0) {
        const item = queue.shift()!;
        if (item.response.destroyed) continue;
        const count = Math.min(16_384, budget, item.bytes.length - item.offset);
        item.response.write(item.bytes.subarray(item.offset, item.offset + count));
        item.record.sent += count;
        item.offset += count; budget -= count;
        if (item.offset === item.bytes.length) item.response.end(); else queue.push(item);
      }
    }, 20);
    const server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url!, 'http://localhost').pathname;
        if (!pathname.startsWith(base)) { response.writeHead(404).end(); return; }
        const relative = pathname.slice(base.length) + (pathname.endsWith('/') ? 'index.html' : '');
        const filename = path.resolve(root, relative);
        if (!filename.startsWith(`${root}${path.sep}`)) { response.writeHead(400).end(); return; }
        const raw = await readFile(filename);
        const compressed = !relative.endsWith('.gz');
        const bytes = compressed ? gzipSync(raw) : raw;
        const type = relative.endsWith('.js') || relative.endsWith('.mjs') ? 'text/javascript'
          : relative.endsWith('.html') ? 'text/html' : relative.endsWith('.css') ? 'text/css'
          : relative.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
        const record = { path: relative, bytes: bytes.length, sent: 0, at: performance.now() - started };
        requests.push(record);
        setTimeout(() => {
          if (response.destroyed) return;
          response.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-store',
            ...(compressed ? { 'Content-Encoding': 'gzip' } : {}) });
          queue.push({ response, bytes, offset: 0, record });
        }, profile.latency);
      } catch { response.writeHead(404).end(); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
    try {
      await page.goto(`${origin}${base}search/`, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForFunction(() => document.documentElement.dataset.essentialReady === 'true');
      const essentialTransferBytes = requests.reduce((sum, r) => sum + r.sent, 0);
      assert.equal(requests.filter(r => /^(models|onnx)\//.test(r.path)).length, 0, 'No semantic requests before essential readiness');
      await page.waitForTimeout(1200);
      const initial = await page.evaluate(() => ({ mode: { ...document.documentElement.dataset },
        readyMs: performance.getEntriesByName('recs-essential-ready')[0]?.startTime,
        resources: performance.getEntriesByType('resource').map(entry => entry.toJSON()) }));
      const beforeTypingBytes = requests.reduce((sum, r) => sum + r.sent, 0);
      const latency: number[] = [];
      const inputLatency: number[] = [];
      for (const query of ['Romans 13', 'Yong', 'living sacrifice', 'prayer', 'zxqvpl-no-match']) {
        await page.evaluate(() => {
          const state = window as unknown as { __inputPaint?: number };
          state.__inputPaint = undefined;
          document.addEventListener('input', () => {
            const start = performance.now();
            requestAnimationFrame(() => requestAnimationFrame(() => { state.__inputPaint = performance.now() - start; }));
          }, { once: true, capture: true });
        });
        const before = performance.now();
        await page.locator('input[type="search"]:visible').fill(query);
        await page.waitForFunction(query => document.querySelector('.results-toolbar h2')?.textContent?.includes(query), query);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        latency.push(performance.now() - before);
        inputLatency.push(await page.evaluate(() => (window as unknown as { __inputPaint: number }).__inputPaint));
      }
      await page.waitForTimeout(1500);
      const report = { profile, initial, essentialTransferBytes, beforeTypingBytes,
        driverToExactPaintMs: latency, inputToPaintMs: inputLatency, finalMode: await page.evaluate(() => ({ ...document.documentElement.dataset })), requests, errors };
      reports.push(report);
      assert.deepEqual(errors, [], 'No browser runtime errors');
      if (initial.mode.dataMode !== 'normal' || initial.mode.computeMode !== 'normal') {
        assert.equal(requests.filter(r => /^(models|onnx)\//.test(r.path)).length, 0, 'Reduced mode must not start automatic model downloads');
      }
      console.log(JSON.stringify({ profile: profile.name, readyMs: initial.readyMs, mode: report.finalMode,
        essentialBytes: essentialTransferBytes, beforeTypingBytes, exactPaintMs: inputLatency, errors }));
    } catch (error) {
      throw new Error(`${profile.name}: ${String(error)}; page errors: ${errors.join('; ')}; ${await page.locator('.search-status').textContent()}`);
    } finally {
      await context.close(); clearInterval(tick);
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
} finally { await browser.close(); }
await mkdir('.local', { recursive: true });
await writeFile('.local/performance-adaptive-browser.json', JSON.stringify({
  assumptions: 'Server-global gzip transfer shaping; Chromium page CPU slowdown only, worker CPU is not throttled. Driver-to-paint includes Playwright overhead. No physical-phone claim.', reports,
}, null, 2));
