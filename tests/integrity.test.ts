import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { artifactSha256 } from '../site/lib/integrity';
import { loadChapterVectors } from '../site/lib/chapter-index';
import { CHAPTER_VECTOR_CONFIG, packChapterVectors } from '../site/lib/chapter-vectors';

afterEach(() => vi.unstubAllGlobals());
describe('artifact checksums outside secure contexts', () => {
  it.each([undefined, {}])('verifies bytes when crypto.subtle is unavailable (%s)', async crypto => {
    vi.stubGlobal('crypto', crypto);
    for (const bytes of [new Uint8Array(), new TextEncoder().encode('abc'), Uint8Array.from({ length: 8193 }, (_, i) => i % 256)]) {
      expect(await artifactSha256(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });
  it('still refuses corrupt vectors on an HTTP preview', async () => {
    vi.stubGlobal('crypto', {}); vi.stubGlobal('DecompressionStream', undefined);
    const bytes = packChapterVectors([]), sha256 = createHash('sha256').update(bytes).digest('hex');
    const metadata = { schemaVersion: 3 as const, model: CHAPTER_VECTOR_CONFIG, chapters: [], vectors: { file: `vectors.${sha256}.bin`, sha256 } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes))));
    expect((await loadChapterVectors('/', metadata)).rowCount).toBe(0);
    const corrupt = bytes.slice(); corrupt[0] ^= 1;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(corrupt)));
    await expect(loadChapterVectors('/', metadata)).rejects.toThrow('checksum mismatch');
  });
});
