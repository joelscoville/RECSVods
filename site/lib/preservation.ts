/** Permanent preservation is self-contained; no historical Git object is required. */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const PRESERVATION_FILE = 'services/preserved-files.json';
const preservedPath = z.string().refine(filename => /^services\/\d{4}\/[A-Za-z0-9][A-Za-z0-9_-]*\/(?:[A-Za-z0-9_-]+\/)*(?:[A-Za-z0-9_-]+\.md|(?:chapters|passages)\.internal\.yaml)$/.test(filename));
const Manifest = z.object({ schemaVersion: z.literal(1), files: z.record(preservedPath, z.string().regex(/^[a-f0-9]{64}$/)) }).strict();
export function verifyPreserved(root = process.cwd()): ReadonlySet<string> {
  const absoluteRoot = realpathSync(root);
  const seal = path.join(absoluteRoot, PRESERVATION_FILE);
  if (realpathSync(seal) !== seal) throw new Error('Preservation seal must not be redirected');
  const manifest = Manifest.parse(JSON.parse(readFileSync(seal, 'utf8')));
  for (const [filename, hash] of Object.entries(manifest.files)) {
    const absolute = path.join(absoluteRoot, filename);
    if (realpathSync(absolute) !== absolute || createHash('sha256').update(readFileSync(absolute)).digest('hex') !== hash) {
      throw new Error(`${filename}: preserved file changed or redirected`);
    }
  }
  return new Set(Object.keys(manifest.files));
}
