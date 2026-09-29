import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from './service-fixtures';
import { describe, expect, it } from 'vitest';
import { enrichPassages, verseTextForReferences } from '../bible/enrich';
import { generateBibleCounts, loadBible, verifyBibleSource } from '../scripts/bible';
import { buildIndex } from '../scripts/archive';
import { archiveFromFiles, flattenChapters, ChapterSourceSchema, SOURCE_CHANNEL_ID } from '../site/lib/archive';
import { packChapterVectors } from '../site/lib/chapter-vectors';
import { createChapterVectorManifest } from '../scripts/chapter-vectors';

const bible = loadBible();

// Entirely synthetic archive metadata, never written into the project archive.
const service = {
  id: 'bible-fixture', date: '2026-01-04', title: 'Synthetic fixture gathering', type: 'service',
  workflow_status: 'complete', editorial_status: 'needs_review',
  videos: [{ id: 'AAAAAAAAAAA', channel_id: SOURCE_CHANNEL_ID, duration: 100, sequence: 1, workflow_status: 'complete', media_disposition: 'playable' }],
  chapters: [{ id: 'bible-chapter', video_id: 'AAAAAAAAAAA', start: 0, end: 100,
    type: 'address', title: 'Synthetic address', summary: 'A synthetic test summary.',
    keywords: [], topics: [], scripture: ['Rom. 12:1', 'II Tim 3:16'] }],
};
const filename = 'services/2026/bible-fixture/service.yaml';
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
  it('normalizes the loader, preserves aligned originals, and keeps BSB out of display projections', () => {
    const archive = archiveFromFiles(new Map([[filename, stringify(service)]]));
    expect(archive[0].chapters[0].scripture).toEqual(['Romans 12:1', '2 Timothy 3:16']);
    const display = flattenChapters(archive, 'preview');
    expect(display[0].scriptureDisplay).toEqual(service.chapters[0].scripture);
    expect(display[0]).not.toHaveProperty('verseText');
    const enriched = enrichPassages(display, bible);
    expect(enriched[0].verseText).toBe([bible.Romans[11][0], bible['2 Timothy'][2][15]].join('\n'));
    const { verseText: _verseText, ...unchanged } = enriched[0];
    expect(unchanged).toEqual(display[0]);
    expect(display[0]).not.toHaveProperty('verseText');
    expect(ChapterSourceSchema.safeParse({ ...archive[0].chapters[0], scriptureDisplay: ['Romans 1'] }).success).toBe(false);
    expect(enrichPassages([{ ...display[0], scripture: [], verseText: 'stale' }], bible)[0]).not.toHaveProperty('verseText');
  });
  it('adds BSB only after publication filtering and produces deterministic generated JSON', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'recs-bible-test-'));
    try {
      mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
      writeFileSync(path.join(root, filename), stringify(service));
      const binary = packChapterVectors([new Int8Array(384)]);
      writeFileSync(path.join(root, path.dirname(filename), 'chapter-vectors.bin'), binary);
      writeFileSync(path.join(root, path.dirname(filename), 'chapter-vectors.json'), JSON.stringify(createChapterVectorManifest(binary,
        service.chapters.map(({ id, video_id, start, end }) => ({ id, video_id, start, end, windows: 0, has_text: false,
          input_sha256: 'a'.repeat(64), source_kind: 'none' as const })))));
      expect(JSON.parse(readFileSync(buildIndex(root), 'utf8')).chapters).toEqual([]);
      const first = readFileSync(buildIndex(root, 'preview'), 'utf8');
      expect(JSON.parse(first).chapters[0]).not.toHaveProperty('verseText');
      const scripture = JSON.parse(readFileSync(path.join(root, 'site/public/generated/scripture.json'), 'utf8'));
      expect(scripture.verses['Romans 12:1']).toBe(bible.Romans[11][0]);
      expect(readFileSync(buildIndex(root, 'preview'), 'utf8')).toBe(first);
      expect(JSON.parse(readFileSync(buildIndex(root), 'utf8')).chapters).toEqual([]);
      expect(JSON.parse(readFileSync(path.join(root, 'site/public/generated/scripture.json'), 'utf8')).verses).toEqual({});
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
