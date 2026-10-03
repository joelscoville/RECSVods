/** One recording file, with named chapters, optional subchapters and timestamped notes.
 * All times use the recording clock across its uploads. Titles and types are independent. */
import { z } from 'zod';
import { parseScriptureReference } from './scripture';
import { ClockSchema } from './timecode';
import { QuirkKindSchema } from './video-quirks';

export const CHAPTER_KINDS = ['acts', 'opening', 'sermon', 'closing', 'communion', 'music', 'qa', 'other'] as const;
export const ChapterKindSchema = z.enum(CHAPTER_KINDS);
export type ChapterKind = z.infer<typeof ChapterKindSchema>;
/** Labels for the type selector, never replacements for a chapter's own title. */
export const CHAPTER_TITLES: Record<ChapterKind, string> = {
  acts: 'ACTS Prayer', opening: 'Opening', sermon: 'Sermon', closing: 'Closing',
  communion: 'Communion', music: 'Music', qa: 'Q&A', other: 'Other',
};
export const CHAPTER_HELP: Record<ChapterKind, string> = {
  acts: 'Prayer in adoration, confession, thanksgiving and supplication.',
  opening: 'Opening worship, welcome, prayers or scripture readings.',
  sermon: 'Teaching within the sermon.', closing: 'Response, notices or closing worship.',
  communion: 'Holy Communion.', music: 'A choir item or other musical section.',
  qa: 'Questions and answers.', other: 'Another kind of section.',
};
/** Writing guidance, not arbitrary limits on what can be saved. */
export const LIMITS = { descriptionWords: [40, 90], points: [5, 10], topics: [1, 3], scripture: [1, 3] } as const;
export const words = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;
const Text = z.string().regex(/\S/u, 'required text');
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'letters, numbers, hyphens and underscores');
const Scripture = Text.refine(value => Boolean(parseScriptureReference(value)), 'not a Bible reference this archive understands, e.g. "John 17:1-5"');
const TopicId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a topic id from taxonomy/topics.yaml');

export const UploadSchema = z.object({
  youtubeId: z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'an 11-character YouTube ID'),
  uploadDuration: ClockSchema.refine(seconds => seconds > 0, 'longer than 0:00').describe('The upload’s full length.'),
  uploadSkip: ClockSchema.describe('Repeated seconds to skip at the start of a later upload.').optional(),
  uploadUnavailable: z.literal(true).optional(),
  uploadQuirks: z.array(QuirkKindSchema).min(1).optional(),
}).strict();
export const PointSchema = z.object({
  pointTime: ClockSchema.describe('The moment this note refers to. A point has no end time.'),
  pointText: Text.describe('A short summary of what happens at this moment. Used by search and shown in the editor, not the public outline.'),
}).strict();
const chapterFields = {
  chapterId: Id.describe('Stable within this recording. Keep it when editing the title, type or times.'),
  chapterTitle: Text.describe('The name viewers see. Editable independently of its type.'),
  chapterKind: ChapterKindSchema,
  chapterStart: ClockSchema, chapterEnd: ClockSchema,
  chapterScripture: z.array(Scripture).describe('Bible passage references belonging to this chapter or subchapter.').optional(),
  points: z.array(PointSchema).describe('Timestamped notes for search and maintainers. Aim for 5–10 when useful; fewer are fine.').optional(),
};
export const SubchapterSchema = z.object(chapterFields).strict();
export const ChapterSchema = z.object({ ...chapterFields, subchapters: z.array(SubchapterSchema).optional() }).strict();
export const MarkerSchema = z.object({
  markerTime: ClockSchema, markerEnd: ClockSchema.optional(),
  markerNote: Text.describe('A review note visible to people using the editor, not on watch pages or in search.'),
}).strict();
const RecordingObject = z.object({
  recordingTitle: Text,
  serviceDate: z.string().date('a real calendar date in YYYY-MM-DD form'),
  status: z.enum(['draft', 'published']),
  sermonDescription: Text.describe('The single paragraph shown under the video.').optional(),
  sermonScripture: z.array(Scripture).optional(),
  sermonTopics: z.array(TopicId).optional(),
  uploads: z.array(UploadSchema).min(1),
  chapters: z.array(ChapterSchema).min(1),
  markers: z.array(MarkerSchema).optional(),
}).strict();
export const RecordingSchema = RecordingObject.superRefine((recording, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const length = recordingLength(recording);
  recording.uploads.forEach((upload, i) => {
    if (upload.uploadSkip !== undefined && (i === 0 || upload.uploadSkip >= upload.uploadDuration)) issue(['uploads', i, 'uploadSkip'], 'only for a later upload, and shorter than it');
  });
  if (new Set(recording.uploads.map(upload => upload.youtubeId)).size !== recording.uploads.length) issue(['uploads'], 'an upload is listed twice');
  const ids = new Set<string>();
  const check = (chapter: z.output<typeof SubchapterSchema>, at: (string | number)[], bounds: [number, number]) => {
    if (ids.has(chapter.chapterId)) issue([...at, 'chapterId'], 'a chapter id is used twice');
    ids.add(chapter.chapterId);
    if (chapter.chapterEnd <= chapter.chapterStart) issue([...at, 'chapterEnd'], 'after the chapter start');
    if (chapter.chapterStart < bounds[0] || chapter.chapterEnd > bounds[1] + 0.000001) issue(at, 'inside its parent chapter or recording');
    chapter.points?.forEach((point, i, points) => {
      if (point.pointTime < chapter.chapterStart || point.pointTime >= chapter.chapterEnd) issue([...at, 'points', i, 'pointTime'], 'inside this chapter');
      if (i && point.pointTime < points[i - 1].pointTime) issue([...at, 'points', i, 'pointTime'], 'points go in time order');
    });
  };
  recording.chapters.forEach((chapter, i, chapters) => {
    check(chapter, ['chapters', i], [0, length]);
    if (i && chapter.chapterStart < chapters[i - 1].chapterEnd - 0.000001) issue(['chapters', i, 'chapterStart'], 'in time order, without overlapping the previous chapter');
    chapter.subchapters?.forEach((child, j, children) => {
      check(child, ['chapters', i, 'subchapters', j], [chapter.chapterStart, chapter.chapterEnd]);
      if (j && child.chapterStart < children[j - 1].chapterEnd - 0.000001) issue(['chapters', i, 'subchapters', j, 'chapterStart'], 'in time order, without overlapping the previous subchapter');
    });
  });
  if (recording.status === 'published' && recording.chapters.some(chapter => chapter.chapterKind === 'sermon' || chapter.subchapters?.some(child => child.chapterKind === 'sermon'))) {
    if (!recording.sermonDescription) issue(['sermonDescription'], 'a recording with a sermon needs its description');
    if (!recording.sermonScripture?.length) issue(['sermonScripture'], 'add the passage the sermon preaches on');
    if (!recording.sermonTopics?.length) issue(['sermonTopics'], 'choose a sermon topic');
  }
  recording.markers?.forEach((marker, i) => {
    if (marker.markerTime > length || (marker.markerEnd !== undefined && (marker.markerEnd <= marker.markerTime || marker.markerEnd > length))) issue(['markers', i], 'inside the recording');
  });
});
export type RecordingSource = z.input<typeof RecordingSchema>;
export type Recording = z.output<typeof RecordingSchema>;
export type Upload = Recording['uploads'][number];
export type Chapter = Recording['chapters'][number];
export type Subchapter = z.output<typeof SubchapterSchema>;
export type Point = z.output<typeof PointSchema>;
export type Marker = z.output<typeof MarkerSchema>;

export function recordingLength(recording: { uploads: { uploadDuration: number; uploadSkip?: number }[] }): number {
  return recording.uploads.reduce((total, upload) => total + upload.uploadDuration - (upload.uploadSkip ?? 0), 0);
}
export function chapterEnd(recording: Pick<Recording, 'chapters'>, index: number): number { return recording.chapters[index].chapterEnd; }
export interface UploadSpan { upload: Upload; index: number; start: number; end: number; offset: number }
export function uploadSpans(recording: Pick<Recording, 'uploads'>): UploadSpan[] {
  let start = 0;
  return recording.uploads.map((upload, index) => {
    const offset = upload.uploadSkip ?? 0, span = { upload, index, start, end: start + upload.uploadDuration - offset, offset };
    start = span.end; return span;
  });
}
export function locate(recording: Pick<Recording, 'uploads'>, time: number): { upload: Upload; index: number; uploadTime: number } {
  const spans = uploadSpans(recording), span = spans.find(item => time < item.end) ?? spans[spans.length - 1];
  return { upload: span.upload, index: span.index, uploadTime: Math.min(span.offset + Math.max(0, time - span.start), span.upload.uploadDuration) };
}
export function recordingTime(recording: Pick<Recording, 'uploads'>, youtubeId: string, uploadTime: number): number {
  const span = uploadSpans(recording).find(item => item.upload.youtubeId === youtubeId);
  if (!span) throw new Error(`${youtubeId} is not an upload of this recording`);
  return span.start + Math.max(0, uploadTime - span.offset);
}
export const TopicListSchema = z.array(z.object({ topicId: TopicId, topicName: Text }).strict());
export const SeriesListSchema = z.array(z.object({
  seriesId: TopicId, seriesTitle: Text,
  seriesRecordings: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}(?:-\d+)?$/, 'a recording id')).min(1),
}).strict());
export type Topic = z.infer<typeof TopicListSchema>[number];
export type Series = z.infer<typeof SeriesListSchema>[number];
export const RECORDING_ID = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/;
