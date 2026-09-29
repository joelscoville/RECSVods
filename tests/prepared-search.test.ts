import { describe, expect, it } from 'vitest';
import { decodeChapterVectors, packChapterVectors } from '../site/lib/chapter-vectors';
import { prepareSearchIndex, search, SEARCH_WEIGHTS, type PreparedSearchOptions } from '../site/lib/search';
import type { SearchChapter } from '../site/lib/types';

const fixture: SearchChapter = {
  id: 'fixture', serviceId: 'service-b', videoId: 'abcdefghijk', start: 60, end: 120,
  serviceTitle: 'Evening gathering', title: 'Serving our neighbours', summary: 'Practical care and quiet generosity.',
  keywords: ['café visits', 'civic responsibility'], topics: ['Community', 'Service'],
  scripture: ['Romans 12:1-2'], scriptureDisplay: ['Rom. 12:1–2'],
  speaker: 'Example Speaker', date: '2026-09-06', type: 'sermon', preview: true,
  series: { id: 'orchard', name: 'Fictional orchard' }, verseText: 'living sacrifices',
};
function unit(index = 0): number[] { return Array.from({ length: 384 }, (_, i) => i === index ? 1 : 0); }
function dense(seed: number): number[] {
  const values = Array.from({ length: 384 }, (_, i) => Math.sin((i + 1) * seed));
  const norm = Math.hypot(...values); return values.map((value) => value / norm);
}
function vectorIndex(chapters: readonly SearchChapter[], vector: (i: number) => number[] = () => unit()) {
  return decodeChapterVectors(packChapterVectors(chapters.map((_, i) => {
    const row = vector(i), max = Math.max(...row.map(Math.abs));
    return Int8Array.from(row, (value) => max ? Math.round(value / max * 127) : 0);
  })));
}
function corpus(): SearchChapter[] {
  return [structuredClone(fixture),
    { ...structuredClone(fixture), id: 'reference', scripture: ['Romans 13:1-7'], date: '2024-02-29' },
    { ...structuredClone(fixture), id: 'cross-chapter', scripture: ['Romans 12:21-14:2'], date: '2020-07-05' },
    { ...structuredClone(fixture), id: 'empty', speaker: undefined, series: undefined, keywords: [], topics: [], scripture: [], verseText: undefined, title: '', summary: '', serviceTitle: '' },
    { ...structuredClone(fixture), id: 'boundaries', scripture: ['Romans 12:10', 'not a reference'], keywords: ['ＣＡＦÉ', 'visits'], summary: 'class status analysis sacrifices' },
    { ...structuredClone(fixture), id: 'incidental-date', date: '2025-01-01', title: '6 September 2026' },
    { ...structuredClone(fixture), id: 'tie-service', serviceId: 'service-a' },
    { ...structuredClone(fixture), id: 'tie-video', videoId: 'aaaaaaaaaaa' },
    { ...structuredClone(fixture), id: 'tie-start', start: 10 }, { ...structuredClone(fixture), id: 'tie-id' },
  ];
}
const queries = ['', '  ', '?!', 'the and', 'zxqvpl', 'community', 'commun', 'Example Speaker community',
  'quiet generosity', 'quiet quiet generosity', 'practical care', 'evening gathering', 'fictional orchard',
  'sermon', ' ＣＡＦÉ\nvisits ', 'responsibility', 'class status analysis', 'Rom13', 'ROM.13:3',
  'Romans 12:21-13:2', 'Romans 13:8', 'Romans 12:1', '12:1', 'living sacrifice', 'living sacrifices',
  '2026-09-06', '6 September 2026', 'Sep. 6, 2026', '29 February 2024', '29 February 1900', '2026-7-5', 'July 2020'];

describe('prepared and exhaustive ranking equivalence', () => {
  it.each(queries)('preserves exact order, scores and reasons for %j', (query) => {
    const chapters = corpus(), before = structuredClone(chapters);
    const prepared = prepareSearchIndex(chapters);
    expect(prepared.search(query)).toStrictEqual(search(chapters, query));
    expect(prepared.search(query)).toStrictEqual(prepared.search(query)); expect(chapters).toStrictEqual(before);
  });
  it.each(queries)('preserves hybrid rankings, thresholds and limits for %j', (query) => {
    const chapters = corpus(), vectors = vectorIndex(chapters, (i) => dense(0.123456789 + i / 1000));
    const before = structuredClone({ chapters, vectors }), prepared = prepareSearchIndex(chapters, vectors);
    const options: PreparedSearchOptions[] = [dense(0.123456789), dense(0.128), unit(), [1], Array(384).fill(0)].flatMap((queryVector) => [
      { queryVector }, ...[-1, 0, 0.45, 0.9, 1, 2, NaN, Infinity].map((semanticThreshold) => ({ queryVector, semanticThreshold })),
    ]);
    options.push(...[0, -1, 1, 2.8, Infinity, NaN].map((limit) => ({ queryVector: unit(), limit })));
    for (const option of options) expect(prepared.search(query, option)).toStrictEqual(search(chapters, query, { ...option, vectors }));
    expect({ chapters, vectors }).toStrictEqual(before);
  });
  it('retains structured scripture overlap, hidden BSB reasons and hard date scope', () => {
    const chapters = corpus(), prepared = prepareSearchIndex(chapters, vectorIndex(chapters));
    expect(prepared.search('Rom 13')[0].reasons).toContain('Scripture: Romans 13');
    expect(prepared.search('living sacrifice').find((r) => r.chapter.id === 'fixture')?.reasons).toEqual(['Verse-text match (BSB)']);
    expect(prepared.search('6 September 2026', { queryVector: unit() }).every((r) => r.chapter.date === '2026-09-06')).toBe(true);
  });
  it('scans every vector before limiting, retains row correspondence including zero rows', () => {
    const chapters = Array.from({ length: 65 }, (_, i) => ({ ...structuredClone(fixture), id: `row-${i}` }));
    const vectors = vectorIndex(chapters, (i) => i === 64 ? unit() : i % 2 ? unit(1) : Array(384).fill(0));
    expect(prepareSearchIndex(chapters, vectors).search('zxqvpl', { queryVector: unit(), limit: 1 }).map((r) => [r.chapter.id, r.score, r.reasons])).toEqual([['row-64', SEARCH_WEIGHTS.semantic, ['Similar in meaning']]]);
    expect(prepareSearchIndex(chapters, { ...vectors, rowCount: 64 }).search('zxqvpl', { queryVector: unit() })).toEqual([]);
  });
});

describe('owned snapshot lifecycle', () => {
  it.each(['append', 'remove'] as const)('attaches against owned rows after callers %s chapters', (mutation) => {
    const chapters = [structuredClone(fixture)], vectors = vectorIndex(chapters);
    const prepared = prepareSearchIndex(chapters);
    if (mutation === 'append') chapters.push({ ...structuredClone(fixture), id: 'later' });
    else chapters.length = 0;
    const attached = prepared.withVectors(vectors);
    expect(attached.search('zxqvpl', { queryVector: unit() }).map(result => result.chapter.id)).toEqual(['fixture']);
    expect(attached.withVectors(vectorIndex([fixture, { ...fixture, id: 'extra' }])).search('zxqvpl', { queryVector: unit() })).toEqual([]);
    expect(prepared.search('community')).toHaveLength(1);
  });
  it('attaches vectors while retaining the exact same frozen lexical snapshot', () => {
    const chapters = [structuredClone(fixture)], vectors = vectorIndex(chapters);
    const lexical = prepareSearchIndex(chapters), hybrid = lexical.withVectors(vectors);
    expect(hybrid.search('community')[0].chapter).toBe(lexical.search('community')[0].chapter);
    expect(lexical.search('zxqvpl', { queryVector: unit() })).toEqual([]);
    expect(hybrid.search('zxqvpl', { queryVector: unit() })).toHaveLength(1);
    vectors.values.fill(0);
    expect(hybrid.search('zxqvpl', { queryVector: unit() })).toHaveLength(1);
    expect(hybrid.withVectors().search('zxqvpl', { queryVector: unit() })).toEqual([]);
    expect(hybrid.withVectors({ ...vectors, rowCount: 2 }).search('zxqvpl', { queryVector: unit() })).toEqual([]);
  });
  it('isolates nested metadata and compact row mutations without freezing caller inputs', () => {
    const chapters = [structuredClone(fixture)], vectors = vectorIndex(chapters);
    const prepared = prepareSearchIndex(chapters, vectors), expected = structuredClone(prepared.search('community', { queryVector: unit() }));
    chapters[0].title = 'Changed'; chapters[0].topics[0] = 'Different'; chapters[0].keywords.push('New keyword');
    chapters[0].scripture[0] = 'John 1'; chapters[0].scriptureDisplay![0] = 'Changed'; chapters[0].series!.name = 'Different';
    vectors.values[0] = 0; chapters.push({ ...structuredClone(fixture), id: 'added' });
    const results = prepared.search('community', { queryVector: unit() });
    expect(results).toStrictEqual(expected); expect(results[0].chapter).not.toBe(chapters[0]);
    expect(Reflect.set(results[0].chapter, 'title', 'corrupted')).toBe(false);
    for (const value of [results[0].chapter.keywords, results[0].chapter.topics, results[0].chapter.scripture, results[0].chapter.scriptureDisplay, results[0].chapter.series]) expect(Object.isFrozen(value)).toBe(true);
    results[0].reasons.push('not a reason'); results[0].score = -100; results.reverse();
    expect(prepared.search('community', { queryVector: unit() })).toStrictEqual(expected);
    expect(Object.isFrozen(chapters[0])).toBe(false); expect(Object.isFrozen(vectors.values)).toBe(false);
  });
  it('rebuilds edits and replacement vectors without a global ID cache', () => {
    const chapters = [structuredClone(fixture)], vectors = vectorIndex(chapters), old = prepareSearchIndex(chapters, vectors);
    chapters[0].topics = ['Orchard']; chapters[0].summary = 'Edited public summary.';
    const updated = prepareSearchIndex(chapters, vectors);
    expect(updated.search('community')).toEqual([]); expect(old.search('community')).toHaveLength(1);
    // These are transcript-derived vectors: editing summary metadata cannot regenerate them.
    expect(updated.search('zxqvpl', { queryVector: unit() })).toHaveLength(1);
    vectors.values[0] = 0;
    expect(prepareSearchIndex(chapters, vectors).search('zxqvpl', { queryVector: unit() })).toEqual([]);
    expect(updated.search('zxqvpl', { queryVector: unit() })).toHaveLength(1);
  });
});

describe('conservative lexical candidates', () => {
  const chapter = (id: string, changes: Partial<SearchChapter> = {}): SearchChapter => ({ ...structuredClone(fixture), id, title: '', summary: '', serviceTitle: '', keywords: [], topics: [], scripture: [], scriptureDisplay: [], speaker: undefined, series: undefined, verseText: undefined, type: '', ...changes });
  it('keeps unknown terms in coverage and admits the cross-field 60% boundary', () => {
    const chapters = [chapter('boundary', { title: 'alpha', topics: ['beta'], keywords: ['gamma'] }), chapter('below', { title: 'alpha', summary: 'beta' }), chapter('repeat', { title: 'alpha alpha', topics: ['alpha'], verseText: 'alpha' })];
    const prepared = prepareSearchIndex(chapters), query = 'alpha beta gamma unknownone unknowntwo';
    expect(prepared.search(query)).toStrictEqual(search(chapters, query));
    expect(prepared.search(query).map((r) => r.chapter.id)).toEqual(['boundary']);
    expect(prepared.search('alpha unknownone unknowntwo')).toEqual([]);
  });
  it('merges raw and BSB matches once per term but counts distinct terms sharing a stem', () => {
    const chapters = [chapter('both', { title: 'sacrifice', verseText: 'sacrifices' }), chapter('verse-only', { verseText: 'sacrifices' }), chapter('plural', { summary: 'sacrifices' })];
    const prepared = prepareSearchIndex(chapters);
    for (const query of ['sacrifice sacrifices unknown', 'sacrifice unknownone unknowntwo', 'sacrifice', 'sacrifices']) expect(prepared.search(query)).toStrictEqual(search(chapters, query));
    expect(prepared.search('sacrifice sacrifices unknown').map((r) => r.chapter.id)).toEqual(['both', 'plural', 'verse-only']);
    expect(prepared.search('sacrifice').some((r) => r.chapter.id === 'plural')).toBe(true);
  });
  it('preserves per-value phrase boundaries and Unicode normalization', () => {
    const chapters = [chapter('separated', { keywords: ['ＣＡＦÉ', 'visits'] }), chapter('phrase', { keywords: ['café visits'] })];
    expect(prepareSearchIndex(chapters).search(' ＣＡＦÉ\nvisits ')).toStrictEqual(search(chapters, ' ＣＡＦÉ\nvisits '));
    expect(prepareSearchIndex(chapters).search('café visits').map((r) => r.chapter.id)).toEqual(['phrase', 'separated']);
  });
  it('does not truncate long queries or carry coverage between searches', () => {
    const terms = Array.from({ length: 300 }, (_, i) => `token${i}`);
    const chapters = [chapter('all', { summary: terms.join(' ') }), chapter('boundary', { summary: terms.slice(0, 180).join(' ') })];
    const prepared = prepareSearchIndex(chapters);
    for (const query of [terms.join(' '), `${terms.join(' ')} unknown`, 'unknown', 'token299']) expect(prepared.search(query)).toStrictEqual(search(chapters, query));
    expect(prepared.search(`${terms.join(' ')} unknown`).map((r) => r.chapter.id)).toEqual(['all']);
  });
});
