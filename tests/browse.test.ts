import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { flattenArchive, publishedServices, ServiceSchema, SOURCE_CHANNEL_ID, type BuildMode, type Service } from '../site/lib/archive';
import { availableBrowseCategories, browseUrl, buildBrowsePages, surroundingPassages } from '../site/lib/browse';
import { displayServices, homeItems, homeSelection } from '../site/components/archive-display';
import { resolveSelection } from '../site/components/Watch';
import BrowsePage from '../site/components/BrowsePage';
import Home from '../site/components/Home';
import ScriptureLinks from '../site/components/ScriptureLinks';
import { readWatchTarget } from '../site/lib/urls';

// Fictional records exercise navigation; they are never archive interpretation.
function fixture(): Service {
  const ids = ['FAILEDVIDEO', 'PARTONE0001', 'PARTTWO0002', 'PARTTHREE03', 'REJECTEDVID'];
  return ServiceSchema.parse({
    id: 'fixture-multipart', date: '2026-08-16', title: 'Fictional multipart service', sermon_title: 'Fictional sermon', type: 'service',
    workflow_status: 'complete', editorial_status: 'needs_review', review_notes: ['Private editorial note'],
    speakers: [{ id: 'speaker-stable-id', name: 'Fictional speaker' }, { id: 'excluded-speaker', name: 'Excluded speaker' }, { id: 'unused-speaker', name: 'Unused speaker' }],
    topics: [{ id: 'topic-stable-id', name: 'Fictional topic' }, { id: 'excluded-topic', name: 'Excluded topic' }],
    videos: ids.map((id, index) => ({ id, channel_id: SOURCE_CHANNEL_ID, duration: 180, sequence: index + 1, workflow_status: 'complete',
      media_disposition: index === 0 ? 'failed' : index === 4 ? 'rejected' : 'playable', ...([0, 4].includes(index) ? { disposition_evidence: 'Fictional failure evidence' } : {}) })),
    sections: ids.map((id, index) => ({ id: `section-${index}`, video_id: id, start: 0, end: 160, type: index === 1 ? 'prayer' : 'sermon', title: `Fictional section ${index}`, confidence: 0.8, speaker_id: [0, 4].includes(index) ? 'excluded-speaker' : 'speaker-stable-id' })),
    passages: ids.flatMap((id, index) => [0, 30, 90].map((start, part) => ({ id: `passage-${index}-${part}`, section_id: `section-${index}`, video_id: id, start, end: start + 20,
      type: index === 1 ? 'prayer' : 'sermon', title: `Fictional passage ${index}-${part}`, summary: 'Fictional summary.', transcript: `Fictional transcript ${index}-${part}.`, questions: [],
      topics: [[0, 4].includes(index) ? 'excluded-topic' : 'topic-stable-id'], scripture: [[0, 4].includes(index) ? 'Jude 1:1' : 'Romans 13:1-7', '1 John 1:1'], confidence: 0.8 }))),
  });
}
function displayed(services = [fixture()], mode: BuildMode = 'preview') {
  const eligible = publishedServices(services, mode);
  return displayServices(eligible, flattenArchive(eligible, mode));
}

describe('static browse from the current publication gate', () => {
  it('has an honest empty production catalogue and no invented Series', () => {
    const services = displayed(undefined, 'production');
    expect(buildBrowsePages(services)).toEqual([]);
    expect(availableBrowseCategories(services)).toEqual([]);
    expect(renderToStaticMarkup(createElement(Home, { items: homeItems(services, '/review/'), base: '/review/' }))).toContain('There are no published recordings');
    expect(buildBrowsePages(displayed()).some((page) => page.path.startsWith('series'))).toBe(false);
  });
  it('generates every available category and only eligible metadata with stable IDs', () => {
    const services = displayed();
    const pages = buildBrowsePages(services);
    expect(pages.map((page) => page.path)).toEqual([
      'services', 'sermons', 'speakers', 'speakers/speaker-stable-id', 'scripture', 'scripture/1-john', 'scripture/romans',
      'topics', 'topics/topic-stable-id', 'years', 'years/2026',
    ]);
    expect(availableBrowseCategories(services).map((category) => category.path)).toEqual(pages.filter((page) => !page.parent).map((page) => page.path));
    expect(pages.find((page) => page.path === 'services')?.serviceIds).toEqual(['fixture-multipart']);
    expect(pages.find((page) => page.path === 'sermons')?.sectionIds).toEqual(['section-2', 'section-3']);
    expect(pages.find((page) => page.path === 'scripture/romans')?.passageIds).toHaveLength(9);
    expect(pages.find((page) => page.path === 'topics/topic-stable-id')?.passageIds).toHaveLength(9);
    expect(JSON.stringify(services)).not.toMatch(/excluded-speaker|excluded-topic|unused-speaker|Private editorial note|workflow_status|Fictional failure evidence/);
  });
  it.each(['/', '/review/', '/nested/review'])('keeps every route and leaf link under base %s', (base) => {
    const services = displayed();
    const pages = buildBrowsePages(services);
    const prefix = base === '/' ? '/' : `${base.replace(/\/$/, '')}/`;
    expect(browseUrl(base)).toBe(`${prefix}browse/`);
    for (const page of pages) {
      expect(browseUrl(base, page.path)).toBe(`${prefix}browse/${page.path}/`);
      const html = renderToStaticMarkup(createElement(BrowsePage, { page, services, base }));
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        if (!href.startsWith('https://')) expect(href).toMatch(new RegExp(`^${prefix}`));
      }
      for (const link of page.links ?? []) expect(pages.some((candidate) => candidate.path === link.path)).toBe(true);
      if (page.parent) expect(pages.some((candidate) => candidate.path === page.parent?.path)).toBe(true);
    }
  });
  it('orders years and service dates newest-first regardless of input order', () => {
    const older = fixture();
    older.id = 'older-service'; older.date = '2020-09-27';
    const services = displayed([older, fixture()]);
    const pages = buildBrowsePages(services);
    expect(pages.find((page) => page.path === 'years')?.links?.map((link) => link.title)).toEqual(['2026', '2020']);
    expect(pages.find((page) => page.path === 'services')?.serviceIds).toEqual(['fixture-multipart', 'older-service']);
    expect(pages.find((page) => page.path === 'years/2020')?.serviceIds).toEqual(['older-service']);
  });
  it('keeps a pre-trimmed sermon as one recording without inventing chapters', () => {
    const sermon = fixture();
    sermon.type = 'sermon'; sermon.videos = [sermon.videos[2]]; sermon.sections = []; sermon.passages = [];
    const services = displayed([sermon]);
    expect(buildBrowsePages(services).find((page) => page.path === 'sermons')).toMatchObject({ sectionIds: [], serviceIds: [sermon.id] });
    expect(homeItems(services, '/')[0]).toMatchObject({ title: 'Fictional sermon', type: 'sermon', start: 0 });
    expect(services[0].sections).toEqual([]);
  });
  it('keeps Sermons navigation valid when only a smaller passage is classified as a sermon', () => {
    const source = fixture();
    source.sections.forEach((section) => { section.type = 'service'; });
    const services = displayed([source]);
    expect(availableBrowseCategories(services).some((category) => category.path === 'sermons')).toBe(true);
    expect(buildBrowsePages(services).find((page) => page.path === 'sermons')).toMatchObject({ sectionIds: [], serviceIds: [], passageIds: ['passage-2-0', 'passage-2-1', 'passage-2-2', 'passage-3-0', 'passage-3-1', 'passage-3-2'] });
  });
  it('shows date and preview labels while keeping hidden verse text out of browse markup', () => {
    const services = displayed();
    Object.assign(services[0].passages[0], { verseText: 'HIDDEN BSB SEARCH SENTINEL' });
    const pages = buildBrowsePages(services);
    for (const path of ['services', 'sermons', 'scripture/romans', 'speakers/speaker-stable-id', 'topics/topic-stable-id', 'years/2026']) {
      const html = renderToStaticMarkup(createElement(BrowsePage, { page: pages.find((page) => page.path === path)!, services, base: '/review/' }));
      expect(html).toMatch(/datetime="2026-08-16"/i);
      expect(html).toContain('Unreviewed preview');
      expect(html).not.toContain('HIDDEN BSB SEARCH SENTINEL');
      expect(html).not.toContain('FAILEDVIDEO');
      expect(html).not.toContain('REJECTEDVID');
    }
  });
});

describe('home and multipart playback', () => {
  it('has one card per eligible physical video and features the latest sermon, not the first upload', () => {
    const items = homeItems(displayed(), '/review/');
    expect(items.map((item) => item.videoId)).toEqual(['PARTONE0001', 'PARTTWO0002', 'PARTTHREE03']);
    const selected = homeSelection(items, null, '/review/');
    expect(selected.featured?.videoId).toBe('PARTTWO0002');
    expect(selected.supporting).toHaveLength(2);
    const html = renderToStaticMarkup(createElement(Home, { items, base: '/review/' }));
    expect(html).toContain('Watch the latest sermon');
    expect(html).toContain('/review/browse/speakers/');
    expect(html).toContain('/review/browse/');
    expect(html).not.toContain('/review/search/?q=');
  });
  it('resumes only an eligible unfinished upload using a full-video target', () => {
    const items = homeItems(displayed(), '/review/');
    const saved = { serviceId: 'fixture-multipart', videoId: 'PARTTHREE03', time: 45 };
    const selected = homeSelection(items, saved, '/review/');
    expect(selected.returning?.videoId).toBe(saved.videoId);
    expect(readWatchTarget(new URL(selected.featured!.href, 'https://example.test').search)).toEqual({ service: saved.serviceId, video: saved.videoId, start: 45, id: undefined });
    for (const override of [{ videoId: 'FAILEDVIDEO' }, { serviceId: 'withdrawn' }, { time: 179 }, { time: 0 }]) expect(homeSelection(items, { ...saved, ...override }, '/').returning).toBeUndefined();
  });
  it('resolves every multipart passage to its own upload and never defaults to a failed upload', () => {
    const services = displayed();
    expect(resolveSelection(services, { service: 'fixture-multipart' })?.video.id).toBe('PARTONE0001');
    for (const passage of services[0].passages) expect(resolveSelection(services, { id: passage.id, video: 'FAILEDVIDEO' })).toMatchObject({ video: { id: passage.videoId }, start: passage.start });
    expect(resolveSelection(services, { service: 'fixture-multipart', video: 'PARTTHREE03', start: 30 })?.video.id).toBe('PARTTHREE03');
    expect(resolveSelection(services, { video: 'FAILEDVIDEO' })).toBeNull();
    expect(resolveSelection(services, { id: 'passage-0-0' })).toBeNull();
    expect(resolveSelection(services, { service: 'missing', video: 'PARTTWO0002' })).toBeNull();
  });
  it('uses the actual preceding/following passage only on the same physical recording', () => {
    const passages = displayed()[0].passages;
    const selected = passages.find((passage) => passage.id === 'passage-2-1')!;
    const context = surroundingPassages([...passages].reverse(), selected);
    expect(context.previous?.id).toBe('passage-2-0');
    expect(context.next?.id).toBe('passage-2-2');
    expect(context.previous!.end).toBeLessThan(selected.start);
    expect(context.next!.start).toBeGreaterThan(selected.end);
    expect(surroundingPassages(passages, passages.find((passage) => passage.id === 'passage-2-0')!).previous).toBeUndefined();
    expect(surroundingPassages(passages, passages.find((passage) => passage.id === 'passage-2-2')!).next).toBeUndefined();
    expect(surroundingPassages([], selected)).toEqual({});
  });
});

describe('reference-only scripture presentation', () => {
  it('links the canonical reference while retaining original display spelling', () => {
    const html = renderToStaticMarkup(createElement(ScriptureLinks, { references: ['Romans 13:1-7', 'Genesis 22:1-19'], displayReferences: ['Rom 13:1–7'] }));
    expect(html).toContain('https://www.esv.org/Romans%2013%3A1-7/');
    expect(html).toContain('Rom 13:1–7 (ESV)');
    expect(html).toContain('Genesis 22:1-19 (ESV)');
    expect(html).toContain('Read Romans 13:1-7 in the ESV');
  });
});
