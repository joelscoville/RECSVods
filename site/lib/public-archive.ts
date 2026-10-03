/** Build-time: the recordings a build shows, ready for pages and search. */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadRecordings } from './recordings';
import { displayRecordings, publishable, searchUnits, type BuildMode, type DisplayRecording, type SearchUnit } from './display';

/** Every page of a build reads the same archive; it is read again only when a file changes. */
const cached = new Map<string, { stamp: string; value: { recordings: DisplayRecording[]; units: SearchUnit[] } }>();
function stamp(root: string): string {
  const files = ['taxonomy/topics.yaml', 'taxonomy/series.yaml', ...readdirSync(path.join(root, 'services')).map(name => `services/${name}`)];
  return files.map(file => `${file}:${statSync(path.join(root, file), { throwIfNoEntry: false })?.mtimeMs ?? 0}`).join('|');
}
export function loadPublicArchive(mode: BuildMode, root = process.cwd()) {
  const key = `${mode}:${root}`, current = stamp(root);
  const previous = cached.get(key);
  if (previous?.stamp === current) return previous.value;
  const archive = loadRecordings(root);
  const sources = publishable(archive.recordings, mode);
  const recordings = displayRecordings(sources, archive.topics, archive.series);
  const value = { recordings, units: searchUnits(recordings, sources) };
  cached.set(key, { stamp: current, value });
  return value;
}
