import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flattenArchive, loadArchive, publishedServices, ServiceSchema, ServiceSourceSchema, SOURCE_CHANNEL_ID } from '../site/lib/archive';
import { CORRECTION_KINDS, correctionConfig, correctionLinks, sourceFileUrl, validateRepositoryUrl, validateSourceRef, type CorrectionConfig, type CorrectionTarget } from '../site/lib/corrections';
import { buildCorrectionConfig, gitReader, loadCorrectionConfig, resolveRepositoryConfig } from '../site/lib/source-links';
import CorrectionLinks from '../site/components/CorrectionLinks';
import PassageResult from '../site/components/PassageResult';
import BrowsePage from '../site/components/BrowsePage';
import { displayServices } from '../site/components/archive-display';
import { buildBrowsePages } from '../site/lib/browse';

const repository = { repositoryUrl: 'https://github.com/example/renamed-archive', sourceRef: 'feat/corrections' };
const filename = 'services/2026/fixture-service/service.yaml';
function fixture() {
  return ServiceSchema.parse({
    id: 'fixture-service', date: '2026-07-12', title: 'Fictional service', type: 'service', workflow_status: 'complete', editorial_status: 'needs_review',
    review_notes: ['PRIVATE REVIEW SENTINEL'], speakers: [], topics: [],
    videos: ['VIDEO000001', 'VIDEO000002'].map((id, index) => ({ id, channel_id: SOURCE_CHANNEL_ID, duration: 189.25, sequence: index + 1, workflow_status: 'complete', media_disposition: 'playable' })),
    sections: ['VIDEO000001', 'VIDEO000002'].map((video_id, index) => ({ id: `section-${index}`, video_id, start: 0, end: 189.25, title: 'Fictional section', type: 'sermon', confidence: 0.7 })),
    passages: ['VIDEO000001', 'VIDEO000002'].map((video_id, index) => ({ id: `passage-${index}`, video_id, section_id: `section-${index}`, start: 12.5, end: 42.75, title: 'Fictional passage', type: 'sermon', confidence: 0.7,
      summary: 'Fictional summary', transcript: 'PRIVATE TRANSCRIPT SENTINEL', questions: [], scripture: [], topics: [] })),
  });
}
function config() {
  const service = fixture();
  return buildCorrectionConfig([service], 'preview', repository, new Set([filename]), () => stringify(service));
}
afterEach(() => vi.unstubAllGlobals());

describe('repository and ref configuration', () => {
  it('supports repository renames and encodes the entire ref separately from file segments', () => {
    expect(sourceFileUrl(repository.repositoryUrl, 'feat/fix#1&more', filename)).toBe('https://github.com/example/renamed-archive/edit/feat%2Ffix%231%26more/services/2026/fixture-service/service.yaml');
    expect(sourceFileUrl(repository.repositoryUrl, 'release/v1', filename, 'blob')).toContain('/blob/release%2Fv1/');
    expect(sourceFileUrl(repository.repositoryUrl, 'feat/corrections', filename)).not.toContain('#L');
  });
  it.each(['http://github.com/a/b', 'https://elsewhere.test/a/b', 'https://github.com.evil.test/a/b', 'https://user:secret@github.com/a/b', 'https://github.com:443/a/b', 'https://github.com/a/b?token=x', 'https://github.com/a/b#x', 'https://github.com/a/../b', 'https://github.com/a/%2e%2e', 'https://github.com/a/b/issues', '//github.com/a/b', 'javascript:alert(1)'])('rejects unsafe repository %s', (value) => {
    expect(validateRepositoryUrl(value)).toBeUndefined();
    expect(correctionLinks({ passageId: 'passage-0' }, '/', { ...config(), repositoryUrl: value })).toEqual({});
  });
  it.each(['HEAD', '../main', '-option', 'a//b', 'a/./b', 'a.lock', 'a..b', 'a b', 'a\nb', 'a?b', 'a\\b'])('rejects unsafe ref %s', (ref) => expect(validateSourceRef(ref)).toBeUndefined());
  it('prefers explicit settings, then CI source branch, then local Git (never a hardcoded branch)', () => {
    const git = vi.fn((args: string[]) => args[0] === 'remote' ? 'git@github.com:example/local-name.git' : 'feat/local-branch');
    expect(resolveRepositoryConfig({ PUBLIC_REPOSITORY_URL: repository.repositoryUrl, PUBLIC_SOURCE_REF: 'review/v2', GITHUB_REPOSITORY: 'example/old' }, git)).toEqual({ ...repository, sourceRef: 'review/v2' });
    expect(git).not.toHaveBeenCalled();
    expect(resolveRepositoryConfig({ GITHUB_REPOSITORY: 'example/new-name', GITHUB_HEAD_REF: 'feat/pr-head', GITHUB_REF_NAME: '9/merge' }, git)).toEqual({ repositoryUrl: 'https://github.com/example/new-name', sourceRef: 'feat/pr-head' });
    expect(resolveRepositoryConfig({}, git)).toEqual({ repositoryUrl: 'https://github.com/example/local-name', sourceRef: 'feat/local-branch' });
    expect(resolveRepositoryConfig({}, () => undefined)).toEqual({ repositoryUrl: undefined, sourceRef: undefined });
    expect(() => resolveRepositoryConfig({ PUBLIC_REPOSITORY_URL: 'https://secret@github.com/a/b' }, git)).toThrow(/PUBLIC_REPOSITORY_URL/);
    expect(() => resolveRepositoryConfig({ PUBLIC_SOURCE_REF: '../escape' }, git)).toThrow(/PUBLIC_SOURCE_REF/);
  });
});

// Opt-in acceptance against real Astro output: run after a non-root pnpm build:preview.
// No mocked helper/build constant, network request or GitHub issue creation is involved.
it.runIf(process.env.RECS_TEST_PREVIEW_CORRECTIONS === '1')('verifies correction links in the built non-root preview', () => {
  const root = process.cwd();
  const output = path.join(root, 'dist/preview');
  const build = JSON.parse(readFileSync(path.join(output, 'build-mode.json'), 'utf8')) as { mode: string; base: string };
  expect(build.mode).toBe('preview');
  expect(build.base).not.toBe('/');
  const services = publishedServices(loadArchive(root), 'preview');
  const data = loadCorrectionConfig(root, { ...process.env, ARCHIVE_MODE: 'preview' });
  expect(data.repositoryUrl).toMatch(/^https:\/\/github\.com\//);
  expect(data.sourceRef).toBeTruthy();
  const tracked = new Set(gitReader(root)(['ls-files', '-z', '--', 'services'])?.split('\0'));
  const links = (html: string, label: string) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter((match) => match[2].startsWith(label))
    .map((match) => {
      expect(match[1]).toMatch(/\brel="noreferrer"/);
      expect(match[1]).toMatch(/\breferrerpolicy="no-referrer"/i);
      const href = /\bhref="([^"]+)"/.exec(match[1])?.[1];
      expect(href).toBeTruthy();
      return new URL(href!.replaceAll('&amp;', '&'));
    });
  let suggestions = 0;
  let trackedEdits = 0;
  let untrackedSuggestions = 0;
  for (const service of services) {
    const servicePath = `services/${service.date.slice(0, 4)}/${service.id}/service.yaml`;
    const source = ServiceSourceSchema.parse(parseDocument(readFileSync(path.join(root, servicePath), 'utf8')).toJS());
    const html = readFileSync(path.join(output, 'services', service.id, 'index.html'), 'utf8');
    expect(html).not.toContain('Correction links are unavailable');
    const suggestionsOnPage = links(html, 'Suggest a correction');
    expect(suggestionsOnPage).toHaveLength(service.passages.length + 1);
    const wholeService = suggestionsOnPage.find((url) => url.searchParams.get('page') === `${build.base}services/${service.id}/`);
    expect(wholeService?.searchParams.get('service-id')).toBe(service.id);
    const cards = [...html.matchAll(/<article class="passage-result">([\s\S]*?)<\/article>/g)];
    expect(cards).toHaveLength(service.passages.length);
    for (const [index, card] of cards.entries()) {
      const passage = service.passages[index];
      const issueLinks = links(card[1], 'Suggest a correction');
      expect(issueLinks).toHaveLength(1);
      const url = issueLinks[0];
      expect(url.origin + url.pathname).toBe(`${data.repositoryUrl}/issues/new`);
      expect(Object.fromEntries([...url.searchParams].filter(([key]) => key !== 'body'))).toEqual({
        template: 'archive-correction.yml', title: `Archive correction: ${passage.id}`,
        'service-id': service.id, 'video-id': passage.video_id, 'passage-id': passage.id,
        'section-id': passage.section_id, timestamps: `${passage.video_id}: ${passage.start}–${passage.end} seconds`,
        page: `${build.base}watch/?id=${passage.id}`,
      });
      for (const field of ['service-id', 'video-id', 'passage-id', 'section-id', 'timestamps', 'page']) {
        expect(url.searchParams.get('body')).toContain(`### ${field}\n${url.searchParams.get(field)}`);
      }
      for (const choice of CORRECTION_KINDS) expect(url.searchParams.get('body')).toContain(`- [ ] ${choice}`);
      suggestions++;
      const sourcePath = data.passages[passage.id].sourcePath;
      const original = source.passages.find((item) => item.id === passage.id)!;
      const candidate = original.transcript_file ? path.posix.join(path.posix.dirname(servicePath), original.transcript_file) : servicePath;
      const expectedSource = tracked.has(servicePath) && tracked.has(candidate) ? candidate : undefined;
      expect(sourcePath).toBe(expectedSource);
      const edits = links(card[1], 'Edit this transcript');
      if (sourcePath) {
        expect(tracked.has(sourcePath)).toBe(true);
        expect(edits).toHaveLength(1);
        expect(edits[0].href).toBe(sourceFileUrl(data.repositoryUrl!, data.sourceRef!, sourcePath));
        expect(edits[0].hash).toBe('');
        trackedEdits++;
      } else {
        expect(edits).toHaveLength(0);
        if (!tracked.has(servicePath)) untrackedSuggestions++;
      }
    }
  }
  expect(Object.keys(data.passages)).toHaveLength(suggestions);
  const chunks = readdirSync(path.join(output, '_astro'));
  const correctionChunk = chunks.find((file) => /^CorrectionLinks\..*\.js$/.test(file));
  expect(correctionChunk).toBeTruthy();
  const client = readFileSync(path.join(output, '_astro', correctionChunk!), 'utf8');
  expect(client).not.toMatch(/__RECS_CORRECTIONS__|node:fs|node:child_process|execFileSync|readFileSync/);
  for (const service of services) for (const passage of service.passages) expect(client).toContain(passage.id);
  const browseDirectory = path.join(output, 'browse', 'topics');
  let browseCards = 0;
  for (const topic of readdirSync(browseDirectory, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const html = readFileSync(path.join(browseDirectory, topic.name, 'index.html'), 'utf8');
    expect(html).not.toContain('Correction links are unavailable');
    const cards = [...html.matchAll(/<article class="passage-result">([\s\S]*?)<\/article>/g)];
    for (const card of cards) expect(links(card[1], 'Suggest a correction')).toHaveLength(1);
    browseCards += cards.length;
  }
  expect(browseCards).toBeGreaterThan(0);
  console.info(`Built preview corrections: ${suggestions} passage suggestions, ${trackedEdits} tracked-source edits, ${untrackedSuggestions} untracked-source suggestions without edits, ${services.length} service suggestions, ${browseCards} topic-browse cards.`);
});

describe('stable correction context and privacy', () => {
  it.each(['/', '/renamed/', '/nested/review/'])('uses canonical passage and service paths under %s', (base) => {
    const links = correctionLinks({ passageId: 'passage-1' }, base, config(), 'timestamp');
    const url = new URL(links.issueUrl!);
    expect(url.origin + url.pathname).toBe(`${repository.repositoryUrl}/issues/new`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ template: 'archive-correction.yml', 'service-id': 'fixture-service', 'video-id': 'VIDEO000002', 'passage-id': 'passage-1', 'section-id': 'section-1', timestamps: 'VIDEO000002: 12.5–42.75 seconds', page: `${base}watch/?id=passage-1`, problem: 'timestamp' });
    for (const field of ['service-id', 'video-id', 'passage-id', 'section-id', 'timestamps', 'page']) expect(url.searchParams.get('body')).toContain(`### ${field}\n${url.searchParams.get(field)}`);
    for (const choice of CORRECTION_KINDS) expect(url.searchParams.get('body')).toContain(`- [${choice === 'timestamp' ? 'x' : ' '}] ${choice}`);
    const service = new URL(correctionLinks({ serviceId: 'fixture-service' }, base, config()).issueUrl!);
    expect(service.searchParams.get('page')).toBe(`${base}services/fixture-service/`);
    expect(service.searchParams.get('video-id')).toBe('VIDEO000001, VIDEO000002');
    expect(service.searchParams.get('timestamps')).toBe('VIDEO000001: 0–189.25 seconds\nVIDEO000002: 0–189.25 seconds');
  });
  it('only emits known IDs and public bounds, even with unrelated properties supplied', () => {
    const target = { serviceId: 'fixture-service', videoId: 'VIDEO000002', start: 77, time: 88, q: 'PRIVATE QUERY', history: ['PRIVATE HISTORY'], resume: 'PRIVATE RESUME', body: 'PRIVATE BODY', problem: 'PRIVATE PROBLEM', page: '/search/?q=PRIVATE', localPath: '/Users/private/file' };
    const links = correctionLinks(target, '/review/', config());
    const params = new URL(links.issueUrl!).searchParams;
    expect(params.get('page')).toBe('/review/watch/?service=fixture-service&video=VIDEO000002');
    expect(params.get('timestamps')).toBe('VIDEO000002: 0–189.25 seconds');
    expect(params.get('body')).toContain('### page\n/review/watch/?service=fixture-service&video=VIDEO000002');
    expect(params.get('body')).not.toMatch(/PRIVATE|77|88|Users|q=|history|resume/);
    const invalidKind = new URL(correctionLinks(target, '/review/', config(), 'PRIVATE KIND' as never).issueUrl!).searchParams;
    expect(invalidKind.has('problem')).toBe(false);
    expect(invalidKind.get('body')).not.toContain('PRIVATE');
    expect(decodeURIComponent(links.issueUrl!)).not.toMatch(/PRIVATE|77|88|Users|q=/);
    expect(JSON.stringify(config())).not.toMatch(/PRIVATE|review_notes|transcript_sha256|audio_sha256|workflow_status|confidence/);
  });
  it('rejects unknown, injected or inconsistent identifiers and bounds', () => {
    for (const target of [{ passageId: 'missing' }, { passageId: 'constructor' }, { serviceId: 'fixture-service', videoId: 'UNKNOWN0000' }, { serviceId: '../../private' }, { passageId: 'p&body=INJECT\n' }]) {
      expect(correctionLinks(target as CorrectionTarget, '/', config())).toEqual({});
    }
    for (const change of [{ start: -1 }, { end: 190 }, { end: 12.5 }, { start: NaN }, { end: Infinity }, { sectionId: 's\nINJECT' }, { sectionId: 'section-1' }, { serviceId: 'missing' }, { videoId: 'UNKNOWN0000' }]) {
      const data = config(); Object.assign(data.passages['passage-0'], change);
      expect(correctionLinks({ passageId: 'passage-0' }, '/', data)).toEqual({});
    }
    expect(() => correctionLinks({ passageId: 'passage-0' }, '/review/../escape/', config())).toThrow('Invalid deployment base');
  });
  it('keeps suggestions available when the source ref is unknown', () => {
    const links = correctionLinks({ passageId: 'passage-0' }, '/', { ...config(), sourceRef: undefined });
    expect(links.issueUrl).toContain('/issues/new?'); expect(links.editUrl).toBeUndefined();
  });
  it('prefills a known section on its own upload with exact bounds, rejecting mismatched uploads', () => {
    const data = config();
    data.services['fixture-service'].sections[1].start = 12.5;
    const target = { serviceId: 'fixture-service', videoId: 'VIDEO000002', sectionId: 'section-1' };
    const params = new URL(correctionLinks(target, '/nested/review/', data).issueUrl!).searchParams;
    expect(params.get('section-id')).toBe('section-1');
    expect(params.get('passage-id')).toBe('Not selected (whole section)');
    expect(params.get('timestamps')).toBe('VIDEO000002: 12.5–189.25 seconds');
    expect(params.get('page')).toBe('/nested/review/watch/?service=fixture-service&video=VIDEO000002&t=12');
    expect(correctionLinks({ ...target, videoId: 'VIDEO000001' }, '/', data)).toEqual({});
  });
});

describe('source pointers and publication allowlist', () => {
  it('links tracked inline YAML but never claims an untracked service has an editable source', () => {
    expect(correctionLinks({ passageId: 'passage-0' }, '/', config()).editUrl).toContain(`/services/2026/fixture-service/service.yaml`);
    const data = buildCorrectionConfig([fixture()], 'preview', repository, new Set(), () => stringify(fixture()));
    expect(correctionLinks({ passageId: 'passage-0' }, '/', data)).toMatchObject({ issueUrl: expect.stringContaining('/issues/new?'), editUrl: undefined });
  });
  it('recovers the actual Markdown pointer, not a guessed transcript filename or YAML fallback', () => {
    const service = fixture();
    const source = { ...service, passages: service.passages.map(({ transcript: _transcript, ...passage }, index) => ({ ...passage, transcript_file: `transcripts/actual-${index}.md` })) };
    const paths = [filename, 'services/2026/fixture-service/transcripts/actual-0.md'];
    const data = buildCorrectionConfig([service], 'preview', repository, new Set(paths), (file) => file === filename ? stringify(source) : 'Fictional Markdown');
    expect(correctionLinks({ passageId: 'passage-0' }, '/', data).editUrl).toContain('/transcripts/actual-0.md');
    expect(correctionLinks({ passageId: 'passage-1' }, '/', data).editUrl).toBeUndefined();
    expect(correctionLinks({ serviceId: service.id }, '/', data).editUrl).toBeUndefined();
  });
  it.each(['../../private.md', '/Users/private.md', 'transcripts/../secret.md', 'transcripts/%2e%2e/secret.md', 'transcripts/a.md?token=x', 'transcripts/a\\b.md'])('rejects unsafe original pointers %s', (pointer) => {
    const service = fixture();
    const source = { ...service, passages: service.passages.map(({ transcript: _transcript, ...passage }) => ({ ...passage, transcript_file: pointer })) };
    const data = buildCorrectionConfig([service], 'preview', repository, new Set([filename, pointer]), () => stringify(source));
    expect(correctionLinks({ passageId: 'passage-0' }, '/', data).editUrl).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain(pointer);
    expect(sourceFileUrl(repository.repositoryUrl, 'main', pointer)).toBeUndefined();
  });
  it('does not expose failed/rejected/unassessed uploads or unreviewed production IDs', () => {
    const service = fixture();
    expect(buildCorrectionConfig([service], 'production', repository, new Set([filename]), () => stringify(service))).toMatchObject({ services: {}, passages: {} });
    for (const disposition of ['failed', 'rejected', 'unassessed'] as const) {
      service.videos[1].media_disposition = disposition;
      service.videos[1].disposition_evidence = 'PRIVATE EVIDENCE';
      const data = buildCorrectionConfig([service], 'preview', repository, new Set([filename]), () => stringify(service));
      expect(JSON.stringify(data)).not.toMatch(/VIDEO000002|passage-1|section-1|PRIVATE/);
    }
  });
  it('does not edit another service or leak unreadable source errors', () => {
    const data = config(); data.passages['passage-0'].sourcePath = 'services/2026/another-service/service.yaml';
    expect(correctionLinks({ passageId: 'passage-0' }, '/', data).editUrl).toBeUndefined();
    const unreadable = buildCorrectionConfig([fixture()], 'preview', repository, new Set([filename]), () => 'invalid: [');
    expect(correctionLinks({ passageId: 'passage-0' }, '/', unreadable).editUrl).toBeUndefined();
  });
});

describe('rendered links and repository templates', () => {
  it('uses native no-referrer links and renders without hydration or faux button state', () => {
    const html = renderToStaticMarkup(createElement(CorrectionLinks, { target: { passageId: 'passage-0' }, base: '/', config: config() }));
    expect(html).toContain('Suggest a correction'); expect(html).toContain('Edit this transcript');
    expect(html).toContain('rel="noreferrer"'); expect(html).toMatch(/referrerpolicy="no-referrer"/i);
    expect(html).not.toMatch(/<button|aria-live|role="button"/);
    expect(html).toContain('&amp;');
    const unavailable: CorrectionConfig = { services: {}, passages: {} };
    expect(renderToStaticMarkup(createElement(CorrectionLinks, { target: { serviceId: 'missing' }, base: '/', config: unavailable }))).toContain('Correction links are unavailable');
  });
  it('covers unchanged browse/search call sites with no source props', () => {
    // Match Vite define's serialized object semantics without mocking the helper or supplying source props.
    const serialized = JSON.parse(JSON.stringify(config()));
    vi.stubGlobal('__RECS_CORRECTIONS__', serialized);
    expect(correctionConfig()).toEqual(serialized);
    const passages = flattenArchive([fixture()], 'preview');
    const card = renderToStaticMarkup(createElement(PassageResult, { passage: passages[0], base: '/review/', reasons: ['Private search match sentinel'] }));
    expect(card).toContain('Suggest a correction');
    expect(card).toContain('Edit this transcript');
    expect(card).not.toContain('Correction links are unavailable');
    const services = displayServices([fixture()], passages);
    const page = buildBrowsePages(services).find((item) => item.path === 'sermons')!;
    const html = renderToStaticMarkup(createElement(BrowsePage, { page, services, base: '/review/' }));
    // A passage leaf definitely renders PassageResult regardless of the sermon page's chapter grouping.
    const leaf = { ...page, serviceIds: [], sectionIds: [], passageIds: passages.map((item) => item.id) };
    const leafHtml = renderToStaticMarkup(createElement(BrowsePage, { page: leaf, services, base: '/review/' }));
    expect(html).toContain('Fictional');
    expect(leafHtml.match(/Suggest a correction/g)).toHaveLength(2);
    expect(leafHtml.match(/Edit this transcript/g)).toHaveLength(2);
    expect(leafHtml).not.toContain('Correction links are unavailable');
    for (const [, href] of card.matchAll(/href="([^"]+\/issues\/new[^"]*)"/g)) expect(href).not.toContain('sentinel');
  });
  it('parses the issue form, matches prefill IDs/choices, and requires no pre-existing labels', () => {
    const document = parseDocument(readFileSync(new URL('../.github/ISSUE_TEMPLATE/archive-correction.yml', import.meta.url), 'utf8'), { uniqueKeys: true });
    expect(document.errors).toEqual([]);
    const form = document.toJS();
    expect(form.labels).toBeUndefined();
    const fields = form.body.filter((field: { id?: string }) => field.id);
    const ids = fields.map((field: { id: string }) => field.id);
    expect(new Set(ids).size).toBe(ids.length);
    const params = new URL(correctionLinks({ passageId: 'passage-0' }, '/', config(), 'transcript').issueUrl!).searchParams;
    // body is GitHub's reserved standard-issue fallback, not an issue-form ID.
    expect(ids).not.toContain('body');
    expect(params.get('body')).toContain('## Suggested correction');
    for (const key of params.keys()) if (!['template', 'title', 'body'].includes(key)) expect(ids).toContain(key);
    expect(fields.find((field: { id: string }) => field.id === 'problem').attributes.options).toEqual([...CORRECTION_KINDS]);
    const template = readFileSync(new URL('../.github/pull_request_template.md', import.meta.url), 'utf8');
    expect(template).toContain('## Code review'); expect(template).toContain('## Editorial review');
    expect(template).toContain('pnpm build:preview'); expect(template).toContain('pnpm editorial:approve -- <service-id> --reviewer <name>');
    expect(template).toContain('Agents must never run this command');
  });
});
