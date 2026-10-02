import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { buildIndex } from '../scripts/archive';
import { verifyOutput } from '../scripts/verify-output';
import { packChapterVectors } from '../site/lib/chapter-vectors';
import type { RecordingSource } from '../site/lib/recording-schema';
import { fakeRows, source, writeArchive } from './recording-fixtures';

const roots: string[] = [];
// Deliberately meaningful prose, rather than a tiny sentinel that could also be a legitimate keyword.
const privateText = 'Behind the orchard our fictional narrator quietly described thirteen extraordinary lanterns illuminating the abandoned observatory throughout the evening.';
function put(root: string, filename: string, data: string | Uint8Array) {
  const full = path.join(root, filename); mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, data);
}
function fixture(overrides: Partial<RecordingSource> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'recs-output-privacy-')); roots.push(root);
  writeArchive(root, { '2026-09-06': source({ sermonScripture: ['Acts 8:32'], ...overrides }) });
  return { root, output: path.join(root, 'site/public') };
}
async function built(overrides: Partial<RecordingSource> = {}) {
  const value = fixture(overrides);
  await buildIndex(value.root, 'production', fakeRows);
  return value;
}
const verify = (root: string, output: string) => verifyOutput(root, output, 'production', { rows: fakeRows });
const transcript = (root: string, value: unknown) => put(root, 'transcripts/2026-09-06.yaml', stringify(value));
function artifact(output: string, name: string, value: unknown) {
  const raw = Buffer.from(JSON.stringify(value));
  put(output, `generated/${name}`, raw); put(output, `generated/${name}.gz`, gzipSync(raw));
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('strict public search privacy boundary', () => {
  it('verifies an archive with no transcripts available', async () => {
    const { root, output } = await built();
    await expect(verify(root, output)).resolves.toEqual({ units: 10, privateShingles: 0 });
  });

  it('permits short spoken phrases, the word passage, and exact BSB quoted in a transcript', async () => {
    const { root, output } = await built();
    const scripture = JSON.parse(readFileSync(path.join(output, 'generated/scripture.json'), 'utf8'));
    transcript(root, { passages: [{ id: 'p1', transcript: privateText }, { id: 'bible-quotation', transcript: scripture.verses['Acts 8:32'] }] });
    put(output, 'index.html', '<h1>A passage of scripture</h1><p>extraordinary lanterns</p><a href="/watch/?r=2026-09-06">Watch</a>');
    await expect(verify(root, output)).resolves.toMatchObject({ units: 10 });
  });

  it.each(['transcript', 'questions', 'confidence', 'review_notes', 'verseText', 'rawBody', 'audio_sha256', 'passages', 'markers'])('rejects injected metadata field %s', async (field) => {
    const { root, output } = await built();
    const index = JSON.parse(readFileSync(path.join(output, 'generated/chapters.json'), 'utf8'));
    index.units[0][field] = 'Private value'; artifact(output, 'chapters.json', index);
    await expect(verify(root, output)).rejects.toThrow();
  });

  it.each(['index.html', 'extra.json', '_astro/leak.js', 'notes.txt.gz'])('detects meaningful transcript text in %s', async (filename) => {
    const { root, output } = await built();
    transcript(root, { passages: [{ id: 'p1', transcript: privateText }] });
    const content = filename.endsWith('.json') ? JSON.stringify({ innocuousTitle: privateText }) : `<p>${privateText}</p>`;
    put(output, filename, filename.endsWith('.gz') ? gzipSync(content) : content);
    await expect(verify(root, output)).rejects.toThrow('Private transcript shingle');
  });

  it('detects transcript text copied into a recording file', async () => {
    const points = source().chapters[2].points!.map((point, i) => i ? point : { ...point, pointText: privateText });
    const { root, output } = await built({ chapters: source().chapters.map(chapter => chapter.chapterKind === 'sermon' ? { ...chapter, points } : chapter) });
    transcript(root, [{ transcript: privateText }]);
    await expect(verify(root, output)).rejects.toThrow('Private transcript shingle');
  });

  it('does not read transcripts, even malformed ones, while building', async () => {
    const { root } = fixture();
    put(root, 'transcripts/2026-09-06.yaml', 'malformed: [private unclosed yaml');
    await expect(buildIndex(root, 'production', fakeRows)).resolves.toBeTruthy();
  });

  it.each(['passages.json', 'vectors.json', 'passages.internal.yaml', 'services/2026-09-06.yaml', 'transcripts/2026-09-06.yaml', '.local/private.json'])('rejects private or source file %s in the output', async (filename) => {
    const { root, output } = await built(); put(output, filename, '{}');
    await expect(verify(root, output)).rejects.toThrow('Private/media artifact');
  });

  it('rejects altered BSB instead of granting arbitrary text a Bible exemption', async () => {
    const { root, output } = await built();
    const index = JSON.parse(readFileSync(path.join(output, 'generated/scripture.json'), 'utf8'));
    index.verses['Acts 8:32'] = privateText; artifact(output, 'scripture.json', index);
    await expect(verify(root, output)).rejects.toThrow('BSB index differs from pinned source');
  });

  it('rejects leftover generated files and a published draft', async () => {
    const { root, output } = await built();
    artifact(output, 'legacy-chapters.json', {});
    await expect(verify(root, output)).rejects.toThrow('Unexpected generated artifact');
    const draft = fixture({ status: 'draft' });
    await buildIndex(draft.root, 'preview', fakeRows);
    await expect(verify(draft.root, draft.output)).rejects.toThrow('differs from the recording files');
  });

  it('rejects private structured fields elsewhere in HTML/JSON without banning ordinary English', async () => {
    const { root, output } = await built();
    put(output, 'index.html', '<script type="application/json">{"rawBody":"private evidence"}</script>');
    await expect(verify(root, output)).rejects.toThrow('Private field');
  });

  it('allows only computed vendor confidence while still scanning the entire worker for transcript text', async () => {
    const { root, output } = await built();
    const filename = '_astro/semantic.worker-fixture.js';
    const vendor = 'function score(a,b,c){return {confidence:a/(b-c)}}';
    put(output, filename, vendor);
    await expect(verify(root, output)).resolves.toMatchObject({ units: 10 });
    for (const data of ['{confidence:0.7}', '{"confidence":0.7}', '{rawBody:"private"}']) {
      put(output, filename, `${vendor};const leaked=${data}`);
      await expect(verify(root, output)).rejects.toThrow('Private field');
    }
    transcript(root, [{ transcript: privateText }]);
    put(output, filename, `${vendor};const leaked=${JSON.stringify(privateText)}`);
    await expect(verify(root, output)).rejects.toThrow('Private transcript shingle');
  });

  it('checks exact binary row correspondence and every compressed companion', async () => {
    const { root, output } = await built();
    const metadata = JSON.parse(readFileSync(path.join(output, 'generated/chapters.json'), 'utf8'));
    put(output, `generated/${metadata.vectors.file}`, packChapterVectors(metadata.units.map(() => new Int8Array(384).fill(63))));
    await expect(verify(root, output)).rejects.toThrow('Binary vectors differ');
    await buildIndex(root, 'production', fakeRows);
    put(output, 'generated/chapters.json.gz', gzipSync('{}'));
    await expect(verify(root, output)).rejects.toThrow('Gzip companion differs');
  });
});
