import { BIBLE_BOOKS, canonicalBook } from '../../bible/books';
import counts from '../../bible/verse-counts.json';

export { BIBLE_BOOKS, canonicalBook };
export interface ScriptureReference {
  display: string;
  canonical: string;
  book: string;
  start: { chapter: number; verse: number };
  end: { chapter: number; verse: number };
}

/** The one normalisation of reference syntax, shared by every reader of references: NFKC folds Unicode
 * forms ("Ⅰ John", "１ John" → "I John", "1 John") and every dash becomes a hyphen ("12:21—13:2"). */
export function normalizeReferenceSyntax(input: string): string {
  return input.normalize('NFKC').replace(/[–—]/g, '-');
}

/** One reference per string: chapter(s), verse(s), or a cross-chapter range. */
export function parseScriptureReference(input: string): ScriptureReference | undefined {
  const value = normalizeReferenceSyntax(input).trim();
  const match = /^(.*?)\s*([1-9]\d*)\s*(?::\s*([1-9]\d*))?\s*(?:-\s*([1-9]\d*)\s*(?::\s*([1-9]\d*))?)?$/.exec(value);
  if (!match) return undefined;
  const book = canonicalBook(match[1]);
  if (!book) return undefined;
  const chapters = (counts as Record<string, number[]>)[book];
  const chapter = Number(match[2]);
  const verse = match[3] ? Number(match[3]) : undefined;
  const end = match[4] ? Number(match[4]) : undefined;
  const endVerse = match[5] ? Number(match[5]) : undefined;
  if (endVerse && !verse) return undefined;
  const endChapter = endVerse ? end! : verse ? chapter : end ?? chapter;
  const start = { chapter, verse: verse ?? 1 };
  const finish = { chapter: endChapter, verse: endVerse ?? (verse ? end ?? verse : chapters[endChapter - 1]) };
  if (![start, finish].every((point) => Number.isSafeInteger(point.chapter) && Number.isSafeInteger(point.verse)
    && point.chapter >= 1 && point.chapter <= chapters.length && point.verse >= 1 && point.verse <= chapters[point.chapter - 1])) return undefined;
  if (finish.chapter < chapter || (finish.chapter === chapter && finish.verse < start.verse)) return undefined;
  let canonical = `${book} ${chapter}${verse ? `:${verse}` : ''}`;
  if (end !== undefined) {
    if (endVerse) {
      if (endChapter !== chapter) canonical += `-${endChapter}:${endVerse}`;
      else if (endVerse !== verse) canonical += `-${endVerse}`;
    } else if (end !== (verse ?? chapter)) canonical += `-${end}`;
  }
  return { display: input, canonical, book, start, end: finish };
}

export function normalizeScriptureReference(input: string): string {
  const reference = parseScriptureReference(input);
  if (!reference) throw new Error(`Invalid scripture reference: ${input}`);
  return reference.canonical;
}

/** Reference-only outbound link; never fetches or caches ESV text. */
export function scriptureUrl(reference: string): string {
  return `https://www.esv.org/${encodeURIComponent(normalizeScriptureReference(reference))}/`;
}

export function scriptureOverlaps(a: ScriptureReference, b: ScriptureReference): boolean {
  const position = (point: ScriptureReference['start']) => point.chapter * 1000 + point.verse;
  return a.book === b.book && position(a.start) <= position(b.end) && position(b.start) <= position(a.end);
}

/** Fraction of requested verses covered, merging duplicate/overlapping references. */
export function scriptureCoverage(query: ScriptureReference, references: readonly ScriptureReference[]): number {
  const chapters = (counts as Record<string, number[]>)[query.book];
  const position = (point: ScriptureReference['start']) => chapters.slice(0, point.chapter - 1).reduce((sum, count) => sum + count, 0) + point.verse;
  const start = position(query.start), end = position(query.end);
  const spans = references.filter(reference => scriptureOverlaps(query, reference))
    .map(reference => [Math.max(start, position(reference.start)), Math.min(end, position(reference.end))])
    .sort((a, b) => a[0] - b[0]);
  let covered = 0, previousEnd = start - 1;
  for (const [from, to] of spans) {
    covered += Math.max(0, to - Math.max(from, previousEnd + 1) + 1);
    previousEnd = Math.max(previousEnd, to);
  }
  return covered / (end - start + 1);
}
