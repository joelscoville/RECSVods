/** Writes the JSON Schemas that editors use to check and complete the YAML files as people type:
 * schema/recording.schema.json (services/<id>.yaml) and the topic and series lists. `--check` fails if stale. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CHAPTER_HELP, RecordingSchema, SeriesListSchema, TopicListSchema } from '../site/lib/recording-schema';
import { QUIRK_LABELS } from '../site/lib/video-quirks';

export const SCHEMAS: Record<string, { schema: ZodTypeAny; name: string }> = {
  'schema/recording.schema.json': { schema: RecordingSchema, name: 'Recording' },
  'schema/topics.schema.json': { schema: TopicListSchema, name: 'Topics' },
  'schema/series.schema.json': { schema: SeriesListSchema, name: 'Series' },
};
export function editorSchema(schema: ZodTypeAny, name: string): string {
  const json = zodToJsonSchema(schema, { name, effectStrategy: 'input', $refStrategy: 'root' });
  // Hover help for each choice: chapter kinds, part types and quirks.
  function describe(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (Array.isArray(node.enum)) {
      for (const labels of [CHAPTER_HELP, QUIRK_LABELS] as Record<string, string>[]) {
        if (node.enum.length === Object.keys(labels).length && node.enum.every(key => typeof key === 'string' && Object.hasOwn(labels, key))) node.markdownEnumDescriptions = node.enum.map(key => labels[String(key)]);
      }
    }
    for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(describe); else describe(child);
  }
  describe(json);
  return `${JSON.stringify(json, null, 2)}\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  if (args.length > 1 || (args.length && args[0] !== '--check')) throw new Error('Usage: pnpm schema [--check]');
  for (const [file, { schema, name }] of Object.entries(SCHEMAS)) {
    const filename = path.resolve(file), contents = editorSchema(schema, name);
    if (args[0] === '--check') {
      if (readFileSync(filename, 'utf8') !== contents) throw new Error(`${file} is stale; run pnpm schema`);
    } else { mkdirSync(path.dirname(filename), { recursive: true }); writeFileSync(filename, contents); }
  }
  console.log('Editor schemas are current.');
}
