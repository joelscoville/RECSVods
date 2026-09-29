import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flattenChapters, ServiceSchema, SOURCE_CHANNEL_ID } from '../site/lib/archive';
import { CORRECTION_KINDS, correctionConfig, correctionLinks, validateRepositoryUrl, validateSourceRef, type CorrectionConfig, type CorrectionTarget } from '../site/lib/corrections';
import { buildCorrectionConfig, resolveRepositoryConfig } from '../site/lib/source-links';
import CorrectionLinks from '../site/components/CorrectionLinks';
import RecordingResult from '../site/components/RecordingResult';
import BrowsePage from '../site/components/BrowsePage';
import { browseItems, displayServices, groupByRecording, homeItems } from '../site/components/archive-display';
import { buildBrowsePages } from '../site/lib/browse';

const repository = { repositoryUrl: 'https://github.com/example/renamed-archive', sourceRef: 'feat/corrections' };
function fixture() {
  return ServiceSchema.parse({
    id: 'fixture-service', date: '2026-07-12', title: 'Fictional service', type: 'service', workflow_status: 'complete', editorial_status: 'needs_review',
    speakers: [], topics: [],
    videos: ['VIDEO000001', 'VIDEO000002'].map((id, index) => ({ id, channel_id: SOURCE_CHANNEL_ID, duration: 189.25, sequence: index + 1, workflow_status: 'complete', media_disposition: 'playable' })),
    chapters: ['VIDEO000001', 'VIDEO000002'].map((video_id, index) => ({ id: `chapter-${index}`, video_id, start: 12.5, end: 42.75, title: 'Fictional chapter', type: 'sermon',
      summary: 'Fictional summary', keywords: ['example'], scripture: [], topics: [] })),
  });
}
function config() { return buildCorrectionConfig([fixture()], 'preview', repository); }
afterEach(() => vi.unstubAllGlobals());

describe('build-only repository and ref configuration', () => {
  it.each(['http://github.com/a/b', 'https://elsewhere.test/a/b', 'https://github.com.evil.test/a/b', 'https://user:secret@github.com/a/b', 'https://github.com:443/a/b', 'https://github.com/a/b?token=x', 'https://github.com/a/b#x', 'https://github.com/a/../b', 'https://github.com/a/%2e%2e', '//github.com/a/b', 'javascript:alert(1)'])('rejects unsafe repository %s', (value) => {
    expect(validateRepositoryUrl(value)).toBeUndefined(); expect(correctionLinks({ chapterId: 'chapter-0' }, '/', { ...config(), repositoryUrl: value })).toEqual({});
  });
  it.each(['HEAD', '../main', '-option', 'a//b', 'a/./b', 'a.lock', 'a..b', 'a b', 'a\nb', 'a?b', 'a\\b'])('rejects unsafe ref %s', (ref) => expect(validateSourceRef(ref)).toBeUndefined());
  it('requires an explicit public correction repository; never assumes Git or CI repositories are public', () => {
    const git = vi.fn((args: string[]) => args[0] === 'remote' ? 'git@github.com:example/local-name.git' : 'feat/local-branch');
    expect(resolveRepositoryConfig({ PUBLIC_REPOSITORY_URL: repository.repositoryUrl, PUBLIC_SOURCE_REF: 'review/v2', GITHUB_REPOSITORY: 'example/old' }, git)).toEqual({ ...repository, sourceRef: 'review/v2' });
    expect(git).not.toHaveBeenCalled();
    expect(resolveRepositoryConfig({ GITHUB_REPOSITORY: 'example/new-name', GITHUB_HEAD_REF: 'feat/pr-head' }, git)).toEqual({ repositoryUrl: undefined, sourceRef: 'feat/pr-head' });
    expect(resolveRepositoryConfig({}, git)).toEqual({ repositoryUrl: undefined, sourceRef: 'feat/local-branch' });
    expect(resolveRepositoryConfig({}, () => undefined)).toEqual({ repositoryUrl: undefined, sourceRef: undefined });
    expect(() => resolveRepositoryConfig({ PUBLIC_REPOSITORY_URL: 'https://secret@github.com/a/b' }, git)).toThrow(/PUBLIC_REPOSITORY_URL/);
    expect(() => resolveRepositoryConfig({ PUBLIC_SOURCE_REF: '../escape' }, git)).toThrow(/PUBLIC_SOURCE_REF/);
  });
  it('accepts a separate contact destination and rejects unsafe schemes or credentials', () => {
    for (const url of ['https://example.org/corrections', 'mailto:editor@example.org']) {
      const destination = resolveRepositoryConfig({ PUBLIC_CORRECTIONS_URL: url }, () => undefined);
      expect(correctionLinks({ chapterId: 'chapter-0' }, '/', { ...config(), ...destination })).toEqual({ issueUrl: url });
    }
    for (const url of ['javascript:alert(1)', 'http://example.org', 'https://secret@example.org', 'mailto:editor@example.org%0aBcc:private@example.org']) {
      expect(() => resolveRepositoryConfig({ PUBLIC_CORRECTIONS_URL: url }, () => undefined)).toThrow('PUBLIC_CORRECTIONS_URL');
    }
  });
});

describe('stable chapter correction context and privacy', () => {
  it.each(['/', '/renamed/', '/nested/review/'])('uses canonical chapter and service paths under %s', (base) => {
    const params = new URL(correctionLinks({ chapterId: 'chapter-1' }, base, config(), 'chapter time').issueUrl!).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ template: 'archive-correction.yml', 'service-id': 'fixture-service', 'video-id': 'VIDEO000002', 'chapter-id': 'chapter-1', timestamps: 'VIDEO000002: 0:12.5–0:42.75', page: `${base}watch/?chapter=chapter-1`, problem: 'chapter time' });
    for (const field of ['service-id', 'video-id', 'chapter-id', 'timestamps', 'page']) expect(params.get('body')).toContain(`### ${field}\n${params.get(field)}`);
    for (const choice of CORRECTION_KINDS) expect(params.get('body')).toContain(`- [${choice === 'chapter time' ? 'x' : ' '}] ${choice}`);
    expect(params.has('passage-id')).toBe(false); expect(params.has('section-id')).toBe(false);
    const service = new URL(correctionLinks({ serviceId: 'fixture-service' }, base, config()).issueUrl!).searchParams;
    expect(service.get('page')).toBe(`${base}services/fixture-service/`); expect(service.get('video-id')).toBe('VIDEO000001, VIDEO000002');
    expect(service.get('timestamps')).toBe('VIDEO000001: 0:00–3:09.25\nVIDEO000002: 0:00–3:09.25');
  });
  it('ignores unrelated properties, private query/history and resume time', () => {
    const target = { serviceId: 'fixture-service', videoId: 'VIDEO000002', start: 77, time: 88, q: 'PRIVATE QUERY', history: ['PRIVATE HISTORY'], resume: 'PRIVATE RESUME', body: 'PRIVATE BODY', page: '/search/?q=PRIVATE', localPath: '/Users/private/file' };
    const links = correctionLinks(target, '/review/', config());
    const params = new URL(links.issueUrl!).searchParams;
    expect(params.get('page')).toBe('/review/watch/?service=fixture-service&video=VIDEO000002');
    expect(params.get('timestamps')).toBe('VIDEO000002: 0:00–3:09.25');
    expect(params.get('body')).not.toMatch(/PRIVATE|77|88|Users|q=|history|resume/);
    expect(new URL(correctionLinks(target, '/', config(), 'PRIVATE KIND' as never).issueUrl!).searchParams.has('problem')).toBe(false);
    expect(JSON.stringify(config())).not.toMatch(/PRIVATE|review_notes|sourcePath|workflow_status|confidence/);
    expect(Object.keys(links)).toEqual(['issueUrl']);
  });
  it('rejects unknown, injected and inconsistent identifiers or bounds', () => {
    for (const target of [{ chapterId: 'missing' }, { chapterId: 'constructor' }, { serviceId: 'fixture-service', videoId: 'UNKNOWN0000' }, { serviceId: '../../private' }, { chapterId: 'c&body=INJECT\n' }]) expect(correctionLinks(target as CorrectionTarget, '/', config())).toEqual({});
    for (const change of [{ start: -1 }, { end: 190 }, { end: 12.5 }, { start: NaN }, { end: Infinity }, { serviceId: 'missing' }, { videoId: 'UNKNOWN0000' }]) {
      const data = config(); Object.assign(data.chapters['chapter-0'], change);
      expect(correctionLinks({ chapterId: 'chapter-0' }, '/', data)).toEqual({});
    }
    expect(correctionLinks({ chapterId: 'chapter-0' }, '/', { ...config(), sourceRef: undefined }).issueUrl).toContain('/issues/new?');
    expect(() => correctionLinks({ chapterId: 'chapter-0' }, '/review/../escape/', config())).toThrow('Invalid deployment base');
  });
  it('excludes failed/rejected/unassessed uploads and unreviewed production IDs', () => {
    const service = fixture(); expect(buildCorrectionConfig([service], 'production', repository)).toMatchObject({ services: {}, chapters: {} });
    for (const disposition of ['failed', 'rejected', 'unassessed'] as const) {
      service.videos[1].media_disposition = disposition; service.videos[1].disposition_evidence = 'PRIVATE EVIDENCE';
      expect(JSON.stringify(buildCorrectionConfig([service], 'preview', repository))).not.toMatch(/VIDEO000002|chapter-1|PRIVATE/);
    }
  });
});

describe('rendered links and form', () => {
  it('renders one native no-referrer suggestion with an honest unavailable state', () => {
    const html = renderToStaticMarkup(createElement(CorrectionLinks, { target: { chapterId: 'chapter-0' }, base: '/', config: config() }));
    expect(html.match(/Suggest a correction/g)).toHaveLength(1); expect(html).not.toContain('Edit this transcript');
    expect(html).toContain('rel="noreferrer"'); expect(html).toMatch(/referrerpolicy="no-referrer"/i); expect(html).not.toMatch(/<button|aria-live|role="button"/);
    const unavailable: CorrectionConfig = { services: {}, chapters: {} };
    expect(renderToStaticMarkup(createElement(CorrectionLinks, { target: { serviceId: 'missing' }, base: '/', config: unavailable }))).toContain('Correction links are unavailable');
  });
  it('keeps search results and browse lists free of per-item correction links', () => {
    const serialized = JSON.parse(JSON.stringify(config())); vi.stubGlobal('__RECS_CORRECTIONS__', serialized);
    expect(correctionConfig()).toEqual(serialized);
    const chapters = flattenChapters([fixture()], 'preview');
    const services = displayServices([fixture()], chapters);
    const [grouped] = groupByRecording([{ chapter: chapters[0], reasons: ['Private search match sentinel'] }], homeItems(services, '/review/'), '/review/');
    const card = renderToStaticMarkup(createElement(RecordingResult, grouped));
    expect(card).not.toContain('Suggest a correction'); expect(card).toContain('/watch/?chapter=chapter-0');
    const page = buildBrowsePages(services).find((item) => item.path === 'all')!;
    const html = renderToStaticMarkup(createElement(BrowsePage, { page, items: browseItems(page, services, '/review/'), base: '/review/' }));
    expect(html).not.toContain('Suggest a correction'); expect(html).not.toContain('Edit this transcript');
    for (const [, href] of card.matchAll(/href="([^"]+\/issues\/new[^"]*)"/g)) expect(href).not.toContain('sentinel');
  });
  it('matches issue-form IDs and choices with the Markdown fallback', () => {
    const document = parseDocument(readFileSync(new URL('../.github/ISSUE_TEMPLATE/archive-correction.yml', import.meta.url), 'utf8'), { uniqueKeys: true });
    expect(document.errors).toEqual([]); const form = document.toJS(); expect(form.labels).toBeUndefined();
    const fields = form.body.filter((field: { id?: string }) => field.id), ids = fields.map((field: { id: string }) => field.id);
    expect(new Set(ids).size).toBe(ids.length);
    const params = new URL(correctionLinks({ chapterId: 'chapter-0' }, '/', config(), 'title').issueUrl!).searchParams;
    expect(ids).not.toContain('body'); expect(params.get('body')).toContain('## Suggested correction');
    for (const key of params.keys()) if (!['template', 'title', 'body'].includes(key)) expect(ids).toContain(key);
    expect(fields.find((field: { id: string }) => field.id === 'problem').attributes.options).toEqual([...CORRECTION_KINDS]);
  });
});
