/** What the pages and search use, derived from the recording files. Browser-safe.
 * Everything is on the recording clock: uploads are laid end to end, so nothing here is "per video". */
import { recordingLength, uploadSpans, type Recording, type Series, type Topic } from './recording-schema';
import { normalizeScriptureReference } from './scripture';
import { publicQuirks, type PublicQuirk } from './video-quirks';

export type BuildMode = 'production' | 'preview';
export interface DisplayUpload { id: string; duration: number; /** Recording time where it starts. */ start: number; end: number; /** Seconds skipped at its start. */ offset: number; quirks?: PublicQuirk[]; unavailable?: boolean }
/** Only chapters and subchapters appear in the public outline. */
export interface DisplayEntry {
  id: string; kind: 'chapter' | 'subchapter';
  type: string;
  title: string; start: number; end: number; parentId?: string;
  scripture?: string[]; scriptureDisplay?: string[];
}
export interface SeriesPlace { id: string; title: string; position: number; total: number }
export interface DisplayRecording {
  id: string; title: string; date: string; preview: boolean; length: number;
  description?: string;
  speaker?: string;
  /** Canonical references, with the wording as entered alongside. */
  scripture: string[]; scriptureDisplay: string[];
  topics: { id: string; name: string }[];
  series?: SeriesPlace;
  uploads: DisplayUpload[];
  entries: DisplayEntry[];
}
/** Search can match a recording, a named section, or a timestamped note. A point
 * has no end time; entryId links its result to the containing public chapter. */
export interface SearchUnit {
  id: string; recordingId: string; recordingTitle: string; date: string;
  kind: 'recording' | 'chapter' | 'subchapter' | 'point';
  title: string; text?: string; speaker?: string; start: number; end?: number; entryId?: string;
  scripture: string[]; scriptureDisplay?: string[]; topics: string[];
  series?: { id: string; title: string };
  preview: boolean;
  /** Browser-only BSB text of the cited passages; never serialized. */
  verseText?: string;
}
export interface StoredRecordingLike extends Recording { recordingId: string }

/** The recordings a build shows: production only published ones, preview everything. */
export function publishable<T extends { status: string }>(recordings: readonly T[], mode: BuildMode): T[] {
  return recordings.filter(recording => mode === 'preview' || recording.status === 'published');
}

export function displayRecordings(recordings: readonly StoredRecordingLike[], topics: readonly Topic[], series: readonly Series[]): DisplayRecording[] {
  const names = new Map(topics.map(topic => [topic.topicId, topic.topicName]));
  const shown = new Map(recordings.map(recording => [recording.recordingId, recording]));
  return [...recordings].sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || a.recordingId.localeCompare(b.recordingId)).map(recording => {
    const entries: DisplayEntry[] = [];
    const references = (chapter: { chapterScripture?: string[] }) => chapter.chapterScripture?.length
      ? { scripture: chapter.chapterScripture.map(normalizeScriptureReference), scriptureDisplay: [...chapter.chapterScripture] } : {};
    recording.chapters.forEach(chapter => {
      entries.push({ id: chapter.chapterId, kind: 'chapter', type: chapter.chapterKind, title: chapter.chapterTitle, start: chapter.chapterStart, end: chapter.chapterEnd, ...references(chapter) });
      chapter.subchapters?.forEach(child => entries.push({ id: child.chapterId, parentId: chapter.chapterId, kind: 'subchapter', type: child.chapterKind,
        title: child.chapterTitle, start: child.chapterStart, end: child.chapterEnd, ...references(child) }));
    });
    const playlist = series.find(item => item.seriesRecordings.includes(recording.recordingId));
    const members = playlist?.seriesRecordings.filter(id => shown.has(id)) ?? [];
    const position = members.indexOf(recording.recordingId);
    const cited = new Map<string, string>();
    for (const ref of [...entries.flatMap(entry => entry.scriptureDisplay ?? []), ...(recording.sermonScripture ?? [])]) {
      const canonical = normalizeScriptureReference(ref); if (!cited.has(canonical)) cited.set(canonical, ref);
    }
    const scriptureDisplay = [...cited.values()];
    return {
      id: recording.recordingId, title: recording.recordingTitle, date: recording.serviceDate, preview: recording.status !== 'published',
      length: recordingLength(recording),
      ...(recording.sermonDescription ? { description: recording.sermonDescription } : {}),
      ...(recording.recordingSpeaker ? { speaker: recording.recordingSpeaker } : {}),
      scripture: scriptureDisplay.map(normalizeScriptureReference), scriptureDisplay: [...scriptureDisplay],
      topics: (recording.sermonTopics ?? []).map(id => ({ id, name: names.get(id) ?? id })),
      ...(playlist && position >= 0 ? { series: { id: playlist.seriesId, title: playlist.seriesTitle, position: position + 1, total: members.length } } : {}),
      uploads: uploadSpans(recording).map(span => {
        const quirks = publicQuirks(span.upload.uploadQuirks);
        return { id: span.upload.youtubeId, duration: span.upload.uploadDuration, start: span.start, end: span.end, offset: span.offset,
          ...(quirks.length ? { quirks } : {}), ...(span.upload.uploadUnavailable ? { unavailable: true } : {}) };
      }),
      entries,
    };
  });
}

/** The full sermon may span several named chapters and several uploads. */
export const sermonOf = (recording: Pick<DisplayRecording, 'entries'>) => {
  const chapters = recording.entries.filter(entry => entry.kind === 'chapter' && entry.type === 'sermon');
  return chapters.length ? { ...chapters[0], end: chapters.at(-1)!.end } : undefined;
};

export function searchUnits(recordings: readonly DisplayRecording[], sources: readonly StoredRecordingLike[] = []): SearchUnit[] {
  return recordings.flatMap(recording => {
    const sermon = sermonOf(recording);
    const base = { recordingId: recording.id, recordingTitle: recording.title, date: recording.date, preview: recording.preview,
      ...(recording.speaker ? { speaker: recording.speaker } : {}) };
    const whole: SearchUnit = { ...base, id: recording.id, kind: 'recording', title: recording.title, ...(recording.description ? { text: recording.description } : {}),
      start: sermon?.start ?? 0, end: sermon?.end ?? recording.length,
      scripture: [...recording.scripture], ...(recording.scriptureDisplay.some((value, i) => value !== recording.scripture[i]) ? { scriptureDisplay: [...recording.scriptureDisplay] } : {}),
      topics: recording.topics.map(topic => topic.name),
      ...(recording.series ? { series: { id: recording.series.id, title: recording.series.title } } : {}) };
    const inside = recording.entries.map((entry): SearchUnit => ({
      ...base, id: `${recording.id}/${entry.id}`, entryId: entry.id, kind: entry.kind, title: entry.title,
      start: entry.start, end: entry.end, scripture: [...(entry.scripture ?? [])], ...(entry.scriptureDisplay ? { scriptureDisplay: [...entry.scriptureDisplay] } : {}), topics: [],
    }));
    const source = sources.find(source => source.recordingId === recording.id);
    const points = source?.chapters.flatMap(chapter => [chapter, ...(chapter.subchapters ?? [])]).flatMap(chapter =>
      (chapter.points ?? []).map((point, i): SearchUnit => ({ ...base, id: `${recording.id}/${chapter.chapterId}/point-${i + 1}`,
        entryId: chapter.chapterId, kind: 'point', title: chapter.chapterTitle, text: point.pointText, start: point.pointTime,
        scripture: (chapter.chapterScripture ?? []).map(normalizeScriptureReference), ...(chapter.chapterScripture?.length ? { scriptureDisplay: [...chapter.chapterScripture] } : {}), topics: [] }))) ?? [];
    return [whole, ...inside, ...points];
  });
}

/** The upload a recording time falls in, and the time within it. */
export function locateUpload(recording: Pick<DisplayRecording, 'uploads'>, time: number): { upload: DisplayUpload; uploadTime: number } {
  const upload = recording.uploads.find(item => time < item.end) ?? recording.uploads[recording.uploads.length - 1];
  return { upload, uploadTime: Math.min(upload.offset + Math.max(0, time - upload.start), upload.duration) };
}
