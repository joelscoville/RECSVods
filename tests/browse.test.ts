import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { flattenChapters, publishedServices, ServiceSchema, SOURCE_CHANNEL_ID, type BuildMode, type Service } from '../site/lib/archive';
import { availableBrowseCategories, browseUrl, buildBrowsePages } from '../site/lib/browse';
import { browseItems, displayServices, groupByRecording, homeItems, homeSelection } from '../site/components/archive-display';
import { resolveSelection } from '../site/components/Watch';
import BrowsePage from '../site/components/BrowsePage';
import Home from '../site/components/Home';
import ScriptureLinks from '../site/components/ScriptureLinks';
import SearchApp from '../site/components/SearchApp';
import { readWatchTarget } from '../site/lib/urls';

// Fictional metadata only, never archive interpretation.
function fixture(): Service {
  const ids = ['FAILEDVIDEO', 'PARTONE0001', 'PARTTWO0002', 'PARTTHREE03', 'REJECTEDVID'];
  return ServiceSchema.parse({
    id: 'fixture-multipart', date: '2026-08-16', title: 'Fictional multipart service', sermon_title: 'Fictional sermon', type: 'service',
    workflow_status: 'complete', editorial_status: 'needs_review', review_notes: ['Private editorial note'],
    speakers: [{ id: 'speaker-stable-id', name: 'Fictional speaker' }, { id: 'excluded-speaker', name: 'Excluded speaker' }, { id: 'unused-speaker', name: 'Unused speaker' }],
    topics: [{ id: 'topic-stable-id', name: 'Fictional topic' }, { id: 'excluded-topic', name: 'Excluded topic' }],
    videos: ids.map((id, index) => ({ id, channel_id: SOURCE_CHANNEL_ID, duration: 180, sequence: index + 1, workflow_status: 'complete',
      media_disposition: index === 0 ? 'failed' : index === 4 ? 'rejected' : 'playable', ...([0, 4].includes(index) ? { disposition_evidence: 'Fictional failure evidence' } : {}) })),
    chapters: ids.flatMap((video_id, index) => [0, 30, 90].map((start, part) => ({ id: `chapter-${index}-${part}`, video_id, start, end: start + 20,
      type: index === 1 ? 'prayer' : 'sermon', title: `Fictional chapter ${index}-${part}`, summary: 'Fictional summary.', keywords: ['example'],
      speaker_id: [0, 4].includes(index) ? 'excluded-speaker' : 'speaker-stable-id',
      topics: [[0, 4].includes(index) ? 'excluded-topic' : 'topic-stable-id'], scripture: [[0, 4].includes(index) ? 'Jude 1:1' : 'Romans 13:1-7', '1 John 1:1'] }))),
  });
}
/** Another recording with its own uploads and chapter IDs, so two recordings can be compared. */
function separateFixture(date = '2020-09-27'): Service {
  const service = fixture();
  Object.assign(service, { id: 'separate-service', date });
  service.videos.forEach((video) => { video.id = `S${video.id.slice(1)}`; });
  service.chapters.forEach((chapter) => { chapter.id = `separate-${chapter.id}`; chapter.video_id = `S${chapter.video_id.slice(1)}`; });
  return service;
}
function displayed(services = [fixture()], mode: BuildMode = 'preview') {
  const eligible = publishedServices(services, mode);
  return displayServices(eligible, flattenChapters(eligible, mode));
}

describe('static browse publication boundary', () => {
  it('has an honest empty production catalogue and no invented Series', () => {
    const services = displayed(undefined, 'production');
    expect(buildBrowsePages(services)).toEqual([]); expect(availableBrowseCategories(services)).toEqual([]);
    expect(renderToStaticMarkup(createElement(Home, { items: homeItems(services, '/review/'), base: '/review/' }))).toContain('There are no published recordings');
    expect(buildBrowsePages(displayed()).some((page) => page.path.startsWith('series'))).toBe(false);
    expect(availableBrowseCategories([], displayed()[0].chapters).some((category) => category.path === 'series')).toBe(false);
  });
  it('builds stable series and newest-first service groups; rejects conflicting names', () => {
    const newer = fixture(); newer.series = { id: 'shared-series', name: 'Fictional shared series' };
    const older: Service = { ...fixture(), id: 'older-service', date: '2020-09-27', series: { ...newer.series } };
    const services = displayed([older, newer]), pages = buildBrowsePages(services);
    expect(pages.find((page) => page.path === 'series/shared-series')).toMatchObject({ serviceIds: ['fixture-multipart', 'older-service'], title: newer.series.name });
    expect(buildBrowsePages([...services].reverse())).toEqual(pages);
    expect(availableBrowseCategories(services).map((category) => category.path)).toEqual(pages.filter((page) => !page.parent).map((page) => page.path));
    older.series!.name = 'Conflicting name';
    expect(() => buildBrowsePages(displayed([older, newer]))).toThrow('Conflicting name for series ID shared-series');
  });
  it('supports eligible services with no chapter metadata, without inventing chapters', () => {
    const source = fixture(); source.type = 'sermon'; source.chapters = [];
    source.series = { id: 'fixture-series', name: 'Fictional series' };
    const services = displayed([source]);
    expect(buildBrowsePages(services).find((page) => page.path === 'all')).toMatchObject({ serviceIds: [source.id] });
    expect(buildBrowsePages(services).find((page) => page.path === 'series/fixture-series')?.serviceIds).toEqual([source.id]);
    expect(services[0].chapters).toEqual([]);
    source.videos.forEach((video) => { video.media_disposition = 'unassessed'; });
    expect(buildBrowsePages(displayed([source]))).toEqual([]);
  });
  it('derives SearchApp navigation from chapter metadata without rendering hidden enrichment', () => {
    const source = fixture(); source.series = { id: 'fixture-series', name: 'Fictional series' };
    const chapters = flattenChapters([source], 'preview');
    chapters[0].verseText = 'HIDDEN BSB SENTINEL';
    const html = renderToStaticMarkup(createElement(SearchApp, { initialChapters: chapters, recordings: homeItems(displayServices([source], chapters), '/review/'), base: '/review/' }));
    expect(html).toContain('href="/review/browse/series/"'); expect(html).not.toContain('HIDDEN BSB SENTINEL');
  });
  it('generates only eligible categories and stable chapter IDs', () => {
    const services = displayed(), pages = buildBrowsePages(services);
    expect(pages.map((page) => page.path)).toEqual(['all', 'scripture', 'scripture/romans', 'scripture/1-john', /* canonical Bible order */ 'topics', 'topics/topic-stable-id', 'years', 'years/2026']);
    expect(pages.find((page) => page.path === 'scripture/romans')?.chapterIds).toHaveLength(9);
    expect(pages.find((page) => page.path === 'topics/topic-stable-id')?.chapterIds).toHaveLength(9);
    expect(JSON.stringify(services)).not.toMatch(/excluded-speaker|excluded-topic|unused-speaker|Private editorial note|workflow_status|Fictional failure evidence/);
  });
  it.each(['/', '/review/', '/nested/review'])('keeps all routes and canonical chapter links under %s', (base) => {
    const services = displayed(), pages = buildBrowsePages(services);
    const prefix = base === '/' ? '/' : `${base.replace(/\/$/, '')}/`;
    expect(browseUrl(base)).toBe(`${prefix}browse/`);
    for (const page of pages) {
      const html = renderToStaticMarkup(createElement(BrowsePage, { page, items: browseItems(page, services, base), base }));
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) if (!href.startsWith('https://')) expect(href.startsWith(prefix)).toBe(true);
      for (const link of page.links ?? []) expect(pages.some((candidate) => candidate.path === link.path)).toBe(true);
      if (page.chapterIds?.length) expect(html).toContain(`${prefix}watch/?chapter=`);
      expect(html).not.toContain('?id=');
    }
  });
  it('orders years and services newest-first', () => {
    const older = fixture(); older.id = 'older-service'; older.date = '2020-09-27';
    const pages = buildBrowsePages(displayed([older, fixture()]));
    expect(pages.find((page) => page.path === 'years')?.links?.map((link) => link.title)).toEqual(['2026', '2020']);
    expect(pages.find((page) => page.path === 'all')?.serviceIds).toEqual(['fixture-multipart', 'older-service']);
  });
  it('shows date and preview labels while keeping hidden verse text out of markup', () => {
    const services = displayed(); Object.assign(services[0].chapters[0], { verseText: 'HIDDEN BSB SENTINEL', summary: 'HIDDEN SYNOPSIS SENTINEL' });
    const pages = buildBrowsePages(services);
    for (const path of ['all', 'scripture/romans', 'topics/topic-stable-id', 'years/2026']) {
      const page = pages.find((candidate) => candidate.path === path)!;
      const html = renderToStaticMarkup(createElement(BrowsePage, { page, items: browseItems(page, services, '/review/'), base: '/review/' }));
      expect(html).toMatch(/datetime="2026-08-16"/i); expect(html).toContain('Unreviewed preview');
      expect(html).not.toMatch(/HIDDEN BSB SENTINEL|HIDDEN SYNOPSIS SENTINEL|FAILEDVIDEO|REJECTEDVID/);
    }
  });
});

describe('home and multipart chapter playback', () => {
  it('keeps one card per recording however many uploads it was split into, and features the latest sermon', () => {
    const items = homeItems(displayed(), '/review/'), selected = homeSelection(items, null, '/review/');
    expect(items).toHaveLength(1);
    expect(items[0].parts.map((part) => part.id)).toEqual(['PARTONE0001', 'PARTTWO0002', 'PARTTHREE03']);
    // It opens the sermon in whichever part holds it; its thumbnail ID stays the first part's.
    expect(items[0]).toMatchObject({ id: 'PARTONE0001', videoId: 'PARTTWO0002', title: 'Fictional sermon' });
    expect(selected.featured?.href).toBe('/review/watch/?chapter=chapter-2-0'); expect(selected.supporting).toHaveLength(0);
  });
  it('groups chapter matches from every part into one result per recording, ranked by its best chapter', () => {
    const services = displayed([separateFixture(), fixture()]), items = homeItems(services, '/');
    const primaries = (id: string) => services.find((service) => service.id === id)!.chapters.filter((chapter) => !chapter.parentId);
    const newer = primaries('fixture-multipart'), older = primaries('separate-service');
    // The best match sits in the newer recording's last part; its other parts' matches count as "more".
    const best = newer.at(-1)!;
    const grouped = groupByRecording([{ chapter: best }, { chapter: older[0] }, ...newer.slice(0, -1).map((chapter) => ({ chapter }))], items, '/');
    expect(grouped.map(({ recording }) => recording.serviceId)).toEqual(['fixture-multipart', 'separate-service']);
    expect(grouped[0].recording.match).toMatchObject({ id: best.id, start: best.start, href: `/watch/?chapter=${best.id}`, more: newer.length - 1 });
    // The recording still opens at its sermon (in another part) and carries the match for "Chapter only".
    expect(grouped[0].recording.href).toBe(`/watch/?chapter=chapter-2-0&match=${best.id}`);
  });
  it('preserves full-recording resume without snapping to a chapter or installing a soft endpoint', () => {
    const services = displayed(), items = homeItems(services, '/review/');
    const saved = { serviceId: 'fixture-multipart', videoId: 'PARTTHREE03', time: 45 };
    const selected = homeSelection(items, saved, '/review/');
    const target = readWatchTarget(new URL(selected.featured!.href, 'https://example.test').search);
    expect(target).toMatchObject({ service: saved.serviceId, video: saved.videoId, start: 45 });
    // Resume in any part features the whole recording, measured against the resumed part.
    expect(selected.featured).toMatchObject({ id: 'PARTONE0001', videoId: saved.videoId, duration: 180 });
    const withOlder = homeItems(displayed([separateFixture('2026-08-30'), fixture()]), '/review/');
    // The resumed card and the latest sermon trade places; every other card keeps its slot.
    expect(homeSelection(withOlder, saved, '/review/').supporting.map((item) => item.serviceId)).toEqual(['separate-service']);
    expect(resolveSelection(services, target)).toMatchObject({ start: 45, video: { id: saved.videoId } });
    expect(resolveSelection(services, target)?.chapter).toBeUndefined();
    for (const override of [{ videoId: 'FAILEDVIDEO' }, { serviceId: 'withdrawn' }, { time: 179 }, { time: 0 }]) expect(homeSelection(items, { ...saved, ...override }, '/').returning).toBeUndefined();
  });
  it('resolves each chapter to its own upload and rejects unknown or unresolved old IDs', () => {
    const services = displayed();
    expect(resolveSelection(services, { service: 'fixture-multipart' })?.video.id).toBe('PARTONE0001');
    for (const chapter of services[0].chapters) expect(resolveSelection(services, { chapter: chapter.id, video: 'FAILEDVIDEO' })).toMatchObject({ chapter, video: { id: chapter.videoId }, start: chapter.start });
    expect(resolveSelection(services, { video: 'FAILEDVIDEO' })).toBeNull();
    expect(resolveSelection(services, { chapter: 'chapter-0-0' })).toBeNull();
    expect(resolveSelection(services, { id: 'old-link', service: 'fixture-multipart' })).toBeNull();
    expect(resolveSelection(services, { service: 'missing', video: 'PARTTWO0002' })).toBeNull();
  });
  it('retains full-recording offsets inside chapters and gaps, clamping only at the video bounds', () => {
    const services = displayed();
    const target = { service: 'fixture-multipart', video: 'PARTTWO0002' };
    expect(resolveSelection(services, { ...target, start: 30 })).toMatchObject({ start: 30, video: { id: target.video } });
    expect(resolveSelection(services, { ...target, start: 30 })?.chapter).toBeUndefined();
    expect(resolveSelection(services, { ...target, start: 50 })?.chapter).toBeUndefined();
    expect(resolveSelection(services, { ...target, start: 25 })?.start).toBe(25);
    expect(resolveSelection(services, { ...target, start: 900 })?.start).toBe(179);
    expect(resolveSelection(services, { ...target, start: NaN })?.start).toBe(0);
  });
});

it('links canonical scripture while retaining original display spelling', () => {
  const html = renderToStaticMarkup(createElement(ScriptureLinks, { references: ['Romans 13:1-7', 'Genesis 22:1-19'], displayReferences: ['Rom 13:1–7'] }));
  expect(html).toContain('https://www.esv.org/Romans%2013%3A1-7/'); expect(html).toContain('Rom 13:1–7 (ESV)');
  expect(html).toContain('Genesis 22:1-19 (ESV)'); expect(html).toContain('Read Romans 13:1-7 in the ESV');
});
