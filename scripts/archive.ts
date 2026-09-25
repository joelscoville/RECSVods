import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { flattenArchive, loadArchive, type BuildMode } from '../site/lib/archive';

export function buildIndex(root = process.cwd(), mode: BuildMode = 'production'): string {
  const passages = flattenArchive(loadArchive(root), mode);
  const directory = path.join(root, 'site/public/generated');
  mkdirSync(directory, { recursive: true });
  // One canonical output is replaced on every build, so a production rebuild cannot
  // accidentally copy a second, stale preview index from the public directory.
  const filename = path.join(directory, 'passages.json');
  writeFileSync(filename, `${JSON.stringify(passages, null, 2)}\n`);
  return filename;
}
export function archiveCli(args = process.argv.slice(2)): void {
  const [command, ...options] = args.filter((arg) => arg !== '--');
  const mode = options.length === 0 ? 'production'
    : options.length === 2 && options[0] === '--mode' ? options[1] : undefined;
  if (!['validate', 'build-index'].includes(command) || !['production', 'preview'].includes(mode ?? '') || (command === 'validate' && options.length)) {
    throw new Error('Usage: tsx scripts/archive.ts validate | build-index [--mode production|preview]');
  }
  if (command === 'validate') console.log(`Archive valid: ${loadArchive().length} interpreted service(s).`);
  else console.log(buildIndex(process.cwd(), mode as BuildMode));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { archiveCli(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
