import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from './archive';
import { prepare } from './embeddings';
import { verifyOutput } from './verify-output';

const command = process.argv[2];
if (!['production', 'preview', 'dev'].includes(command)) throw new Error('Usage: build.ts production | preview | dev');
const mode = command === 'production' ? 'production' : 'preview';
const root = process.cwd();
// buildIndex always recreates generated and copies only committed, eligible int8 rows.
const metadataFile = buildIndex(root, mode);
const metadata = JSON.parse(await readFile(metadataFile, 'utf8'));
// Query inference still needs pinned self-hosted weights. Never infer chapter vectors here.
if (metadata.chapters.length) await prepare(root);
const child = spawn('pnpm', ['exec', 'astro', command === 'dev' ? 'dev' : 'build', ...process.argv.slice(3)], {
  stdio: 'inherit', env: { ...process.env, ARCHIVE_MODE: mode },
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => child.kill(signal));
const code = await new Promise<number>((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (status) => resolve(status ?? 1));
});
if (code) process.exit(code);
if (command !== 'dev') {
  const output = path.join(root, 'dist', mode);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'build-mode.json'), `${JSON.stringify({ mode, base: process.env.SITE_BASE_PATH || '/' })}\n`);
  await verifyOutput(root, output, mode);
}
