import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadArchive, IdentifierRecordSchema, parseYaml } from '../site/lib/archive';
import { validateBackfill } from '../site/lib/backfill';

// Identifier projection only: no interpretation, private evidence, media or model work.
const services = loadArchive();
const manifest = validateBackfill(process.cwd(), services);
const ids = new Set([...services.flatMap(service => service.videos.map(video => video.id)),
  ...manifest.services.flatMap(service => service.videos.map(video => video.youtube_id))]);
function walk(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filename);
    else if (/\.ya?ml$/.test(entry.name) && filename !== path.join('corpus', 'manifest.yaml')) {
      ids.add(IdentifierRecordSchema.parse(parseYaml(readFileSync(filename, 'utf8'), filename)).youtube_id);
    }
  }
}
if (existsSync('corpus')) walk('corpus');
console.log(JSON.stringify([...ids].sort()));
