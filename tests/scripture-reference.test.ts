import { describe, expect, it } from 'vitest';
import { BOOKS } from '../bible/books';
import counts from '../bible/verse-counts.json';
import { normalizeScriptureReference, parseScriptureReference, scriptureCoverage, scriptureUrl } from '../site/lib/scripture';

describe('scripture reference metadata (no corpus/model/build dependencies)', () => {
  it('ranks real query coverage without double counting overlapping references or other books', () => {
    const query = parseScriptureReference('Romans 13')!;
    const refs = ['Romans 13:1-7', 'Romans 13:1', 'Romans 13:2-4', '1 Peter 2'].map(ref => parseScriptureReference(ref)!);
    expect(scriptureCoverage(query, refs)).toBe(0.5);
    expect(scriptureCoverage(query, [...refs, parseScriptureReference('Romans 13:8-14')!])).toBe(1);
    expect(scriptureCoverage(query, [parseScriptureReference('Romans 12')!])).toBe(0);
  });
  it('covers all 66 canonical books and every declared alias with sourced chapter bounds', () => {
    expect(BOOKS).toHaveLength(66);
    expect(Object.keys(counts)).toEqual(BOOKS.map(([book]) => book));
    for (const [book, ...aliases] of BOOKS) for (const alias of [book, ...aliases]) {
      expect(normalizeScriptureReference(`${alias} 1:1`)).toBe(`${book} 1:1`);
    }
  });
  it.each([
    ['Rom13', 'Romans 13'], ['ROM. 13:1–7', 'Romans 13:1-7'], ['II Tim. 3:16', '2 Timothy 3:16'],
    ['IICor 1:1', '2 Corinthians 1:1'], ['III Jn 1:14', '3 John 1:14'], ['1Jn1:1', '1 John 1:1'],
    ['Ps 23', 'Psalms 23'], ['Song of Songs 2:1', 'Song of Solomon 2:1'],
    ['Jn 3:36 — 4:2', 'John 3:36-4:2'], ['Gen 1 - 2', 'Genesis 1-2'],
    ['Romans 12:1-12:2', 'Romans 12:1-2'], ['John 3:16-16', 'John 3:16'],
  ])('normalizes %s and preserves entered display', (input, canonical) => {
    expect(parseScriptureReference(input)).toMatchObject({ display: input, canonical });
  });
  it.each(['Romans 17', 'Romans 13:15', 'Romans 0', 'John 3:0', 'John 3:37', 'John 3:16-4:55',
    'John 4:2-3:16', 'Romans 12:2-1', 'Genesis 1-51', 'John 3-4:2', 'Jude 2', '4 John 1:1',
    'Rom 13 extra text', 'Unknown 1', 'John 3:16; Romans 1:1', 'Romans 99999999999999999999'])('rejects invalid reference %s', (input) => {
    expect(parseScriptureReference(input)).toBeUndefined();
    expect(() => scriptureUrl(input)).toThrow('Invalid scripture reference');
  });
  it('generates canonical ESV reference links without requesting verse text', () => {
    expect(scriptureUrl('Rom13:1–7')).toBe('https://www.esv.org/Romans%2013%3A1-7/');
    expect(scriptureUrl('II Tim 3:16')).toBe('https://www.esv.org/2%20Timothy%203%3A16/');
  });
});
