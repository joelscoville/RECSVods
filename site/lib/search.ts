import type { SearchPassage } from './types';
import { EMBEDDING_CONFIG, isCompatibleEmbeddingConfig, isEmbeddingVector, preprocessEmbedding } from './embedding-config';

export const SEARCH_WEIGHTS = Object.freeze({
  date: 16, speaker: 14, scripture: 14, topic: 7, title: 6,
  service: 4, question: 4, summary: 3, transcript: 2, type: 2,
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
    ...passage.scripture, passage.transcript,
  ].join('\n'));
}

const STOP_WORDS = new Set('a an and are as at be by for from how i in is it of on or that the this to was what when where which who why with'.split(' '));
function words(text: string): string[] {
  return preprocessEmbedding(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
function lexical(text: string): string { return words(text).join(' '); }
function containsPhrase(field: string, query: string): boolean { return ` ${field} `.includes(` ${query} `); }
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function dateTerms(date: string): string[] {
  const [year, month, day] = date.split('-');
  const name = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][Number(month) - 1];
  return [date, `${Number(day)} ${name} ${year}`, `${name} ${Number(day)} ${year}`, `${Number(day)} ${name?.slice(0, 3)} ${year}`];
}

/** Exact field scores plus a bounded cosine contribution. No model is needed for lexical search. */
export function search(passages: readonly SearchPassage[], query: string, options: SearchOptions = {}): SearchResult[] {
  const phrase = lexical(query);
  const terms = [...new Set(words(query).filter((word) => !STOP_WORDS.has(word)))];
  if (!phrase || !terms.length) return [];
  const semanticAvailable = isEmbeddingVector(options.queryVector) && options.vectors?.schemaVersion === 1 && isCompatibleEmbeddingConfig(options.vectors.model);
  const threshold = Math.max(0, Math.min(1, Number.isFinite(options.semanticThreshold) ? options.semanticThreshold! : SEARCH_WEIGHTS.semanticThreshold));
  const results: SearchResult[] = [];
  for (const passage of passages) {
    const fields: [keyof Pick<typeof SEARCH_WEIGHTS, 'date' | 'speaker' | 'scripture' | 'topic' | 'title' | 'service' | 'question' | 'summary' | 'transcript' | 'type'>, string[]][] = [
      ['date', dateTerms(passage.date)], ['speaker', passage.speaker ? [passage.speaker] : []],
      ['scripture', passage.scripture], ['topic', passage.topics], ['title', [passage.title]],
      ['service', [passage.serviceTitle]], ['question', passage.questions], ['summary', [passage.summary]],
      ['transcript', [passage.transcript]], ['type', [passage.type]],
    ];
    let score = 0;
    const reasons: string[] = [];
    const covered = new Set<string>();
    for (const [name, values] of fields) {
      const normalized = values.map(lexical);
      const found = terms.filter((term) => normalized.some((value) => containsPhrase(value, term)));
      if (!found.length) continue;
      found.forEach((term) => covered.add(term));
      const fullPhrase = normalized.some((value) => containsPhrase(value, phrase));
      score += SEARCH_WEIGHTS[name] * (found.length / terms.length + (fullPhrase ? SEARCH_WEIGHTS.phraseBonus : 0));
      reasons.push(`${name[0].toUpperCase()}${name.slice(1)} match${fullPhrase && words(query).length > 1 ? ' (exact phrase)' : ''}`);
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
