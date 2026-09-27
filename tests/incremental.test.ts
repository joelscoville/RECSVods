import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildIndex, CHAPTER_ARTIFACTS, artifactFilename } from '../scripts/archive';
import { createChapterVectorManifest } from '../scripts/chapter-vectors';
import { packChapterVectors, decodeChapterVectors } from '../site/lib/chapter-vectors';
import { SOURCE_CHANNEL_ID, type Service } from '../site/lib/archive';

// Chapter processing/cache tests live in chapter-vectors.test.ts. Builds now copy
// committed rows, so incremental acceptance compares their output to a clean build.
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.unstubAllGlobals(); });
function root() { const value = mkdtempSync(path.join(tmpdir(), 'recs-chapter-rebuild-')); roots.push(value); return value; }
function service(id: string, videoId: string): Service {
  return { id, date: '2026-01-04', title: 'Fixture service', type: 'service', workflow_status: 'complete',
    editorial_status: 'needs_review', speakers: [], topics: [], review_notes: [],
    videos: [{ id: videoId, channel_id: SOURCE_CHANNEL_ID, duration: 120, sequence: 1, workflow_status: 'complete', media_disposition: 'playable' }],
    chapters: [{ id: `${id}-chapter`, video_id: videoId, start: 0, end: 60, title: 'Fixture chapter', type: 'sermon',
      summary: 'A fixture summary.', keywords: ['hope'], topics: [], scripture: [], review_notes: [] }],
  };
}
function put(root: string, item: Service, axis: number) {
  const directory = path.join(root, 'services/2026', item.id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'service.yaml'), stringify(item));
  const row = new Int8Array(384); row[axis] = 127;
  const bytes = packChapterVectors([row]);
  writeFileSync(path.join(directory, 'chapter-vectors.bin'), bytes);
  writeFileSync(path.join(directory, 'chapter-vectors.json'), JSON.stringify(createChapterVectorManifest(bytes,
    item.chapters.map(({ id, video_id, start, end }) => ({ id, video_id, start, end, windows: 1, has_text: true,
      input_sha256: 'a'.repeat(64), source_kind: 'raw_colab_json' as const })))));
}
function artifacts(root: string) {
  const directory = path.join(root, 'site/public/generated');
  const metadata = JSON.parse(readFileSync(path.join(directory, 'chapters.json'), 'utf8'));
  return Object.fromEntries(CHAPTER_ARTIFACTS.flatMap(name => ['', '.gz'].map(suffix =>
    [name + suffix, readFileSync(path.join(directory, artifactFilename(name, metadata) + suffix))])));
}
describe('committed chapter incremental/full build equivalence', () => {
  it('matches a clean rebuild after metadata and vector updates, without model or transcript inputs', () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No inference/network in chapter builds'); }));
    const incremental = root(), clean = root();
    const a = service('a', 'AAAAAAAAAAA'), b = service('b', 'BBBBBBBBBBB');
    put(incremental, a, 0); put(incremental, b, 1);
    buildIndex(incremental, 'preview');
    const original = artifacts(incremental);
    a.chapters[0].summary = 'Changed public summary; vector still derives from private speech.';
    // A metadata-only edit does not require re-embedding the chapter.
    writeFileSync(path.join(incremental, 'services/2026/a/service.yaml'), stringify(a));
    buildIndex(incremental, 'preview');
    expect(artifacts(incremental)['vectors.bin']).toEqual(original['vectors.bin']);
    put(incremental, b, 2);
    buildIndex(incremental, 'preview');
    put(clean, a, 0); put(clean, b, 2); buildIndex(clean, 'preview');
    expect(artifacts(incremental)).toEqual(artifacts(clean));
    const vector = decodeChapterVectors(artifacts(incremental)['vectors.bin']);
    expect(vector.values[0]).toBe(127); expect(vector.values[384 + 2]).toBe(127);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('drops removed services and stale preview output identically to a fresh mode-filtered build', () => {
    const incremental = root(), clean = root();
    const a = service('a', 'AAAAAAAAAAA'), b = service('b', 'BBBBBBBBBBB');
    put(incremental, a, 0); put(incremental, b, 1); buildIndex(incremental, 'preview');
    rmSync(path.join(incremental, 'services/2026/b'), { recursive: true });
    put(clean, a, 0);
    for (const mode of ['preview', 'production'] as const) {
      buildIndex(incremental, mode); buildIndex(clean, mode);
      expect(artifacts(incremental)).toEqual(artifacts(clean));
      expect(decodeChapterVectors(artifacts(incremental)['vectors.bin']).rowCount).toBe(mode === 'preview' ? 1 : 0);
    }
  });
});
