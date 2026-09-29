import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ServiceSourceSchema } from '../site/lib/archive';
import { CHAPTER_TYPE_HELP, SERVICE_TYPE_HELP } from '../site/lib/service-types';
import { QUIRK_LABELS } from '../site/lib/video-quirks';

export function serviceEditorSchema() {
  const schema = zodToJsonSchema(ServiceSourceSchema, { name: 'Service', effectStrategy: 'input', $refStrategy: 'root' });
  function descriptions(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (Array.isArray(node.enum)) {
      for (const labels of [CHAPTER_TYPE_HELP, SERVICE_TYPE_HELP, QUIRK_LABELS] as Record<string, string>[]) {
        if (node.enum.length === Object.keys(labels).length && node.enum.every(key => typeof key === 'string' && Object.hasOwn(labels, key))) node.markdownEnumDescriptions = node.enum.map(key => labels[String(key)]);
      }
    }
    for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(descriptions); else descriptions(child);
  }
  descriptions(schema);
  return `${JSON.stringify(schema, null, 2)}\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  if (args.length > 1 || args.length && args[0] !== '--check') throw new Error('Usage: pnpm schema:service [--check]');
  const filename = path.resolve('schema/service.schema.json'), contents = serviceEditorSchema();
  if (args[0] === '--check') {
    if (readFileSync(filename, 'utf8') !== contents) throw new Error('Editor schema is stale; run pnpm schema:service');
  } else { mkdirSync(path.dirname(filename), { recursive: true }); writeFileSync(filename, contents); }
  console.log('Service editor schema is current.');
}
