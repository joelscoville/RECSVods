import { describe, expect, it } from 'vitest';
import { enrichPassages } from '../bible/enrich';
import { flattenArchive, publishedServices } from '../site/lib/archive';
import { EMBEDDING_CONFIG } from '../site/lib/embedding-config';
import { buildEmbeddingDocument, search, type VectorIndex } from '../site/lib/search';
import type { IdentifierRecord, SearchPassage, Service } from '../site/lib/types';
import {
  assertCoreInventory, assertMediaExclusion, assertPublicationProjection, assertSourceDate, CORE_INVENTORY,
  evaluateSearchCases, excludedMedia, loadEvaluationCases, parseEvaluationArgs, parseEvaluationCases,
  reportSearchCase, selectEvaluationCases, type AcceptanceCase,
} from '../scripts/evaluate-core';

// Synthetic fixtures only. These helpers neither read generated builds nor initialize inference.
const fixture: SearchPassage = {
  id: 'fixture-passage', serviceId: 'fixture-service', videoId: 'abcdefghijk', date: '2032-07-05',
  title: 'Practical care', serviceTitle: 'Fictional gathering', summary: 'A fictional discussion of practical care.',
  questions: ['How can we care?'], topics: ['Care'], scripture: ['Romans 12:1'], transcript: 'Practical care.',
  start: 10, end: 60, type: 'sermon', preview: true,
};
function service(id = fixture.serviceId, videoId = fixture.videoId): Service {
  return {
    id, date: fixture.date, title: fixture.serviceTitle, type: 'service', workflow_status: 'complete', editorial_status: 'needs_review',
    speakers: [], topics: [], review_notes: [],
    videos: [{ id: videoId, channel_id: 'UCLjwcZaIkiFEed1VgQYSsrw', duration: 100, sequence: 1, workflow_status: 'complete', media_disposition: 'playable' }],
    sections: [{ id: `${id}-section`, video_id: videoId, start: 0, end: 100, type: 'sermon', title: 'Fixture section', confidence: 0.5, review_notes: [] }],
    passages: [{ id: `${id}-passage`, section_id: `${id}-section`, video_id: videoId, start: 10, end: 60,
      title: fixture.title, summary: fixture.summary, questions: [], topics: [], scripture: fixture.scripture, transcript: fixture.transcript,
      type: 'sermon', confidence: 0.5, review_notes: [] }],
  };
}
const rankCase: AcceptanceCase = {
  id: 'synthetic-rank', milestone: 2, kind: 'rank', query: 'practical care',
  acceptableServiceIds: [fixture.serviceId], acceptablePassageIds: [fixture.id], maxRank: 1, note: 'Synthetic evaluator test.',
};
const dateCase: AcceptanceCase = { ...rankCase, kind: 'date', query: '5 July 2032', expectedDate: '2032-07-05', reason: 'Date match' };
const emptyCase: AcceptanceCase = { id: 'synthetic-empty', milestone: 3, kind: 'empty', query: 'zxqvpl-no-match', note: 'Synthetic empty test.' };
const unit = (axis = 0) => Array.from({ length: 384 }, (_, i) => i === axis ? 1 : 0);
function index(passages: SearchPassage[]): VectorIndex {
  return { schemaVersion: 1, model: EMBEDDING_CONFIG, passagesSha256: 'synthetic-only',
    vectors: Object.fromEntries(passages.map((passage) => [passage.id, { document: buildEmbeddingDocument(passage), vector: unit() }])) };
}
const context = { mode: 'exact' as const, passages: [fixture], excludedIds: new Set<string>() };

describe('evaluation case file and command contract', () => {
  it('loads human-readable cases and selects explicit milestone subsets', () => {
    const file = loadEvaluationCases();
    const core = selectEvaluationCases(file, 2);
    const all = selectEvaluationCases(file, 3);
    expect(core.length).toBeGreaterThanOrEqual(8);
    expect(core.every((item) => item.milestone === 2)).toBe(true);
    expect(all.length).toBe(file.cases.filter((item) => item.milestone <= 3).length);
    expect(selectEvaluationCases(file, 4)).toHaveLength(file.cases.length);
    expect(all.length).toBeGreaterThan(core.length);
    expect(all.find((item) => item.id === 'tripping-question')).toMatchObject({ acceptableServiceIds: ['2020-07-19'], maxRank: 3 });
    expect(file.sourceDates.find((item) => item.videoId === 'D-FyolbxJgk')?.expectedDate).toBe('2026-07-12');
    expect(file.sourceDates.find((item) => item.videoId === 'OrsN83j3qxE')?.expectedDate).toBe('2026-07-05');
  });
  it('fails missing files and deleted required cases rather than silently skipping them', () => {
    expect(() => loadEvaluationCases('evaluation/does-not-exist.yaml')).toThrow();
    const file = loadEvaluationCases();
    expect(() => selectEvaluationCases({ ...file, cases: [] }, 2)).toThrow('Missing required');
    expect(() => selectEvaluationCases({ ...file, cases: file.cases.filter((item) => item.id !== 'tripping-question') }, 3)).toThrow('tripping-question');
    expect(() => selectEvaluationCases({ ...file, sourceDates: file.sourceDates.filter((item) => item.videoId !== 'MZr169xBwrU') }, 3)).toThrow('Missing source-date case');
    expect(() => selectEvaluationCases({ ...file, cases: file.cases.filter((item) => item.milestone === 2) }, 2)).not.toThrow();
  });
  it('validates strict case shape, targets, thresholds, dates, duplicates and nonempty coverage', () => {
    const file = { schemaVersion: 1, sourceDates: [{ milestone: 2, videoId: fixture.videoId, expectedDate: fixture.date }], cases: [rankCase] };
    expect(parseEvaluationCases(JSON.stringify(file)).cases).toEqual([rankCase]);
    for (const cases of [[], [rankCase, rankCase], [{ ...rankCase, maxRank: 0 }], [{ ...rankCase, maxRank: 1.5 }],
      [{ ...rankCase, query: ' ' }], [{ ...rankCase, acceptablePassageIds: [] }], [{ ...rankCase, typo: true }],
      [{ ...rankCase, acceptablePassageIds: undefined, acceptableServiceIds: undefined }],
      [{ ...dateCase, expectedDate: '2032-07-12' }], [{ ...dateCase, expectedDate: '2032-02-30', query: '30 February 2032' }],
      [{ ...emptyCase, maxRank: 1 }]]) {
      expect(() => parseEvaluationCases(JSON.stringify({ ...file, cases }))).toThrow();
    }
    expect(() => parseEvaluationCases('schemaVersion: 1\nschemaVersion: 1')).toThrow();
    expect(() => parseEvaluationCases(JSON.stringify({ ...file, sourceDates: [] }))).toThrow();
  });
  it('defaults to the current milestone with human approvals supported; implementation checking is opt-in', () => {
    expect(parseEvaluationArgs([])).toEqual({ milestone: 4, implementation: false });
    expect(parseEvaluationArgs(['--', '--milestone', '2', '--implementation'])).toEqual({ milestone: 2, implementation: true });
    for (const args of [['--milestone'], ['--milestone', '5'], ['--unknown'], ['--implementation', '--implementation'], ['--milestone', '2', '--milestone', '3']]) {
      expect(() => parseEvaluationArgs(args)).toThrow();
    }
  });
});

describe('growing corpus and publication gates', () => {
  it('requires the five stable core IDs and exact eight uploads inside that scope, allowing growth', () => {
    const core = Object.entries(CORE_INVENTORY).map(([id, videoIds]) => {
      const item = service(id, videoIds[0]);
      item.videos = videoIds.map((videoId, i) => ({ ...item.videos[0], id: videoId, sequence: i + 1 }));
      return item;
    });
    expect(() => assertCoreInventory([...core, service('additional-service')])).not.toThrow();
    expect(() => assertCoreInventory(core.slice(1))).toThrow('core service');
    const extra = structuredClone(core);
    extra[0].videos.push({ ...extra[0].videos[0], id: 'other-video', sequence: 2 });
    expect(() => assertCoreInventory(extra)).toThrow();
    const reordered = structuredClone(core);
    reordered.find((item) => item.id === '2026-08-16')!.videos.reverse();
    expect(() => assertCoreInventory(reordered)).toThrow();
  });
  it('compares both enriched projections and allows future reviewed source in default mode', () => {
    const pending = service();
    const approved: Service = { ...service('approved-service', 'bcdefghijkl'), editorial_status: 'reviewed', reviewed_by: 'Fixture human', reviewed_at: '2032-07-06T00:00:00Z' };
    const services = [pending, approved];
    const preview = enrichPassages(flattenArchive(services, 'preview'));
    const production = enrichPassages(flattenArchive(services, 'production'));
    expect(production).toHaveLength(1);
    expect(production[0].verseText).toBeTruthy();
    expect(preview.some((passage) => !passage.preview)).toBe(true);
    expect(() => assertPublicationProjection(services, preview, production)).not.toThrow();
    expect(() => assertPublicationProjection(services, preview, [])).toThrow('Production');
    expect(() => assertPublicationProjection(services, preview, flattenArchive(services, 'production'))).toThrow('Production');
    expect(() => assertPublicationProjection(services, preview, production, true)).toThrow('Implementation interpretation');
    expect(() => assertPublicationProjection([pending], enrichPassages(flattenArchive([pending], 'preview')), [], true)).not.toThrow();
    expect(() => assertPublicationProjection(services, preview.slice(1), production)).toThrow('Preview');
  });
  it.each(['failed', 'rejected', 'unassessed'] as const)('derives %s exclusion from source, including navigation and sections', (disposition) => {
    const blocked = service('excluded-service', 'blockedvide');
    blocked.videos[0].media_disposition = disposition;
    const services = [service(), blocked];
    const excluded = excludedMedia(services);
    expect(excluded).toEqual([{ id: 'blockedvide', disposition }]);
    const ids = new Set(excluded.map((video) => video.id));
    const preview = flattenArchive(services, 'preview');
    expect(publishedServices(services, 'preview').map((item) => item.id)).toEqual([fixture.serviceId]);
    expect(() => assertMediaExclusion(services, [preview, []], ids)).not.toThrow();
    expect(() => assertMediaExclusion(services, [[{ ...fixture, videoId: 'blockedvide' }]], ids)).toThrow('indexed');
    // A projected segment pointing to a non-playable sibling may not escape either.
    const brokenProjection = service();
    brokenProjection.sections[0].video_id = 'blockedvide';
    brokenProjection.videos.push({ ...blocked.videos[0], media_disposition: 'playable', sequence: 2 });
    expect(() => assertMediaExclusion([brokenProjection], [[]], ids)).toThrow('navigation');
  });
  it('uses interpreted dispositions over old discovery receipts and retains standalone unresolved IDs', () => {
    const identifiers: IdentifierRecord[] = [
      { youtube_id: fixture.videoId, date: fixture.date, workflow_status: 'in_progress', media_disposition: 'unassessed' },
      { youtube_id: 'unassessed1', date: fixture.date, workflow_status: 'registered', media_disposition: 'unassessed' },
    ];
    expect(excludedMedia([service()], identifiers)).toEqual([{ id: 'unassessed1', disposition: 'unassessed' }]);
  });
  it('checks declared video dates across renames, missing sources and incorrectly dated artifacts', () => {
    const expected = { videoId: fixture.videoId, expectedDate: fixture.date };
    const renamed = service('renamed-service');
    expect(() => assertSourceDate([renamed], [{ ...fixture, serviceId: renamed.id }], expected)).not.toThrow();
    expect(() => assertSourceDate([], [], expected)).toThrow('Missing or duplicate');
    expect(() => assertSourceDate([{ ...renamed, date: '2032-07-12' }], [], expected)).toThrow();
    expect(() => assertSourceDate([renamed], [{ ...fixture, date: '2032-07-12' }], expected)).toThrow();
    // A short unassessed source is retained without inventing an indexed passage or a grouping rule.
    renamed.videos[0].media_disposition = 'unassessed';
    expect(() => assertSourceDate([renamed], [], expected)).not.toThrow();
  });
});

describe('rank and failure reports', () => {
  it('reports actual rank, top result, rounded score and reasons; applies the threshold', () => {
    const wrong = { passage: { ...fixture, id: 'wrong' }, score: 12, reasons: ['Title match'] };
    const correct = { passage: fixture, score: 8.12345678, reasons: ['Question match', 'Semantic similarity'] };
    const failed = reportSearchCase(rankCase, [wrong, correct], context);
    expect(failed).toMatchObject({ pass: false, rank: 2, maxRank: 1, resultCount: 2 });
    expect(failed.top[0]).toMatchObject({ rank: 1, id: 'wrong', score: 12, reasons: ['Title match'] });
    expect(failed.top[1]).toMatchObject({ rank: 2, id: fixture.id, score: 8.123457, reasons: correct.reasons });
    expect(reportSearchCase({ ...rankCase, maxRank: 2, reason: 'Question match' }, [wrong, correct], context).pass).toBe(true);
    expect(reportSearchCase({ ...rankCase, maxRank: 2, reason: 'Scripture match' }, [wrong, correct], context).rank).toBeNull();
  });
  it('fails absent targets, wrong service/physical identity, and excluded candidates even below top three', () => {
    expect(reportSearchCase(rankCase, [], { ...context, passages: [] })).toMatchObject({ pass: false, rank: null, top: [] });
    expect(reportSearchCase(rankCase, [], { ...context, passages: [] }).detail).toContain('no skip');
    const wrongService = { passage: { ...fixture, serviceId: 'wrong-service' }, score: 1, reasons: [] };
    expect(reportSearchCase(rankCase, [wrongService], context).pass).toBe(false);
    const results = search([fixture], 'practical care');
    results.push(...Array.from({ length: 4 }, (_, i) => ({ passage: { ...fixture, id: `extra-${i}`, videoId: 'excluded-id' }, score: 0.1, reasons: [] })));
    expect(reportSearchCase(rankCase, results, { ...context, excludedIds: new Set(['excluded-id']) }).detail).toContain('Excluded source media');
  });
  it('requires all and only the expected date, permits multiple services, and does not rely on service IDs', () => {
    const second = { ...fixture, id: 'second', serviceId: 'separate-programme' };
    const passages = [fixture, second];
    const results = search(passages, dateCase.query);
    expect(reportSearchCase(dateCase, results, { ...context, passages }).pass).toBe(true);
    expect(reportSearchCase(dateCase, results.slice(0, 1), { ...context, passages }).pass).toBe(false);
    const incidental = { passage: { ...fixture, id: 'incidental', date: '2032-07-12' }, score: 1, reasons: ['Transcript match'] };
    expect(reportSearchCase(dateCase, [...results, incidental], { ...context, passages }).detail).toContain('all and only');
    const renamed = { ...fixture, serviceId: 'renamed-by-curator' };
    const byVideo: AcceptanceCase = { id: 'video-date', milestone: 3, kind: 'date', query: dateCase.query, expectedDate: fixture.date,
      acceptableVideoIds: [fixture.videoId], maxRank: 1, note: 'Synthetic renamed source.' };
    expect(reportSearchCase(byVideo, search([renamed], byVideo.query), { ...context, passages: [renamed] }).pass).toBe(true);
  });
  it('reports both modes and never passes blocked or unembedded hybrid empty cases as lexical fallbacks', () => {
    const cases = [rankCase, emptyCase];
    const vectors = index([fixture]);
    // Unit vectors test the evaluation plumbing only; CLI uses embedTexts on the actual queries.
    const reports = evaluateSearchCases(cases, [fixture], vectors, [unit(), unit(1)], new Set());
    expect(reports.map((item) => [item.mode, item.pass])).toEqual([['exact', true], ['hybrid', true], ['exact', true], ['hybrid', true]]);
    expect(reports[1].top[0].reasons).toContain('Semantic similarity');
    for (const queryVectors of [[], [unit()], [unit(), [1, 2]]]) {
      const blocked = evaluateSearchCases(cases, [fixture], vectors, queryVectors, new Set());
      expect(blocked.filter((item) => item.mode === 'hybrid').every((item) => !item.pass && item.detail.includes('embeddings'))).toBe(true);
    }
    const blocked = evaluateSearchCases([emptyCase], [fixture], vectors, [unit(1)], new Set(), 'Stale index digest');
    expect(blocked[1]).toMatchObject({ pass: false, rank: null, top: [] });
    expect(blocked[1].detail).toContain('Stale index digest');
    expect(() => evaluateSearchCases([], [fixture], vectors, [], new Set())).toThrow('requires cases');
    const falseEmpty = evaluateSearchCases([emptyCase], [fixture], vectors, [unit()], new Set());
    expect(falseEmpty[1].pass).toBe(false);
    expect(falseEmpty[1].top[0].reasons).toEqual(['Semantic similarity']);
  });
});
