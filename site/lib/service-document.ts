/** Human source-file editing. Runtime models keep seconds; YAML keeps quoted clocks and comments. */
import { readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Document, isMap, isScalar, isSeq, parseDocument, Scalar } from 'yaml';
import { ServiceSchema, ServiceSourceSchema, parseWithPath, parseYaml, type Service, type ServiceSource } from './archive';
import { formatTimecode } from './timecode';

export const SOURCE_HEADER = ' yaml-language-server: $schema=../../../schema/service.schema.json\n Editing guide: ../../../docs/editing-services.md\n Times are quoted MM:SS or HH:MM:SS, optionally with fractional seconds. Keep existing IDs stable.';
export function authoringValue(service: Service): ServiceSource {
  const parsed = ServiceSchema.parse(service);
  return { ...parsed, videos: parsed.videos.map(video => ({ ...video, duration: formatTimecode(video.duration) })),
    chapters: parsed.chapters.map(chapter => ({ ...chapter, start: formatTimecode(chapter.start), end: formatTimecode(chapter.end) })) };
}
export function quoteClockNodes(document: Document): void {
  for (const [collection, fields] of [['videos', ['duration']], ['chapters', ['start', 'end']]] as const) {
    const sequence = document.get(collection);
    if (!isSeq(sequence)) continue;
    for (const entry of sequence.items) if (isMap(entry)) for (const field of fields) {
      const scalar = entry.get(field, true);
      if (isScalar(scalar) && typeof scalar.value === 'string') scalar.type = Scalar.QUOTE_DOUBLE;
    }
  }
}
export function stringifyService(service: Service): string {
  const document = new Document(authoringValue(service));
  document.commentBefore = SOURCE_HEADER;
  quoteClockNodes(document);
  return document.toString({ lineWidth: 100 });
}
export function serviceFilename(root: string, service: Pick<Service, 'date' | 'id'>): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(service.id) || !/^\d{4}-\d{2}-\d{2}$/.test(service.date)) throw new Error('Invalid service identity');
  return path.join(realpathSync(root), 'services', service.date.slice(0, 4), service.id, 'service.yaml');
}
export function editServiceDocument(root: string, service: Pick<Service, 'id' | 'date'>, change: (document: Document) => void, expected?: string): void {
  const filename = serviceFilename(root, service);
  if (realpathSync(filename) !== filename) throw new Error('Service file must not be redirected');
  const before = readFileSync(filename, 'utf8');
  if (expected !== undefined && before !== expected) throw new Error(`${service.id}: service changed during checking; rerun instead of overwriting edits`);
  const document = parseDocument(before, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${service.id}: invalid YAML`);
  change(document); quoteClockNodes(document);
  const text = document.toString({ lineWidth: 100 });
  parseWithPath(ServiceSourceSchema, parseYaml(text, filename), filename);
  if (before === text) return;
  const lock = `${filename}.lock`, temporary = `${filename}.${randomUUID()}.tmp`;
  writeFileSync(lock, '', { flag: 'wx', mode: 0o600 });
  try {
    if (readFileSync(filename, 'utf8') !== before) throw new Error(`${service.id}: service changed during editing`);
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 }); renameSync(temporary, filename);
  } finally { rmSync(temporary, { force: true }); rmSync(lock, { force: true }); }
}
