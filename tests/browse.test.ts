import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { availableBrowseCategories, browseUrl, buildBrowsePages } from '../site/lib/browse';
import { publishable, searchUnits } from '../site/lib/display';
import { browseItems, groupByRecording, homeItems, homeSelection } from '../site/components/archive-display';
import { resolveSelection } from '../site/components/Watch';
import BrowsePage from '../site/components/BrowsePage';
import Home from '../site/components/Home';
import ScriptureLinks from '../site/components/ScriptureLinks';
import SearchApp from '../site/components/SearchApp';
import { selectResultReferences } from '../site/components/RecordingResult';
import { readWatchTarget } from '../site/lib/urls';
import type { Series } from '../site/lib/recording-schema';
import { display, source, stored } from './recording-fixtures';

// Fictional recordings only. A three-upload recording, and an older one.
const multipart = () => stored(source({ status: 'draft', sermonScripture: ['Romans 13:1-7', '1 John 1:1'], sermonTopics: ['service-life', 'hope'], uploads: [
  { youtubeId: 'PARTONE0001', uploadDuration: '20:00' }, { youtubeId: 'PARTTWO0002', uploadDuration: '40:00' }, { youtubeId: 'PARTTHREE03', uploadDuration: '30:00' },
] }));
const older = (date = '2020-09-27') => stored(source({ serviceDate: date, recordingTitle: 'An Older Sermon', uploads: [{ youtubeId: 'OLDERVIDEO1', uploadDuration: '1:30:00' }] }));
const SERIES: Series[] = [{ seriesId: 'romans', seriesTitle: 'Romans', seriesRecordings: ['2026-09-06', '2020-09-27'] }];

describe('static browse publication boundary', () => {
  it('has an honest empty production catalogue', () => {
    const recordings = display(publishable([multipart()], 'production'));
    expect(buildBrowsePages(recordings)).toEqual([]); expect(availableBrowseCategories(recordings)).toEqual([]);
    expect(renderToStaticMarkup(createElement(Home, { items: homeItems(recordings, '/review/'), base: '/review/' }))).toContain('There are no published recordings');
  });
  it('generates only the categories that have recordings, in a stable order', () => {
    const pages = buildBrowsePages(display([multipart()]));
    expect(pages.map((page) => page.path)).toEqual(['all', 'scripture', 'scripture/romans', 'scripture/1-john', /* canonical Bible order */
      'topics', 'topics/hope', 'topics/service-life', 'years', 'years/2026']);
    expect(pages.find((page) => page.path === 'topics/hope')).toMatchObject({ title: 'Hope', recordingIds: ['2026-09-06'] });
  });
  it('keeps a series in its playlist order, not newest first', () => {
    const recordings = display([multipart(), older()], SERIES), pages = buildBrowsePages(recordings);
    expect(pages.find((page) => page.path === 'series/romans')).toMatchObject({ title: 'Romans', recordingIds: ['2026-09-06', '2020-09-27'] });
    expect(pages.find((page) => page.path === 'all')?.recordingIds).toEqual(['2026-09-06', '2020-09-27']);
    expect(pages.find((page) => page.path === 'years')?.links?.map((link) => link.title)).toEqual(['2026', '2020']);
    const page = pages.find((item) => item.path === 'series/romans')!;
    expect(browseItems(page, recordings, '/').map((item) => item.context)).toEqual(['Part 1 of 2', 'Part 2 of 2']);
    expect(recordings[1].series).toMatchObject({ position: 2, total: 2 });
    expect(recordings[1].series).not.toHaveProperty('previous');
  });
  it.each(['/', '/review/', '/nested/review'])('keeps all routes and recording links under %s', (base) => {
    const recordings = display([multipart(), older()], SERIES), pages = buildBrowsePages(recordings);
    const prefix = base === '/' ? '/' : `${base.replace(/\/$/, '')}/`;
    expect(browseUrl(base)).toBe(`${prefix}browse/`);
    for (const page of pages) {
      const html = renderToStaticMarkup(createElement(BrowsePage, { page, items: browseItems(page, recordings, base), base }));
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) if (!href.startsWith('https://')) expect(href.startsWith(prefix)).toBe(true);
      for (const link of page.links ?? []) expect(pages.some((candidate) => candidate.path === link.path)).toBe(true);
      if (page.recordingIds?.length) expect(html).toContain(`${prefix}watch/?r=`);
    }
  });
  it('shows date and preview labels while keeping hidden verse text out of markup', () => {
    const recordings = display([multipart()]), pages = buildBrowsePages(recordings);
    for (const path of ['all', 'scripture/romans', 'topics/hope', 'years/2026']) {
      const page = pages.find((candidate) => candidate.path === path)!;
      const html = renderToStaticMarkup(createElement(BrowsePage, { page, items: browseItems(page, recordings, '/review/'), base: '/review/' }));
      expect(html).toMatch(/datetime="2026-09-06"/i); expect(html).toContain('Unreviewed preview');
    }
    const units = searchUnits(recordings); units[0].verseText = 'HIDDEN BSB SENTINEL';
    const html = renderToStaticMarkup(createElement(SearchApp, { initialUnits: units, recordings: homeItems(recordings, '/review/'), base: '/review/' }));
    expect(html).toContain('href="/review/browse/topics/"'); expect(html).not.toContain('HIDDEN BSB SENTINEL');
  });
});

describe('one recording across uploads', () => {
  it('keeps one card per recording however many uploads it took, opening at the sermon', () => {
    const items = homeItems(display([multipart()]), '/review/'), selected = homeSelection(items, null, '/review/');
    expect(items).toHaveLength(1);
    // The thumbnail pattern comes from the first upload; the card opens at the sermon on the recording clock.
    expect(items[0]).toMatchObject({ id: 'PARTONE0001', recordingId: '2026-09-06', length: 5400, start: 1800, hasSermon: true });
    expect(selected.featured?.href).toBe('/review/watch/?r=2026-09-06&t=1800'); expect(selected.supporting).toHaveLength(0);
  });
  it('groups matching point notes under their named chapter, without creating a public point range', () => {
    const sources = [multipart(), older()], recordings = display(sources), items = homeItems(recordings, '/'), units = searchUnits(recordings, sources);
    const find = (id: string) => units.find((unit) => unit.id === id)!;
    const best = find('2026-09-06/hospitality/point-1');
    const grouped = groupByRecording([{ unit: best }, { unit: find('2020-09-27') }, { unit: find('2026-09-06/sermon/point-1') }, { unit: find('2026-09-06') }], items, '/');
    expect(grouped.map(({ recording }) => recording.recordingId)).toEqual(['2026-09-06', '2020-09-27']);
    expect(grouped[0].recording.match).toMatchObject({ id: 'hospitality', start: 3600, href: '/watch/?r=2026-09-06&t=3600&focus=hospitality', more: 2 });
    // The recording still opens at its sermon and carries the match for "This point only".
    expect(grouped[0].recording.href).toBe('/watch/?r=2026-09-06&t=1800&focus=hospitality');
    // A whole-recording match opens as the card does.
    expect(grouped[1].recording.match).toBeUndefined();
  });
  it('resumes where you left off on the recording clock', () => {
    const recordings = display([multipart(), older('2026-08-30')]), items = homeItems(recordings, '/review/');
    const saved = { recordingId: '2026-09-06', time: 2500 };
    const selected = homeSelection(items, saved, '/review/');
    const target = readWatchTarget(new URL(selected.featured!.href, 'https://example.test').search);
    expect(target).toEqual({ recording: '2026-09-06', start: 2500 });
    expect(resolveSelection(recordings, target)).toMatchObject({ start: 2500 });
    expect(resolveSelection(recordings, target)?.focus).toBeUndefined();
    for (const override of [{ recordingId: 'withdrawn' }, { time: 5399 }, { time: 0 }]) expect(homeSelection(items, { ...saved, ...override }, '/').returning).toBeUndefined();
  });
  it('opens full recordings at zero, explicit chapter links at the chapter, and clamps times', () => {
    const recordings = display([multipart()]);
    expect(resolveSelection(recordings, { recording: '2026-09-06' })?.start).toBe(0);
    expect(resolveSelection(recordings, { recording: '2026-09-06', focus: 'hospitality' })).toMatchObject({ start: 3600, focus: { title: 'Practise Small Hospitality' } });
    expect(resolveSelection(recordings, { recording: '2026-09-06', start: 30 })?.start).toBe(30);
    expect(resolveSelection(recordings, { recording: '2026-09-06', start: 99999 })?.start).toBe(5399);
    expect(resolveSelection(recordings, { recording: '2026-09-06', focus: 'sermon' })?.focus?.id).toBe('sermon');
    expect(resolveSelection(recordings, { recording: 'missing' })).toBeNull();
  });
});

describe('result references', () => {
  it('lists the references matching a searched reference or verse first', () => {
    const chapter = { scripture: ['Psalms 99:1-5', 'Daniel 7', 'Psalms 1:1-6'], scriptureDisplay: ['Ps 99:1-5', 'Dan 7', 'Ps 1:1-6'] };
    expect(selectResultReferences(chapter, 'Psalms 1')).toEqual({ references: ['Psalms 1:1-6', 'Psalms 99:1-5', 'Daniel 7'], displayReferences: ['Ps 1:1-6', 'Ps 99:1-5', 'Dan 7'] });
    expect(selectResultReferences(chapter, 'eternal life').references).toEqual(chapter.scripture);
    const findBestVerse = (reference: string) => reference === 'Daniel 7' ? { reference: 'Daniel 7:13', score: 4 } : undefined;
    expect(selectResultReferences(chapter, 'son of man coming with the clouds', findBestVerse)).toEqual({
      references: ['Daniel 7:13', 'Psalms 99:1-5', 'Psalms 1:1-6'], displayReferences: ['Daniel 7:13', 'Ps 99:1-5', 'Ps 1:1-6'] });
    const repeats = { scripture: ['Romans 13:1-7', 'Romans 13:1'] };
    expect(selectResultReferences(repeats, 'governing authorities', () => ({ reference: 'Romans 13:1', score: 3 })).references).toEqual(['Romans 13:1']);
    expect(selectResultReferences(chapter, 'Psalms 1', findBestVerse).references[0]).toBe('Psalms 1:1-6');
  });
  it('links canonical scripture while retaining original display spelling', () => {
    const html = renderToStaticMarkup(createElement(ScriptureLinks, { references: ['Romans 13:1-7', 'Genesis 22:1-19'], displayReferences: ['Rom 13:1–7'] }));
    expect(html).toContain('https://www.esv.org/Romans%2013%3A1-7/'); expect(html).toContain('Rom 13:1–7 (ESV)');
    expect(html).toContain('Genesis 22:1-19 (ESV)'); expect(html).toContain('Read Romans 13:1-7 in the ESV');
  });
});
