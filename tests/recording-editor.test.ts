import { describe, expect, it } from 'vitest';
import { addMarker, addSubchapterAt, addPointAt, describeChanges, DraftStateSchema, editChapter, editMarker, editPoint,
  initialState, items, outline, removeItem, removeMarker, setEdge, snapTime, startChapterAt, toRecording, validateEditor,
  githubRawUrl, githubEditUrl, recordingFilePath, SOURCE_BRANCH, type EditorRecording, type EditorState } from '../site/lib/recording-editor';
import { applyChanges, ChangeConflictError } from '../site/lib/apply-changes';
import { diffHunks } from '../site/lib/line-diff';
import { CHAPTER_KINDS, RecordingSchema, type RecordingSource } from '../site/lib/recording-schema';
import { loadRecordings } from '../site/lib/recordings';
import { displayRecordings, searchUnits } from '../site/lib/display';
import { recordingText, source, TOPICS } from './recording-fixtures';
const base = (overrides: Partial<RecordingSource> = {}): EditorRecording => ({ id: '2026-09-06', recording: RecordingSchema.parse(source(overrides)), topics: TOPICS });
const LENGTH = 5400;
const file = (value = source()) => recordingText(value).replace('recordingTitle:', '# Checked against the slide.\nrecordingTitle:');
const send = (text: string, state: EditorState, from = base()) => applyChanges({ text, base: from.recording, edited: toRecording(from, state).source, filename: 'services/2026-09-06.yaml' });

describe('named editor sections', () => {
  it('rejects structured speaker metadata while preserving names in ordinary descriptions', () => {
    const description = 'Avery Example explains how hospitality serves neighbours.';
    expect(RecordingSchema.safeParse({ ...source(), recordingSpeaker: 'Avery Example' }).success).toBe(false);
    const from = base({ sermonDescription: description }), state = initialState(from);
    expect(state).not.toHaveProperty('speaker');
    const restored = DraftStateSchema.parse({ ...state, speaker: 'Retired draft metadata' });
    expect(restored).not.toHaveProperty('speaker');
    const result = toRecording(from, restored).source;
    expect(result).not.toHaveProperty('recordingSpeaker');
    expect(result.sermonDescription).toBe(description);
    const display = displayRecordings([{ ...RecordingSchema.parse(result), recordingId: from.id }], TOPICS, []);
    expect(display[0]).not.toHaveProperty('speaker');
    expect(searchUnits(display, [{ ...RecordingSchema.parse(result), recordingId: from.id }]).every(unit => !('speaker' in unit))).toBe(true);
  });
  it('retains the stored names and nests subchapters and point notes under their owners', () => {
    const state = initialState(base()), list = outline(state, LENGTH);
    expect(list.filter(item => item.lane === 'chapter').map(item => item.title)).toEqual(['ACTS Prayer', 'Opening and Scripture', 'Serving Our Neighbours', 'Response and Closing']);
    expect(list.find(item => item.id === 'hospitality')?.parentId).toBe('sermon');
    expect(list.find(item => item.id === 'hospitality/point-1')?.parentId).toBe('hospitality');
    expect(items(state, LENGTH).filter(item => item.lane === 'point').every(item => item.start === item.end)).toBe(true);
    expect(items(state, LENGTH).filter(item => item.lane === 'point').map(item => item.title)).toEqual(['Description at 30:00', 'Description at 45:00', 'Description at 1:00:00']);
  });
  it.each(CHAPTER_KINDS)('changes a chapter and subchapter to %s without changing title, ID or children', kind => {
    const state = initialState(base());
    const changed = editChapter(editChapter(state, 'sermon', { kind }), 'hospitality', { kind });
    expect(changed.chapters[2]).toEqual({ ...state.chapters[2], kind });
    expect(changed.subchapters[1]).toEqual({ ...state.subchapters[1], kind });
    expect(changed.points).toEqual(state.points);
    expect(validateEditor(base(), changed)).toEqual([]);
  });
  it('renames any chapter, including communion, independently of type', () => {
    const changed = editChapter(editChapter(initialState(base()), 'sermon', { title: 'A different title' }), 'communion', { title: 'The Lord’s Table' });
    expect(toRecording(base(), changed).source.chapters[2].chapterTitle).toBe('A different title');
    expect(toRecording(base(), changed).source.chapters[1].subchapters![0].chapterTitle).toBe('The Lord’s Table');
    expect(validateEditor(base(), changed)).toEqual([]);
  });
  it('moves touching boundaries together and can also move one alone', () => {
    const state = initialState(base()), edge = { lane: 'chapter' as const, id: 'sermon', edge: 'start' as const };
    const moved = setEdge(state, LENGTH, edge, 1790);
    expect(moved.chapters[1].end).toBe(1790); expect(moved.chapters[2].start).toBe(1790);
    expect(moved.points[0].time).toBe(1790);
    expect(setEdge(state, LENGTH, edge, 1790, false).chapters[1].end).toBe(1800);
    expect(validateEditor(base(), moved)).toEqual([]);
  });
  it('refuses inverted, overlapping, or out-of-parent boundaries from any command path', () => {
    const state = initialState(base());
    expect(setEdge(state, LENGTH, { lane: 'chapter', id: 'sermon', edge: 'end' }, 0)).toBe(state);
    expect(setEdge(state, LENGTH, { lane: 'point', id: 'sermon/point-1', edge: 'start' }, 100)).toBe(state);
    expect(setEdge(state, LENGTH, { lane: 'subchapter', id: 'hospitality', edge: 'end' }, 5000)).toBe(state);
    expect(setEdge(state, LENGTH, { lane: 'chapter', id: 'sermon', edge: 'start' }, 1790, false)).toBe(state);
    expect(setEdge(state, LENGTH, { lane: 'chapter', id: 'sermon', edge: 'end' }, 4000)).not.toBe(state);
    expect(validateEditor(base(), setEdge(state, LENGTH, { lane: 'chapter', id: 'sermon', edge: 'end' }, 4000))).toEqual([]);
  });
  it('adds repeated chapter types, preserving explicit ends and nested ownership', () => {
    const state = initialState(base()), added = startChapterAt(state, LENGTH, 'sermon', 3000);
    expect(added.id).toBeTruthy(); expect(added.state.chapters.filter(chapter => chapter.kind === 'sermon')).toHaveLength(2);
    expect(added.state.chapters.find(chapter => chapter.id === 'sermon')?.end).toBe(3000);
    expect(added.state.subchapters.find(chapter => chapter.id === 'hospitality')?.parentId).toBe(added.id);
    expect(validateEditor(base(), editChapter(added.state, added.id!, { title: 'A New Chapter' }))).toEqual([]);
  });
  it('adds subchapters in any parent and timestamp-only notes at any useful spacing', () => {
    const state = initialState(base()), child = addSubchapterAt(state, LENGTH, 60);
    expect(child.state.subchapters.find(item => item.id === child.id)).toMatchObject({ parentId: 'acts', start: 60, end: 480 });
    const added = addPointAt(child.state, LENGTH, 61);
    expect(added.state.points.find(item => item.id === added.id)).toMatchObject({ parentId: child.id, time: 61, text: '' });
    const ready = editPoint(editChapter(added.state, child.id!, { title: 'Prayer' }), added.id!, { text: 'A prayer for neighbours.' });
    const point = toRecording(base(), ready).source.chapters[0].subchapters![0].points![0];
    expect(point).toEqual({ pointTime: '1:01', pointText: 'A prayer for neighbours.' });
    expect(validateEditor(base(), ready)).toEqual([]);
  });
  it('removes a section with its children and notes, without lengthening unrelated chapters', () => {
    const state = initialState(base()), removed = removeItem(state, 'sermon');
    expect(removed.subchapters.map(item => item.id)).toEqual(['communion']);
    expect(removed.points).toEqual([]); expect(removed.chapters[1].end).toBe(1800);
  });
  it('points out invalid notes and titles on the right row', () => {
    let state = editChapter(initialState(base()), 'hospitality', { title: '' });
    state = editPoint(state, 'sermon/point-1', { time: 100 });
    expect(validateEditor(base(), state)).toContainEqual(expect.objectContaining({ itemId: 'hospitality', message: 'Title: required text' }));
    expect(validateEditor(base(), state)).toContainEqual(expect.objectContaining({ itemId: 'sermon/point-1', message: 'Time: inside this chapter' }));
  });
  it('restores only structurally valid drafts and snaps only within tolerance', () => {
    expect(DraftStateSchema.safeParse(initialState(base())).success).toBe(true);
    expect(DraftStateSchema.safeParse({ ...initialState(base()), chapters: [] }).success).toBe(false);
    const broken = initialState(base()); broken.subchapters[0].id = broken.chapters[0].id;
    expect(DraftStateSchema.safeParse(broken).success).toBe(false);
    expect(snapTime(10.2, [10, 11], 0.3)).toEqual({ time: 10, snapped: 10 });
    expect(snapTime(10.5, [10, 11.2], 0.3)).toEqual({ time: 10.5 });
  });
});
describe('saving the real recording file', () => {
  it('round-trips all restored recording data through the editor', () => {
    const archive = loadRecordings();
    for (const { recordingId, ...recording } of archive.recordings) {
      const from = { id: recordingId, recording, topics: archive.topics };
      expect(RecordingSchema.parse({ ...toRecording(from, initialState(from)).source, status: recording.status }), recordingId).toEqual(recording);
    }
  });
  it('changes only the edited title and preserves comments', () => {
    const text = file(), state = editChapter(initialState(base()), 'sermon', { title: 'Practical Generosity' }), result = send(text, state);
    expect(result.text).toContain('# Checked against the slide.');
    expect(result.recording.chapters[2].chapterId).toBe('sermon');
    const changed = diffHunks(text, result.text).flatMap(hunk => hunk.lines.filter(line => line.kind !== 'same').map(line => `${line.kind[0]}${line.text.trim()}`));
    expect(changed).toEqual(['rchapterTitle: Serving Our Neighbours', 'achapterTitle: Practical Generosity']);
  });
  it('retains chapter and subchapter Bible links through editing and search projection', () => {
    const value = source();
    value.chapters[2].chapterScripture = ['John 16:25-33'];
    value.chapters[2].subchapters![0].chapterScripture = ['Rom 12:13'];
    const from = base(value), edited = editChapter(initialState(from), 'hospitality', { title: 'A Renamed Subchapter', kind: 'other' });
    const result = send(file(value), edited, from).recording;
    expect(result.chapters[2].chapterScripture).toEqual(['John 16:25-33']);
    expect(result.chapters[2].subchapters![0].chapterScripture).toEqual(['Rom 12:13']);
    const stored = { ...result, recordingId: from.id }, display = displayRecordings([stored], from.topics, []);
    expect(display[0].scripture).toEqual(['John 16:25-33', 'Romans 12:13', 'Romans 12:9-13']);
    expect(searchUnits(display, [stored]).find(unit => unit.id.endsWith('hospitality/point-1'))).toMatchObject({ scripture: ['Romans 12:13'], scriptureDisplay: ['Rom 12:13'] });
  });
  it('publishes a reviewed draft and describes structural changes', () => {
    const draft = base({ status: 'draft' });
    expect(send(file(source({ status: 'draft' })), initialState(draft), draft).recording.status).toBe('published');
    expect(describeChanges(base(), removeItem(initialState(base()), 'hospitality')).join()).toContain('Subchapter “Practise Small Hospitality” removed');
  });
  it('preserves all finer source timing precision during text-only edits', () => {
    const value = source({ uploads: [{ youtubeId: 'AAAAAAAAAAA', uploadDuration: '1:30:00.123456' }], markers: [{ markerTime: '31:00.123456', markerEnd: '31:05.123456', markerNote: 'Check this moment.' }] });
    const from = base(value), state = { ...initialState(from), title: 'Changed title' };
    expect(send(file(value), state, from).recording).toEqual({ ...from.recording, recordingTitle: 'Changed title' });
  });
  it('rejects conflicting section edits and changed upload clocks', () => {
    const value = source(); value.chapters[2].chapterTitle = 'Someone Else’s Title';
    expect(() => send(file(value), editChapter(initialState(base()), 'sermon', { title: 'My Title' }))).toThrow(ChangeConflictError);
    expect(() => send(file(source({ uploads: [{ youtubeId: 'AAAAAAAAAAA', uploadDuration: '1:31:00' }] })), initialState(base()))).toThrow('uploads or recording clock');
  });
  it('merges untouched fields, including concurrent upload notes', () => {
    const value = source({ uploads: [{ ...source().uploads[0], uploadQuirks: ['audio_choppy'] }] });
    value.chapters[0].chapterTitle = 'Their title';
    const result = send(file(value), editChapter(initialState(base()), 'sermon', { kind: 'other' }));
    expect(result.recording.chapters[0].chapterTitle).toBe('Their title');
    expect(result.recording.uploads[0].uploadQuirks).toEqual(['audio_choppy']);
  });
  it('addresses the real file on main', () => {
    expect(SOURCE_BRANCH).toBe('main'); expect(recordingFilePath('2026-09-06-2')).toBe('services/2026-09-06-2.yaml');
    expect(githubRawUrl('https://github.com/a/b', 'main', 'services/x.yaml')).toBe('https://raw.githubusercontent.com/a/b/main/services/x.yaml');
    expect(githubEditUrl('https://github.com/a/b', 'main', 'services/x.yaml')).toBe('https://github.com/a/b/edit/main/services/x.yaml');
  });
});
describe('review markers', () => {
  const marked = base({ markers: [{ markerTime: '31:00', markerEnd: '31:10', markerNote: 'Check the reading.' }] });
  it('keeps file notes in the editor, out of public display and search, and unsent notes local', () => {
    const state = initialState(marked), added = addMarker(state, 2000, 'Private until sent');
    expect(state.markers[0].note).toBe('Check the reading.');
    const display = displayRecordings([{ ...marked.recording, recordingId: marked.id }], marked.topics, []);
    expect(JSON.stringify(display)).not.toContain('Check the reading.'); expect(JSON.stringify(searchUnits(display))).not.toContain('Check the reading.');
    expect(toRecording(marked, added.state).source.markers).toHaveLength(1);
    expect(toRecording(marked, editMarker(added.state, added.id, { include: true })).source.markers).toHaveLength(2);
  });
  it('moves a marker range together and can resolve it', () => {
    expect(editMarker(initialState(marked), 'file-0', { at: 2000 }).markers[0]).toMatchObject({ at: 2000, end: 2010 });
    const text = recordingText({ ...source(), markers: [{ markerTime: '31:00', markerEnd: '31:10', markerNote: 'Check the reading.' }] });
    expect(send(text, removeMarker(initialState(marked), 'file-0'), marked).recording.markers).toBeUndefined();
    expect(validateEditor(marked, editMarker(initialState(marked), 'file-0', { note: ' ' })).map(issue => issue.message).join()).toContain('required text');
  });
});
