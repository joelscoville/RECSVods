import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { correctionConfig, validateRepositoryUrl, validateSourceRef } from '../site/lib/corrections';
import { resolveRepositoryConfig } from '../site/lib/source-links';
import CorrectionLinks from '../site/components/CorrectionLinks';
import RecordingResult from '../site/components/RecordingResult';
import BrowsePage from '../site/components/BrowsePage';
import { browseItems, groupByRecording, homeItems } from '../site/components/archive-display';
import { buildBrowsePages } from '../site/lib/browse';
import { searchUnits } from '../site/lib/display';
import { editUrl } from '../site/lib/urls';
import { display } from './recording-fixtures';

const repository = { repositoryUrl: 'https://github.com/example/renamed-archive', sourceRef: 'feat/corrections' };
afterEach(() => vi.unstubAllGlobals());

describe('build-only repository and ref configuration', () => {
  it.each(['http://github.com/a/b', 'https://elsewhere.test/a/b', 'https://github.com.evil.test/a/b', 'https://user:secret@github.com/a/b', 'https://github.com:443/a/b', 'https://github.com/a/b?token=x', 'https://github.com/a/b#x', 'https://github.com/a/../b', 'https://github.com/a/%2e%2e', '//github.com/a/b', 'javascript:alert(1)'])('rejects unsafe repository %s', (value) => {
    expect(validateRepositoryUrl(value)).toBeUndefined();
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
      expect(resolveRepositoryConfig({ PUBLIC_CORRECTIONS_URL: url }, () => undefined).correctionUrl).toBe(url);
    }
    for (const url of ['javascript:alert(1)', 'http://example.org', 'https://secret@example.org', 'mailto:editor@example.org%0aBcc:private@example.org']) {
      expect(() => resolveRepositoryConfig({ PUBLIC_CORRECTIONS_URL: url }, () => undefined)).toThrow('PUBLIC_CORRECTIONS_URL');
    }
  });
});

describe('Suggest a change', () => {
  it('is one native link to the editor at the moment being watched', () => {
    const html = renderToStaticMarkup(createElement(CorrectionLinks, { recordingId: '2026-09-06', start: 1834.6, base: '/review/' }));
    expect(html.match(/<a /g)).toHaveLength(1); expect(html).not.toMatch(/Report a problem|<button|role="button"/);
    expect(html).toMatch(/href="\/review\/edit\/2026-09-06\/\?t=1834"[^>]*>Suggest a change</);
    expect(editUrl('/', '2026-09-06')).toBe('/edit/2026-09-06/');
  });
  it('keeps search results and browse lists free of per-item correction links', () => {
    vi.stubGlobal('__RECS_CORRECTIONS__', repository);
    expect(correctionConfig()).toEqual(repository);
    const recordings = display(), units = searchUnits(recordings);
    const [grouped] = groupByRecording([{ unit: units[1], reasons: ['Private search match sentinel'] }], homeItems(recordings, '/review/'), '/review/');
    const card = renderToStaticMarkup(createElement(RecordingResult, { ...grouped, units }));
    expect(card).not.toContain('Suggest a change'); expect(card).toContain('/review/watch/?r=2026-09-06');
    const page = buildBrowsePages(recordings).find((item) => item.path === 'all')!;
    const html = renderToStaticMarkup(createElement(BrowsePage, { page, items: browseItems(page, recordings, '/review/'), base: '/review/' }));
    expect(html).not.toContain('Suggest a change');
  });
});
