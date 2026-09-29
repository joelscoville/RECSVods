import type { SearchChapter } from './types';
import { isEmbeddingVector, preprocessEmbedding } from './embedding-config';
import { CHAPTER_VECTOR_CONFIG, cosineChapterVector, type ChapterVectorFile } from './chapter-vectors';
import { canonicalBook, normalizeReferenceSyntax, parseScriptureReference, scriptureOverlaps, scriptureCoverage, type ScriptureReference } from './scripture';

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
/** Words that negate or restrict a query's meaning ("not", "only"). A match that drops one is not a match. */
const MEANING_QUALIFIERS = ['no', 'not', 'never', 'only'];

/** How verse selection chooses the verse a search is about. Tuned separately from chapter ranking
 * (SEARCH_WEIGHTS), so changing one never silently changes the other. */
export const VERSE_SELECTION_POLICY = Object.freeze({
  /** Share of a multi-word query's terms a verse must contain; never fewer than two terms. */
  minimumTermCoverage: 0.6,
  /** A one-word query picks a verse only if the word appears in at most this share of all verses. */
  maximumSingleTermFrequency: 0.02,
  /** Added when a verse contains the query's words in order. */
  exactPhraseBonus: 32,
});

// ---------------------------------------------------------------------------------------------------
// References mentioned in a chapter's prose (as opposed to its cited scripture list).
// ---------------------------------------------------------------------------------------------------

/** Book names that are also everyday words; written in lowercase they are prose, not references. */
const EVERYDAY_WORDS = new Set(['acts', 'cant', 'job', 'judges', 'mark', 'numbers', 'song', 'songs']);
/** The book a name written in prose denotes. Capitalised or numbered names may be any alias ("Is", "Rom",
 * "1 Jn"); a lowercase name must be unambiguous (four or more letters, not an everyday word), so
 * "john 3:16" counts while "it is 3 weeks" (Isaiah) and "mark 3 items" (Mark) do not. */
function bookNamedInProse(name: string): string | undefined {
  const book = canonicalBook(name);
  if (!book || /^[A-Z0-9]/.test(name)) return book;
  const word = name.toLowerCase();
  return word.replace(/[^a-z]/g, '').length >= 4 && !EVERYDAY_WORDS.has(word) ? book : undefined;
}

/** Prose split into words, numbers and punctuation. Periods are left in the gaps between tokens, so an
 * abbreviation such as "Rom. 13:1" still reads as one reference. */
interface ProseTokens { text: string; tokens: { value: string; start: number; end: number }[] }
function tokenizeProse(text: string): ProseTokens {
  const tokens = [...text.matchAll(/\d+|[A-Za-z]+|[^\s.A-Za-z\d]/g)].map((match) => ({ value: match[0], start: match.index, end: match.index + match[0].length }));
  return { text, tokens };
}
/** Whether two tokens are separated only by whitespace or a period. */
function adjacent(prose: ProseTokens, left: number, right: number): boolean {
  return /^\.?\s*$/.test(prose.text.slice(prose.tokens[left].end, prose.tokens[right].start));
}
function isNumberAt(prose: ProseTokens, index: number): boolean { return index < prose.tokens.length && /^\d+$/.test(prose.tokens[index].value); }
function isWordAt(prose: ProseTokens, index: number): boolean { return index < prose.tokens.length && /^[A-Za-z]+$/.test(prose.tokens[index].value); }
/** Whether `mark` sits at `index`, directly after the previous token. */
function isMarkAt(prose: ProseTokens, index: number, mark: string): boolean {
  return index < prose.tokens.length && prose.tokens[index].value === mark && adjacent(prose, index - 1, index);
}

/** The book named by `tokenCount` contiguous tokens starting at `startIndex`: an optional leading book
 * number ("1", "I") followed by words, as the parser's alias table knows them ("Song of Solomon"). */
function readBookName(prose: ProseTokens, startIndex: number, tokenCount: number, bookNamed: (name: string) => string | undefined): string | undefined {
  if (!isWordAt(prose, startIndex) && !isNumberAt(prose, startIndex)) return undefined;
  const words = [prose.tokens[startIndex].value];
  for (let index = startIndex + 1; index < startIndex + tokenCount; index++) {
    if (!isWordAt(prose, index) || !adjacent(prose, index - 1, index)) return undefined;
    words.push(prose.tokens[index].value);
  }
  return bookNamed(words.join(' '));
}

/** The chapter:verse block starting at a chapter number: the chapter, an optional ":verse", then an
 * optional "-" end with its own optional ":verse" ("12", "12:1", "12:1-8", "12:21-13:2"). */
function readChapterVerseRange(prose: ProseTokens, chapterTokenIndex: number): { range: string; nextTokenIndex: number } {
  let range = prose.tokens[chapterTokenIndex].value;
  let lastTokenIndex = chapterTokenIndex;
  const readOptional = (mark: string) => {
    if (!isMarkAt(prose, lastTokenIndex + 1, mark) || !isNumberAt(prose, lastTokenIndex + 2)) return false;
    range += `${mark}${prose.tokens[lastTokenIndex + 2].value}`;
    lastTokenIndex += 2;
    return true;
  };
  readOptional(':');
  if (readOptional('-')) readOptional(':');
  return { range, nextTokenIndex: lastTokenIndex + 1 };
}

/** A reference unit starting at `startIndex`: the longest book name (up to four tokens) directly followed
 * by a chapter number, plus its chapter:verse block. `reference` is undefined when the recognised unit is
 * not a valid reference (1 John has five chapters, so "1 John 9" is not one). */
function readReferenceUnit(prose: ProseTokens, startIndex: number, bookNamed: (name: string) => string | undefined): { reference?: ScriptureReference; nextTokenIndex: number } | undefined {
  for (let bookTokenCount = 4; bookTokenCount >= 1; bookTokenCount--) {
    const chapterTokenIndex = startIndex + bookTokenCount;
    // Cheap check first: a chapter number must directly follow the name.
    if (!isNumberAt(prose, chapterTokenIndex) || !adjacent(prose, chapterTokenIndex - 1, chapterTokenIndex)) continue;
    const book = readBookName(prose, startIndex, bookTokenCount, bookNamed);
    if (!book) continue;
    const { range, nextTokenIndex } = readChapterVerseRange(prose, chapterTokenIndex);
    return { reference: parseScriptureReference(`${book} ${range}`), nextTokenIndex };
  }
  return undefined;
}

/** References mentioned in normalised prose, read forward as whole units in the chapter:verse format. */
function scanReferenceMentions(text: string, bookNamed: (name: string) => string | undefined): ScriptureReference[] {
  const prose = tokenizeProse(text);
  const mentions: ScriptureReference[] = [];
  let tokenIndex = 0;
  while (tokenIndex < prose.tokens.length) {
    const unit = readReferenceUnit(prose, tokenIndex, bookNamed);
    if (!unit) {
      tokenIndex += 1;
      continue;
    }
    if (unit.reference) mentions.push(unit.reference);
    // Invariant: a recognised book-and-number unit is always consumed whole, even when it is not a valid
    // reference. Its numbers therefore never start the next unit: the ":1" of "Romans 12:1" can never make
    // "1 John", and "1 John 9" is never re-read as John 9.
    tokenIndex = unit.nextTokenIndex;
  }
  return mentions;
}

/** Reads the references a chapter mentions in its own text (title, summary, service, series, keywords and
 * topics), normalised as the scripture parser normalises references. Create one reader per index build:
 * it caches per build, because service titles and topics repeat across a service's chapters, and the
 * caches are released with the index. */
function createMentionReader(): (chapter: SearchChapter) => ScriptureReference[] {
  const bookByName = new Map<string, string | undefined>();
  const mentionsByText = new Map<string, ScriptureReference[]>();
  const bookNamed = (name: string) => {
    if (!bookByName.has(name)) bookByName.set(name, bookNamedInProse(name));
    return bookByName.get(name);
  };
  const mentionsIn = (raw: string) => {
    let mentions = mentionsByText.get(raw);
    if (!mentions) {
      const text = normalizeReferenceSyntax(raw);
      mentions = /\d/.test(text) ? scanReferenceMentions(text, bookNamed) : [];
      mentionsByText.set(raw, mentions);
    }
    return mentions;
  };
  return (chapter) => [chapter.title, chapter.parentTitle ?? '', chapter.summary, chapter.serviceTitle,
    chapter.series?.name ?? '', ...chapter.keywords, ...chapter.topics].flatMap(mentionsIn);
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
/** `citedReferences` come from the chapter's scripture list; `mentionedReferences` are written in its text. */
interface SearchRow { chapter: SearchChapter; citedReferences: ReturnType<typeof parseScriptureReference>[]; mentionedReferences: ScriptureReference[]; fields: [FieldName, string[]][] }
function fields(chapter: SearchChapter, citedReferences: SearchRow['citedReferences']): SearchRow['fields'] {
  return [
    ['date', dateTerms(chapter.date)], ['speaker', chapter.speaker ? [chapter.speaker] : []],
    ['scripture', citedReferences.flatMap((ref) => ref ? [ref.canonical] : [])],
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
const CHAPTER_FIELDS = new Set<FieldName>(['title', 'keyword', 'summary']);
interface LexicalPostings { raw: Map<string, Uint32Array>; verse: Map<string, Uint32Array>; chapter: Map<string, Uint32Array> }
function prepareLexicalPostings(rows: readonly SearchRow[]): LexicalPostings {
  const raw = new Map<string, number[]>(), verse = new Map<string, number[]>(), chapter = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, term: string, row: number) => {
    const ids = map.get(term);
    if (!ids) map.set(term, [row]);
    else if (ids[ids.length - 1] !== row) ids.push(row);
  };
  rows.forEach(({ fields }, row) => {
    for (const [name, values] of fields) for (const value of values) for (const term of value.split(' ')) {
      if (!term) continue;
      add(name === 'verseText' ? verse : raw, term, row);
      if (CHAPTER_FIELDS.has(name)) add(chapter, term, row);
    }
  });
  const compact = (map: Map<string, number[]>) => new Map([...map].map(([term, ids]) => [term, Uint32Array.from(ids)]));
  return { raw: compact(raw), verse: compact(verse), chapter: compact(chapter) };
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
 * enemies" does not pick a verse that only mentions enemies. Thresholds live in VERSE_SELECTION_POLICY. */
export function prepareVerseScorer(verses: Readonly<Record<string, string>>): (query: string) => (verseKey: string) => number {
  const normalized = new Map(Object.entries(verses).map(([key, text]) => [key, normalize(text)]));
  return (query) => {
    const queryWords = words(query);
    const terms = [...new Set(queryWords.filter((word) => !STOP_WORDS.has(word)))].map(inflectionTerm);
    if (!terms.length) return () => 0;
    const needles = terms.map((term) => ` ${term} `), phrase = ` ${queryWords.map(inflectionTerm).join(' ')} `;
    // A qualifier must stay attached to what it qualifies: "do not love the world" needs "not love", so
    // John 3:16 ("so loved the world … shall not perish") is not the verse it is about.
    const qualifiedPairs = queryWords.flatMap((word, i) => MEANING_QUALIFIERS.includes(word) && i + 1 < queryWords.length ? [` ${inflectionTerm(word)} ${inflectionTerm(queryWords[i + 1])} `] : []);
    const requiredTerms = terms.length === 1 ? 1 : Math.max(2, Math.ceil(terms.length * VERSE_SELECTION_POLICY.minimumTermCoverage));
    const frequency = needles.map((needle) => { let count = 0; for (const text of normalized.values()) if (text.includes(needle)) count++; return count; });
    const total = normalized.size;
    return (verseKey) => {
      const text = normalized.get(verseKey);
      if (!text || qualifiedPairs.some((pair) => !text.includes(pair))) return 0;
      let score = 0, matchedTerms = 0, distinctive = false;
      needles.forEach((needle, i) => {
        if (!text.includes(needle)) return;
        matchedTerms += 1;
        score += Math.log((total + 1) / (frequency[i] + 1));
        if (frequency[i] / total <= VERSE_SELECTION_POLICY.maximumSingleTermFrequency) distinctive = true;
      });
      if (matchedTerms < requiredTerms || (terms.length === 1 && !distinctive)) return 0;
      return score + (queryWords.length > 1 && text.includes(phrase) ? VERSE_SELECTION_POLICY.exactPhraseBonus : 0);
    };
  };
}

/** Exhaustive, mutable-input API. No global ID cache or metadata-derived embeddings. */
export function search(chapters: readonly SearchChapter[], query: string, options: SearchOptions = {}): SearchResult[] {
  const readMentions = createMentionReader();
  const rows = chapters.map((chapter) => {
    const citedReferences = chapter.scripture.map(parseScriptureReference);
    return { chapter, citedReferences, mentionedReferences: readMentions(chapter), fields: fields(chapter, citedReferences).map(([name, values]): [FieldName, string[]] => [name, values.map(normalize)]) };
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
  const readMentions = createMentionReader();
  const rows = chapters.map((source): SearchRow => {
    const chapter = snapshot(source);
    const citedReferences = chapter.scripture.map((value) => {
      if (!parsed.has(value)) parsed.set(value, parseScriptureReference(value));
      return parsed.get(value);
    });
    return { chapter, citedReferences, mentionedReferences: readMentions(chapter), fields: fields(chapter, citedReferences).map(([name, values]) => [name, values.map((value) => {
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
    const { chapter, citedReferences, mentionedReferences, fields } = rows[row];
    if (dateQuery && chapter.date !== dateQuery) continue;
    const citedMatch = referenceQuery && citedReferences.some((reference) => reference && scriptureOverlaps(referenceQuery, reference));
    // Without a cited match, a reference mentioned in the chapter's text still counts, however it is
    // abbreviated ("Rom. 13:1" for Romans 13), so it admits the row without the query's exact words.
    const mentionedMatch = referenceQuery && !citedMatch && mentionedReferences.some((reference) => scriptureOverlaps(referenceQuery, reference));
    let score = 0;
    const reasons: string[] = [];
    if (!coverage || citedMatch || mentionedMatch || coverage[row] / terms.length >= SEARCH_WEIGHTS.minimumTermCoverage || coverage[row] >= 2) {
      const covered = new Set<number>();
      let distinctiveMetadata = false;
      for (const [name, values] of fields) {
        if (name === 'scripture' && referenceQuery) {
          if (citedMatch) {
            terms.forEach((_, i) => covered.add(i));
            score += SEARCH_WEIGHTS.referenceBonus * scriptureCoverage(referenceQuery, citedReferences.filter(reference => reference !== undefined))
              + SEARCH_WEIGHTS.scripture * (1 + SEARCH_WEIGHTS.phraseBonus);
            reasons.push(`Scripture: ${referenceQuery.canonical}`);
          } else if (mentionedMatch) {
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
          // A shared recording/series title must not erase the distinctiveness of
          // a term found in an individual chapter's title, keywords or synopsis.
          if (CHAPTER_FIELDS.has(name) && (frequencies.chapter.get(terms[i])?.length ?? rows.length) / rows.length <= 0.05) distinctiveMetadata = true;
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
        && !terms.some((term, i) => MEANING_QUALIFIERS.includes(term) && !covered.has(i));
      if (covered.size / terms.length < SEARCH_WEIGHTS.minimumTermCoverage && !sparse) { score = 0; reasons.length = 0; }
      // A Bible reference is one term, not loose words: "Psalms 1" must not match a chapter that merely
      // mentions some psalm and the number 1 (Psalms 98:1-3). Without an overlapping cited reference, only
      // an overlapping reference mentioned in the chapter's own text counts, book identity included.
      if (referenceQuery && !citedMatch && !mentionedMatch) { score = 0; reasons.length = 0; }
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
