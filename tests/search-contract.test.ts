import { describe, expect, it } from 'vitest';
import { prepareSearchIndex, search } from '../site/lib/search';
import { parseScriptureReference, scriptureCoverage, scriptureOverlaps } from '../site/lib/scripture';
import type { SearchUnit } from '../site/lib/display';

// Independent truth table: do not derive expected identities from the parser under test.
const books = [
  { book: 'John', names: ['John', 'john', 'JOHN', 'Jn', 'Jhn'] },
  { book: '1 John', names: ['1 John', 'I John', 'i john', '1Jn'] },
  { book: '2 John', names: ['2 John', 'II John', 'ii john', '2Jn'] },
  { book: '3 John', names: ['3 John', 'III John', 'iii john', '3Jn'] },
  { book: 'Song of Solomon', names: ['Song of Solomon', 'Song of Songs', 'song of solomon', 'SOS'] },
];
const fixture: SearchUnit = {
  id: 'target', recordingId: 'fixture', kind: 'point', start: 10, end: 20,
  title: 'Reading', recordingTitle: 'Gathering', text: 'A reading.', date: '2026-01-04',
  preview: true, scripture: [], topics: [],
};
const engines = {
  exhaustive: (rows: SearchUnit[]) => (query: string) => search(rows, query),
  prepared: (rows: SearchUnit[]) => prepareSearchIndex(rows).search,
};

describe.each(Object.entries(engines))('%s search contracts', (_name, prepare) => {
  for (const { book, names } of books) it.each(names)('keeps the full identity of %s', (name) => {
    const run = prepare([{ ...fixture, text: `Read ${name} 1:2.` }]);
    expect(run(`${book} 1:2`).map(({ unit }) => unit.id)).toEqual(['target']);
    expect(run(`${book} 1:2`)[0].reasons).toContain(`Mentions ${book} 1:2`);
    for (const other of books.filter(item => item.book !== book)) expect(run(`${other.book} 1:2`)).toEqual([]);
  });

  it.each([';', ', ', ' / ', ' (', '\n', '. ', ' ', ';\n'])('never borrows a number across %j', (separator) => {
    for (const compact of [false, true]) {
      const john = compact ? 'John3:16' : 'John 3:16';
      const run = prepare([{ ...fixture, text: `Read Romans 12:1${separator}${john}.` }]);
      expect(run('John 3:16')).toHaveLength(1);
      expect(run('Romans 12:1')).toHaveLength(1);
      expect(run('1 John 3:16')).toEqual([]);
      // Adding a genuinely numbered reference is not the same as borrowing a number.
      const numbered = prepare([{ ...fixture, text: `Romans 12:1${separator}1 ${john}.` }]);
      expect(numbered('1 John 3:16')).toHaveLength(1);
      expect(numbered('John 3:16')).toEqual([]);
    }
  });

  const fields: [string, Partial<SearchUnit>][] = [
    ['title', { title: 'Read John 3:16' }], ['text', { text: 'Read John 3:16' }],
    ['recording', { recordingTitle: 'Read John 3:16' }], ['series', { series: { id: 'series', title: 'Read John 3:16' } }],
    ['topics', { topics: ['Read John 3:16'] }],
  ];
  it.each(fields)('recognizes references in %s independently of structured citations', (_field, values) => {
    expect(prepare([{ ...fixture, ...values }])('John 3:16')).toHaveLength(1);
  });
  it('does not join distinct metadata values into references', () => {
    const run = prepare([{ ...fixture, title: '1', topics: ['1', 'John 3:16', 'John', '4:8'] }]);
    expect(run('John 3:16')).toHaveLength(1);
    expect(run('1 John 3:16')).toEqual([]);
    expect(run('John 4:8')).toEqual([]);
  });
  it.each(['It is 3 weeks away.', 'mark 3 items', 'the acts 2 cast list'])('does not invent a reference in %s', (text) => {
    const run = prepare([{ ...fixture, text }]);
    for (const query of ['Isaiah 3', 'Mark 3', 'Acts 2']) expect(run(query)).toEqual([]);
  });
  it('rejects loose book/number coverage and preserves citation provenance', () => {
    const rows = [
      { ...fixture, id: 'loose', scripture: ['Psalms 98:1-3'], text: 'Psalms 98:1-3 and 1 Corinthians 11.' },
      { ...fixture, id: 'written', text: 'Reads Psalm 1 aloud.' },
      { ...fixture, id: 'cited', scripture: ['Psalms 1:1-6'] },
    ];
    const results = prepare(rows)('Psalms 1');
    expect(results.map(({ unit }) => unit.id)).toEqual(['cited', 'written']);
    expect(results[0].reasons).toContain('Scripture: Psalms 1');
    expect(results[1].reasons).toContain('Mentions Psalms 1');
  });
  it.each(['John 3:0', 'John 3:37', 'John 3:20-16', 'John 99:16'])('does not salvage an invalid written range: %s', (reference) => {
    expect(prepare([{ ...fixture, text: `Read ${reference}.` }])('John 3:16')).toEqual([]);
  });
});

// Deterministic generation with an enumerated-set oracle, independent of production interval math.
// RECS_TEST_SEED replays a run; each assertion also prints its complete, small input.
describe('generated reference contracts', () => {
  it('matches overlap, coverage and written-range admission against verse sets (300 cases)', () => {
    const seed = Number(process.env.RECS_TEST_SEED ?? 130316);
    if (!Number.isSafeInteger(seed)) throw new Error('RECS_TEST_SEED must be an integer');
    let state = seed >>> 0;
    const next = (max: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
    const set = (start: number, end: number) => new Set(Array.from({ length: end - start + 1 }, (_, i) => start + i));
    for (let i = 0; i < 300; i++) {
      const from = 1 + next(30), to = from + next(37 - from);
      const a = 1 + next(30), b = a + next(37 - a);
      const q = `John 3:${from}-${to}`, ref = `John 3:${a}-${b}`;
      const requested = set(from, to), cited = set(a, b);
      const hits = [...requested].filter(verse => cited.has(verse)).length;
      const context = `seed=${seed} case=${i} query=${q} reference=${ref}`;
      const parsed = parseScriptureReference(q)!, passage = parseScriptureReference(ref)!;
      expect(scriptureOverlaps(parsed, passage), context).toBe(hits > 0);
      expect(scriptureCoverage(parsed, [passage, passage]), context).toBe(hits / requested.size);
      const summary = `Romans 12:1; ${i % 2 ? ref.toLowerCase() : ref}.`;
      for (const prepare of Object.values(engines)) expect(prepare([{ ...fixture, text: summary }])(q).length, context).toBe(hits ? 1 : 0);
    }
  });
});
