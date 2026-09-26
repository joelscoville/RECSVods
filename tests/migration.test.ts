import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { flattenChapters, loadArchive, SOURCE_CHANNEL_ID } from '../site/lib/archive';
import { assertMigrationPreserved, assertPassagesPreserved, MIGRATION_NOTE, originalLegacy } from '../site/lib/internal-validation';
import { BASELINE_PATH, deriveChapters, migrateChapters, migrationCli, preservePassageBlock, readMigrationBaseline, spokenKeywordCandidates } from '../scripts/migrate-chapters';

const roots: string[] = [];
const filename = 'services/2026/fictional/service.yaml';
const internalPath = 'services/2026/fictional/passages.internal.yaml';
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'Fictional Test Human', GIT_AUTHOR_EMAIL: 'human@example.invalid',
  GIT_COMMITTER_NAME: 'Fictional Test Human', GIT_COMMITTER_EMAIL: 'human@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, env: gitEnv, encoding: 'utf8' }).trim();
function put(root: string, relative: string, text: string) {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); writeFileSync(path.join(root, relative), text);
}
function fixture(external = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'recs-migration-test-')); roots.push(root);
  const section = { id: 'original-section', video_id: 'AAAAAAAAAAA', start: 0, end: 100, type: 'address',
    title: '  Original title  ', speaker_id: 'speaker', confidence: 0.51, review_notes: ['  Original uncertainty.  '] };
  const first = { ...section, id: 'original-passage', section_id: section.id, summary: 'An existing summary, still uncertain.',
    questions: ['An original question?'], topics: ['hope'], scripture: ['Rom 13:1', 'Romans 13:1'],
    title: 'Enduring hope and invented fantasy', transcript: '  Enduring hope.\r\nOriginal transcript bytes.  \n\n' };
  const service = { id: 'fictional', date: '2026-01-04', title: '  Original service  ', type: 'service',
    workflow_status: 'complete', editorial_status: 'needs_review', review_notes: ['Original provenance note.'],
    series: { id: 'series', name: 'Original series' }, speakers: [{ id: 'speaker', name: 'Original speaker' }],
    topics: [{ id: 'hope', name: 'Enduring hope' }],
    videos: [{ id: 'AAAAAAAAAAA', channel_id: SOURCE_CHANNEL_ID, duration: 100, sequence: 1,
      workflow_status: 'complete', media_disposition: 'playable', transcription_language: 'en', transcribed_span: { start: 0, end: 100 } }],
    sections: [section], passages: external ? [(() => { const { transcript: _text, ...p } = first; return { ...p, transcript_file: 'original.md' }; })()] : [first] };
  put(root, filename, stringify(service, { lineWidth: 0 }));
  if (external) put(root, 'services/2026/fictional/original.md', first.transcript);
  put(root, 'inputs/approved.yaml', '# immutable approved input\napproved_by: Fictional Operator\n');
  git(root, 'init', '-q'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'Frozen fictional content');
  return { root, baseline: git(root, 'rev-parse', 'HEAD'), service, originalText: readFileSync(path.join(root, filename), 'utf8') };
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('lossless chapter migration', () => {
  it.each([false, true])('preserves every old field and transcript byte, external=%s', (external) => {
    const { root, baseline, service, originalText } = fixture(external);
    const approved = readFileSync(path.join(root, 'inputs/approved.yaml'));
    const manifest = migrateChapters(root, { baseline, mode: 'prepare' });
    expect(manifest).toMatchObject({ serviceCount: 1, sectionCount: 1, passageCount: 1 });
    const text = readFileSync(path.join(root, filename), 'utf8'); const migrated = parse(text);
    const internal = readFileSync(path.join(root, internalPath), 'utf8');
    expect(parse(internal).passages).toEqual(service.passages);
    assertMigrationPreserved(originalLegacy(originalText, filename), text, internal, filename);
    const { sections, passages: _passages, review_notes, ...metadata } = service;
    const { chapters, review_notes: notes, ...newMetadata } = migrated;
    expect(newMetadata).toEqual(metadata); expect(notes).toEqual([...review_notes, MIGRATION_NOTE]);
    for (const [key, value] of Object.entries(sections[0])) expect(chapters[0][key]).toEqual(value);
    expect(chapters[0].scripture).toEqual(['Romans 13:1']); expect(chapters[0].topics).toEqual(['hope']);
    expect(chapters[0].keywords).toContain('enduring hope'); expect(chapters[0].keywords.join(' ')).not.toMatch(/invented|fantasy/);
    if (external) expect(readFileSync(path.join(root, 'services/2026/fictional/original.md'))).toEqual(Buffer.from('  Enduring hope.\r\nOriginal transcript bytes.  \n\n'));
    else expect(Buffer.from(parse(internal).passages[0].transcript)).toEqual(Buffer.from(originalLegacy(originalText, filename).passages[0].transcript!));
    const review = readFileSync(path.join(root, '.local/chapter-review/fictional.json'), 'utf8');
    expect(review).toContain('An existing summary'); expect(review).not.toContain('Original transcript bytes');
    expect(parse(review).chapters[0]).toMatchObject({ summary_needs_review: true, keywords_need_review: true });
    expect(JSON.parse(readFileSync(path.join(root, 'services/2026/fictional/legacy-chapters.json'), 'utf8'))).toEqual({ 'original-passage': 'original-section' });
    expect(readFileSync(path.join(root, 'inputs/approved.yaml'))).toEqual(approved);
    expect(() => migrateChapters(root, { baseline, mode: 'verify' })).not.toThrow();
    expect(flattenChapters(loadArchive(root), 'preview')).toHaveLength(1);
    rmSync(path.join(root, internalPath)); if (external) rmSync(path.join(root, 'services/2026/fictional/original.md'));
    expect(flattenChapters(loadArchive(root), 'preview')).toHaveLength(1);
  });
  it('preserves literal YAML blocks including chomping, whitespace and comments', () => {
    const { originalText } = fixture();
    const original = originalLegacy(originalText, filename);
    const literal = 'passages:\n' + stringify(original.passages, { lineWidth: 0 }).split('\n').map((s) => s ? `  ${s}` : s).join('\n');
    const full = stringify({ ...original, passages: undefined }) + literal;
    expect(preservePassageBlock(full, original)).toBe(literal);
  });
  it('recovers after internal-first interruption and leaves curated chapter/review files byte-unchanged on reruns', () => {
    const { root, baseline, originalText } = fixture();
    put(root, internalPath, preservePassageBlock(originalText, originalLegacy(originalText, filename)));
    migrateChapters(root, { baseline, mode: 'prepare' });
    const record = parse(readFileSync(path.join(root, filename), 'utf8')); record.chapters[0].summary = 'Later concise metadata-only summary.';
    put(root, filename, stringify(record));
    const before = readFileSync(path.join(root, filename)); const internal = readFileSync(path.join(root, internalPath));
    const review = '.local/chapter-review/fictional.json'; put(root, review, '{"human_work_in_progress":true}\n');
    migrateChapters(root, { baseline, mode: 'prepare' });
    expect(readFileSync(path.join(root, filename))).toEqual(before); expect(readFileSync(path.join(root, internalPath))).toEqual(internal);
    expect(readFileSync(path.join(root, review), 'utf8')).toBe('{"human_work_in_progress":true}\n');
  });
  it.each(['internal', 'source', 'approved', 'map'])('refuses %s conflicts before rewriting public source', (kind) => {
    const { root, baseline, originalText } = fixture();
    if (kind === 'internal') put(root, internalPath, stringify({ passages: [] }));
    if (kind === 'source') put(root, filename, originalText + '# changed\n');
    if (kind === 'approved') { const source = parse(originalText); source.editorial_status = 'reviewed'; source.reviewed_by = 'Human'; source.reviewed_at = '2026-01-05T00:00:00Z'; put(root, filename, stringify(source)); }
    if (kind === 'map') put(root, 'services/2026/fictional/legacy-chapters.json', '{"old":"wrong"}');
    const before = readFileSync(path.join(root, filename));
    expect(() => migrateChapters(root, { baseline, mode: 'prepare' })).toThrow();
    expect(readFileSync(path.join(root, filename))).toEqual(before); expect(existsSync(path.join(root, BASELINE_PATH))).toBe(false);
  });
  it('prefers exact-video private Colab speech for keyword evidence without copying raw ASR', () => {
    const { root, baseline } = fixture();
    put(root, 'private/AAAAAAAAAAA.json', JSON.stringify({ segments: [{ start: 0, end: 50, text: 'Invented fantasy. SECRET_RAW_ASR_SENTINEL' }] }));
    migrateChapters(root, { baseline, mode: 'prepare', privateDirectory: path.join(root, 'private') });
    const review = readFileSync(path.join(root, '.local/chapter-review/fictional.json'), 'utf8');
    expect(review).not.toContain('SECRET_RAW_ASR_SENTINEL'); expect(review).toContain('private_colab');
    const chapter = loadArchive(root)[0].chapters[0]; expect(chapter.keywords).toContain('invented fantasy'); expect(chapter.keywords).not.toContain('enduring hope');
  });
  it('requires whole spoken words/phrases and rejects unspoken title tokens', () => {
    expect(spokenKeywordCandidates(['Hope renewal', 'invented'], 'hopeless renewal')).toEqual(['renewal']);
    expect(spokenKeywordCandidates(['quiet prayer', 'renewal'], '[Quiet prayer; wording omitted.] renewal')).toEqual(['renewal']);
  });
  it('records hashes/counts only, with no migration or source edits', () => {
    const { root, baseline, originalText } = fixture();
    migrationCli(['--baseline', baseline, '--record-baseline'], root);
    expect(readFileSync(path.join(root, filename), 'utf8')).toBe(originalText); expect(existsSync(path.join(root, internalPath))).toBe(false);
    const manifest = readFileSync(path.join(root, BASELINE_PATH), 'utf8'); expect(manifest).not.toContain('Original transcript'); expect(manifest).not.toContain('Original provenance note');
    expect(() => migrationCli(['--prepare'], root)).toThrow('Usage');
  });
});

describe('frozen real baseline (read-only, pure in-memory migration)', () => {
  it('checks all 1,646 passage objects/transcripts, 582 sections, and all original service metadata against Git 540abab', () => {
    const baseline = readMigrationBaseline(process.cwd(), '540abab');
    expect(baseline.manifest).toMatchObject({ serviceCount: 22, sectionCount: 582, passageCount: 1646, sourceBytes: 2148986 });
    for (const { filename, text, original } of baseline.sources) {
      const internal = preservePassageBlock(text, original);
      const derived = deriveChapters(original, filename, baseline.files);
      assertMigrationPreserved(original, stringify(derived.service), internal, filename);
      assertPassagesPreserved(original.passages, internal, filename);
      const preserved = parse(internal).passages;
      original.passages.forEach((passage, i) => {
        expect(preserved[i]).toEqual(passage);
        if (passage.transcript !== undefined) expect(Buffer.from(preserved[i].transcript)).toEqual(Buffer.from(passage.transcript));
      });
    }
    const persisted = JSON.parse(readFileSync(path.join(process.cwd(), BASELINE_PATH), 'utf8'));
    expect(persisted).toEqual(baseline.manifest);
  }, 30_000);
});
