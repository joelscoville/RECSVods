import { describe, expect, it } from 'vitest';
import { enrichPassages } from '../bible/enrich';
import { EMBEDDING_CONFIG } from '../site/lib/embedding-config';
import { buildEmbeddingDocument, prepareSearchIndex, search, type PreparedSearchOptions, type VectorIndex } from '../site/lib/search';
import type { SearchPassage } from '../site/lib/types';

// Fictional data only. The unchanged pure search is the independent ranking oracle.
const fixture: SearchPassage = {
  id: 'fixture', serviceId: 'service-b', videoId: 'abcdefghijk', start: 60, end: 120,
  serviceTitle: 'Evening gathering', title: 'Serving our neighbours', summary: 'Practical care and quiet generosity.',
  questions: ['How can we help others?', 'What is civic responsibility?'], topics: ['Community', 'Service'],
  scripture: ['Rom 12:1-2'], scriptureDisplay: ['Rom. 12:1–2'],
  transcript: 'The fictional speaker discusses quiet acts of generosity, café visits and civic responsibility.',
  speaker: 'Example Speaker', date: '2026-09-06', type: 'sermon', preview: true,
  series: { id: 'orchard', name: 'Fictional orchard' },
};
function unit(index = 0): number[] { return Array.from({ length: 384 }, (_, i) => i === index ? 1 : 0); }
function dense(seed: number): number[] {
  const values = Array.from({ length: 384 }, (_, i) => Math.sin((i + 1) * seed));
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
}
function vectorIndex(passages: readonly SearchPassage[], vector: (i: number) => number[] = () => unit()): VectorIndex {
  return { schemaVersion: 1, model: EMBEDDING_CONFIG, passagesSha256: 'fictional-test-only',
    vectors: Object.fromEntries(passages.map((p, i) => [p.id, { document: buildEmbeddingDocument(p), vector: vector(i) }])),
  };
}
function corpus(): SearchPassage[] {
  const passages = enrichPassages([
    structuredClone(fixture),
    { ...structuredClone(fixture), id: 'reference', scripture: ['Romans 13:1-7'], date: '2024-02-29' },
    { ...structuredClone(fixture), id: 'cross-chapter', scripture: ['Romans 12:21-13:2'], date: '2020-07-05' },
    { ...structuredClone(fixture), id: 'empty', speaker: undefined, series: undefined, questions: [], topics: [], scripture: [],
      title: '', summary: '', transcript: '', serviceTitle: '' },
    { ...structuredClone(fixture), id: 'boundaries', scripture: ['Romans 12:10'],
      topics: ['Communities'], transcript: 'Quiet generosity. ＣＡＦÉ visits; kindness and just service.',
      questions: ['quiet', 'generosity'], summary: 'class status analysis sacrifices' },
    { ...structuredClone(fixture), id: 'incidental-date', date: '2025-01-01', title: '6 September 2026', transcript: '2026-09-06' },
    { ...structuredClone(fixture), id: 'tie-a', serviceId: 'service-a' },
    { ...structuredClone(fixture), id: 'tie-video', videoId: 'aaaaaaaaaaa' },
    { ...structuredClone(fixture), id: 'tie-start', start: 10 },
    { ...structuredClone(fixture), id: 'tie-id' },
  ]);
  // The search API ignores malformed references; the build-only enricher rejects them.
  passages.find((p) => p.id === 'boundaries')!.scripture.push('not a reference');
  return passages;
}

const queries = [
  '', '  ', '?!', 'the and', 'zxqvpl', 'community', 'commun', 'Example Speaker community',
  'quiet generosity', 'quiet quiet generosity', 'practical care', 'help others', 'evening gathering',
  'fictional orchard', 'sermon', ' ＣＡＦÉ\nvisits ', 'responsibility', 'class status analysis',
  'Rom13', 'ROM.13:3', 'Romans 12:21-13:2', 'Romans 13:8', 'Romans 12:1', '12:1',
  'living sacrifice', 'living sacrifices', '2026-09-06', '6 September 2026', 'Sep. 6, 2026',
  '29 February 2024', '29 February 1900', '2026-7-5', 'July 2020', '5 July 2020 prayer',
];

describe('prepared ranking equivalence', () => {
  it.each(queries)('preserves exact order, Float64 scores and reasons for %j', (query) => {
    const passages = corpus();
    const before = structuredClone(passages);
    const prepared = prepareSearchIndex(passages);
    expect(prepared.search(query)).toStrictEqual(search(passages, query));
    expect(prepared.search(query)).toStrictEqual(prepared.search(query));
    expect(passages).toStrictEqual(before);
  });

  it.each(queries)('preserves hybrid rankings, thresholds and limits for %j', (query) => {
    const passages = corpus();
    const vectors = vectorIndex(passages, (i) => dense(0.12345678901234566 + i / 1000));
    const before = structuredClone({ passages, vectors });
    const prepared = prepareSearchIndex(passages, vectors);
    const queryVectors = [dense(0.12345678901234566), dense(0.128), unit(), [1], Array(384).fill(0)];
    const options: PreparedSearchOptions[] = queryVectors.flatMap((queryVector) => [
      { queryVector }, ...[-1, 0, 0.45, 0.9, 1, 2, NaN, Infinity].map((semanticThreshold) => ({ queryVector, semanticThreshold })),
    ]);
    options.push(...[0, -1, 1, 2.8, Infinity, NaN].map((limit) => ({ queryVector: queryVectors[0], limit })));
    for (const option of options) {
      expect(prepared.search(query, option)).toStrictEqual(search(passages, query, { ...option, vectors }));
    }
    expect({ passages, vectors }).toStrictEqual(before);
  });

  it('keeps reference priority, truthful BSB reasons and hard date scope with perfect semantics', () => {
    const passages = corpus();
    const vectors = vectorIndex(passages);
    const prepared = prepareSearchIndex(passages, vectors);
    expect(prepared.search('Rom 13')[0].reasons).toContain('Scripture match (reference)');
    expect(prepared.search('living sacrifice').find((r) => r.passage.id === 'fixture')?.reasons).toEqual(['Verse-text match (BSB)']);
    const results = prepared.search('6 September 2026', { queryVector: unit() });
    expect(results).toStrictEqual(search(passages, '6 September 2026', { vectors, queryVector: unit() }));
    expect(results.every((r) => r.passage.date === '2026-09-06')).toBe(true);
    expect(results.some((r) => r.passage.id === 'incidental-date')).toBe(false);
  });

  it('rejects stale, missing, incompatible and malformed vectors exactly as the pure API does', () => {
    const passages = corpus();
    const original = vectorIndex(passages);
    const broken = structuredClone(original);
    broken.vectors.fixture.document += ' changed';
    delete broken.vectors.reference;
    broken.vectors['cross-chapter'].vector = [1];
    broken.vectors.empty.vector = Array(384).fill(0);
    broken.vectors.boundaries.vector[0] = NaN;
    broken.vectors['tie-a'].vector[0] = Infinity;
    broken.vectors['tie-video'].vector[0] = -1; // valid vector, negative cosine
    const wrongModel = { ...original, model: { ...EMBEDDING_CONFIG, revision: 'wrong' } } as unknown as VectorIndex;
    const wrongSchema = { ...original, schemaVersion: 2 } as unknown as VectorIndex;
    for (const vectors of [undefined, broken, wrongModel, wrongSchema]) {
      const prepared = prepareSearchIndex(passages, vectors);
      for (const query of ['community', 'zxqvpl', 'Romans 13', '2024-02-29']) {
        expect(prepared.search(query, { queryVector: unit() })).toStrictEqual(search(passages, query, { vectors, queryVector: unit() }));
      }
    }
  });

  it('scans every compatible vector even without lexical candidates and before applying the limit', () => {
    const passages = Array.from({ length: 65 }, (_, i) => ({ ...structuredClone(fixture), id: `row-${i}` }));
    const vectors = vectorIndex(passages, (i) => i === 64 ? unit() : unit(1));
    const prepared = prepareSearchIndex(passages, vectors);
    const results = prepared.search('zxqvpl', { queryVector: unit(), limit: 1 });
    expect(results).toStrictEqual(search(passages, 'zxqvpl', { vectors, queryVector: unit(), limit: 1 }));
    expect(results.map((r) => [r.passage.id, r.score, r.reasons])).toEqual([['row-64', 3, ['Semantic similarity']]]);
    expect(prepareSearchIndex([]).search('community', { queryVector: unit() })).toEqual([]);
  });

  it('preserves exact threshold boundaries and query-vector mutation between queries', () => {
    const passages = [structuredClone(fixture)];
    const vectors = vectorIndex(passages);
    const prepared = prepareSearchIndex(passages, vectors);
    const queryVector = unit();
    for (const cosine of [0.44999999999999996, 0.45, 0.45000000000000007, 0, -1, 1]) {
      queryVector[0] = cosine;
      queryVector[1] = Math.sqrt(1 - cosine ** 2);
      expect(prepared.search('zxqvpl', { queryVector })).toStrictEqual(search(passages, 'zxqvpl', { vectors, queryVector }));
    }
  });
});

describe('owned snapshot lifecycle', () => {
  it('rejects stale vectors after editing each embedding source field, but accepts equivalent normalized documents', () => {
    const edits: ((passage: SearchPassage) => void)[] = [
      (p) => { p.title += ' edited'; }, (p) => { p.summary += ' edited'; },
      (p) => { p.questions.push('An edited question'); }, (p) => { p.topics.push('Edited'); },
      (p) => { p.scripture[0] = 'John 1:1'; }, (p) => { p.verseText = 'Edited hidden verse text'; },
      (p) => { p.transcript += ' edited'; },
    ];
    for (const edit of edits) {
      const passages = [structuredClone(fixture)];
      const vectors = vectorIndex(passages);
      edit(passages[0]);
      expect(prepareSearchIndex(passages, vectors).search('zxqvpl', { queryVector: unit() })).toStrictEqual(
        search(passages, 'zxqvpl', { vectors, queryVector: unit() }),
      );
      expect(prepareSearchIndex(passages, vectors).search('zxqvpl', { queryVector: unit() })).toEqual([]);
    }
    const passages = [structuredClone(fixture)];
    const vectors = vectorIndex(passages);
    passages[0].scripture[0] = 'Romans 12:1-2'; // alias expansion leaves the embedding document unchanged
    passages[0].title = ' Ｓerving\tour neighbours ';
    passages[0].speaker = 'Changed speaker'; // metadata-only edits never invalidated embeddings
    passages[0].series!.name = 'Changed series';
    expect(buildEmbeddingDocument(passages[0])).toBe(vectors.vectors.fixture.document);
    const prepared = prepareSearchIndex(passages, vectors);
    expect(prepared.search('zxqvpl', { queryVector: unit() })).toStrictEqual(search(passages, 'zxqvpl', { vectors, queryVector: unit() }));
    expect(prepared.search('zxqvpl', { queryVector: unit() })[0].reasons).toEqual(['Semantic similarity']);
  });

  it('isolates nested input mutations and freezes exposed passage data without freezing inputs', () => {
    const passages = [structuredClone(fixture)];
    const vectors = vectorIndex(passages);
    const prepared = prepareSearchIndex(passages, vectors);
    const expected = structuredClone(prepared.search('community', { queryVector: unit() }));
    passages[0].title = 'Changed';
    passages[0].topics[0] = 'Different';
    passages[0].questions.push('New question');
    passages[0].scripture[0] = 'John 1';
    passages[0].scriptureDisplay![0] = 'Changed display';
    passages[0].series!.name = 'Different series';
    passages[0].date = '2020-01-01';
    vectors.vectors.fixture.vector[0] = 0;
    vectors.vectors.fixture.document = 'Changed document';
    passages.push({ ...structuredClone(fixture), id: 'added' });
    const results = prepared.search('community', { queryVector: unit() });
    expect(results).toStrictEqual(expected);
    expect(results[0].passage).not.toBe(passages[0]);
    expect(Reflect.set(results[0].passage, 'title', 'corrupted')).toBe(false);
    expect(Reflect.set(results[0].passage.topics, '0', 'corrupted')).toBe(false);
    expect(Reflect.set(results[0].passage.series!, 'name', 'corrupted')).toBe(false);
    for (const value of [results[0].passage.questions, results[0].passage.scripture, results[0].passage.scriptureDisplay]) expect(Object.isFrozen(value)).toBe(true);
    results[0].reasons.push('not a real reason');
    results[0].score = -100;
    results.reverse();
    expect(prepared.search('community', { queryVector: unit() })).toStrictEqual(expected);
    expect(Object.isFrozen(passages[0])).toBe(false);
    expect(Object.isFrozen(vectors.vectors.fixture.vector)).toBe(false);
  });

  it('rebuilds same-ID edits, additions, removals and replacement vectors without a stale ID cache', () => {
    const passages = [structuredClone(fixture)];
    const vectors = vectorIndex(passages);
    const old = prepareSearchIndex(passages, vectors);
    passages[0].summary = 'An edited embedding document';
    passages[0].topics = ['Orchard'];
    const stale = prepareSearchIndex(passages, vectors);
    expect(stale.search('zxqvpl', { queryVector: unit() })).toEqual([]);
    expect(stale.search('community')).toEqual([]);
    expect(old.search('community')).toHaveLength(1);
    expect(old.search('zxqvpl', { queryVector: unit() })).toHaveLength(1);
    const freshVectors = vectorIndex(passages);
    const fresh = prepareSearchIndex(passages, freshVectors);
    expect(fresh.search('zxqvpl', { queryVector: unit() })).toHaveLength(1);
    const replacements = [{ ...structuredClone(fixture), id: 'replacement' }];
    const updated = prepareSearchIndex(replacements, vectorIndex(replacements));
    expect(updated.search('community').map((r) => r.passage.id)).toEqual(['replacement']);
    expect(updated.search('community')).toStrictEqual(search(replacements, 'community'));
    freshVectors.vectors.fixture.vector = unit(1);
    expect(prepareSearchIndex(passages, freshVectors).search('zxqvpl', { queryVector: unit() })).toEqual([]);
    expect(fresh.search('zxqvpl', { queryVector: unit() })).toHaveLength(1);
  });
});

describe('conservative prepared lexical candidates', () => {
  function passage(id: string, changes: Partial<SearchPassage> = {}): SearchPassage {
    return { ...structuredClone(fixture), id, title: '', summary: '', transcript: '', serviceTitle: '',
      questions: [], topics: [], scripture: [], scriptureDisplay: [], speaker: undefined, series: undefined,
      type: '', ...changes };
  }

  it('keeps unknown terms in coverage and admits the exact cross-field 60% boundary', () => {
    const passages = [
      passage('boundary', { title: 'alpha', topics: ['beta'], questions: ['gamma'] }),
      passage('below', { title: 'alpha', transcript: 'beta' }),
      passage('repeated', { title: 'alpha alpha', topics: ['alpha'], verseText: 'alpha' }),
    ];
    const prepared = prepareSearchIndex(passages);
    const query = 'alpha beta gamma unknownone unknowntwo';
    const results = prepared.search(query);
    expect(results).toStrictEqual(search(passages, query));
    expect(results.map((r) => r.passage.id)).toEqual(['boundary']);
    expect(results[0].reasons).toEqual(['Topic match', 'Title match', 'Question match']);
    for (const text of ['alpha unknownone unknowntwo', 'alpha beta unknownone unknowntwo', 'entirelyunknown', query, 'alpha alpha beta']) {
      expect(prepared.search(text)).toStrictEqual(search(passages, text));
    }
    expect(prepared.search('alpha unknownone unknowntwo')).toEqual([]);
  });

  it('merges raw/verse matches once per term but counts distinct terms sharing a verse stem', () => {
    const passages = [
      passage('both', { title: 'sacrifice', topics: ['sacrifice'], verseText: 'sacrifices' }),
      passage('verse-only', { verseText: 'sacrifices' }),
      passage('raw-plural', { transcript: 'sacrifices' }),
      passage('raw-singular', { transcript: 'sacrifice' }),
    ];
    const prepared = prepareSearchIndex(passages);
    for (const query of ['sacrifice sacrifices unknown', 'sacrifice unknownone unknowntwo', 'sacrifice', 'sacrifices']) {
      expect(prepared.search(query)).toStrictEqual(search(passages, query));
    }
    expect(prepared.search('sacrifice sacrifices unknown').map((r) => r.passage.id)).toEqual(['both', 'verse-only']);
    expect(prepared.search('sacrifice unknownone unknowntwo')).toEqual([]);
    expect(prepared.search('sacrifice').some((r) => r.passage.id === 'raw-plural')).toBe(false);
  });

  it('preserves per-value phrase boundaries and Unicode normalization across fields', () => {
    const passages = [
      passage('separated', { questions: ['ＣＡＦÉ', 'visits'], topics: ['alpha'], summary: 'beta' }),
      passage('phrase', { questions: ['café visits'], topics: ['alpha'], summary: 'beta' }),
    ];
    const prepared = prepareSearchIndex(passages);
    for (const query of [' ＣＡＦÉ\nvisits ', 'café visits alpha beta unknown', 'café café visits', 'caf']) {
      expect(prepared.search(query)).toStrictEqual(search(passages, query));
    }
    expect(prepared.search('café visits').map((r) => r.reasons)).toEqual([
      ['Question match (exact phrase)'], ['Question match'],
    ]);
  });

  it('admits structured range overlaps without literal endpoints and still rejects nonoverlaps', () => {
    const passages = [
      passage('wide', { scripture: ['Romans 12:21-14:2'] }),
      passage('narrow', { scripture: ['Romans 13:8'] }),
      passage('incidental', { transcript: 'Romans 13:3' }),
    ];
    const prepared = prepareSearchIndex(passages);
    for (const query of ['Rom13:3', 'Romans 12:20-13:2', 'Romans 14:1', 'Romans 14:3']) {
      expect(prepared.search(query)).toStrictEqual(search(passages, query));
    }
    const results = prepared.search('Rom13:3');
    expect(results[0].passage.id).toBe('wide');
    expect(results[0].reasons).toEqual(['Scripture match (reference)']);
    expect(results.some((r) => r.passage.id === 'narrow')).toBe(false);
    expect(prepared.search('Romans 14:3').some((r) => r.passage.id === 'wide')).toBe(false);
  });

  it('retains semantic-only rows below lexical coverage, including after mutable vector updates', () => {
    const passages = [
      passage('lexical', { title: 'no match' }),
      passage('semantic-only', { title: 'no' }),
      passage('no-terms', { title: 'elsewhere' }),
    ];
    const vectors = vectorIndex(passages, (i) => i === 0 ? unit(1) : unit());
    const prepared = prepareSearchIndex(passages, vectors);
    const query = 'zxqvpl-no-match';
    const options = { queryVector: unit() };
    const expected = search(passages, query, { vectors, ...options });
    expect(prepared.search(query, options)).toStrictEqual(expected);
    expect(expected.filter((r) => r.passage.id !== 'lexical').map((r) => r.reasons)).toEqual([
      ['Semantic similarity'], ['Semantic similarity'],
    ]);
    vectors.vectors['semantic-only'].vector[0] = 0; // invalid norm
    vectors.vectors['no-terms'].vector = unit(1); // valid, now orthogonal
    expect(prepared.search(query, options)).toStrictEqual(expected);
    const rebuilt = prepareSearchIndex(passages, vectors);
    expect(rebuilt.search(query, options)).toStrictEqual(search(passages, query, { vectors, ...options }));
    expect(rebuilt.search(query, options).map((r) => r.passage.id)).toEqual(['lexical']);
    options.queryVector[0] = 0;
    options.queryVector[1] = 1;
    expect(rebuilt.search(query, options)).toStrictEqual(search(passages, query, { vectors, ...options }));
  });

  it('retains hard date scope and the current auxiliary/pronoun stop-word policy', () => {
    const passages = [
      passage('target', { title: 'Christians', topics: ['government'] }),
      passage('wrong-date', { date: '2025-01-01', transcript: '6 September 2026', title: 'not no only will' }),
    ];
    const vectors = vectorIndex(passages);
    const prepared = prepareSearchIndex(passages, vectors);
    for (const query of ['6 September 2026', 'How should Christians relate to government?', 'we should do our', 'not no only will']) {
      for (const options of [{}, { queryVector: unit() }]) {
        expect(prepared.search(query, options)).toStrictEqual(search(passages, query, { ...options, vectors }));
      }
    }
    expect(prepared.search('6 September 2026', { queryVector: unit() }).map((r) => r.passage.id)).toEqual(['target']);
    expect(prepared.search('we should do our', { queryVector: unit() })).toEqual([]);
    expect(prepared.search('not no only will').map((r) => r.passage.id)).toEqual(['wrong-date']);
    expect(prepared.search('How should Christians relate to government?').map((r) => r.passage.id)).toEqual(['target']);
  });

  it('does not truncate long queries or carry coverage between searches', () => {
    const terms = Array.from({ length: 300 }, (_, i) => `token${i}`);
    const passages = [passage('all', { transcript: terms.join(' ') }), passage('boundary', { topics: terms.slice(0, 180) })];
    const prepared = prepareSearchIndex(passages);
    for (const query of [terms.join(' '), `${terms.join(' ')} unknown`, 'unknown', 'token299', terms.join(' ')]) {
      expect(prepared.search(query)).toStrictEqual(search(passages, query));
    }
    expect(prepared.search(terms.join(' ')).map((r) => r.passage.id).sort()).toEqual(['all', 'boundary']);
    expect(prepared.search(`${terms.join(' ')} unknown`).map((r) => r.passage.id)).toEqual(['all']);
  });
});
