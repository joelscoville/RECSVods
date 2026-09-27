import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESERVATION_FILE, verifyPreserved } from '../site/lib/preservation';
import { isTitleCase } from '../site/lib/outline';
import { assertInternalHistory } from '../site/lib/internal-validation';

describe('self-contained preservation', () => {
  it('verifies the current frozen evidence in a source export with no Git history', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'recs-preserved-export-'));
    try {
      const files = verifyPreserved();
      expect(files.size).toBe(44);
      for (const filename of [PRESERVATION_FILE, ...files]) {
        mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
        cpSync(filename, path.join(root, filename));
      }
      expect(verifyPreserved(root)).toEqual(files);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('detects altered bytes, deletion and seal rewrites', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'recs-preserved-test-'));
    try {
      const filename = 'services/2026/fixture/passages.internal.yaml';
      mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
      const bytes = 'Original fictional evidence.\n';
      writeFileSync(path.join(root, filename), bytes);
      const seal = JSON.stringify({ schemaVersion: 1, files: { [filename]: createHash('sha256').update(bytes).digest('hex') } });
      writeFileSync(path.join(root, PRESERVATION_FILE), seal);
      expect(verifyPreserved(root).has(filename)).toBe(true);
      writeFileSync(path.join(root, filename), bytes.trim());
      expect(() => verifyPreserved(root)).toThrow('preserved file changed');
      rmSync(path.join(root, filename)); expect(() => verifyPreserved(root)).toThrow();
      expect(() => assertInternalHistory(new Map([[PRESERVATION_FILE, seal]]), new Map())).toThrow('seal');
      expect(() => assertInternalHistory(new Map([[PRESERVATION_FILE, seal]]), new Map([[PRESERVATION_FILE, '{}']]))).toThrow('seal');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
it('keeps the current Title Case rule independent of one-time scripts', () => {
  for (const title of ['Opening', 'Worship and Scripture', 'Serving God through Faith']) expect(isTitleCase(title)).toBe(true);
  for (const title of ['', 'opening', 'Worship and scripture']) expect(isTitleCase(title)).toBe(false);
});
