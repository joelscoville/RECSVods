import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState, type EditorRecording } from '../site/lib/recording-editor';
import { RecordingSchema } from '../site/lib/recording-schema';
import { readEditorDraft, writeEditorDraft } from '../site/lib/editor-draft';
import { editorHistory, type EditorHistory } from '../site/lib/editor-history';
import { source } from './recording-fixtures';

const base = (): EditorRecording => ({ id: '2026-09-06', recording: RecordingSchema.parse(source()), topics: [] });
afterEach(() => vi.unstubAllGlobals());
describe('editor session boundaries', () => {
  it('coalesces typing only within one editing session and clears redo on a new edit', () => {
    const original = initialState(base());
    let history: EditorHistory = { present: original, past: [], future: [] };
    history = editorHistory(history, { type: 'apply', next: { ...original, title: 'A' }, key: 'title' });
    history = editorHistory(history, { type: 'apply', next: { ...original, title: 'AB' }, key: 'title' });
    expect(history.past).toHaveLength(1);
    history = editorHistory(history, { type: 'break' });
    history = editorHistory(history, { type: 'apply', next: { ...original, title: 'ABC' }, key: 'title' });
    history = editorHistory(history, { type: 'undo' });
    expect(history.present.title).toBe('AB');
    history = editorHistory(history, { type: 'apply', next: { ...history.present, description: 'A revised description' } });
    expect(history.future).toEqual([]);
  });
  it('makes draft restoration and reset undoable, but discards a previous recording history on load', () => {
    const original = initialState(base()), draft = { ...original, title: 'My draft' };
    let history = editorHistory({ past: [], present: original, future: [] }, { type: 'load', original, draft });
    history = editorHistory(history, { type: 'reset', state: original });
    expect(editorHistory(history, { type: 'undo' }).present.title).toBe('My draft');
    history = editorHistory(history, { type: 'load', original: { ...original, title: 'Another recording' } });
    expect(history.past).toEqual([]); expect(history.future).toEqual([]);
  });
  it('rejects stale or malformed drafts and only clears its own recording key', () => {
    const values = new Map<string, string>([['unrelated', 'keep']]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    const recording = base(), draft = { ...initialState(recording), title: 'Saved correction' };
    writeEditorDraft(recording, draft);
    expect(readEditorDraft(recording)?.title).toBe('Saved correction');
    expect(readEditorDraft({ ...recording, recording: { ...recording.recording, recordingTitle: 'Changed remotely' } })).toBeUndefined();
    values.set('recs-recording-editor:v3:2026-09-06', '{broken');
    expect(readEditorDraft(recording)).toBeUndefined();
    writeEditorDraft(recording, undefined);
    expect([...values]).toEqual([['unrelated', 'keep']]);
  });
});
