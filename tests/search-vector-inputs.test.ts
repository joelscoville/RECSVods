import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chapterArtifacts } from '../scripts/archive';
import { createEmbeddingSession } from '../scripts/embeddings';
import { unitText } from '../scripts/search-vectors';
import { source, writeArchive } from './recording-fixtures';

// Keep the real projection, BSB enrichment, windowing, cache and codec. Replace only
// model inference so we can inspect exactly what the tokenizer receives, offline.
vi.mock('../scripts/embeddings', async importOriginal => ({
  ...await importOriginal<typeof import('../scripts/embeddings')>(),
  createEmbeddingSession: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.resetAllMocks(); });

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'recs-vector-inputs-')); roots.push(root);
  const tokenize = vi.fn((text: string) => Array.from(text, character => character.codePointAt(0)!));
  const dispose = vi.fn(async () => {});
  vi.mocked(createEmbeddingSession).mockResolvedValue({
    tokenize, dispose,
    embedTokenIds: async ids => Array.from({ length: 384 }, (_, index) => index === ids.reduce((sum, id) => sum + id, 0) % 384 ? 1 : 0),
    embedText: vi.fn(),
  });
  return { root, tokenize, dispose };
}

describe('recording YAML is the only archive input to embeddings', () => {
  it('embeds published titles, description, point summaries, parts, topics and cited BSB; never transcripts or markers', async () => {
    const { root, tokenize, dispose } = fixture();
    const recording = source({ markers: [{ markerTime: '0:01', markerNote: 'PRIVATE_REVIEW_MARKER' }] });
    writeArchive(root, { '2026-09-06': recording });
    mkdirSync(path.join(root, 'transcripts'));
    writeFileSync(path.join(root, 'transcripts/2026-09-06.yaml'), 'broken: [PRIVATE_TRANSCRIPT_DO_NOT_EMBED');
    const built = await chapterArtifacts(root, 'production');
    const texts = tokenize.mock.calls.map(([text]) => text);
    expect(texts).toEqual(built.metadata.units.map(unit => unitText(unit, built.scripture)));
    expect(texts[0]).toContain(recording.recordingTitle);
    expect(texts[0]).toContain(recording.sermonDescription);
    expect(texts[0]).toContain('Service'); // Display name from taxonomy/topics.yaml.
    expect(texts[0]).toContain('Romans 12:9-13');
    expect(texts[0]).toContain(built.scripture.verses['Romans 12:9']);
    expect(texts).toContain('Holy Communion');
    expect(texts.some(text => text.includes(recording.chapters[2].points![0].pointText))).toBe(true);
    expect(texts.join('\n')).not.toMatch(/PRIVATE_REVIEW_MARKER|PRIVATE_TRANSCRIPT_DO_NOT_EMBED/);
    expect(JSON.stringify(built.metadata)).not.toMatch(/markers|transcript/);
    expect(dispose).toHaveBeenCalledOnce();

    // Even changing both evidence and review notes leaves public bytes and cached rows unchanged.
    writeFileSync(path.join(root, 'transcripts/2026-09-06.yaml'), 'transcript: Entirely different evidence');
    writeArchive(root, { '2026-09-06': { ...recording, markers: [{ markerTime: '0:02', markerNote: 'A different review note' }] } });
    const again = await chapterArtifacts(root, 'production');
    expect(again.files).toEqual(built.files);
    expect(createEmbeddingSession).toHaveBeenCalledOnce();
  });

  it('automatically re-embeds an edited YAML summary, while reusing every unchanged unit', async () => {
    const { root, tokenize } = fixture(), recording = source();
    writeArchive(root, { '2026-09-06': recording });
    const before = await chapterArtifacts(root, 'production');
    tokenize.mockClear();
    const summary = 'The preacher asks the congregation to practise hospitality with strangers, giving their time and attention to people who are easily overlooked.';
    writeArchive(root, { '2026-09-06': { ...recording, chapters: recording.chapters.map(chapter => chapter.chapterKind === 'sermon'
      ? { ...chapter, points: chapter.points!.map((point, index) => index === 1 ? { ...point, pointText: summary } : point) } : chapter) } });
    const after = await chapterArtifacts(root, 'production');
    expect(tokenize).toHaveBeenCalledOnce();
    expect(tokenize.mock.calls[0][0]).toContain(summary);
    expect(after.metadata.units.find(unit => unit.id.endsWith('sermon/point-2'))?.text).toBe(summary);
    expect(after.metadata.vectors.sha256).not.toBe(before.metadata.vectors.sha256);
  });

  it('does not embed excluded drafts, but embeds their public fields for preview', async () => {
    const { root, tokenize } = fixture();
    writeArchive(root, { '2026-09-06': source({ status: 'draft' }) });
    expect((await chapterArtifacts(root, 'production')).metadata.units).toEqual([]);
    expect(createEmbeddingSession).not.toHaveBeenCalled();
    const preview = await chapterArtifacts(root, 'preview');
    expect(tokenize).toHaveBeenCalledTimes(preview.metadata.units.length);
    expect(preview.metadata.units.every(unit => unit.preview)).toBe(true);
  });
});
