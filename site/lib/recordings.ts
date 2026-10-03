/** Reads the archive from disk: `services/<id>.yaml`, `taxonomy/topics.yaml`, `taxonomy/series.yaml`.
 * Node only; everything else in the site works on the result. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import { parseFile } from './parse-file';
export { parseFile };
import { RECORDING_ID, RecordingSchema, SeriesListSchema, TopicListSchema, type Recording, type Series, type Topic } from './recording-schema';

export interface StoredRecording extends Recording { recordingId: string }
export interface Archive { recordings: StoredRecording[]; topics: Topic[]; series: Series[] }

/** Cross-file rules: file names match dates, topics and series refer to real things. */
export function checkArchive({ recordings, topics, series }: Archive): void {
  const problems: string[] = [];
  const topicIds = new Set(topics.map(topic => topic.topicId)), ids = new Set(recordings.map(item => item.recordingId));
  if (topicIds.size !== topics.length) problems.push('taxonomy/topics.yaml: a topic id is listed twice');
  for (const recording of recordings) {
    const match = RECORDING_ID.exec(recording.recordingId);
    if (!match || match[1] !== recording.serviceDate) problems.push(`services/${recording.recordingId}.yaml: the file name must be the service date (${recording.serviceDate})`);
    for (const topic of recording.sermonTopics ?? []) if (!topicIds.has(topic)) problems.push(`services/${recording.recordingId}.yaml: sermonTopics: "${topic}" is not in taxonomy/topics.yaml`);
  }
  const uploads = new Map<string, string>();
  for (const recording of recordings) for (const upload of recording.uploads) {
    const owner = uploads.get(upload.youtubeId);
    if (owner) problems.push(`${upload.youtubeId}: in both ${owner} and ${recording.recordingId}`);
    uploads.set(upload.youtubeId, recording.recordingId);
  }
  const member = new Map<string, string>();
  for (const item of series) for (const id of item.seriesRecordings) {
    if (!ids.has(id)) problems.push(`taxonomy/series.yaml: ${item.seriesId} lists ${id}, which has no services/${id}.yaml`);
    const other = member.get(id);
    if (other) problems.push(`taxonomy/series.yaml: ${id} is in both ${other} and ${item.seriesId}`);
    member.set(id, item.seriesId);
  }
  if (new Set(series.map(item => item.seriesId)).size !== series.length) problems.push('taxonomy/series.yaml: a series id is listed twice');
  if (problems.length) throw new Error(problems.join('\n'));
}

export function loadRecordings(root = process.cwd()): Archive {
  const directory = path.join(root, 'services');
  const names = readdirSync(directory).filter(name => name.endsWith('.yaml')).map(name => name.slice(0, -'.yaml'.length));
  const recordings = names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(id => {
    const filename = `services/${id}.yaml`;
    return { recordingId: id, ...parseFile(RecordingSchema, readFileSync(path.join(root, filename), 'utf8'), filename) };
  });
  const list = <S extends z.ZodTypeAny>(schema: S, file: string) => parseFile(schema, readFileSync(path.join(root, file), 'utf8'), file);
  const archive = { recordings, topics: list(TopicListSchema, 'taxonomy/topics.yaml'), series: list(SeriesListSchema, 'taxonomy/series.yaml') };
  checkArchive(archive);
  return archive;
}
