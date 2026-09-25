import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { flattenArchive, loadArchive, type BuildMode } from '../site/lib/archive';
import type { SearchPassage } from '../site/lib/types';

export async function verifyOutput(root: string, output: string, mode: BuildMode) {
  const actual = JSON.parse(await readFile(path.join(output, 'generated/passages.json'), 'utf8')) as SearchPassage[];
  const expected = flattenArchive(loadArchive(root), mode);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Built index differs from publication-filtered source');
  const vectors = JSON.parse(await readFile(path.join(output, 'generated/vectors.json'), 'utf8'));
  if (JSON.stringify(Object.keys(vectors.vectors).sort()) !== JSON.stringify(expected.map((p) => p.id).sort())) throw new Error('Vector index passage IDs differ from published index');
  if (mode === 'production' && actual.some((p) => p.preview)) throw new Error('Unreviewed passage in production');
  const forbiddenNames = /(?:^|\/)(?:\.env[^/]*|\.local|\.git|corpus|services\/\d{4}|media-authorization\.json|evidence\.(?:txt|json)|ggml-[^/]+|[^/]+\.(?:mp4|mkv|wav|mp3|webm|part))$/;
  async function inspect(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(output, full).split(path.sep).join('/');
      if (entry.isSymbolicLink() || forbiddenNames.test(relative)) throw new Error(`Private/media artifact in output: ${relative}`);
      if (entry.isDirectory()) await inspect(full);
      else if ((await stat(full)).size >= 100 * 1024 * 1024) throw new Error(`Static-host file-size limit exceeded: ${relative}`);
    }
  }
  await inspect(output);
  console.log(`${mode} output verified: ${actual.length} eligible passages; no private media; all files under 100 MiB.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  if (mode !== 'production' && mode !== 'preview') throw new Error('Usage: verify-output.ts production | preview');
  await verifyOutput(process.cwd(), path.resolve('dist', mode), mode);
}
