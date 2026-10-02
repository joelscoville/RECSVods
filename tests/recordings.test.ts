import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAPTER_KINDS, chapterEnd, locate, recordingLength, recordingTime, RecordingSchema, uploadSpans, type RecordingSource } from '../site/lib/recording-schema';
import { loadRecordings } from '../site/lib/recordings';
import { ClockSchema, formatTimecode, parseTimecode } from '../site/lib/timecode';
import { editorSchema, SCHEMAS } from '../scripts/recording-schema';
import { source, writeArchive } from './recording-fixtures';

const problems = (value: RecordingSource) => {
  const result = RecordingSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
};
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const tempRoot = () => { const root = mkdtempSync(path.join(tmpdir(), 'recs-recordings-')); roots.push(root); return root; };

describe('clocks', () => {
  it('round-trips precise clocks and rejects numeric YAML times', () => {
    expect(parseTimecode('42:54.62')).toBe(2574.62);
    expect(formatTimecode(3723)).toBe('1:02:03');
    expect(formatTimecode(2574.123456)).toBe('42:54.123456');
    expect(ClockSchema.safeParse(90).success).toBe(false);
    expect(ClockSchema.safeParse('1:5').success).toBe(false);
  });
});
describe('named chapters and subchapters', () => {
  it('accepts complete recordings and does not generate or rewrite titles', () => {
    const value = source(); value.chapters[0].chapterTitle = 'A title chosen by the reviewer';
    expect(RecordingSchema.parse(value).chapters[0].chapterTitle).toBe('A title chosen by the reviewer');
  });
  it.each(CHAPTER_KINDS)('lets any chapter or subchapter use the %s type without renaming it', kind => {
    const value = source(); value.chapters[0].chapterKind = kind;
    value.chapters[1].subchapters![0].chapterKind = kind;
    const result = RecordingSchema.parse(value);
    expect(result.chapters[0].chapterTitle).toBe('ACTS Prayer');
    expect(result.chapters[1].subchapters![0].chapterTitle).toBe('Holy Communion');
  });
  it('allows repeated types, gaps and a nonzero first start, but rejects overlapping ranges', () => {
    const value = source(); value.chapters[0].chapterStart = '0:05'; value.chapters[1].chapterKind = 'acts';
    expect(problems(value)).toEqual([]);
    value.chapters[1].chapterStart = '7:59';
    expect(problems(value).join()).toContain('overlapping');
  });
  it('requires explicit titles, IDs and ends, with unique IDs at both levels', () => {
    const value = source(); value.chapters[0].chapterTitle = '';
    expect(problems(value).join()).toContain('chapterTitle');
    value.chapters[0].chapterTitle = 'Opening'; value.chapters[1].subchapters![0].chapterId = 'acts';
    expect(problems(value).join()).toContain('used twice');
    const { chapterEnd: _, ...missingEnd } = source().chapters[0];
    expect(RecordingSchema.safeParse(source({ chapters: [missingEnd as RecordingSource['chapters'][number]] })).success).toBe(false);
  });
  it('keeps subchapters and their notes inside the parent, without restricting the parent type', () => {
    const value = source();
    value.chapters[0].subchapters = [{ chapterId: 'prayer', chapterTitle: 'Prayer for the church', chapterKind: 'acts', chapterStart: '1:00', chapterEnd: '2:00', points: [{ pointTime: '1:15', pointText: 'Prayers for the congregation.' }] }];
    expect(problems(value)).toEqual([]);
    value.chapters[0].subchapters[0].chapterEnd = '9:00';
    expect(problems(value).join()).toContain('inside its parent');
  });
  it('points have a time and text, no title/summary split or end, and no mandatory count or spacing', () => {
    const value = source(); value.chapters[2].points = [{ pointTime: '30:00', pointText: 'An introduction.' }, { pointTime: '30:01', pointText: 'A short clarification.' }];
    expect(problems(value)).toEqual([]);
    expect(RecordingSchema.safeParse(source({ chapters: [{ ...value.chapters[2], points: [{ ...value.chapters[2].points[0], pointEnd: '31:00' } as never] }] })).success).toBe(false);
    value.chapters[2].points[0].pointTime = '1:16:00';
    expect(problems(value).join()).toContain('inside this chapter');
  });
  it('returns errors rather than crashing on empty chapter lists', () => {
    expect(problems(source({ chapters: [] })).join()).toContain('chapters');
  });
  it.each(['2026-02-29', '2026-04-31', '2026-00-10', '2026-13-01'])('rejects impossible date %s', serviceDate => {
    expect(problems(source({ serviceDate })).join()).toContain('serviceDate');
  });
  it('accepts leap days, but rejects zero-length uploads', () => {
    expect(problems(source({ serviceDate: '2024-02-29' }))).toEqual([]);
    expect(problems(source({ uploads: [...source().uploads, { youtubeId: 'BBBBBBBBBBB', uploadDuration: '0:00' }] })).join()).toContain('uploadDuration');
  });
  it('allows incomplete drafts and requires the overall sermon information before publication', () => {
    const draft = source({ status: 'draft', sermonDescription: undefined, sermonScripture: undefined, sermonTopics: undefined });
    expect(problems(draft)).toEqual([]);
    expect(problems({ ...draft, status: 'published' }).join()).toContain('needs its description');
  });
});
describe('one clock across uploads', () => {
  const recording = RecordingSchema.parse(source({ uploads: [
    { youtubeId: 'AAAAAAAAAAA', uploadDuration: '40:00' },
    { youtubeId: 'BBBBBBBBBBB', uploadDuration: '50:10', uploadSkip: '0:10' },
  ] }));
  it('maps cuts correctly without changing chapter bounds', () => {
    expect(recordingLength(recording)).toBe(5400);
    expect(uploadSpans(recording).map(span => [span.start, span.end, span.offset])).toEqual([[0, 2400, 0], [2400, 5400, 10]]);
    expect(chapterEnd(recording, 2)).toBe(4500);
    expect(locate(recording, 2400)).toMatchObject({ index: 1, uploadTime: 10 });
    expect(locate(recording, 3000)).toMatchObject({ index: 1, uploadTime: 610 });
    expect(recordingTime(recording, 'BBBBBBBBBBB', 610)).toBe(3000);
    expect(() => recordingTime(recording, 'CCCCCCCCCCC', 1)).toThrow();
  });
  it('allows a skip only on a later upload, shorter than it', () => {
    expect(problems(source({ uploads: [{ youtubeId: 'AAAAAAAAAAA', uploadDuration: '1:30:00', uploadSkip: '0:05' }] })).join()).toContain('only for a later upload');
  });
});
describe('archive and generated schemas', () => {
  it('loads by file name and checks dates, topics, upload ownership and series', () => {
    const root = tempRoot();
    writeArchive(root, { '2026-09-06': source(), '2026-09-06-2': source({ uploads: [{ youtubeId: 'BBBBBBBBBBB', uploadDuration: '1:30:00' }] }) },
      { series: [{ seriesId: 'romans', seriesTitle: 'Romans', seriesRecordings: ['2026-09-06', '2026-09-06-2'] }] });
    expect(loadRecordings(root).recordings).toHaveLength(2);
    writeArchive(root, { '2026-09-13': source() });
    expect(() => loadRecordings(root)).toThrow('file name must be the service date');
  });
  it('rejects unknown topics, shared uploads and duplicate series membership', () => {
    const root = tempRoot();
    writeArchive(root, { '2026-09-06': source({ sermonTopics: ['gardening'] }), '2026-09-13': source({ serviceDate: '2026-09-13' }) },
      { series: [{ seriesId: 'a', seriesTitle: 'A', seriesRecordings: ['2026-09-06', '2026-09-20'] }, { seriesId: 'b', seriesTitle: 'B', seriesRecordings: ['2026-09-06'] }] });
    expect(() => loadRecordings(root)).toThrow('gardening');
    expect(() => loadRecordings(root)).toThrow('in both');
    expect(() => loadRecordings(root)).toThrow('2026-09-20');
  });
  it('names the invalid file and field', () => {
    const root = tempRoot(); writeArchive(root, { '2026-09-06': source() });
    const file = path.join(root, 'services/2026-09-06.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('recordingTitle:', 'title:'));
    expect(() => loadRecordings(root)).toThrow('services/2026-09-06.yaml');
  });
  it('keeps generated schemas current and recording-file links correct', () => {
    for (const [file, { schema, name }] of Object.entries(SCHEMAS)) expect(readFileSync(file, 'utf8')).toBe(editorSchema(schema, name));
    for (const { recordingId } of loadRecordings().recordings) expect(readFileSync(`services/${recordingId}.yaml`, 'utf8')).toContain('$schema=../schema/recording.schema.json');
  });
});
