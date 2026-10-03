/** Every YouTube upload the archive already knows, for discovery to skip: the recording files' uploads,
 * the corpus manifest's videos and the corpus identifier records. Identifiers only. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { loadRecordings } from '../site/lib/recordings';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const ids = new Set(loadRecordings().recordings.flatMap(recording => recording.uploads.map(upload => upload.youtubeId)));
/** Any `youtube_id` value anywhere in a corpus file. */
function collect(value: unknown): void {
  if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (key === 'youtube_id') {
      if (typeof child !== 'string' || !YOUTUBE_ID.test(child)) throw new Error(`Invalid youtube_id: ${String(child)}`);
      ids.add(child);
    } else collect(child);
  }
}
function walk(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filename);
    else if (/\.ya?ml$/.test(entry.name)) collect(parse(readFileSync(filename, 'utf8')));
  }
}
if (existsSync('corpus')) walk('corpus');
console.log(JSON.stringify([...ids].sort()));
