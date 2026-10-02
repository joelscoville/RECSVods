/** Fictional recordings for tests: one complete published sermon by default, in the file's own form. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Document } from 'yaml';
import { quoteClocks } from '../site/lib/apply-changes';
import { parseFile } from '../site/lib/parse-file';
import { RecordingSchema, type RecordingSource, type Series, type Topic } from '../site/lib/recording-schema';
import type { StoredRecording } from '../site/lib/recordings';
import { displayRecordings, searchUnits } from '../site/lib/display';

export const TOPICS: Topic[] = [
  { topicId: 'prayer', topicName: 'Prayer' }, { topicId: 'service-life', topicName: 'Service' }, { topicId: 'hope', topicName: 'Hope' },
];
const DESCRIPTION = 'The preacher reads the passage as a call to quiet, practical generosity toward neighbours. He argues that care is shaped by '
  + 'attention rather than display, that small faithful acts matter, and that the church grows when members notice one another. '
  + 'He closes by inviting listeners to choose one concrete act of service this week.';
const summary = (topic: string) => `The preacher explains ${topic} with a short story from the garden, then applies it to daily life in the congregation and asks listeners to respond.`;

/** A recording in its file form. Times are clocks, as people write them. */
export function source(overrides: Partial<RecordingSource> = {}): RecordingSource {
  return {
    recordingTitle: 'Serving Our Neighbours', serviceDate: '2026-09-06', status: 'published',
    sermonDescription: DESCRIPTION, sermonScripture: ['Romans 12:9-13'], sermonTopics: ['service-life'],
    uploads: [{ youtubeId: 'AAAAAAAAAAA', uploadDuration: '1:30:00' }],
    chapters: [
      { chapterId: 'acts', chapterTitle: 'ACTS Prayer', chapterKind: 'acts', chapterStart: '0:00', chapterEnd: '8:00' },
      { chapterId: 'opening', chapterTitle: 'Opening and Scripture', chapterKind: 'opening', chapterStart: '8:00', chapterEnd: '30:00',
        subchapters: [{ chapterId: 'communion', chapterTitle: 'Holy Communion', chapterKind: 'communion', chapterStart: '20:00', chapterEnd: '25:00' }] },
      { chapterId: 'sermon', chapterTitle: 'Serving Our Neighbours', chapterKind: 'sermon', chapterStart: '30:00', chapterEnd: '1:15:00', points: [
        { pointTime: '30:00', pointText: summary('sincere love') },
        { pointTime: '45:00', pointText: summary('attention') },
      ], subchapters: [{ chapterId: 'hospitality', chapterTitle: 'Practise Small Hospitality', chapterKind: 'sermon', chapterStart: '1:00:00', chapterEnd: '1:15:00',
        points: [{ pointTime: '1:00:00', pointText: summary('hospitality') }] }] },
      { chapterId: 'closing', chapterTitle: 'Response and Closing', chapterKind: 'closing', chapterStart: '1:15:00', chapterEnd: '1:30:00' },
    ],
    ...overrides,
  };
}
export function stored(overrides: Partial<RecordingSource> = {}, id?: string): StoredRecording {
  const value = source(overrides);
  return { recordingId: id ?? value.serviceDate, ...RecordingSchema.parse(value) };
}
export function display(recordings: StoredRecording[] = [stored()], series: Series[] = []) {
  return displayRecordings(recordings, TOPICS, series);
}
export const units = (recordings: StoredRecording[] = [stored()], series: Series[] = []) => searchUnits(display(recordings, series), recordings);

/** A recording file's text, as the archive writes it. */
export function recordingText(value: RecordingSource): string {
  const document = new Document(value);
  document.commentBefore = ' yaml-language-server: $schema=../schema/recording.schema.json';
  quoteClocks(document);
  const text = document.toString({ lineWidth: 100 });
  parseFile(RecordingSchema, text, 'fixture.yaml');
  return text;
}
/** A whole archive on disk: services/<id>.yaml and the taxonomy lists. */
export function writeArchive(root: string, recordings: Record<string, RecordingSource>, options: { topics?: Topic[]; series?: Series[] } = {}): void {
  mkdirSync(path.join(root, 'services'), { recursive: true });
  mkdirSync(path.join(root, 'taxonomy'), { recursive: true });
  for (const [id, value] of Object.entries(recordings)) writeFileSync(path.join(root, 'services', `${id}.yaml`), recordingText(value));
  writeFileSync(path.join(root, 'taxonomy/topics.yaml'), new Document(options.topics ?? TOPICS).toString());
  writeFileSync(path.join(root, 'taxonomy/series.yaml'), new Document(options.series ?? []).toString());
}
/** Deterministic vector rows, so index builds need no model. */
export async function fakeRows(_root: string, list: readonly unknown[]): Promise<Int8Array[]> {
  return list.map((_, i) => Int8Array.from({ length: 384 }, (_, j) => j === i % 384 ? 127 : 0));
}
