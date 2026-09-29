import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { SOURCE_CHANNEL_ID, type Service } from '../site/lib/archive';
import { CaptionProvenanceSchema, HistoricalVideoSchema as VideoSchema } from '../site/lib/processing-provenance';
import { validateServiceOutline } from '../scripts/validate-outlines';
import captionConfig from '../scripts/caption-config.json';
import { pagesBase, verifyPages } from '../scripts/pages';
import { buildIndex } from '../scripts/archive';
import { checkTrackedFile } from '../scripts/verify-tracked';
import { packChapterVectors } from '../site/lib/chapter-vectors';

const provenance = {
  engine: 'youtube-auto-captions', track: 'en-orig', gate_version: 1, video_id: 'AAAAAAAAAAA', yt_dlp_version: '2026.08.19',
  dictionary_id: captionConfig.dictionary.id, dictionary_blob_sha1: captionConfig.dictionary.gitBlobSha1,
  dictionary_sha256: captionConfig.dictionary.sha256, caption_sha256: 'b'.repeat(64), evidence_sha256: 'c'.repeat(64),
  fetched_at: '2026-09-21T01:00:00Z', words: 100, dictionary_words: 90, english_ratio: 0.9, words_per_minute: 100,
  scope: { start: 0, end: 60 },
};

describe('weekly caption provenance', () => {
  it('requires one natural sermon description and Title Case without imposing a chapter quota', () => {
    const service: Service = { id: 'fixture', date: '2026-01-04', title: 'Fixture Sermon', type: 'sermon', workflow_status: 'complete', editorial_status: 'needs_review',
      speakers: [], topics: [], videos: [], chapters: [], sermon_description: 'The speaker connects hope with care for others.' };
    expect(() => validateServiceOutline(service)).not.toThrow();
    for (const sermon_description of [undefined, 'Thesis: hope. Points: care.', '1. Hope', 'First paragraph.\n\nSecond paragraph.']) {
      expect(() => validateServiceOutline({ ...service, sermon_description })).toThrow();
    }
    service.chapters = [{ id: 'fixture-chapter', video_id: 'AAAAAAAAAAA', start: 0, end: 60, type: 'sermon', title: 'hope and care', summary: 'Internal.', keywords: [], topics: [], scripture: [] }];
    expect(() => validateServiceOutline(service)).toThrow('Title Case');
  });
  it('requires the original English track, pinned dictionary and internally consistent quality metrics', () => {
    expect(CaptionProvenanceSchema.parse(provenance)).toEqual(provenance);
    for (const change of [{ track: 'en' }, { dictionary_words: 89 }, { words: 0 }, { english_ratio: 0.89 },
      { words_per_minute: 221 }, { words_per_minute: 99 }, { dictionary_blob_sha1: 'f'.repeat(40) }, { private_path: '/private/evidence' }]) {
      expect(CaptionProvenanceSchema.safeParse({ ...provenance, ...change }).success).toBe(false);
    }
  });
  it('binds caption evidence to the exact physical video and scoped English timeline', () => {
    const video = { id: 'AAAAAAAAAAA', channel_id: SOURCE_CHANNEL_ID, duration: 120, sequence: 1,
      workflow_status: 'complete', media_disposition: 'playable', transcription_language: 'en',
      transcribed_span: { start: 0, end: 60 }, caption_provenance: provenance };
    expect(VideoSchema.safeParse(video).success).toBe(true);
    expect(VideoSchema.safeParse({ ...video, transcript_engine: 'youtube-auto-captions' }).success).toBe(true);
    expect(VideoSchema.safeParse({ ...video, transcript_engine: 'whisper.cpp' }).success).toBe(false);
    expect(VideoSchema.safeParse({ ...video, caption_provenance: undefined, transcript_engine: 'whisper.cpp' }).success).toBe(true);
    expect(VideoSchema.safeParse({ ...video, caption_provenance: undefined, transcript_engine: 'youtube-auto-captions' }).success).toBe(false);
    for (const change of [{ id: 'BBBBBBBBBBB' }, { duration: 50 }, { transcription_language: 'zh' },
      { transcribed_span: { start: 0, end: 120 } }, { workflow_status: 'registered' }]) {
      expect(VideoSchema.safeParse({ ...video, ...change }).success).toBe(false);
    }
  });
});

describe('production deployment boundary', () => {
  it('normalizes configured Pages paths without accepting remote or traversal inputs', () => {
    expect(pagesBase('')).toBe('/'); expect(pagesBase('/RECSVods')).toBe('/RECSVods/');
    for (const base of ['https://remote.test', '//remote.test', '/../secret', '/x?token=private', 'relative']) expect(() => pagesBase(base)).toThrow();
  });
  it('checks production mode, all direct routes, local assets and non-root containment', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'recs-pages-test-'));
    try {
      buildIndex(root);
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
  it('rejects tracked media/caption/cache/credential material but permits compact source vectors', () => {
    for (const filename of ['source.mp4', 'captions.json3', 'captions.vtt', 'cookies.txt', '.env', '.local/source.json', 'site/public/models/weights.bin']) {
      expect(() => checkTrackedFile(filename, Buffer.from('fixture'))).toThrow();
    }
    expect(() => checkTrackedFile('README.md', Buffer.from(['-----BEGIN ', 'OPENSSH PRIVATE KEY-----'].join('')))).toThrow('Credential');
    expect(() => checkTrackedFile('services/2026/fixture/chapter-vectors.bin', Buffer.from(packChapterVectors([])))).not.toThrow();
    expect(() => checkTrackedFile('services/2026/new/passages.internal.yaml', Buffer.from('private'))).toThrow('must stay private');
    expect(() => checkTrackedFile('services/2026/new/raw.json', Buffer.from('{}'))).toThrow('Unexpected service');
    expect(() => checkTrackedFile('services/2026/old/passages.internal.yaml', Buffer.from('preserved'), new Set(['services/2026/old/passages.internal.yaml']))).not.toThrow();
  });
});

describe('workflow policy (configuration, not a live deployment)', () => {
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const discovery = parse(readFileSync('.github/workflows/discovery.yml', 'utf8'));
  it('keeps weekly video checks read-only and separate from deployment and audio acquisition', () => {
    const checks = parse(readFileSync('.github/workflows/video-quirks.yml', 'utf8'));
    expect(checks.permissions).toEqual({ contents: 'read' });
    const commands = checks.jobs.embeds.steps.map((step: { run?: string }) => step.run ?? '').join('\n');
    expect(commands).toContain('check-embeds --all');
    expect(commands).not.toMatch(/--apply|check-audio|git (?:commit|push)|editorial:approve/);
  });
  it('gates the sole production artifact and deployment on both required checks and main', () => {
    expect(ci.on.pull_request_target).toBeUndefined();
    expect(ci.permissions).toEqual({ contents: 'read' });
    expect(ci.jobs['build-pages'].needs).toEqual(['validate', 'editorial-guard']);
    expect(ci.jobs.deploy.needs).toEqual(['validate', 'editorial-guard', 'build-pages']);
    for (const job of [ci.jobs['build-pages'], ci.jobs.deploy]) expect(job.if).toContain("github.ref == 'refs/heads/main'");
    const artifacts = Object.values(ci.jobs).flatMap((job: unknown) => (job as { steps: { uses?: string; with?: unknown }[] }).steps).filter(step => step.uses?.includes('upload'));
    expect(artifacts).toEqual([{ uses: 'actions/upload-pages-artifact@v3', with: { path: 'dist/production' } }]);
    expect(ci.jobs.deploy.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
    expect(ci.jobs.browser.env.RECS_E2E_NO_MODEL).toBe('1');
    expect(ci.jobs.browser.steps.some((step: { run?: string }) => step.run === 'pnpm evaluate:core -- --exact-only')).toBe(true);
    expect(ci.jobs.validate.if).toBe('always()');
    expect(ci.jobs.validate.needs).toEqual(['quality', 'tests', 'browser', 'editorial-guard']);
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
