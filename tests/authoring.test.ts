import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { authorCli, proposeChapter } from '../scripts/author';
import { loadArchive, parseWithPath, ServiceSchema, ServiceSourceSchema, SOURCE_CHANNEL_ID } from '../site/lib/archive';
import { authoringValue, stringifyService } from '../site/lib/service-document';
import { ClockSchema, formatTimecode, parseTimecode } from '../site/lib/timecode';

const fixture = () => ServiceSchema.parse({ id: 'fixture', title: 'A Recording', date: '2026-09-20', type: 'service',
  workflow_status: 'complete', editorial_status: 'needs_review', sermon_description: 'A natural paragraph about the sermon.',
  videos: [{ id: 'AAAAAAAAAAA', channel_id: SOURCE_CHANNEL_ID, sequence: 1, duration: 6090.161, workflow_status: 'complete', media_disposition: 'playable' }],
  chapters: [{ id: 'existing-stable-id', title: 'The Sermon', type: 'sermon', summary: 'A retrieval synopsis.', keywords: [], topics: [], scripture: [], video_id: 'AAAAAAAAAAA', start: 2574.62, end: 4000 }] });
const values = { video: 'AAAAAAAAAAA', title: 'A New Chapter', type: 'sermon', start: '44:00.125', end: '45:00', summary: 'A concise retrieval synopsis.', parent: 'existing-stable-id' };
const roots: string[] = [];
function repo(reviewed = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'recs-authoring-')); roots.push(root);
  const service = fixture();
  if (reviewed) { service.editorial_status = 'reviewed'; service.reviewed_by = 'Example Reviewer'; service.reviewed_at = '2026-09-27T00:00:00Z'; }
  const file = path.join(root, 'services/2026/fixture/service.yaml'); mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, stringifyService(service).replace('title: The Sermon', '# Check the first spoken word here.\n    title: The Sermon'));
  return { root, file };
}
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.restoreAllMocks(); process.exitCode = undefined; });

describe('human clocks preserve numeric playback contracts', () => {
  it.each([0, 0.000000001, 0.0000001, 12.5, 2574.62, 3711.109999, 6090.161, 86400.125])('round-trips %s seconds exactly', seconds => {
    expect(parseTimecode(formatTimecode(seconds))).toBe(seconds);
  });
  it('accepts minutes or hours and emits an unambiguous readable clock', () => {
    expect(parseTimecode('62:03.125')).toBe(3723.125);
    expect(parseTimecode('1:02:03.125')).toBe(3723.125);
    expect(formatTimecode(2574.62)).toBe('42:54.62');
    expect(formatTimecode(3723.125)).toBe('1:02:03.125');
  });
  it.each(['42:60', '1:60:00', '1:2:03', '12.5', '-1:00', ' 1:00', '1:00 ', '0:00.1234567891', '99999999999999999:00', 2574.62])('rejects invalid source clock %s', value => {
    expect(ClockSchema.safeParse(value).success).toBe(false);
  });
  it('refuses to silently round unsupported precision', () => {
    expect(() => formatTimecode(0.0000000001)).toThrow();
    expect(() => formatTimecode(0.1 + 0.2)).toThrow();
  });
});

describe('strict, minimal human source', () => {
  it('serializes quoted clocks, one title and an editor schema without changing the runtime model', () => {
    const service = fixture(), text = stringifyService(service);
    expect(text).toContain('$schema=../../../schema/service.schema.json');
    expect(text).toContain('start: "42:54.62"'); expect(text).toContain('duration: "1:41:30.161"');
    expect(ServiceSourceSchema.parse(parse(text))).toEqual(service);
  });
  it('rejects superseded editorial/processing fields and undefined type values', () => {
    const source = authoringValue(fixture());
    for (const extra of [{ sermon_title: 'Another Title' }, { review_notes: 'Question' }]) expect(ServiceSourceSchema.safeParse({ ...source, ...extra }).success).toBe(false);
    for (const extra of [{ confidence: 0.9 }, { source_chapters: ['old-id'] }, { review_notes: 'Question' }, { type: 'freeform-type' }, { start: 2574.62 }]) {
      expect(ServiceSourceSchema.safeParse({ ...source, chapters: [{ ...source.chapters[0], ...extra }] }).success).toBe(false);
    }
    expect(ServiceSourceSchema.safeParse({ ...source, videos: [{ ...source.videos[0], transcription_language: 'en' }] }).success).toBe(false);
    expect(ServiceSourceSchema.safeParse({ ...source, type: 'anything' }).success).toBe(false);
  });
  it('identifies the chapter and field when a human enters an invalid boundary', () => {
    const source = authoringValue(fixture()); source.chapters[0].end = '42:00';
    expect(() => parseWithPath(ServiceSourceSchema, source, 'service.yaml')).toThrow(/service.yaml:chapters.0.end.*existing-stable-id.*The Sermon.*later than start/);
  });
});

describe('chapter authoring helper', () => {
  it('generates collision-free readable IDs without recycling archived IDs or modifying existing chapters', () => {
    const service = fixture(), before = structuredClone(service);
    const chapter = proposeChapter([service], service.id, values, ['fixture-a-new-chapter', 'fixture-a-new-chapter-2']);
    expect(chapter.id).toBe('fixture-a-new-chapter-3'); expect(chapter.start).toBe(2640.125);
    expect(service).toEqual(before);
    expect(proposeChapter([service], service.id, { ...values, title: 'A '.repeat(80).trim() }).id.length).toBeLessThanOrEqual(service.id.length + 49);
  });
  it('rejects unknown uploads, missing parents and subsections outside their parent', () => {
    const services = [fixture()];
    expect(() => proposeChapter(services, 'fixture', { ...values, video: 'BBBBBBBBBBB' })).toThrow('video');
    expect(() => proposeChapter(services, 'fixture', { ...values, parent: 'missing' })).toThrow('parent');
    expect(() => proposeChapter(services, 'fixture', { ...values, start: '40:00' })).toThrow('parent');
    expect(() => proposeChapter(services, 'fixture', { ...values, end: '1:10:00' })).toThrow('parent');
  });
  it('defaults to a proposal, then applies quoted times while preserving comments and withdrawing previous approval', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { root, file } = repo(true), before = readFileSync(file, 'utf8');
    const args = ['add-chapter', 'fixture', ...Object.entries(values).flatMap(([key, value]) => [`--${key}`, value])];
    authorCli(args, root);
    expect(readFileSync(file, 'utf8')).toBe(before); expect(log).toHaveBeenCalledWith(expect.stringContaining('Proposal only'));
    authorCli([...args, '--apply'], root);
    const text = readFileSync(file, 'utf8'), service = loadArchive(root)[0];
    expect(text).toContain('# Check the first spoken word here.'); expect(text).toContain('start: "44:00.125"');
    expect(service.chapters.map(chapter => chapter.id)).toEqual(['existing-stable-id', 'fixture-a-new-chapter']);
    expect(service.chapters[0]).toEqual(fixture().chapters[0]);
    expect(service.editorial_status).toBe('needs_review'); expect(service.reviewed_by).toBeUndefined(); expect(service.reviewed_at).toBeUndefined();
  });
});
