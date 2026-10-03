import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { pagesBase, verifyPages } from '../scripts/pages';
import { buildIndex } from '../scripts/archive';
import { checkTrackedFile } from '../scripts/verify-tracked';
import { fakeRows, writeArchive } from './recording-fixtures';

describe('production deployment boundary', () => {
  it('normalizes configured Pages paths without accepting remote or traversal inputs', () => {
    expect(pagesBase('')).toBe('/'); expect(pagesBase('/RECSVods')).toBe('/RECSVods/');
    for (const base of ['https://remote.test', '//remote.test', '/../secret', '/x?token=private', 'relative']) expect(() => pagesBase(base)).toThrow();
  });
  it('checks production mode, all direct routes, local assets and non-root containment', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'recs-pages-test-'));
    try {
      writeArchive(root, {});
      await buildIndex(root, 'production', fakeRows);
      const output = path.join(root, 'dist/production');
      mkdirSync(output, { recursive: true });
      const { cpSync } = await import('node:fs');
      cpSync(path.join(root, 'site/public/generated'), path.join(output, 'generated'), { recursive: true });
      const put = (file: string, data: string) => { mkdirSync(path.dirname(path.join(output, file)), { recursive: true }); writeFileSync(path.join(output, file), data); };
      put('build-mode.json', JSON.stringify({ mode: 'production', base: '/check/' }));
      for (const route of ['index.html', '404.html', 'search/index.html', 'watch/index.html', 'browse/index.html', 'policies/index.html']) put(route, '<a href="/check/search/">Search</a>');
      expect((await verifyPages(root, '/check/')).pages).toBe(6);
      put('index.html', '<script src="/wrong/app.js"></script>');
      await expect(verifyPages(root, '/check/')).rejects.toThrow('deployment base');
      put('index.html', '<a href="/check/missing/">Missing</a>');
      await expect(verifyPages(root, '/check/')).rejects.toThrow('Missing local');
      put('build-mode.json', JSON.stringify({ mode: 'preview', base: '/check/' }));
      await expect(verifyPages(root, '/check/')).rejects.toThrow('Only the matching production');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects tracked media, captions, caches, credentials and stray files in services/', () => {
    for (const filename of ['source.mp4', 'captions.json3', 'captions.vtt', 'cookies.txt', '.env', '.local/source.json', 'site/public/models/weights.bin', 'notes/vectors.bin']) {
      expect(() => checkTrackedFile(filename, Buffer.from('fixture'))).toThrow();
    }
    expect(() => checkTrackedFile('README.md', Buffer.from(['-----BEGIN ', 'OPENSSH PRIVATE KEY-----'].join('')))).toThrow('Credential');
    expect(() => checkTrackedFile('services/2026-09-06.yaml', Buffer.from('recordingTitle: x'))).not.toThrow();
    expect(() => checkTrackedFile('services/2026-09-06-2.yaml', Buffer.from('recordingTitle: x'))).not.toThrow();
    expect(() => checkTrackedFile('services/2026/2026-09-06/service.yaml', Buffer.from('id: x'))).toThrow('Only recording files');
    expect(() => checkTrackedFile('services/notes.md', Buffer.from('notes'))).toThrow('Only recording files');
  });
});

describe('workflow policy (configuration, not a live deployment)', () => {
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const discovery = parse(readFileSync('.github/workflows/discovery.yml', 'utf8'));
  it('gates the sole production artifact and deployment on both required checks and main', () => {
    expect(ci.on.pull_request_target).toBeUndefined();
    expect(ci.permissions).toEqual({ contents: 'read' });
    expect(ci.jobs['build-pages'].needs).toEqual(['validate']);
    expect(ci.jobs.deploy.needs).toEqual(['validate', 'build-pages']);
    for (const job of [ci.jobs['build-pages'], ci.jobs.deploy]) expect(job.if).toContain("github.ref == 'refs/heads/main'");
    const artifacts = Object.values(ci.jobs).flatMap((job: unknown) => (job as { steps: { uses?: string; with?: unknown }[] }).steps).filter(step => step.uses?.includes('upload'));
    expect(artifacts).toEqual([{ uses: 'actions/upload-pages-artifact@v3', with: { path: 'dist/production' } }]);
    expect(ci.jobs.deploy.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
    expect(ci.jobs.browser.env.RECS_E2E_NO_MODEL).toBe('1');
    expect(ci.jobs.browser.steps.some((step: { run?: string }) => step.run === 'pnpm evaluate:core -- --exact-only')).toBe(true);
    expect(ci.jobs.validate.if).toBe('always()');
    expect(ci.jobs.validate.needs).toEqual(['quality', 'tests', 'browser']);
    for (const name of ci.jobs.validate.needs) expect(ci.jobs[name].needs).toBeUndefined();
    // Execute the actual gate, not just a string assertion: any failed/skipped/cancelled lane must block.
    const command = ci.jobs.validate.steps[0].run;
    for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
      const needs = Object.fromEntries(ci.jobs.validate.needs.map((name: string) => [name, { result: name === 'tests' ? result : 'success' }]));
      const run = () => execFileSync('sh', ['-c', command], { env: { ...process.env, CHECK_RESULTS: JSON.stringify(needs) }, stdio: 'pipe' });
      if (result === 'success') expect(run).not.toThrow();
      else expect(run).toThrow();
    }
  });
  it('limits serialized discovery to public metadata issues, with no content writes or inference', () => {
    expect(discovery.permissions).toEqual({ contents: 'read', issues: 'write' });
    expect(discovery.on.schedule[0].cron).toBe('17 1 * * 1');
    expect(discovery.on.workflow_dispatch.inputs.apply.default).toBe(false);
    expect(discovery.concurrency['cancel-in-progress']).toBe(false);
    const commands = discovery.jobs.discover.steps.map((step: { run?: string }) => step.run ?? '').join('\n');
    expect(commands).not.toMatch(/media:|captions:|transcrib|editorial:approve|git (?:commit|push)|build:preview/);
    expect(commands).toContain('pnpm discover --apply');
  });
});
