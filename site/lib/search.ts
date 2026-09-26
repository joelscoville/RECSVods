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

export function buildEmbeddingDocument(passage: SearchPassage): string {
  return preprocessEmbedding([
    passage.title, passage.summary, ...passage.questions, ...passage.topics,
    ...passage.scripture.map((reference) => parseScriptureReference(reference)?.canonical ?? reference), passage.verseText ?? '', passage.transcript,
  ].join('\n'));
}

const STOP_WORDS = new Set('a an and are as at be by for from how i in is it of on or that the this to was what when where which who why with'.split(' '));
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
