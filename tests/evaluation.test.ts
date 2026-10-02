import { describe, expect, it } from 'vitest';
import { decodeChapterVectors, packChapterVectors } from '../site/lib/chapter-vectors';
import { search } from '../site/lib/search';
import type { SearchUnit } from '../site/lib/display';
import { evaluateSearchCases, loadEvaluationCases, parseEvaluationArgs, parseEvaluationCases, reportSearchCase, type AcceptanceCase } from '../scripts/evaluate-core';

// Synthetic fixtures only. These helpers neither read generated builds nor initialize inference.
const fixture: SearchUnit = {
  id: 'fixture-service/sermon-point-1', recordingId: 'fixture-service', recordingTitle: 'Fictional gathering', date: '2032-07-05',
  kind: 'point', title: 'Practical care', text: 'A fictional discussion of practical care.', topics: ['Care'], scripture: ['Romans 12:1'],
  start: 10, end: 60, preview: true,
};
const rankCase: AcceptanceCase = {
  id: 'synthetic-rank', milestone: 2, kind: 'rank', query: 'practical care', acceptableServiceIds: [fixture.recordingId], maxRank: 1, note: 'Synthetic evaluator test.',
};
const dateCase: AcceptanceCase = { ...rankCase, kind: 'date', query: '5 July 2032', expectedDate: '2032-07-05', reason: 'Date match' };
const emptyCase: AcceptanceCase = { id: 'synthetic-empty', milestone: 3, kind: 'empty', query: 'zxqvpl-no-match', note: 'Synthetic empty test.' };
const axis = (index = 0) => Array.from({ length: 384 }, (_, i) => i === index ? 1 : 0);
const vectors = (units: SearchUnit[]) => decodeChapterVectors(packChapterVectors(units.map(() => Int8Array.from(axis(), (n) => n * 127))));
const context = { mode: 'exact' as const, units: [fixture] };

describe('evaluation case file and command', () => {
  it('loads the real cases, which name recordings that exist', () => {
    const file = loadEvaluationCases();
    expect(file.cases.length).toBeGreaterThanOrEqual(30);
    expect(file.cases.find((item) => item.id === 'tripping-question')).toMatchObject({ acceptableServiceIds: ['2020-07-19'], maxRank: 3 });
    expect(file.sourceDates.find((item) => item.videoId === 'D-FyolbxJgk')?.expectedDate).toBe('2026-07-12');
  });
  it('validates strict case shape, targets, thresholds, dates and duplicates', () => {
    const file = { schemaVersion: 1, sourceDates: [{ milestone: 2, videoId: 'abcdefghijk', expectedDate: fixture.date }], cases: [rankCase] };
    expect(parseEvaluationCases(JSON.stringify(file)).cases).toEqual([rankCase]);
    for (const cases of [[], [rankCase, rankCase], [{ ...rankCase, maxRank: 0 }], [{ ...rankCase, maxRank: 1.5 }], [{ ...rankCase, query: ' ' }],
      [{ ...rankCase, acceptableServiceIds: [] }], [{ ...rankCase, typo: true }], [{ ...dateCase, expectedDate: '2032-07-12' }],
      [{ ...dateCase, expectedDate: '2032-02-30', query: '30 February 2032' }], [{ ...emptyCase, maxRank: 1 }]]) {
      expect(() => parseEvaluationCases(JSON.stringify({ ...file, cases }))).toThrow();
    }
    expect(() => parseEvaluationCases(JSON.stringify({ ...file, sourceDates: [] }))).toThrow();
  });
  it('reads its options strictly', () => {
    expect(parseEvaluationArgs([])).toEqual({ milestone: 4 });
    expect(parseEvaluationArgs(['--exact-only'])).toEqual({ milestone: 4, exactOnly: true });
    expect(parseEvaluationArgs(['--', '--milestone', '2'])).toEqual({ milestone: 2 });
    for (const args of [['--milestone'], ['--milestone', '5'], ['--unknown']]) expect(() => parseEvaluationArgs(args)).toThrow();
  });
});

describe('rank and failure reports', () => {
  it('ranks recordings, not units, and applies the threshold and required reason', () => {
    const wrong = { unit: { ...fixture, recordingId: 'wrong', id: 'wrong' }, score: 12, reasons: ['Title match'] };
    const sibling = { unit: { ...fixture, recordingId: 'wrong', id: 'wrong/2' }, score: 10, reasons: ['Title match'] };
    const correct = { unit: fixture, score: 8.12345678, reasons: ['Summary match', 'Similar in meaning'] };
    const failed = reportSearchCase(rankCase, [wrong, sibling, correct], context);
    expect(failed).toMatchObject({ pass: false, rank: 2, maxRank: 1 });
    expect(failed.top.map((item) => [item.rank, item.recording, item.score])).toEqual([[1, 'wrong', 12], [2, 'fixture-service', 8.1235]]);
    expect(reportSearchCase({ ...rankCase, maxRank: 2, reason: 'Summary' }, [wrong, correct], context).pass).toBe(true);
    expect(reportSearchCase({ ...rankCase, maxRank: 2, reason: 'Scripture:' }, [wrong, correct], context).rank).toBeNull();
  });
  it('fails absent targets and wrong recordings', () => {
    expect(reportSearchCase(rankCase, [], { ...context, units: [] })).toMatchObject({ pass: false, rank: null, top: [] });
    expect(reportSearchCase(rankCase, [], { ...context, units: [] }).detail).toContain('missing from the index');
    expect(reportSearchCase(rankCase, [{ unit: { ...fixture, recordingId: 'wrong-service' }, score: 1, reasons: [] }], context).pass).toBe(false);
  });
  it('requires all and only the expected date', () => {
    const second = { ...fixture, id: 'second', recordingId: 'separate-programme' };
    const units = [fixture, second], results = search(units, dateCase.query);
    expect(reportSearchCase(dateCase, results, { ...context, units }).pass).toBe(true);
    const incidental = { unit: { ...fixture, id: 'incidental', date: '2032-07-12' }, score: 1, reasons: ['Summary match'] };
    expect(reportSearchCase(dateCase, [...results, incidental], { ...context, units }).detail).toContain('all be on expectedDate');
  });
  it('reports both modes and never passes blocked or unembedded hybrid cases', () => {
    const cases = [rankCase, emptyCase], index = vectors([fixture]);
    const reports = evaluateSearchCases(cases, [fixture], index, [axis(), axis(1)]);
    expect(reports.map((item) => [item.mode, item.pass])).toEqual([['exact', true], ['hybrid', true], ['exact', true], ['hybrid', true]]);
    expect(reports[1].top[0].reasons).toContain('Similar in meaning');
    for (const queryVectors of [[], [axis()], [axis(), [1, 2]]]) {
      expect(evaluateSearchCases(cases, [fixture], index, queryVectors).filter((item) => item.mode === 'hybrid').every((item) => !item.pass && item.detail.includes('embeddings'))).toBe(true);
    }
    const blocked = evaluateSearchCases([emptyCase], [fixture], index, [axis(1)], 'Model failed');
    expect(blocked[1]).toMatchObject({ pass: false, rank: null, top: [] });
    expect(() => evaluateSearchCases([], [fixture], index, [])).toThrow('requires cases');
    // A semantic match is a result: an empty case fails.
    expect(evaluateSearchCases([emptyCase], [fixture], index, [axis()])[1].pass).toBe(false);
  });
  it('uses the keyword companion for exact search and the question for meaning', () => {
    const item = { ...rankCase, query: 'A paraphrase absent from the fixture metadata', exactQuery: 'practical care' };
    expect(evaluateSearchCases([item], [fixture], vectors([fixture]), [axis()]).map(({ query, pass }) => ({ query, pass }))).toEqual([
      { query: item.exactQuery, pass: true }, { query: item.query, pass: true },
    ]);
    expect(evaluateSearchCases([rankCase], [fixture], vectors([fixture]), [], undefined, true)).toMatchObject([{ mode: 'exact', pass: true }]);
  });
});
