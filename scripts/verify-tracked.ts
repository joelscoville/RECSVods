/** Refuses media, caches, credentials and stray files in the repository: services/ holds only the
 * recording files, and nothing binary is committed. */
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const forbidden = /(?:^|\/)(?:\.env(?:\..+)?|\.local|node_modules|cookies?(?:\..+)?|media-authorization\.json|[^/]+\.(?:mp4|mkv|webm|mp3|wav|m4a|ogg|opus|flac|json3|vtt|srt|ttml|onnx|gguf|part|bin))$/i;
const secret = /-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}/;
export function checkTrackedFile(filename: string, data: Buffer): void {
  if (forbidden.test(filename) || /^(?:\.local|node_modules|site\/public\/(?:generated|models|onnx))\//.test(filename)) throw new Error(`Private/media/cache file tracked: ${filename}`);
  if (filename.startsWith('services/') && !/^services\/\d{4}-\d{2}-\d{2}(?:-\d+)?\.yaml$/.test(filename)) throw new Error(`Only recording files belong in services/: ${filename}`);
  if (secret.test(data.toString('utf8'))) throw new Error(`Credential material detected: ${filename}`);
}
export function verifyTracked(root = process.cwd()) {
  const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
  let checked = 0;
  for (const filename of files) {
    const stat = lstatSync(path.join(root, filename), { throwIfNoEntry: false });
    if (!stat) continue; // A working-tree deletion has no bytes to publish.
    if (stat.isSymbolicLink()) throw new Error(`Tracked symlink requires review: ${filename}`);
    checkTrackedFile(filename, readFileSync(path.join(root, filename)));
    checked++;
  }
  return { repositoryFilesChecked: checked };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(verifyTracked()));
