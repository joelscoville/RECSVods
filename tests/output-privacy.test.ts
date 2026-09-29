import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { stringify } from './service-fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { buildIndex } from '../scripts/archive';
import { createChapterVectorManifest } from '../scripts/chapter-vectors';
import { verifyOutput } from '../scripts/verify-output';
import { packChapterVectors } from '../site/lib/chapter-vectors';
import { SOURCE_CHANNEL_ID } from '../site/lib/archive';

const roots: string[] = [];
// Deliberately meaningful prose, rather than a tiny sentinel that could also be a legitimate keyword.
const privateText = 'Behind the orchard our fictional narrator quietly described thirteen extraordinary lanterns illuminating the abandoned observatory throughout the evening.';
function put(root: string, filename: string, data: string | Uint8Array) {
  const full = path.join(root, filename); mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, data);
}
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'recs-output-privacy-')); roots.push(root);
  const chapter = { id: 'fixture-chapter', video_id: 'AAAAAAAAAAA', start: 0, end: 90, type: 'worship',
    title: 'A passage of scripture', summary: 'Introducing the reading.', keywords: ['extraordinary lanterns'],
    scripture: ['Acts 8:32'], topics: [] };
  const service = { id: 'fixture', date: '2026-01-04', title: 'Fixture service', type: 'service',
    workflow_status: 'complete', editorial_status: 'reviewed', reviewed_by: 'Fixture Reviewer', reviewed_at: '2026-01-05T00:00:00Z',
    videos: [{ id: 'AAAAAAAAAAA', duration: 120, sequence: 1, channel_id: SOURCE_CHANNEL_ID,
      workflow_status: 'complete', media_disposition: 'playable' }], chapters: [chapter] };
  const directory = 'services/2026/fixture';
  put(root, `${directory}/service.yaml`, stringify(service));
  const binary = packChapterVectors([new Int8Array(384).fill(127)]);
  const manifest = createChapterVectorManifest(binary, [{ id: chapter.id, video_id: chapter.video_id, start: 0, end: 90,
    windows: 1, has_text: true, input_sha256: 'a'.repeat(64), source_kind: 'legacy_passages' }]);
  put(root, `${directory}/chapter-vectors.bin`, binary);
  put(root, `${directory}/chapter-vectors.json`, JSON.stringify(manifest));
  put(root, `${directory}/legacy-chapters.json`, '{"fixture-p001":"fixture-chapter"}');
  buildIndex(root);
  const output = path.join(root, 'site/public');
  return { root, output, directory };
}
function artifact(output: string, name: string, value: unknown) {
  const raw = Buffer.from(JSON.stringify(value));
  put(output, `generated/${name}`, raw); put(output, `generated/${name}.gz`, gzipSync(raw));
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('strict public chapter privacy boundary', () => {
  it('verifies source-only fixtures with no private ASR or internals available', async () => {
    const { root, output } = fixture();
    await expect(verifyOutput(root, output, 'production')).resolves.toEqual({ chapters: 1, privateShingles: 0 });
  });

  it('permits short spoken keywords, the word passage, exact BSB, and ID-only compatibility data', async () => {
    const { root, output, directory } = fixture();
    const scripture = JSON.parse(readFileSync(path.join(output, 'generated/scripture.json'), 'utf8'));
    put(root, `${directory}/passages.internal.yaml`, stringify({ passages: [
      { id: 'fixture-p001', transcript: privateText },
      { id: 'bible-quotation', transcript: scripture.verses['Acts 8:32'] },
    ] }));
    put(output, 'index.html', '<h1>A passage of scripture</h1><p>extraordinary lanterns</p><a href="/watch/?chapter=fixture-chapter">Watch</a>');
    await expect(verifyOutput(root, output, 'production')).resolves.toMatchObject({ chapters: 1 });
  });

  it.each(['transcript', 'questions', 'confidence', 'review_notes', 'verseText', 'rawBody', 'audio_sha256', 'passages'])('rejects injected metadata field %s', async (field) => {
    const { root, output } = fixture();
    const index = JSON.parse(readFileSync(path.join(output, 'generated/chapters.json'), 'utf8'));
    index.chapters[0][field] = 'Private value'; artifact(output, 'chapters.json', index);
    await expect(verifyOutput(root, output, 'production')).rejects.toThrow();
  });

  it.each(['index.html', 'extra.json', '_astro/leak.js', 'notes.txt.gz'])('detects meaningful private transcript text in %s', async (filename) => {
    const { root, output, directory } = fixture();
    put(root, `${directory}/passages.internal.yaml`, stringify({ passages: [{ id: 'fixture-p001', transcript: privateText }] }));
    const content = filename.endsWith('.json') ? JSON.stringify({ innocuousTitle: privateText }) : `<p>${privateText}</p>`;
    put(output, filename, filename.endsWith('.gz') ? gzipSync(content) : content);
    await expect(verifyOutput(root, output, 'production')).rejects.toThrow('Private transcript shingle');
  });

  it('detects transcripts hidden under innocent metadata keys even if copied back to source', async () => {
    const { root, output, directory } = fixture();
    put(root, `${directory}/passages.internal.yaml`, stringify([{ transcript: privateText }]));
    const { parse } = await import('yaml');
    const source = parse(readFileSync(path.join(root, directory, 'service.yaml'), 'utf8'));
    source.chapters[0].summary = privateText;
    put(root, `${directory}/service.yaml`, stringify(source));
    buildIndex(root); // Build uses only metadata and committed rows; privacy checking is separate.
    await expect(verifyOutput(root, output, 'production')).rejects.toThrow('Private transcript shingle');
  });

  it('does not read even malformed internals during artifact generation', () => {
    const { root, directory } = fixture();
    put(root, `${directory}/passages.internal.yaml`, 'malformed: [private unclosed yaml');
    expect(() => buildIndex(root)).not.toThrow();
  });

  it.each(['passages.json', 'vectors.json', 'passages.internal.yaml', 'services/2026/copied/service.yaml', '.local/private.json'])('rejects private or old output file %s', async (filename) => {
    const { root, output } = fixture(); put(output, filename, '{}');
    await expect(verifyOutput(root, output, 'production')).rejects.toThrow('Private/media artifact');
  });

  it('rejects altered BSB instead of granting arbitrary text a Bible exemption', async () => {
    const { root, output } = fixture();
    const index = JSON.parse(readFileSync(path.join(output, 'generated/scripture.json'), 'utf8'));
    index.verses['Acts 8:32'] = privateText; artifact(output, 'scripture.json', index);
    await expect(verifyOutput(root, output, 'production')).rejects.toThrow('BSB index differs from pinned source');
  });

  it('rejects compatibility content objects and new HTML legacy links', async () => {
    const { root, output } = fixture();
    artifact(output, 'legacy-chapters.json', { 'fixture-p001': { chapter: 'fixture-chapter', start: 0, summary: 'Private' } });
    await expect(verifyOutput(root, output, 'production')).rejects.toThrow();
    artifact(output, 'legacy-chapters.json', { 'fixture-p001': 'fixture-chapter' });
    put(output, 'index.html', '<a href="/watch/?id=fixture-p001">Old link</a>');
    await expect(verifyOutput(root, output, 'production')).rejects.toThrow('Current HTML links to legacy unit');
  });

  it('rejects private structured fields elsewhere in HTML/JSON without banning ordinary English', async () => {
    const { root, output } = fixture();
    put(output, 'index.html', '<script type="application/json">{"rawBody":"private evidence"}</script>');
    await expect(verifyOutput(root, output, 'production')).rejects.toThrow('Private field');
  });

  it('allows only computed vendor confidence while still scanning the entire worker for private data', async () => {
    const { root, output, directory } = fixture();
    const filename = '_astro/semantic.worker-fixture.js';
    const vendor = 'function score(a,b,c){return {confidence:a/(b-c)}}';
    put(output, filename, vendor);
    await expect(verifyOutput(root, output, 'production')).resolves.toMatchObject({ chapters: 1 });
    for (const data of ['{confidence:0.7}', '{"confidence":0.7}', '{rawBody:"private"}']) {
      put(output, filename, `${vendor};const leaked=${data}`);
      await expect(verifyOutput(root, output, 'production')).rejects.toThrow('Private field');
    }
    put(root, `${directory}/passages.internal.yaml`, stringify([{ transcript: privateText }]));
    put(output, filename, `${vendor};const leaked=${JSON.stringify(privateText)}`);
    await expect(verifyOutput(root, output, 'production')).rejects.toThrow('Private transcript shingle');
  });

  it('rejects raw provenance hashes even when leaked without their original field name', async () => {
    const { root, output } = fixture();
    put(output, 'index.html', `<span data-debug="${'a'.repeat(64)}">Debug</span>`);
    await expect(verifyOutput(root, output, 'production')).rejects.toThrow('Private provenance hash');
  });

  it('checks exact binary row correspondence and every compressed companion', async () => {
    const { root, output } = fixture();
    const metadata = JSON.parse(readFileSync(path.join(output, 'generated/chapters.json'), 'utf8'));
    put(output, `generated/${metadata.vectors.file}`, packChapterVectors([new Int8Array(384).fill(63)]));
    await expect(verifyOutput(root, output, 'production')).rejects.toThrow('Binary vectors differ');
    buildIndex(root);
    put(output, 'generated/chapters.json.gz', gzipSync('{}'));
    await expect(verifyOutput(root, output, 'production')).rejects.toThrow('Gzip companion differs');
  });
});
