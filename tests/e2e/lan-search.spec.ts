import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { browserTest as test, expect } from './fixtures';
import { performanceEvidence } from './performance-fixture';

test.use({ launchOptions: { args: ['--host-resolver-rules=MAP recs-lan.test 127.0.0.1', '--no-proxy-server'] } });

test('plain HTTP outside localhost intentionally keeps search lexical without model traffic', async ({ browser }) => {
  // Resolve a non-localhost hostname to the test server. The browser still correctly considers
  // this an insecure origin, unlike http://localhost or 127.0.0.1. No API deletion/mocking.
  const root = path.resolve('dist/preview'), base = '/replay-check/';
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, 'http://recs-lan.test').pathname;
    const filename = path.resolve(root, pathname.slice(base.length), pathname.endsWith('/') ? 'index.html' : '');
    if (!pathname.startsWith(base) || !filename.startsWith(`${root}${path.sep}`)) { response.writeHead(404).end(); return; }
    try {
      const bytes = await readFile(filename);
      const type = filename.endsWith('.html') ? 'text/html' : filename.endsWith('.js') ? 'text/javascript'
        : filename.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type }); response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    if (process.env.RECS_E2E_CHROME_PORT_FILE) {
      // Existing Chrome cannot take a new resolver flag. Forward only this test
      // hostname to our local server; the document keeps its real insecure origin.
      await page.route(/^http:\/\/recs-lan\.test:/, async route => {
        const url = new URL(route.request().url()); url.hostname = '127.0.0.1';
        await route.fulfill({ response: await route.fetch({ url: url.href }) });
      });
    }
    await performanceEvidence(page); // Only timing evidence is controlled; secure-context APIs are real.
    const errors: string[] = [], semanticRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/semantic-sw|semantic\.worker|\/(models|onnx)\//.test(request.url())) semanticRequests.push(request.url()); });
    await page.goto(`http://recs-lan.test:${port}${base}search/?q=Romans%2013`);
    expect(await page.evaluate(() => ({ secure: isSecureContext, sw: 'serviceWorker' in navigator }))).toEqual({ secure: false, sw: false });
    await expect(page.locator('.result-list')).toContainText('Authority');
    await expect(page.locator('.search-status')).toContainText('with exact search.');
    await expect(page.locator('html')).toHaveAttribute('data-essential-ready', 'true');
    await page.waitForTimeout(1500);
    expect(semanticRequests).toEqual([]); expect(errors).toEqual([]);
  } finally {
    await context.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
