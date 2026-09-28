import type { SearchChapter } from './types';
import { isEmbeddingVector, preprocessEmbedding } from './embedding-config';
import { CHAPTER_VECTOR_CONFIG, cosineChapterVector, type ChapterVectorFile } from './chapter-vectors';
import { canonicalBook, parseScriptureReference, scriptureOverlaps, scriptureCoverage, type ScriptureReference } from './scripture';

export const SEARCH_WEIGHTS = Object.freeze({
  date: 16, speaker: 14, scripture: 14, verseText: 2, keyword: 7, topic: 7, title: 6,
  referenceBonus: 32, service: 4, series: 4, summary: 3, type: 2,
  phraseBonus: 1, semantic: 6, semanticThreshold: 0.45, minimumTermCoverage: 0.6,
});
/** Rows MUST retain the order of validated ChapterMetadata.chapters, including zero rows.
 * loadChapterMetadata validates CHAPTER_VECTOR_CONFIG before vectors are attached.
 * The binary has no IDs; callers must never independently filter or reorder its metadata.
 */
export type DecodedChapterVectors = ChapterVectorFile;
export interface SearchOptions {
  queryVector?: number[]; vectors?: DecodedChapterVectors; limit?: number; semanticThreshold?: number;
}
export interface SearchResult { chapter: SearchChapter; score: number; reasons: string[] }
export type PreparedSearchOptions = Omit<SearchOptions, 'vectors'>;
export interface PreparedSearchIndex { search(query: string, options?: PreparedSearchOptions): SearchResult[] }

const STOP_WORDS = new Set('a about above after again all am an and any are as at be because been before being below between both by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself now of off on once or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up us very was we were what when where which while who whom why with would you your yours yourself yourselves'.split(' '));
/** Qualifiers that invert or restrict meaning; a match that drops one is not a match. */
const NEGATIONS = ['no', 'not', 'never', 'only'];
/** A chapter number with an optional verse or range, as written in prose ("3:16", "13:1-7", "2"). */
const WRITTEN_CHAPTER = /(?<![0-9:])(\d+(?:\s*:\s*\d+)?(?:\s*[-–]\s*\d+(?:\s*:\s*\d+)?)?)(?![0-9])/g;
/** References written out in a chapter's own text (not its cited scripture). Before each chapter number,
 * the longest run of up to four preceding words that the parser's own alias table names as a book is taken,
 * so book identity is complete: "1 John", "I John", "1 Jn" and "Song of Solomon" are read in full, and
 * "Reading from 1 John 3:16" is never John. Names must be capitalised as written, so prose such as "it is
 * 3 weeks" is not Isaiah 3. Query-independent, so parsed once per row, and only texts with digits. */
function writtenReferences(chapter: SearchChapter): ScriptureReference[] {
  const texts = [chapter.title, chapter.parentTitle ?? '', chapter.summary, chapter.serviceTitle, chapter.series?.name ?? '', ...chapter.keywords, ...chapter.topics];
  return texts.flatMap((text) => {
    if (!/\d/.test(text)) return [];
    const found: ScriptureReference[] = [];
    for (const match of text.matchAll(WRITTEN_CHAPTER)) {
      const before = text.slice(Math.max(0, match.index - 40), match.index);
      if (!/[A-Za-z]\.?\s*$/.test(before)) continue;
      const tokens = before.match(/[A-Za-z0-9]+/g)?.slice(-4) ?? [];
      for (let count = tokens.length; count >= 1; count--) {
        const name = tokens.slice(-count).join(' '), book = /^[A-Z0-9]/.test(name) ? canonicalBook(name) : undefined;
        if (!book) continue;
        const reference = parseScriptureReference(`${book} ${match[1]}`);
        if (reference) found.push(reference);
        break;
      }
    }
    return found;
  });
}
function words(text: string): string[] { return preprocessEmbedding(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; }
/** Light English inflection normalization; no synonyms, prefixes, or corpus-specific terms. */
function inflectionTerm(word: string): string {
  if (!/^[a-z]+$/.test(word) || word.length < 4) return word;
  let stem = word.replace(/ies$/, 'y');
  if (stem.endsWith('s') && !/(ss|us|is|ous)$/.test(stem)) stem = stem.slice(0, -1);
  if (/[aeiouy].*(?:ing|ed)$/.test(stem)) {
    stem = stem.replace(/(?:ing|ed)$/, '');
    if (/([bdgmnprt])\1$/.test(stem)) stem = stem.slice(0, -1);
  }
  return stem.length > 3 ? stem.replace(/e$/, '') : stem;
}
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_NUMBERS = new Map(MONTHS.flatMap((name, index) => [[name, index + 1], [name.slice(0, 3), index + 1]] as [string, number][]));
MONTH_NUMBERS.set('sept', 9);

/** Whole-query calendar dates only. No locale-dependent Date.parse or rollover. */
export function parseFullDateQuery(query: string): string | undefined {
  const text = preprocessEmbedding(query).toLowerCase();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dayFirst = /^(\d{1,2}) ([a-z]+)\.? (\d{4})$/.exec(text);
  const monthFirst = /^([a-z]+)\.? (\d{1,2}),? (\d{4})$/.exec(text);
  if (!iso && !dayFirst && !monthFirst) return undefined;
  const year = Number(iso?.[1] ?? dayFirst?.[3] ?? monthFirst?.[3]);
  const month = iso ? Number(iso[2]) : MONTH_NUMBERS.get(dayFirst?.[2] ?? monthFirst![1]);
  const day = Number(iso?.[3] ?? dayFirst?.[1] ?? monthFirst?.[2]);
  if (year < 1 || !month || month > 12 || day < 1) return undefined;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return undefined;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function dateTerms(date: string): string[] {
  const [year, month, day] = date.split('-');
  const name = MONTHS[Number(month) - 1];
  return [date, `${Number(day)} ${name} ${year}`, `${name} ${Number(day)} ${year}`, `${Number(day)} ${name?.slice(0, 3)} ${year}`];
}
type FieldName = 'date' | 'speaker' | 'scripture' | 'verseText' | 'keyword' | 'topic' | 'title' | 'service' | 'series' | 'summary' | 'type';
interface SearchRow { chapter: SearchChapter; references: ReturnType<typeof parseScriptureReference>[]; written: ScriptureReference[]; fields: [FieldName, string[]][] }
function fields(chapter: SearchChapter, references: SearchRow['references']): SearchRow['fields'] {
  return [
    ['date', dateTerms(chapter.date)], ['speaker', chapter.speaker ? [chapter.speaker] : []],
    ['scripture', references.flatMap((ref) => ref ? [ref.canonical] : [])],
    ['verseText', chapter.verseText ? [chapter.verseText] : []], ['keyword', chapter.keywords],
    ['topic', chapter.topics], ['title', [chapter.title, ...(chapter.parentTitle ? [chapter.parentTitle] : [])]], ['service', [chapter.serviceTitle]],
    ['series', chapter.series ? [chapter.series.name] : []], ['summary', [chapter.summary]], ['type', [chapter.type]],
  ];
}
function normalize(value: string): string { return ` ${words(value).map(inflectionTerm).join(' ')} `; }
function validVectors(vectors: DecodedChapterVectors | undefined, count: number): vectors is DecodedChapterVectors {
  return !!vectors && vectors.dimension === CHAPTER_VECTOR_CONFIG.dimension && vectors.rowCount === count
    && vectors.values instanceof Int8Array && vectors.values.length === count * vectors.dimension
    && !vectors.values.some((value) => value === -128);
}
interface LexicalPostings { raw: Map<string, Uint32Array>; verse: Map<string, Uint32Array> }
function prepareLexicalPostings(rows: readonly SearchRow[]): LexicalPostings {
  const raw = new Map<string, number[]>(), verse = new Map<string, number[]>();
  rows.forEach(({ fields }, row) => {
    for (const [name, values] of fields) for (const value of values) for (const term of value.split(' ')) {
      if (!term) continue;
      const map = name === 'verseText' ? verse : raw;
      const ids = map.get(term);
      if (!ids) map.set(term, [row]);
      else if (ids[ids.length - 1] !== row) ids.push(row);
    }
  });
  const compact = (map: Map<string, number[]>) => new Map([...map].map(([term, ids]) => [term, Uint32Array.from(ids)]));
  return { raw: compact(raw), verse: compact(verse) };
}
function lexicalCoverage(postings: LexicalPostings, terms: readonly string[], count: number): Uint32Array {
  const covered = new Uint32Array(count);
  for (const term of terms) {
    const raw = postings.raw.get(term), verse = postings.verse.get(term);
    let a = 0, b = 0;
    while (a < (raw?.length ?? 0) || b < (verse?.length ?? 0)) {
      const rawRow = raw?.[a] ?? Infinity, verseRow = verse?.[b] ?? Infinity;
      const row = Math.min(rawRow, verseRow);
      covered[row]++;
      if (rawRow === row) a++;
      if (verseRow === row) b++;
    }
  }
  return covered;
}

/** Scores individual Bible verses against a query with search's own words and inflections, so a result
 * can lead with the verse a natural-language or verse-text search is about. Prepare once per scripture
 * index; call with a query to get a per-verse scorer. A one-word query must be distinctive (rare across
 * all verses), so "God" never decides; a longer query must match most of its words, so "love your
 * enemies" does not pick a verse that only mentions enemies. */
export function prepareVerseScorer(verses: Readonly<Record<string, string>>): (query: string) => (verseKey: string) => number {
  const normalized = new Map(Object.entries(verses).map(([key, text]) => [key, normalize(text)]));
  return (query) => {
    const queryWords = words(query);
    const terms = [...new Set(queryWords.filter((word) => !STOP_WORDS.has(word)))].map(inflectionTerm);
    if (!terms.length) return () => 0;
    const needles = terms.map((term) => ` ${term} `), phrase = ` ${queryWords.map(inflectionTerm).join(' ')} `;
    // A negation must stay attached to what it negates: "do not love the world" needs "not love", so
    // John 3:16 ("so loved the world … shall not perish") is not the verse it is about.
    const negated = queryWords.flatMap((word, i) => NEGATIONS.includes(word) && i + 1 < queryWords.length ? [` ${inflectionTerm(word)} ${inflectionTerm(queryWords[i + 1])} `] : []);
    const frequency = needles.map((needle) => { let count = 0; for (const text of normalized.values()) if (text.includes(needle)) count++; return count; });
    const total = normalized.size;
    return (verseKey) => {
      const text = normalized.get(verseKey);
      if (!text || negated.some((pair) => !text.includes(pair))) return 0;
      let score = 0, hits = 0, distinctive = false;
      const required = terms.length === 1 ? 1 : Math.max(2, Math.ceil(terms.length * SEARCH_WEIGHTS.minimumTermCoverage));
      needles.forEach((needle, i) => {
        if (!text.includes(needle)) return;
        hits++; score += Math.log((total + 1) / (frequency[i] + 1));
        if (frequency[i] / total <= 0.02) distinctive = true;
      });
      if (hits < required || (terms.length === 1 && !distinctive)) return 0;
      return score + (queryWords.length > 1 && text.includes(phrase) ? SEARCH_WEIGHTS.referenceBonus : 0);
    };
  };
}

/** Exhaustive, mutable-input API. No global ID cache or metadata-derived embeddings. */
export function search(chapters: readonly SearchChapter[], query: string, options: SearchOptions = {}): SearchResult[] {
  const rows = chapters.map((chapter) => {
    const references = chapter.scripture.map(parseScriptureReference);
    return { chapter, references, written: writtenReferences(chapter), fields: fields(chapter, references).map(([name, values]): [FieldName, string[]] => [name, values.map(normalize)]) };
  });
  return rank(rows, validVectors(options.vectors, chapters.length) ? options.vectors : undefined, undefined, query, options);
}

function snapshot(source: SearchChapter): SearchChapter {
  // Explicit allowlist prevents accidental retention of private fields in a prepared index.
  const { id, serviceId, serviceTitle, videoId, start, end, type, title, summary, speaker, date, preview, verseText } = source;
  const chapter: SearchChapter = { id, serviceId, serviceTitle, videoId, start, end, type, title, summary, date, preview,
    keywords: [...source.keywords], topics: [...source.topics], scripture: [...source.scripture],
    ...(source.parentId ? { parentId: source.parentId, parentTitle: source.parentTitle } : {}),
    ...(Object.hasOwn(source, 'speaker') ? { speaker } : {}), ...(Object.hasOwn(source, 'verseText') ? { verseText } : {}),
    ...(Object.hasOwn(source, 'scriptureDisplay') ? { scriptureDisplay: source.scriptureDisplay ? [...source.scriptureDisplay] : undefined } : {}),
    ...(Object.hasOwn(source, 'series') ? { series: source.series ? { id: source.series.id, name: source.series.name } : undefined } : {}),
  };
  Object.freeze(chapter.keywords); Object.freeze(chapter.topics); Object.freeze(chapter.scripture);
  if (chapter.scriptureDisplay) Object.freeze(chapter.scriptureDisplay);
  if (chapter.series) Object.freeze(chapter.series);
  return Object.freeze(chapter);
}
/** Owns a frozen metadata snapshot and a copy of compact rows. Rebuild for new artifact pairs. */
export function prepareSearchIndex(chapters: readonly SearchChapter[], vectors?: DecodedChapterVectors): PreparedSearchIndex {
  const raw = new Map<string, string>(), verse = new Map<string, string>();
  const parsed = new Map<string, ReturnType<typeof parseScriptureReference>>();
  const rows = chapters.map((source): SearchRow => {
    const chapter = snapshot(source);
    const references = chapter.scripture.map((value) => {
      if (!parsed.has(value)) parsed.set(value, parseScriptureReference(value));
      return parsed.get(value);
    });
    return { chapter, references, written: writtenReferences(chapter), fields: fields(chapter, references).map(([name, values]) => [name, values.map((value) => {
      const cache = name === 'verseText' ? verse : raw;
      if (!cache.has(value)) cache.set(value, normalize(value));
      return cache.get(value)!;
    })]) };
  });
  const ownedVectors = validVectors(vectors, chapters.length) ? { dimension: vectors.dimension, rowCount: vectors.rowCount, values: vectors.values.slice() } : undefined;
  const postings = prepareLexicalPostings(rows);
  return Object.freeze({ search: rank.bind(undefined, rows, ownedVectors, postings) });
}

function rank(rows: readonly SearchRow[], vectors: DecodedChapterVectors | undefined, postings: LexicalPostings | undefined, query: string, options: PreparedSearchOptions = {}): SearchResult[] {
  const dateQuery = parseFullDateQuery(query), referenceQuery = parseScriptureReference(query);
  const queryWords = words(dateQuery ?? referenceQuery?.canonical ?? query);
  const terms = [...new Set(queryWords.filter((word) => !STOP_WORDS.has(word)))].map(inflectionTerm);
  if (!queryWords.length || !terms.length) return [];
  const needles = terms.map((term) => ` ${term} `);
  const phrase = ` ${queryWords.map(inflectionTerm).join(' ')} `;
  const queryVector = isEmbeddingVector(options.queryVector) ? options.queryVector : undefined;
  const threshold = Math.max(0, Math.min(1, Number.isFinite(options.semanticThreshold) ? options.semanticThreshold! : SEARCH_WEIGHTS.semanticThreshold));
  const coverage = postings && !dateQuery ? lexicalCoverage(postings, terms, rows.length) : undefined;
  const frequencies = postings ?? prepareLexicalPostings(rows);
  const weights = terms.map((term) => 1 + Math.log((rows.length + 1) / ((frequencies.raw.get(term)?.length ?? 0) + 1)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  // Shared service labels and BSB spans recur across outline parents/subsections.
  // Scan each distinct normalized value once per query, rather than once per row.
  const textMatches = new Map<string, { terms: boolean[]; phrase: boolean }>();
  const matchText = (value: string) => {
    let match = textMatches.get(value);
    if (!match) {
      match = { terms: needles.map(needle => value.includes(needle)), phrase: value.includes(phrase) };
      textMatches.set(value, match);
    }
    return match;
  };
  const results: SearchResult[] = [];
  for (let row = 0; row < rows.length; row++) {
    const { chapter, references, written, fields } = rows[row];
    if (dateQuery && chapter.date !== dateQuery) continue;
    const referenceMatch = referenceQuery && references.some((reference) => reference && scriptureOverlaps(referenceQuery, reference));
    // Without a cited match, a reference written in the chapter's text still counts, however it is
    // abbreviated ("Rom. 13:1" for Romans 13), so it admits the row without the query's exact words.
    const writtenMatch = referenceQuery && !referenceMatch && written.some((reference) => scriptureOverlaps(referenceQuery, reference));
    let score = 0;
    const reasons: string[] = [];
    if (!coverage || referenceMatch || writtenMatch || coverage[row] / terms.length >= SEARCH_WEIGHTS.minimumTermCoverage || coverage[row] >= 2) {
      const covered = new Set<number>();
      let distinctiveMetadata = false;
      for (const [name, values] of fields) {
        if (name === 'scripture' && referenceQuery) {
          if (referenceMatch) {
            terms.forEach((_, i) => covered.add(i));
            score += SEARCH_WEIGHTS.referenceBonus * scriptureCoverage(referenceQuery, references.filter(reference => reference !== undefined))
              + SEARCH_WEIGHTS.scripture * (1 + SEARCH_WEIGHTS.phraseBonus);
            reasons.push(`Scripture: ${referenceQuery.canonical}`);
          } else if (writtenMatch) {
            terms.forEach((_, i) => covered.add(i));
            score += SEARCH_WEIGHTS.scripture;
            reasons.push(`Mentions ${referenceQuery.canonical}`);
          }
          continue;
        }
        const fieldNeedles = needles;
        let found = 0;
        for (let i = 0; i < fieldNeedles.length; i++) if (values.some((value) => matchText(value).terms[i])) {
          found += weights[i]; covered.add(i);
          if (['title', 'keyword', 'summary'].includes(name) && (frequencies.raw.get(terms[i])?.length ?? rows.length) / rows.length <= 0.05) distinctiveMetadata = true;
        }
        if (!found) continue;
        const fullPhrase = values.some((value) => matchText(value).phrase);
        score += SEARCH_WEIGHTS[name] * (found / totalWeight + (fullPhrase ? SEARCH_WEIGHTS.phraseBonus : 0));
        reasons.push(name === 'verseText' ? 'Verse-text match (BSB)' : name === 'keyword' ? 'Keyword'
          : `${name[0].toUpperCase()}${name.slice(1)} match${fullPhrase && queryWords.length > 1 ? ' (exact phrase)' : ''}`);
      }
      // Short metadata cannot reproduce every word of a natural-language question.
      // Admit a sparse match only with two terms and a distinctive metadata cue;
      // ordinary partial matches, unknown-only queries and negation remain constrained.
      const sparse = distinctiveMetadata && covered.size >= 2 && covered.size / terms.length >= 1 / 3
        && !terms.some((term, i) => NEGATIONS.includes(term) && !covered.has(i));
      if (covered.size / terms.length < SEARCH_WEIGHTS.minimumTermCoverage && !sparse) { score = 0; reasons.length = 0; }
      // A Bible reference is one term, not loose words: "Psalms 1" must not match a chapter that merely
      // mentions some psalm and the number 1 (Psalms 98:1-3). Without an overlapping cited reference, only
      // an overlapping reference written out in the chapter's own text counts, book identity included.
      if (referenceQuery && !referenceMatch && !writtenMatch) { score = 0; reasons.length = 0; }
    }
    // Exhaustive even for rows with no lexical candidates. Zero rows score 0 and never match.
    if (vectors && queryVector) {
      const cosine = cosineChapterVector(vectors, row, queryVector);
      if (cosine > 0 && cosine >= threshold) { score += SEARCH_WEIGHTS.semantic * cosine; reasons.push('Similar in meaning'); }
    }
    if (score > 0) results.push({ chapter, score, reasons });
  }
  results.sort((a, b) => b.score - a.score || compare(b.chapter.date, a.chapter.date)
    || compare(a.chapter.serviceId, b.chapter.serviceId) || compare(a.chapter.videoId, b.chapter.videoId)
    || a.chapter.start - b.chapter.start || compare(a.chapter.id, b.chapter.id));
  return options.limit === undefined ? results : results.slice(0, Math.max(0, Math.floor(options.limit)));
}
