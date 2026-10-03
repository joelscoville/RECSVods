import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verseTextForReferences } from '../bible/enrich';
import { generateBibleCounts, loadBible, verifyBibleSource } from '../scripts/bible';
import { buildIndex } from '../scripts/archive';
import { buildScriptureIndex } from '../bible/chapter-index';
import { enrichUnits } from '../site/lib/chapter-index';
import { searchUnits } from '../site/lib/display';
import { display, fakeRows, source, stored, writeArchive } from './recording-fixtures';

const bible = loadBible();

// Entirely synthetic archive metadata, never written into the project archive.
const draft = source({ status: 'draft', sermonScripture: ['Rom. 12:1', 'II Tim 3:16'] });
describe('offline BSB enrichment boundary', () => {
  it('verifies pinned bytes, reproducible verse counts and complete source structure', () => {
    expect(() => generateBibleCounts(true)).not.toThrow();
    expect(Object.keys(bible)).toHaveLength(66);
    expect(Object.values(bible).reduce((sum, chapters) => sum + chapters.length, 0)).toBe(1189);
    expect(Object.values(bible).flat().reduce((sum, verses) => sum + verses.length, 0)).toBe(31102);
    expect(() => verifyBibleSource(Buffer.from('not the pinned source'))).toThrow('integrity');
  });
  it('selects actual sourced verses, expands chapters/ranges and deduplicates overlap', () => {
    expect(verseTextForReferences(['Rom12:1'], bible)).toBe(bible.Romans[11][0]);
    expect(bible.Romans[11][0]).toContain('living sacrifices');
    expect(verseTextForReferences(['John 3:36-4:2'], bible)).toBe([bible.John[2][35], ...bible.John[3].slice(0, 2)].join('\n'));
    expect(verseTextForReferences(['Rom12', 'Romans 12:1'], bible)).toBe(bible.Romans[11].join('\n'));
    expect(verseTextForReferences(['Gen1-2'], bible)).toBe(bible.Genesis.slice(0, 2).flat().join('\n'));
    expect(verseTextForReferences(['Matthew 17:21'], bible)).toBe('');
    expect(() => verseTextForReferences(['Romans 12:1'], {})).toThrow('Missing BSB chapter');
  });
  it('normalizes references, keeps the written form for display, and keeps BSB out of the published units', () => {
    const [recording] = display([stored(draft)]);
    expect(recording.scripture).toEqual(['Romans 12:1', '2 Timothy 3:16']);
    expect(recording.scriptureDisplay).toEqual(['Rom. 12:1', 'II Tim 3:16']);
    const [unit] = searchUnits([recording]);
    expect(unit).not.toHaveProperty('verseText');
    const [enriched] = enrichUnits([unit], buildScriptureIndex([unit]));
    expect(enriched.verseText).toBe([bible.Romans[11][0], bible['2 Timothy'][2][15]].join('\n'));
    const { verseText: _verseText, ...unchanged } = enriched;
    expect(unchanged).toEqual(unit);
  });
  it('adds BSB only after publication filtering and produces deterministic generated JSON', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'recs-bible-test-'));
    try {
      writeArchive(root, { '2026-09-06': draft });
      const read = async (mode: 'production' | 'preview') => readFileSync(await buildIndex(root, mode, fakeRows), 'utf8');
      expect(JSON.parse(await read('production')).units).toEqual([]);
      const first = await read('preview');
      expect(JSON.parse(first).units[0]).not.toHaveProperty('verseText');
      const scripture = JSON.parse(readFileSync(path.join(root, 'site/public/generated/scripture.json'), 'utf8'));
      expect(scripture.verses['Romans 12:1']).toBe(bible.Romans[11][0]);
      expect(await read('preview')).toBe(first);
      expect(JSON.parse(await read('production')).units).toEqual([]);
      expect(JSON.parse(readFileSync(path.join(root, 'site/public/generated/scripture.json'), 'utf8')).verses).toEqual({});
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
