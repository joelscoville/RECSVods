/** Search acceptance: runs the cases in evaluation/search-cases.yaml through the product's own search, on the
 * built preview index, and reports where each expected recording ranks. Exact search always; meaning-based
 * search too unless --exact-only (it embeds the queries with the pinned local model). */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { buildScriptureIndex } from '../bible/chapter-index';
import { enrichUnits, parseChapterMetadata } from '../site/lib/chapter-index';
import { decodeChapterVectors, type ChapterVectorFile } from '../site/lib/chapter-vectors';
import { EMBEDDING_CONFIG, isEmbeddingVector } from '../site/lib/embedding-config';
import { parseFullDateQuery, prepareSearchIndex, type SearchResult } from '../site/lib/search';
import type { SearchUnit } from '../site/lib/display';
import { loadRecordings, parseFile } from '../site/lib/recordings';
import { embedTexts, sha256 } from './embeddings';

export interface EvaluationOptions { milestone: 2 | 3 | 4; exactOnly?: boolean }
export function parseEvaluationArgs(args: readonly string[]): EvaluationOptions {
  const options: EvaluationOptions = { milestone: 4 };
  const tokens = args.filter((arg) => arg !== '--');
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--exact-only') options.exactOnly = true;
    else if (tokens[i] === '--milestone' && ['2', '3', '4'].includes(tokens[i + 1])) options.milestone = Number(tokens[++i]) as 2 | 3 | 4;
    else throw new Error('Usage: tsx scripts/evaluate-core.ts [--milestone 2|3|4] [--exact-only]');
  }
  return options;
}

const Text = z.string().trim().min(1);
const Ids = z.array(Text).min(1).refine((ids) => new Set(ids).size === ids.length, 'duplicate acceptable ID');
const DateText = Text.refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && parseFullDateQuery(value) === value, 'expected a valid ISO date');
const Milestone = z.union([z.literal(2), z.literal(3), z.literal(4)]);
const baseCase = { id: Text, milestone: Milestone, query: Text, note: Text };
const targetFields = { acceptableServiceIds: Ids, reason: Text.optional(), maxRank: z.number().int().positive() };
const CaseSchema = z.discriminatedUnion('kind', [
  z.object({ ...baseCase, kind: z.literal('rank'), ...targetFields, exactQuery: Text.optional() }).strict(),
  z.object({ ...baseCase, kind: z.literal('date'), ...targetFields, expectedDate: DateText }).strict(),
  z.object({ ...baseCase, kind: z.literal('empty') }).strict(),
]).superRefine((item, ctx) => {
  if (item.kind === 'date' && parseFullDateQuery(item.query) !== item.expectedDate) ctx.addIssue({ code: 'custom', message: 'date query must parse to expectedDate' });
});
const CaseFileSchema = z.object({
  schemaVersion: z.literal(1),
  sourceDates: z.array(z.object({ milestone: Milestone, videoId: Text, expectedDate: DateText }).strict()).min(1),
  cases: z.array(CaseSchema).min(1),
}).strict().superRefine((file, ctx) => {
  if (new Set(file.cases.map((item) => item.id)).size !== file.cases.length) ctx.addIssue({ code: 'custom', message: 'duplicate case ID' });
});
export type AcceptanceCase = z.infer<typeof CaseSchema>;
export type EvaluationCaseFile = z.infer<typeof CaseFileSchema>;
export function parseEvaluationCases(text: string, filename = 'evaluation/search-cases.yaml'): EvaluationCaseFile {
  return parseFile(CaseFileSchema, text, filename);
}
export function loadEvaluationCases(filename = 'evaluation/search-cases.yaml'): EvaluationCaseFile {
  return parseEvaluationCases(readFileSync(filename, 'utf8'), filename);
}

/** A result counts when it belongs to an accepted recording (its own row or any of its points and parts). */
function matchesTarget(item: AcceptanceCase, unit: SearchUnit): boolean {
  if (item.kind === 'empty') return false;
  return item.acceptableServiceIds.includes(unit.recordingId) && (item.kind !== 'date' || unit.date === item.expectedDate);
}
/** Ranks are of recordings, as the search page shows them: one line per recording. */
function recordingRanks(results: readonly SearchResult[]) {
  const seen = new Set<string>();
  return results.filter(({ unit }) => !seen.has(unit.recordingId) && seen.add(unit.recordingId));
}

export function reportSearchCase(item: AcceptanceCase, results: readonly SearchResult[], context: { mode: 'exact' | 'hybrid'; units: readonly SearchUnit[]; blocker?: string }) {
  const ranked = recordingRanks(results);
  const targeted = item.kind !== 'empty';
  const rankIndex = ranked.findIndex(({ unit }) => matchesTarget(item, unit)
    && (!targeted || !item.reason || results.some((result) => result.unit.recordingId === unit.recordingId && result.reasons.some((reason) => reason.startsWith(item.reason!)))));
  const rank = rankIndex < 0 ? null : rankIndex + 1;
  const errors: string[] = [];
  if (context.blocker) errors.push(context.blocker);
  if (targeted) {
    if (!context.units.some((unit) => matchesTarget(item, unit))) errors.push('Accepted recording missing from the index');
    if (rank === null || rank > item.maxRank) errors.push(`Accepted recording ranked ${rank ?? 'nowhere'}, needs ≤ ${item.maxRank}`);
  }
  if (item.kind === 'date' && results.some(({ unit }) => unit.date !== item.expectedDate)) errors.push('Date results must all be on expectedDate');
  if (item.kind === 'empty' && results.length) errors.push('Expected no results');
  return {
    id: item.id, kind: item.kind, mode: context.mode,
    query: context.mode === 'exact' && item.kind === 'rank' ? item.exactQuery ?? item.query : item.query,
    pass: errors.length === 0, rank, maxRank: targeted ? item.maxRank : null, detail: errors.join('; ') || 'pass',
    top: ranked.slice(0, 3).map(({ unit, score, reasons }, i) => ({ rank: i + 1, recording: unit.recordingId, unit: unit.title, score: Number(score.toFixed(4)), reasons })),
  };
}

export function evaluateSearchCases(cases: readonly AcceptanceCase[], units: readonly SearchUnit[], vectors: ChapterVectorFile | undefined, queryVectors: readonly number[][], blocker?: string, exactOnly = false) {
  assert.ok(cases.length, 'Evaluation requires cases');
  const hybridBlocker = blocker ?? (!vectors || vectors.rowCount !== units.length ? 'Search vectors do not match the units'
    : queryVectors.length !== cases.length || !queryVectors.every(isEmbeddingVector) ? 'Missing or invalid query embeddings' : undefined);
  const prepared = prepareSearchIndex(units, vectors);
  const modes: ('exact' | 'hybrid')[] = exactOnly ? ['exact'] : ['exact', 'hybrid'];
  return cases.flatMap((item, index) => modes.map((mode) => {
    const blocked = mode === 'hybrid' ? hybridBlocker : undefined;
    const query = mode === 'exact' && item.kind === 'rank' ? item.exactQuery ?? item.query : item.query;
    const results = blocked ? [] : prepared.search(query, mode === 'hybrid' ? { queryVector: queryVectors[index] } : {});
    return reportSearchCase(item, results, { mode, units, blocker: blocked });
  }));
}

export async function evaluate(options: EvaluationOptions = { milestone: 4 }) {
  const file = loadEvaluationCases();
  const cases = file.cases.filter((item) => item.milestone <= options.milestone);
  const artifact = existsSync('dist/preview/generated/chapters.json') ? 'dist/preview/generated' : 'site/public/generated';
  const source = readFileSync(path.join(artifact, 'chapters.json'));
  const metadata = parseChapterMetadata(JSON.parse(source.toString('utf8')));
  const vectors = decodeChapterVectors(readFileSync(path.join(artifact, metadata.vectors.file)));
  const { recordings } = loadRecordings();
  // Each upload must belong to the recording of the expected date.
  const sourceDates = file.sourceDates.filter((item) => item.milestone <= options.milestone).map((expected) => {
    const owner = recordings.find((recording) => recording.uploads.some((upload) => upload.youtubeId === expected.videoId));
    return { videoId: expected.videoId, pass: !owner || owner.serviceDate === expected.expectedDate, detail: owner ? `${owner.recordingId}` : 'not in any recording (left out)' };
  });
  const units = enrichUnits(metadata.units, buildScriptureIndex(metadata.units));
  let blocker: string | undefined, queryVectors: number[][] = [];
  if (!options.exactOnly) {
    try { queryVectors = await embedTexts(cases.map((item) => item.query)); }
    catch (error) { blocker = `Local query embedding failed: ${error instanceof Error ? error.message : String(error)}`; }
  }
  const queries = evaluateSearchCases(cases, units, vectors, queryVectors, blocker, options.exactOnly);
  const failures = sourceDates.filter((item) => !item.pass).length + queries.filter((item) => !item.pass).length;
  return { artifact, ...options, model: EMBEDDING_CONFIG.model, indexSha256: sha256(source), units: units.length,
    sourceDates, queries, summary: { passed: sourceDates.length + queries.length - failures, failed: failures, total: sourceDates.length + queries.length } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  Promise.resolve().then(() => evaluate(parseEvaluationArgs(process.argv.slice(2)))).then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.summary.failed) process.exitCode = 1;
  }).catch((error: unknown) => {
    console.error(JSON.stringify({ pass: false, reason: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
