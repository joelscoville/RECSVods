import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { buildScriptureIndex } from '../bible/chapter-index';
import { enrichChapters, parseChapterMetadata, sameJson } from '../site/lib/chapter-index';
import { flattenChapters, IdentifierRecordSchema, loadArchive, parseWithPath, parseYaml, publishedServices } from '../site/lib/archive';
import { EMBEDDING_CONFIG, isEmbeddingVector, MODEL_FILES } from '../site/lib/embedding-config';
import { decodeChapterVectors, packChapterVectors, type ChapterVectorFile } from '../site/lib/chapter-vectors';
import { parseFullDateQuery, prepareSearchIndex, type SearchResult } from '../site/lib/search';
import { normalizeScriptureReference, scriptureUrl } from '../site/lib/scripture';
import type { IdentifierRecord, SearchChapter, Service } from '../site/lib/types';
import { embedTexts, sha256, verifyModelFile } from './embeddings';
import { chapterArtifacts, committedChapterRows } from './archive';

// Acceptance expectations only: all ranking goes through the product's prepared search path.
export const CORE_INVENTORY: Readonly<Record<string, readonly string[]>> = {
  '2026-09-06': ['ZTDYIJUDb0M'],
  '2026-08-16': ['mw4SAoJRZgo', 'XWAH9SWFcoo', 'IcIxBc--VvM'],
  '2026-06-28': ['wh4mCRKRJ-4', 'k27dmsPvmG8'],
  '2020-09-27': ['W2IZ6MUX-Yk'],
  '2025-11-02': ['94fynFHtreg'],
};
const failedId = 'wh4mCRKRJ-4';
export interface EvaluationOptions { milestone: 2 | 3 | 4; implementation: boolean; exactOnly?: boolean }
export function parseEvaluationArgs(args: readonly string[]): EvaluationOptions {
  const options: EvaluationOptions = { milestone: 4, implementation: false };
  const seen = new Set<string>();
  const tokens = args.filter((arg) => arg !== '--');
  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === '--implementation') options.implementation = true;
    else if (arg === '--exact-only') options.exactOnly = true;
    else if (arg === '--milestone' && ['2', '3', '4'].includes(tokens[i + 1])) options.milestone = Number(tokens[++i]) as 2 | 3 | 4;
    else throw new Error('Usage: tsx scripts/evaluate-core.ts [--milestone 2|3|4] [--implementation] [--exact-only]');
  }
  return options;
}

const Text = z.string().trim().min(1);
const Ids = z.array(Text).min(1).refine((ids) => new Set(ids).size === ids.length, 'duplicate acceptable ID');
const DateText = Text.refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && parseFullDateQuery(value) === value, 'expected a valid ISO date');
const Milestone = z.union([z.literal(2), z.literal(3), z.literal(4)]);
const baseCase = { id: Text, milestone: Milestone, query: Text, note: Text };
const targetFields = {
  acceptableServiceIds: Ids.optional(), acceptableChapterIds: Ids.optional(), acceptableVideoIds: Ids.optional(),
  speaker: Text.optional(), reason: Text.optional(), maxRank: z.number().int().positive(),
};
const CaseSchema = z.discriminatedUnion('kind', [
  z.object({ ...baseCase, kind: z.literal('rank'), ...targetFields, exactQuery: Text.optional() }).strict(),
  z.object({ ...baseCase, kind: z.literal('date'), ...targetFields, expectedDate: DateText }).strict(),
  z.object({ ...baseCase, kind: z.literal('empty') }).strict(),
  z.object({ ...baseCase, kind: z.literal('excluded-media') }).strict(),
]).superRefine((item, ctx) => {
  if ((item.kind === 'rank' || item.kind === 'date') && !item.acceptableServiceIds && !item.acceptableChapterIds && !item.acceptableVideoIds) {
    ctx.addIssue({ code: 'custom', message: 'rank/date cases require acceptable chapter, service or video IDs' });
  }
  if (item.kind === 'date' && parseFullDateQuery(item.query) !== item.expectedDate) {
    ctx.addIssue({ code: 'custom', message: 'date query must parse to expectedDate' });
  }
});
const CaseFileSchema = z.object({
  schemaVersion: z.literal(1),
  sourceDates: z.array(z.object({ milestone: Milestone, videoId: Text, expectedDate: DateText }).strict()).min(1),
  cases: z.array(CaseSchema).min(1),
}).strict().superRefine((file, ctx) => {
  for (const [label, ids] of [['case', file.cases.map((item) => item.id)], ['source video', file.sourceDates.map((item) => item.videoId)]] as const) {
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: `duplicate ${label} ID` });
  }
});
export type AcceptanceCase = z.infer<typeof CaseSchema>;
export type EvaluationCaseFile = z.infer<typeof CaseFileSchema>;

// These stable coverage IDs prevent accidentally deleting a required acceptance case.
// Queries, targets and thresholds live only in the human-readable YAML.
const REQUIRED_CASE_IDS = {
  2: ['romans-13', 'romans-alias', 'speaker-yong', 'government-question', 'abraham-isaac', 'living-sacrifice', 'august-date', 'authority-date'],
  3: ['tripping-question', 'tripping-luke', 'tripping-matthew', 'july-iso', 'july-day-first', 'july-month-first', 'july-abbreviated', 'july-corrected-date', 'excluded-candidates', 'no-match'],
  4: ['historical-0830', 'historical-0823', 'historical-0809', 'historical-0802', 'historical-0726', 'historical-0719', 'historical-0621', 'historical-0614', 'historical-0607', 'historical-0531', 'historical-0524', 'historical-0517'],
};
export function parseEvaluationCases(text: string, filename = 'evaluation/search-cases.yaml'): EvaluationCaseFile {
  return parseWithPath(CaseFileSchema, parseYaml(text, filename), filename);
}
export function loadEvaluationCases(filename = 'evaluation/search-cases.yaml'): EvaluationCaseFile {
  return parseEvaluationCases(readFileSync(filename, 'utf8'), filename);
}
export function selectEvaluationCases(file: EvaluationCaseFile, milestone: 2 | 3 | 4): AcceptanceCase[] {
  const cases = file.cases.filter((item) => item.milestone <= milestone);
  for (const stage of [2, 3, 4] as const) if (stage <= milestone) {
    for (const id of REQUIRED_CASE_IDS[stage]) assert.ok(cases.some((item) => item.id === id && item.milestone === stage), `Missing required M${stage} case: ${id}`);
  }
  const requiredVideos = [...Object.values(CORE_INVENTORY).flat(), ...(milestone >= 3
    ? ['GkmB_KeBlBw', 'OrsN83j3qxE', 'D-FyolbxJgk', 'MZr169xBwrU', 'Z-vRVB-WucA'] : [])];
  for (const id of requiredVideos) assert.ok(file.sourceDates.some((item) => item.videoId === id && item.milestone <= milestone), `Missing source-date case: ${id}`);
  assert.ok(cases.length, `No evaluation cases for milestone ${milestone}`);
  return cases;
}

export function assertCoreInventory(services: readonly Service[]): void {
  for (const [id, videoIds] of Object.entries(CORE_INVENTORY)) {
    const matches = services.filter((item) => item.id === id);
    assert.equal(matches.length, 1, `Missing or duplicate core service ${id}`);
    assert.deepEqual(matches[0].videos.map((video) => video.id), videoIds, id);
  }
  const coreServices = services.filter((item) => Object.hasOwn(CORE_INVENTORY, item.id));
  assert.equal(coreServices.flatMap((item) => item.videos).length, 8, '8 physical uploads within the core scope');
}

export function assertPublicationProjection(services: readonly Service[], preview: SearchChapter[], production: SearchChapter[], implementation = false): void {
  assert.deepEqual(preview, flattenChapters(services, 'preview'), 'Preview must equal eligible public metadata');
  assert.deepEqual(production, flattenChapters(services, 'production'), 'Production must equal reviewed/playable public metadata');
  if (implementation) {
    for (const service of services) assert.equal(service.editorial_status, 'needs_review', `Implementation interpretation: ${service.id}`);
    assert.equal(production.length, 0, 'Implementation run must publish no interpretation');
  }
}

export function assertSourceDate(services: readonly Service[], chapters: readonly SearchChapter[], expected: { videoId: string; expectedDate: string }): void {
  const owners = services.filter((item) => item.videos.some((video) => video.id === expected.videoId));
  assert.equal(owners.length, 1, `Missing or duplicate source video ${expected.videoId}`);
  assert.equal(owners[0].date, expected.expectedDate, expected.videoId);
  for (const chapter of chapters.filter((item) => item.videoId === expected.videoId)) assert.equal(chapter.date, expected.expectedDate, chapter.id);
}

function loadIdentifierRecords(root = 'corpus'): IdentifierRecord[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry): IdentifierRecord[] => {
    const filename = path.join(root, entry.name);
    if (path.resolve(filename) === path.resolve('corpus/manifest.yaml')) return [];
    if (entry.isDirectory()) return loadIdentifierRecords(filename);
    return /\.ya?ml$/.test(entry.name) ? [parseWithPath(IdentifierRecordSchema, parseYaml(readFileSync(filename, 'utf8'), filename), filename)] : [];
  });
}

/** An interpreted service supersedes its earlier identifier-only discovery receipt. */
export function excludedMedia(services: readonly Service[], identifiers: readonly IdentifierRecord[] = []) {
  const physical = new Map(identifiers.map((record) => [record.youtube_id, record.media_disposition]));
  for (const service of services) for (const video of service.videos) physical.set(video.id, video.media_disposition);
  return [...physical].filter(([, disposition]) => disposition !== 'playable').map(([id, disposition]) => ({ id, disposition }));
}

export function assertMediaExclusion(services: readonly Service[], indexes: readonly SearchChapter[][], excludedIds: ReadonlySet<string>): void {
  for (const chapters of indexes) for (const chapter of chapters) assert.ok(!excludedIds.has(chapter.videoId), `Excluded media indexed: ${chapter.videoId}`);
  for (const mode of ['preview', 'production'] as const) for (const service of publishedServices(services, mode)) {
    assert.ok(service.videos.length, `${mode} default playback missing: ${service.id}`);
    for (const video of service.videos) assert.ok(video.media_disposition === 'playable' && !excludedIds.has(video.id), `${mode} navigation includes ${video.id}`);
    for (const chapter of service.chapters) assert.ok(!excludedIds.has(chapter.video_id), `${mode} navigation includes ${chapter.video_id}`);
  }
}

function matchesTarget(item: AcceptanceCase, chapter: SearchChapter): boolean {
  if (item.kind !== 'rank' && item.kind !== 'date') return false;
  return (!item.acceptableServiceIds || item.acceptableServiceIds.includes(chapter.serviceId))
    && (!item.acceptableChapterIds || item.acceptableChapterIds.includes(chapter.id))
    && (!item.acceptableVideoIds || item.acceptableVideoIds.includes(chapter.videoId))
    && (!item.speaker || chapter.speaker === item.speaker)
    && (item.kind !== 'date' || chapter.date === item.expectedDate);
}

/** Scores an actual result list; never substitutes a fabricated result for a missing target. */
export function reportSearchCase(item: AcceptanceCase, results: readonly SearchResult[], context: {
  mode: 'exact' | 'hybrid'; chapters: readonly SearchChapter[]; excludedIds: ReadonlySet<string>; blocker?: string;
}) {
  const targeted = item.kind === 'rank' || item.kind === 'date';
  const rankIndex = results.findIndex(({ chapter, reasons }) => matchesTarget(item, chapter)
    && (!targeted || !item.reason || reasons.some((reason) => reason.startsWith(item.reason!))));
  const rank = rankIndex < 0 ? null : rankIndex + 1;
  const errors: string[] = [];
  if (context.blocker) errors.push(context.blocker);
  if (results.some(({ chapter }) => context.excludedIds.has(chapter.videoId))) errors.push('Excluded source media returned');
  if (targeted) {
    if (!context.chapters.some((chapter) => matchesTarget(item, chapter))) errors.push('Accepted target missing from eligible corpus (no skip)');
    if (rank === null || rank > item.maxRank) errors.push('Accepted target or required reason missing from rank threshold');
  }
  if (item.kind === 'date') {
    const expected = context.chapters.filter((chapter) => chapter.date === item.expectedDate).map((chapter) => chapter.id).sort();
    const actual = results.map(({ chapter }) => chapter.id).sort();
    if (results.some(({ chapter }) => chapter.date !== item.expectedDate) || JSON.stringify(actual) !== JSON.stringify(expected)) errors.push('Date results must include all and only eligible chapters on expectedDate');
  }
  if (item.kind === 'empty' && results.length) errors.push('Expected an honest empty result set');
  return {
    id: item.id, kind: item.kind, mode: context.mode,
    query: context.mode === 'exact' && item.kind === 'rank' ? item.exactQuery ?? item.query : item.query,
    pass: errors.length === 0, rank,
    maxRank: targeted ? item.maxRank : null,
    acceptedServiceIds: targeted ? item.acceptableServiceIds : undefined,
    acceptedChapterIds: targeted ? item.acceptableChapterIds : undefined,
    acceptedVideoIds: targeted ? item.acceptableVideoIds : undefined,
    resultCount: results.length,
    detail: errors.length ? errors.join('; ') : item.kind === 'empty' ? 'No indexed chapter met the search threshold; no theological conclusion implied' : 'All declared rank, date and source-exclusion expectations passed',
    top: results.slice(0, 3).map(({ chapter, score, reasons }, i) => ({ rank: i + 1, id: chapter.id, serviceId: chapter.serviceId,
      videoId: chapter.videoId, date: chapter.date, start: chapter.start, end: chapter.end, score: Number(score.toFixed(6)), reasons })),
  };
}

export function evaluateSearchCases(cases: readonly AcceptanceCase[], chapters: readonly SearchChapter[], vectors: ChapterVectorFile,
  queryVectors: readonly number[][], excludedIds: ReadonlySet<string>, blocker?: string, exactOnly = false) {
  assert.ok(cases.length, 'Evaluation requires cases');
  const hybridBlocker = blocker ?? (vectors.rowCount !== chapters.length || vectors.dimension !== 384
    || vectors.values.length !== chapters.length * 384 || vectors.values.some((value) => value === -128)
    ? 'Invalid chapter vector rows' : queryVectors.length !== cases.length || !queryVectors.every(isEmbeddingVector) ? 'Missing or invalid actual query embeddings' : undefined);
  const prepared = prepareSearchIndex(chapters, vectors);
  const modes: ('exact' | 'hybrid')[] = exactOnly ? ['exact'] : ['exact', 'hybrid'];
  return cases.flatMap((item, index) => modes.map((mode) => {
    const blocked = mode === 'hybrid' ? hybridBlocker : undefined;
    const query = mode === 'exact' && item.kind === 'rank' ? item.exactQuery ?? item.query : item.query;
    const results = blocked ? [] : prepared.search(query, mode === 'hybrid' ? { queryVector: queryVectors[index] } : {});
    return reportSearchCase(item, results, { mode, chapters, excludedIds, blocker: blocked });
  }));
}

export async function evaluate(options: EvaluationOptions = { milestone: 4, implementation: false }) {
  const caseFile = loadEvaluationCases();
  const cases = selectEvaluationCases(caseFile, options.milestone);
  const artifact = existsSync('dist/preview/generated/chapters.json') ? 'dist/preview/generated' : 'site/public/generated';
  const checks: { name: string; pass: boolean; detail: string }[] = [];
  function check(name: string, run: () => void, detail: string) {
    try { run(); checks.push({ name, pass: true, detail }); }
    catch (error) { checks.push({ name, pass: false, detail: error instanceof Error ? error.message : String(error) }); }
  }
  const services = loadArchive(); // Strict source schema also checks sequence, membership and bounds.
  const source = readFileSync(path.join(artifact, 'chapters.json'));
  const chapters = parseChapterMetadata(JSON.parse(source.toString('utf8'))).chapters;
  const vectorBytes = readFileSync(path.join(artifact, 'vectors.bin'));
  const production = parseChapterMetadata(JSON.parse(readFileSync('dist/production/generated/chapters.json', 'utf8'))).chapters;
  const projected = publishedServices(services, 'preview');
  const physical = services.flatMap((service) => service.videos);
  const exclusions = excludedMedia(services, loadIdentifierRecords());
  const excludedIds = new Set(exclusions.map((video) => video.id));
  const service = (id: string) => { const found = services.find((item) => item.id === id); assert.ok(found, `Missing service ${id}`); return found; };

  check('required core inventory', () => assertCoreInventory(services), '5 required core services; exactly 8 physical IDs within that scope, additional services allowed');
  check('evidence-based core physical dispositions', () => {
    for (const video of services.filter((item) => Object.hasOwn(CORE_INVENTORY, item.id)).flatMap((item) => item.videos)) {
      assert.equal(video.media_disposition, video.id === failedId ? 'failed' : 'playable', video.id);
      assert.ok(video.disposition_evidence?.trim(), `Missing evidence: ${video.id}`);
    }
    assert.ok(physical.find((video) => video.id === failedId)!.duration <= 7);
  }, 'failed seven-second upload retained with evidence; other 7 playable with evidence');
  check('preview canonical artifact', () => {
    assert.deepEqual(chapters, flattenChapters(services, 'preview'));
    assert.ok(chapters.length > 0);
  }, `${chapters.length} chapters equal the current public metadata projection`);
  check('publication eligibility and enrichment', () => {
    assertPublicationProjection(services, chapters, production, options.implementation);
  }, options.implementation ? 'Implementation gate: all interpreted services needs_review and zero production chapters'
    : 'Production equals reviewed/playable source, including future human approvals');
  check('dynamic media exclusion and playable defaults', () => {
    assert.ok(projected.length >= Object.keys(CORE_INVENTORY).length);
    assertMediaExclusion(services, [chapters, production], excludedIds);
    assert.equal(projected.find((item) => item.id === '2026-06-28')!.videos[0].id, 'k27dmsPvmG8');
  }, `${exclusions.length} current failed/rejected/unassessed uploads excluded from both indexes and navigation projections; June defaults to full stream`);
  for (const video of exclusions) check(`excluded ${video.disposition} media ${video.id}`, () => {
    assertMediaExclusion(services, [chapters, production], new Set([video.id]));
  }, 'Source disposition, not a hardcoded candidate ID, controls exclusion');
  for (const expected of caseFile.sourceDates.filter((item) => item.milestone <= options.milestone)) {
    check(`source date ${expected.videoId}`, () => {
      assertSourceDate(services, chapters, expected);
    }, `Expected ${expected.expectedDate}; resolves by physical ID rather than a mutable service-directory name`);
  }
  check('August multipart', () => {
    const august = service('2026-08-16');
    assert.deepEqual(august.videos.map((video) => video.sequence), [1, 2, 3]);
    for (const video of august.videos) assert.ok(chapters.some((chapter) => chapter.serviceId === august.id && chapter.videoId === video.id));
  }, 'one service, 3 ordered uploads, indexed chapters on each physical upload');
  check('trusted metadata and pre-trimmed sermon', () => {
    const authority = service('2020-09-27');
    assert.equal(authority.title, 'Authority');
    assert.ok(authority.speakers.some((speaker) => speaker.id === 'yong-teck-meng' && speaker.name === 'Rev. Yong Teck Meng'));
    const sacrifice = service('2025-11-02');
    assert.equal(sacrifice.title, 'The Death That Brings Life: Sacrifice');
    assert.equal(sacrifice.type, 'sermon');
    assert.ok(sacrifice.chapters.length && sacrifice.chapters.every((chapter) => chapter.type === 'sermon'));
    for (const [item, references] of [[authority, ['Luke 20:19-26', 'Romans 13:1-7']], [sacrifice, ['Genesis 22:1-19', 'Romans 12:1-2']]] as const) {
      for (const reference of references) assert.ok(item.chapters.some((chapter) => chapter.scripture.includes(reference)), `${item.id}: ${reference}`);
    }
  }, 'Authority speaker/references and Sacrifice title/references/sermon-only chapters preserved');
  check('normalized ESV reference links', () => {
    assert.equal(normalizeScriptureReference('Rom 13'), 'Romans 13');
    for (const chapter of chapters) for (const reference of chapter.scripture) {
      assert.equal(normalizeScriptureReference(reference), reference);
      const url = new URL(scriptureUrl(reference));
      assert.equal(url.origin, 'https://www.esv.org');
      assert.equal(decodeURIComponent(url.pathname), `/${reference}/`);
    }
  }, 'all indexed references normalize and generate reference-only esv.org links');
  check('chapter artifact config and committed row correspondence', () => {
    const expected = chapterArtifacts();
    assert.deepEqual(production, expected.metadata.chapters);
    assert.equal(decodeChapterVectors(vectorBytes).rowCount, chapters.length);
    assert.deepEqual(vectorBytes, Buffer.from(packChapterVectors(committedChapterRows(process.cwd(), services, chapters))));
    assert.ok(sameJson(JSON.parse(readFileSync(path.join(artifact, 'scripture.json'), 'utf8')), buildScriptureIndex(chapters)), 'Built BSB index differs from the pinned source');
  }, 'Strict public metadata, exact committed int8 row order, and deduplicated verified BSB; no transcript-derived build');
  check('prepared local model integrity', () => {
    for (const file of MODEL_FILES) {
      assert.ok(verifyModelFile(readFileSync(`site/public/models/${EMBEDDING_CONFIG.model}/${file.path}`), file), file.path);
      if (artifact.startsWith('dist/')) assert.ok(verifyModelFile(readFileSync(`dist/preview/models/${EMBEDDING_CONFIG.model}/${file.path}`), file), `built ${file.path}`);
    }
  }, 'prepared and built model bytes match pinned upstream hashes; no download or external inference');

  // Invalid artifacts cannot earn hybrid acceptance by silently falling back to exact search.
  let blocker = checks.every((item) => item.pass) ? undefined : 'Blocked by corpus/artifact checks';
  let queryVectors: number[][] = [];
  if (!blocker && !options.exactOnly) {
    try { queryVectors = await embedTexts(cases.map((item) => item.query)); }
    catch (error) { blocker = `Local query embedding failed: ${error instanceof Error ? error.message : String(error)}`; }
  }
  // M2 keeps the core ranking subset usable while M3 content is still being curated.
  // Artifact, publication and source-exclusion checks above always cover the entire archive.
  const rankingChapters = options.milestone === 2 ? chapters.filter((item) => Object.hasOwn(CORE_INVENTORY, item.serviceId)) : chapters;
  // Select metadata and binary rows together; binary rows have no independent ID table.
  const rankingVectors = decodeChapterVectors(packChapterVectors(committedChapterRows(process.cwd(), services, rankingChapters)));
  const enriched = enrichChapters(rankingChapters, buildScriptureIndex(rankingChapters));
  const queries = evaluateSearchCases(cases, enriched, rankingVectors, queryVectors, excludedIds, blocker, options.exactOnly);
  const semanticUsed = queries.some((query) => query.mode === 'hybrid' && query.top.some((result) => result.reasons.includes('Similar in meaning')));
  if (!options.exactOnly) check('real hybrid contribution', () => assert.ok(!blocker && semanticUsed), 'actual query embeddings contribute semantic similarity to ranked results');
  const failures = checks.filter((item) => !item.pass).length + queries.filter((item) => !item.pass).length;
  return { artifact, ...options, semanticStatus: options.exactOnly ? 'not run: exact-only validation without inference' : blocker ? `blocked: ${blocker}` : 'actual local query inference', rankingScope: options.milestone === 2 ? 'core subset' : 'all eligible preview chapters', chaptersSha256: sha256(source), model: EMBEDDING_CONFIG,
    counts: { services: services.length, physical: physical.length, coreServices: Object.keys(CORE_INVENTORY).length, corePhysical: 8,
      preview: chapters.length, production: production.length, rankedChapters: rankingChapters.length },
    exclusions, checks, queries, summary: { passed: checks.length + queries.length - failures, failed: failures, total: checks.length + queries.length } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  Promise.resolve().then(() => evaluate(parseEvaluationArgs(process.argv.slice(2)))).then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.summary.failed) process.exitCode = 1;
  }).catch((error: unknown) => {
    console.error(JSON.stringify({ pass: false, blocker: 'Search acceptance could not run', reason: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
