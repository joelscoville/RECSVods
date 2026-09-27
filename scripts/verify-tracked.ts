import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeChapterVectors } from '../site/lib/chapter-vectors';
import { PRESERVATION_FILE, verifyPreserved } from '../site/lib/preservation';

const forbidden = /(?:^|\/)(?:\.env(?:\..+)?|\.local|node_modules|cookies?(?:\..+)?|media-authorization\.json|[^/]+\.(?:mp4|mkv|webm|mp3|wav|m4a|ogg|opus|flac|json3|vtt|srt|ttml|onnx|gguf|part))$/i;
const secret = /-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}/;
export function checkTrackedFile(filename: string, data: Buffer, preservedFiles: ReadonlySet<string> = new Set()): void {
  if (forbidden.test(filename) || /^(?:\.local|node_modules|site\/public\/(?:generated|models|onnx))\//.test(filename)) throw new Error(`Private/media/cache file tracked: ${filename}`);
  if ((filename.endsWith('.internal.yaml') || /(?:^|\/)(?:[^/]*\.)?(?:evidence|transcripts?)\.json$/.test(filename)) && !preservedFiles.has(filename)) throw new Error(`New transcript/evidence archives must stay private: ${filename}`);
  if (filename.startsWith('services/') && filename !== PRESERVATION_FILE && !preservedFiles.has(filename)
    && !/\/(?:service\.yaml|chapter-vectors\.(?:json|bin)|legacy-chapters\.json|review\.md)$/.test(filename)) throw new Error(`Unexpected service-side evidence file: ${filename}`);
  if (filename.endsWith('.bin')) {
    if (!/^services\/\d{4}\/[^/]+\/chapter-vectors\.bin$/.test(filename)) throw new Error(`Unexpected tracked binary: ${filename}`);
    decodeChapterVectors(data);
  } else if (secret.test(data.toString('utf8'))) throw new Error(`Credential material detected: ${filename}`);
}
export function verifyTracked(root = process.cwd()) {
  const preservedFiles = verifyPreserved(root);
  const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
  let checked = 0;
  for (const filename of files) {
    const absolute = path.join(root, filename);
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) continue; // A working-tree deletion has no bytes to publish; the seal above protects evidence.
    if (stat.isSymbolicLink()) throw new Error(`Tracked symlink requires review: ${filename}`);
    checkTrackedFile(filename, readFileSync(absolute), preservedFiles);
    checked++;
  }
  return { repositoryFilesChecked: checked };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(verifyTracked()));
