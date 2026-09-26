import type { SearchPassage } from './types';
import { EMBEDDING_CONFIG, isCompatibleEmbeddingConfig, isEmbeddingVector, preprocessEmbedding } from './embedding-config';
import { parseScriptureReference, scriptureOverlaps } from './scripture';

export const SEARCH_WEIGHTS = Object.freeze({
  date: 16, speaker: 14, scripture: 14, verseText: 8, topic: 7, title: 6,
  referenceBonus: 32,
  service: 4, series: 4, question: 4, summary: 3, transcript: 2, type: 2,
  phraseBonus: 0.5, semantic: 3, semanticThreshold: 0.45, minimumTermCoverage: 0.6,
});

export interface VectorIndex {
  schemaVersion: 1;
  model: typeof EMBEDDING_CONFIG;
  passagesSha256: string;
  /** Exact input guards against applying a stale vector to an edited passage with the same ID. */
  vectors: Record<string, { document: string; vector: number[] }>;
}
export interface SearchOptions {
  queryVector?: number[];
  vectors?: VectorIndex;
  limit?: number;
  semanticThreshold?: number;
}
export interface SearchResult { passage: SearchPassage; score: number; reasons: string[] }

export type PreparedSearchOptions = Omit<SearchOptions, 'vectors'>;
export interface PreparedSearchIndex {
  /** Results contain frozen snapshot passages, not the caller's mutable objects. */
  search(query: string, options?: PreparedSearchOptions): SearchResult[];
}

export function buildEmbeddingDocument(passage: SearchPassage): string {
  return preprocessEmbedding([
    passage.title, passage.summary, ...passage.questions, ...passage.topics,
    ...passage.scripture.map((reference) => parseScriptureReference(reference)?.canonical ?? reference), passage.verseText ?? '', passage.transcript,
  ].join('\n'));
}

// Query scaffolding should not outweigh its subject. Keep negation and meaningful
// title words such as "only" and "will"; phrase matching still uses the full query.
const STOP_WORDS = new Set('a am an and are as at be been being by can could did do does for from he her him his how i if in is it its me my of on or our ours she should that the their them they this to us was we were what when where which who why with would you your yours'.split(' '));
function words(text: string): string[] {
  return preprocessEmbedding(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
function lexical(text: string): string { return words(text).join(' '); }
// Conservative English plural folding for verse-text recall, not substring matching.
function verseTerm(word: string): string {
  return word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
}
function containsPhrase(field: string, query: string): boolean { return ` ${field} `.includes(` ${query} `); }
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

/** Exact field scores plus a bounded cosine contribution. No model is needed for lexical search. */
export function search(passages: readonly SearchPassage[], query: string, options: SearchOptions = {}): SearchResult[] {
  const dateQuery = parseFullDateQuery(query);
  const referenceQuery = parseScriptureReference(query);
  const lexicalQuery = dateQuery ?? referenceQuery?.canonical ?? query;
  const phrase = lexical(lexicalQuery);
  const terms = [...new Set(words(lexicalQuery).filter((word) => !STOP_WORDS.has(word)))];
  if (!phrase || !terms.length) return [];
  const semanticAvailable = isEmbeddingVector(options.queryVector) && options.vectors?.schemaVersion === 1 && isCompatibleEmbeddingConfig(options.vectors.model);
  const threshold = Math.max(0, Math.min(1, Number.isFinite(options.semanticThreshold) ? options.semanticThreshold! : SEARCH_WEIGHTS.semanticThreshold));
  const results: SearchResult[] = [];
  for (const passage of passages) {
    // Neither incidental text nor even a perfect semantic vector can escape a date constraint.
    if (dateQuery && passage.date !== dateQuery) continue;
    const references = passage.scripture.map((value) => parseScriptureReference(value));
    const referenceMatch = referenceQuery && references.some((reference) => reference && scriptureOverlaps(referenceQuery, reference));
    const fields: [keyof Pick<typeof SEARCH_WEIGHTS, 'date' | 'speaker' | 'scripture' | 'verseText' | 'topic' | 'title' | 'service' | 'series' | 'question' | 'summary' | 'transcript' | 'type'>, string[]][] = [
      ['date', dateTerms(passage.date)], ['speaker', passage.speaker ? [passage.speaker] : []],
      ['scripture', references.flatMap((reference) => reference ? [reference.canonical] : [])],
      ['verseText', passage.verseText ? [passage.verseText] : []], ['topic', passage.topics], ['title', [passage.title]],
      ['service', [passage.serviceTitle]], ['question', passage.questions], ['summary', [passage.summary]],
      ['transcript', [passage.transcript]], ['type', [passage.type]],
    ];
    if (passage.series) fields.push(['series', [passage.series.name]]);
    let score = 0;
    const reasons: string[] = [];
    const covered = new Set<string>();
    for (const [name, values] of fields) {
      if (name === 'scripture' && referenceQuery) {
        if (referenceMatch) {
          terms.forEach((term) => covered.add(term));
          score += SEARCH_WEIGHTS.referenceBonus + SEARCH_WEIGHTS.scripture * (1 + SEARCH_WEIGHTS.phraseBonus);
          reasons.push('Scripture match (reference)');
        }
        continue;
      }
      const normalized = values.map((value) => name === 'verseText' ? words(value).map(verseTerm).join(' ') : lexical(value));
      const found = terms.filter((term) => normalized.some((value) => containsPhrase(value, name === 'verseText' ? verseTerm(term) : term)));
      if (!found.length) continue;
      found.forEach((term) => covered.add(term));
      const fieldPhrase = name === 'verseText' ? words(lexicalQuery).map(verseTerm).join(' ') : phrase;
      const fullPhrase = normalized.some((value) => containsPhrase(value, fieldPhrase));
      score += SEARCH_WEIGHTS[name] * (found.length / terms.length + (fullPhrase ? SEARCH_WEIGHTS.phraseBonus : 0));
      reasons.push(name === 'verseText' ? 'Verse-text match (BSB)'
        : `${name[0].toUpperCase()}${name.slice(1)} match${fullPhrase && words(lexicalQuery).length > 1 ? ' (exact phrase)' : ''}`);
    }
    const lexicalMatch = covered.size / terms.length >= SEARCH_WEIGHTS.minimumTermCoverage;
    if (!lexicalMatch) { score = 0; reasons.length = 0; }
    const entry = semanticAvailable ? options.vectors!.vectors?.[passage.id] : undefined;
    if (entry && entry.document === buildEmbeddingDocument(passage) && isEmbeddingVector(entry.vector)) {
      const cosine = Math.max(-1, Math.min(1, entry.vector.reduce((sum, value, i) => sum + value * options.queryVector![i], 0)));
      if (cosine > 0 && cosine >= threshold) {
        score += SEARCH_WEIGHTS.semantic * cosine;
        reasons.push('Semantic similarity');
      }
    }
    if (score > 0) results.push({ passage, score, reasons });
  }
  results.sort((a, b) => b.score - a.score || compare(b.passage.date, a.passage.date)
    || compare(a.passage.serviceId, b.passage.serviceId) || compare(a.passage.videoId, b.passage.videoId)
    || a.passage.start - b.passage.start || compare(a.passage.id, b.passage.id));
  return options.limit === undefined ? results : results.slice(0, Math.max(0, Math.floor(options.limit)));
}

type FieldName = 'date' | 'speaker' | 'scripture' | 'verseText' | 'topic' | 'title' | 'service' | 'series' | 'question' | 'summary' | 'transcript' | 'type';
interface PreparedPassage {
  passage: SearchPassage;
  references: ReturnType<typeof parseScriptureReference>[];
  fields: [FieldName, string[]][];
  vector?: number[];
}

interface LexicalPostings {
  raw: Map<string, Uint32Array>;
  verse: Map<string, Uint32Array>;
}

/** Sorted, unique row ordinals per token; no retained per-passage word Sets. */
function prepareLexicalPostings(rows: readonly PreparedPassage[]): LexicalPostings {
  const raw = new Map<string, number[]>();
  const verse = new Map<string, number[]>();
  rows.forEach(({ fields }, row) => {
    for (const [name, values] of fields) {
      const postings = name === 'verseText' ? verse : raw;
      for (const value of values) for (const term of value.split(' ')) {
        if (!term) continue;
        const ids = postings.get(term);
        // Rows arrive in order, so the last ordinal deduplicates across all fields.
        if (!ids) postings.set(term, [row]);
        else if (ids[ids.length - 1] !== row) ids.push(row);
      }
    }
  });
  const compact = (source: Map<string, number[]>) => {
    const result = new Map<string, Uint32Array>();
    for (const [term, ids] of source) result.set(term, Uint32Array.from(ids));
    source.clear();
    return result;
  };
  return { raw: compact(raw), verse: compact(verse) };
}

/** Upper bound on distinct query-term coverage, not a scoring or semantic filter. */
function lexicalCoverage(postings: LexicalPostings, terms: readonly string[], rowCount: number): Uint32Array {
  const covered = new Uint32Array(rowCount);
  for (const term of terms) {
    const raw = postings.raw.get(term);
    const verse = postings.verse.get(verseTerm(term));
    let a = 0, b = 0;
    // Merge the two sorted lists: a term matching both raw and BSB counts once.
    // Distinct query terms that fold to the same BSB stem still count separately.
    while (a < (raw?.length ?? 0) || b < (verse?.length ?? 0)) {
      const rawRow = raw?.[a] ?? Infinity;
      const verseRow = verse?.[b] ?? Infinity;
      const row = Math.min(rawRow, verseRow);
      covered[row]++;
      if (rawRow === row) a++;
      if (verseRow === row) b++;
    }
  }
  return covered;
}

function snapshotPassage(source: SearchPassage): SearchPassage {
  const passage = { ...source, questions: [...source.questions], topics: [...source.topics], scripture: [...source.scripture],
    ...(source.scriptureDisplay ? { scriptureDisplay: [...source.scriptureDisplay] } : {}),
    ...(source.series ? { series: { ...source.series } } : {}),
  };
  Object.freeze(passage.questions); Object.freeze(passage.topics); Object.freeze(passage.scripture);
  if (passage.scriptureDisplay) Object.freeze(passage.scriptureDisplay);
  if (passage.series) Object.freeze(passage.series);
  return Object.freeze(passage);
}

/**
 * Prepare one immutable, owned snapshot for repeated queries. Recreate after changing
 * passages or vectors; later mutations of inputs cannot change this snapshot. No global
 * ID cache is used. The pure search() above deliberately reevaluates mutable inputs.
 */
export function prepareSearchIndex(passages: readonly SearchPassage[], vectors?: VectorIndex): PreparedSearchIndex {
  // Construction-only interning saves repeated service/BSB fields without a Set per word.
  // These maps are released after preparation; only the prepared strings/references live on.
  const normalized = new Map<string, string>();
  const folded = new Map<string, string>();
  const parsed = new Map<string, ReturnType<typeof parseScriptureReference>>();
  const normalize = (value: string, verse: boolean) => {
    const cache = verse ? folded : normalized;
    let result = cache.get(value);
    if (result === undefined) {
      result = ` ${verse ? words(value).map(verseTerm).join(' ') : lexical(value)} `;
      cache.set(value, result);
    }
    return result;
  };
  const compatible = vectors?.schemaVersion === 1 && isCompatibleEmbeddingConfig(vectors.model);
  const rows = passages.map((source): PreparedPassage => {
    const passage = snapshotPassage(source);
    const references = passage.scripture.map((value) => {
      if (!parsed.has(value)) parsed.set(value, parseScriptureReference(value));
      return parsed.get(value);
    });
    const fields: [FieldName, string[]][] = [
      ['date', dateTerms(passage.date)], ['speaker', passage.speaker ? [passage.speaker] : []],
      ['scripture', references.flatMap((reference) => reference ? [reference.canonical] : [])],
      ['verseText', passage.verseText ? [passage.verseText] : []], ['topic', passage.topics], ['title', [passage.title]],
      ['service', [passage.serviceTitle]], ['question', passage.questions], ['summary', [passage.summary]],
      ['transcript', [passage.transcript]], ['type', [passage.type]],
    ];
    if (passage.series) fields.push(['series', [passage.series.name]]);
    const entry = compatible ? vectors!.vectors?.[passage.id] : undefined;
    // Copy only valid, source-current vectors. Ordinary numbers retain Float64 precision
    // and the query loop sums in exactly the same order as the pure API's reduce().
    const vector = entry && entry.document === buildEmbeddingDocument(passage) && isEmbeddingVector(entry.vector)
      ? entry.vector.slice() : undefined;
    return { passage, references, fields: fields.map(([name, values]) => [name, values.map((value) => normalize(value, name === 'verseText'))]), vector };
  });
  normalized.clear(); folded.clear(); parsed.clear();
  const postings = prepareLexicalPostings(rows);
  // Bind only owned rows, rather than retaining the factory's input/cache closure.
  return Object.freeze({ search: searchPrepared.bind(undefined, rows, postings) });
}

function searchPrepared(rows: readonly PreparedPassage[], postings: LexicalPostings, query: string, options: PreparedSearchOptions = {}): SearchResult[] {
  const dateQuery = parseFullDateQuery(query);
  const referenceQuery = parseScriptureReference(query);
  const queryWords = words(dateQuery ?? referenceQuery?.canonical ?? query);
  const phrase = queryWords.join(' ');
  const terms = [...new Set(queryWords.filter((word) => !STOP_WORDS.has(word)))];
  if (!phrase || !terms.length) return [];
  const needles = terms.map((term) => ` ${term} `);
  const verseNeedles = terms.map((term) => ` ${verseTerm(term)} `);
  const phraseNeedle = ` ${phrase} `;
  const versePhrase = ` ${queryWords.map(verseTerm).join(' ')} `;
  const queryVector = isEmbeddingVector(options.queryVector) ? options.queryVector : undefined;
  const threshold = Math.max(0, Math.min(1, Number.isFinite(options.semanticThreshold) ? options.semanticThreshold! : SEARCH_WEIGHTS.semanticThreshold));
  // Unknown words remain in the denominator. Full dates keep their existing scope.
  const coverage = dateQuery ? undefined : lexicalCoverage(postings, terms, rows.length);
  const results: SearchResult[] = [];
  for (let row = 0; row < rows.length; row++) {
    const { passage, references, fields, vector } = rows[row];
    if (dateQuery && passage.date !== dateQuery) continue;
    const referenceMatch = referenceQuery && references.some((reference) => reference && scriptureOverlaps(referenceQuery, reference));
    let score = 0;
    const reasons: string[] = [];
    // A structured overlap covers every term even if range endpoints omit the
    // query's literal chapter/verse. Other candidates must still pass exact scoring.
    if (dateQuery || referenceMatch || coverage![row] / terms.length >= SEARCH_WEIGHTS.minimumTermCoverage) {
      const covered = new Set<number>();
      for (const [name, values] of fields) {
        if (name === 'scripture' && referenceQuery) {
          if (referenceMatch) {
            terms.forEach((_, i) => covered.add(i));
            score += SEARCH_WEIGHTS.referenceBonus + SEARCH_WEIGHTS.scripture * (1 + SEARCH_WEIGHTS.phraseBonus);
            reasons.push('Scripture match (reference)');
          }
          continue;
        }
        const fieldNeedles = name === 'verseText' ? verseNeedles : needles;
        let found = 0;
        for (let i = 0; i < fieldNeedles.length; i++) {
          if (values.some((value) => value.includes(fieldNeedles[i]))) { found++; covered.add(i); }
        }
        if (!found) continue;
        const fullPhrase = values.some((value) => value.includes(name === 'verseText' ? versePhrase : phraseNeedle));
        score += SEARCH_WEIGHTS[name] * (found / terms.length + (fullPhrase ? SEARCH_WEIGHTS.phraseBonus : 0));
        reasons.push(name === 'verseText' ? 'Verse-text match (BSB)'
          : `${name[0].toUpperCase()}${name.slice(1)} match${fullPhrase && queryWords.length > 1 ? ' (exact phrase)' : ''}`);
      }
      if (covered.size / terms.length < SEARCH_WEIGHTS.minimumTermCoverage) { score = 0; reasons.length = 0; }
    }
    // Semantic scoring stays exhaustive, including rows rejected by lexical coverage.
    if (vector && queryVector) {
      const dot = vector.reduce((sum, value, i) => sum + value * queryVector[i], 0);
      const cosine = Math.max(-1, Math.min(1, dot));
      if (cosine > 0 && cosine >= threshold) {
        score += SEARCH_WEIGHTS.semantic * cosine;
        reasons.push('Semantic similarity');
      }
    }
    if (score > 0) results.push({ passage, score, reasons });
  }
  results.sort((a, b) => b.score - a.score || compare(b.passage.date, a.passage.date)
    || compare(a.passage.serviceId, b.passage.serviceId) || compare(a.passage.videoId, b.passage.videoId)
    || a.passage.start - b.passage.start || compare(a.passage.id, b.passage.id));
  return options.limit === undefined ? results : results.slice(0, Math.max(0, Math.floor(options.limit)));
}
