import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { archiveFromFiles, loadArchive, SOURCE_CHANNEL_ID, type Service } from '../site/lib/archive';
import { assertManifestDiff, BackfillManifestSchema, editorialReviewAids, importBackfill, loadBackfill,
  MANIFEST_PATH, manifestFromFiles, nextBackfill, reportBackfill, transitionBackfill, validateBackfill } from '../site/lib/backfill';
import { backfillCli } from '../scripts/backfill';
import { buildIndex } from '../scripts/archive';

const roots: string[] = [];
const inputPath = 'inputs/approved.yaml';
const videos = ['AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC'];
function input(count = 3, approved_by = 'Fictional Operator') {
  return { schema_version: 1, batch_id: 'fixture-001', approved_by, approved_at: '2026-01-01',
    services: Array.from({ length: count }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      videos: [{ youtube_id: videos[i] ?? `VID${String(i).padStart(8, '0')}` }],
      ...(i === 0 ? { title: 'Trusted human title', known: { speaker: 'Fictional speaker', scripture: ['Romans 13:1-7'] }, notes: 'Preserve this operator note.' } : {}) })) };
}
function put(root: string, file: string, text: string) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text);
}
function fixture(count = 3, approver = 'Fictional Operator') {
  const root = mkdtempSync(path.join(tmpdir(), 'recs-backfill-test-')); roots.push(root);
  put(root, inputPath, `# Read-only fixture input\n${stringify(input(count, approver))}`);
  return root;
}
function source(id = '2026-01-01', video = videos[0]): Service {
  return { id, date: id, title: 'Fictional interpreted title', type: 'service', workflow_status: 'complete', editorial_status: 'needs_review',
    review_notes: [], speakers: [], topics: [], videos: [{ id: video, channel_id: SOURCE_CHANNEL_ID, sequence: 1, duration: 300,
      workflow_status: 'complete', media_disposition: 'playable' }],
    sections: [{ id: `${id}-section`, video_id: video, type: 'address', title: 'Fictional section', start: 10, end: 290, confidence: 0.7, review_notes: [] }],
    passages: [{ id: `${id}-passage`, section_id: `${id}-section`, video_id: video, type: 'address', title: 'Fictional passage',
      start: 20, end: 30, confidence: 0.6, review_notes: [], summary: 'The speaker discusses a fictional example.',
      transcript: 'This fictional text is long enough to demonstrate duplicate overlap detection.', questions: [], topics: [], scripture: [] }] };
}
function putSource(root: string, service = source()) { put(root, `services/${service.date.slice(0, 4)}/${service.id}/service.yaml`, stringify(service)); }
function claim(root: string, id = '2026-01-01') { transitionBackfill(root, id, 'registered'); transitionBackfill(root, id, 'in_progress'); }
function snapshot(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const walk = (relative: string) => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(file); else result.set(file, readFileSync(path.join(root, file), 'utf8'));
    }
  }; walk(''); return result;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('approved, deterministic registry import', () => {
  it('preserves source order, byte hash and trusted metadata; import is byte-idempotent after progress', () => {
    const root = fixture(); const original = readFileSync(path.join(root, inputPath), 'utf8');
    const manifest = importBackfill(root, path.join(root, inputPath));
    expect(manifest.services.map((s) => s.service_id)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(manifest.services[0]).toMatchObject({ source_order: 0, workflow_status: 'discovered', title: 'Trusted human title', known: input().services[0].known,
      sourceFileRef: 'services/2026/2026-01-01/service.yaml' });
    expect(manifest.batches[0].input_sha256).toMatch(/^[a-f0-9]{64}$/);
    claim(root); const before = snapshot(root);
    expect(importBackfill(root, inputPath).services[0].workflow_status).toBe('in_progress');
    expect(snapshot(root)).toEqual(before); expect(readFileSync(path.join(root, inputPath), 'utf8')).toBe(original);
  });
  it('stops on any input byte change, including comments, rather than overwriting a batch', () => {
    const root = fixture(); importBackfill(root, inputPath); const manifest = readFileSync(path.join(root, MANIFEST_PATH), 'utf8');
    put(root, inputPath, `${readFileSync(path.join(root, inputPath), 'utf8')}# Changed\n`);
    expect(() => importBackfill(root, inputPath)).toThrow('content hash changed');
    expect(readFileSync(path.join(root, MANIFEST_PATH), 'utf8')).toBe(manifest);
  });
  it('rejects duplicate video IDs and ambiguous same-date logical IDs', () => {
    for (const duplicate of ['video', 'service']) {
      const root = fixture(); const data = input();
      if (duplicate === 'video') data.services[1].videos = data.services[0].videos;
      else data.services[1].date = data.services[0].date;
      put(root, inputPath, stringify(data));
      expect(() => importBackfill(root, inputPath)).toThrow('duplicate');
      expect(loadBackfill(root).services).toEqual([]);
    }
  });
  it('rejects assignments repeated across batches, leaves the first batch untouched', () => {
    const root = fixture(); importBackfill(root, inputPath); const before = readFileSync(path.join(root, MANIFEST_PATH), 'utf8');
    const data = input(); data.batch_id = 'fixture-002'; put(root, 'inputs/other.yaml', stringify(data));
    expect(() => importBackfill(root, 'inputs/other.yaml')).toThrow('duplicate service');
    expect(readFileSync(path.join(root, MANIFEST_PATH), 'utf8')).toBe(before);
  });
  it.each([[0, 'Fictional Operator'], [3, '   ']] as const)('labels pending input (%s entries, approver %s) without a new workflow value', (count, approver) => {
    const root = fixture(count, approver); const manifest = importBackfill(root, inputPath);
    expect(manifest.services).toEqual([]); expect(nextBackfill(manifest, 'fixture-001')).toEqual([]);
    expect(reportBackfill(root).batches[0].acceptance_condition).toBe('pending_operator_input');
    expect(() => nextBackfill(manifest, 'fixture-001', { limit: 1 })).toThrow('bounded');
  });
  it('rejects path traversal, symlinks, malformed and foreign-channel operator input', () => {
    const root = fixture(); expect(() => importBackfill(root, '../outside.yaml')).toThrow();
    symlinkSync(path.join(root, inputPath), path.join(root, 'linked.yaml'));
    expect(() => importBackfill(root, 'linked.yaml')).toThrow('symlinks');
    symlinkSync(path.join(root, 'missing.yaml'), path.join(root, 'dangling.yaml'));
    expect(() => importBackfill(root, 'dangling.yaml')).toThrow('symlinks');
    const data = input(); Object.assign(data.services[0].videos[0], { channel_id: 'foreign' }); put(root, inputPath, stringify(data));
    expect(() => importBackfill(root, inputPath)).toThrow('channel_id');
  });
  it('recognizes only the canonical manifest and preserves legacy identifier records', () => {
    const root = fixture(); const legacy = 'youtube_id: ZTDYIJUDb0M\ndate: 2026-09-06\nworkflow_status: registered\nmedia_disposition: unassessed\n';
    put(root, 'corpus/ZTDYIJUDb0M.yaml', legacy); importBackfill(root, inputPath);
    expect(loadArchive(root)).toEqual([]); expect(validateBackfill(root).services).toHaveLength(3);
    expect(readFileSync(path.join(root, 'corpus/ZTDYIJUDb0M.yaml'), 'utf8')).toBe(legacy);
    expect(() => archiveFromFiles(new Map([['corpus/other.yaml', stringify(loadBackfill(root))]]))).toThrow();
  });
});

describe('selection, claims, transitions and partial isolation', () => {
  it('uses 20 as a default selection size, not a worker cap; explicit limits cannot exceed approval', () => {
    const root = fixture(25); const manifest = importBackfill(root, inputPath);
    expect(nextBackfill(manifest, 'fixture-001')).toHaveLength(20);
    expect(nextBackfill(manifest, 'fixture-001', { limit: 25 })).toHaveLength(25);
    for (const limit of [0, -1, 26, 1.5, Infinity, NaN]) expect(() => nextBackfill(manifest, 'fixture-001', { limit })).toThrow('limit');
    expect(() => nextBackfill(manifest, 'unknown')).toThrow('unknown batch');
  });
  it('skips completed, in-progress and blocked work without consuming available capacity; resume is explicit', () => {
    const root = fixture(5); importBackfill(root, inputPath); claim(root); putSource(root); transitionBackfill(root, '2026-01-01', 'complete');
    claim(root, '2026-01-02'); transitionBackfill(root, '2026-01-03', 'blocked', 'No authorized source access');
    const manifest = loadBackfill(root);
    expect(nextBackfill(manifest, 'fixture-001', { limit: 2 }).map((e) => e.service_id)).toEqual(['2026-01-04', '2026-01-05']);
    expect(nextBackfill(manifest, 'fixture-001', { resume: '2026-01-02' })[0].workflow_status).toBe('in_progress');
    expect(nextBackfill(manifest, 'fixture-001', { resume: '2026-01-03' })[0].workflow_status).toBe('blocked');
    expect(() => nextBackfill(manifest, 'fixture-001', { resume: '2026-01-01' })).toThrow('resume');
  });
  it('enforces exact edges and conditional reasons, clears resolved reasons, preserves earlier history', () => {
    const root = fixture(); importBackfill(root, inputPath);
    expect(() => transitionBackfill(root, '2026-01-01', 'complete')).toThrow('forbidden');
    expect(() => transitionBackfill(root, '2026-01-01', 'blocked')).toThrow('reason');
    expect(() => transitionBackfill(root, '2026-01-01', 'registered', 'not allowed')).toThrow('reason');
    transitionBackfill(root, '2026-01-01', 'blocked', 'Source unavailable');
    transitionBackfill(root, '2026-01-01', 'registered');
    expect(loadBackfill(root).services[0]).not.toHaveProperty('blocked_reason');
    transitionBackfill(root, '2026-01-01', 'in_progress'); transitionBackfill(root, '2026-01-01', 'registered');
    const manifest = loadBackfill(root); const altered = structuredClone(manifest); altered.services[0].history.splice(0, 2);
    expect(() => assertManifestDiff(manifest, altered)).toThrow('history');
    expect(() => transitionBackfill(root, 'unknown', 'registered')).toThrow('unknown service');
  });
  it('completes only a matching interpreted source; errors leave manifest and other claims untouched', () => {
    const root = fixture(); importBackfill(root, inputPath); claim(root); claim(root, '2026-01-02');
    const before = snapshot(root);
    expect(() => transitionBackfill(root, '2026-01-01', 'complete')).toThrow('requires matching'); expect(snapshot(root)).toEqual(before);
    putSource(root, { ...source(), workflow_status: 'in_progress' });
    expect(() => transitionBackfill(root, '2026-01-01', 'complete')).toThrow('requires matching');
    putSource(root, source('2026-01-01', 'XXXXXXXXXXX'));
    expect(() => transitionBackfill(root, '2026-01-01', 'complete')).toThrow('assignment');
    putSource(root); put(root, 'services/2026/2026-01-02/service.yaml', 'temporary incomplete worker output');
    transitionBackfill(root, '2026-01-01', 'complete');
    expect(loadBackfill(root).services[1].workflow_status).toBe('in_progress');
    expect(() => transitionBackfill(root, '2026-01-01', 'blocked', 'Later unavailable')).toThrow('complete -> blocked');
    transitionBackfill(root, '2026-01-01', 'in_progress');
  });
  it('refuses cached editorial promotion and interpretive/media payloads in the manifest', () => {
    const root = fixture(); const manifest = importBackfill(root, inputPath);
    for (const key of ['editorial_status', 'reviewed_by', 'reviewed_at', 'transcript', 'summary', 'published', 'media_disposition']) {
      const forged = structuredClone(manifest); Object.assign(forged.services[0], { [key]: 'reviewed' });
      expect(BackfillManifestSchema.safeParse(forged).success).toBe(false);
    }
    expect(() => backfillCli(['transition', '--service', '2026-01-01', '--to', 'reviewed'], root)).toThrow('Usage');
  });
  it('fails closed if another writer holds the main-only lock', () => {
    const root = fixture(); importBackfill(root, inputPath); const before = snapshot(root);
    put(root, `${MANIFEST_PATH}.lock`, 'another writer');
    expect(() => transitionBackfill(root, '2026-01-01', 'registered')).toThrow('EEXIST');
    expect(readFileSync(path.join(root, MANIFEST_PATH), 'utf8')).toBe(before.get(MANIFEST_PATH));
    expect(readFileSync(path.join(root, `${MANIFEST_PATH}.lock`), 'utf8')).toBe('another writer');
  });
});

describe('source references, integrated build gate, read-only reports', () => {
  it.each(['owner', 'extra video', 'legacy date'])('rejects all-source %s conflicts before import writes', (kind) => {
    const root = fixture(); const service = source();
    if (kind === 'owner') { service.id = 'other-owner'; putSource(root, service); }
    if (kind === 'extra video') { service.videos.push({ ...service.videos[0], id: 'XXXXXXXXXXX', sequence: 2 }); putSource(root, service); }
    if (kind === 'legacy date') put(root, 'corpus/legacy.yaml', stringify({ youtube_id: videos[0], date: '2025-01-01', workflow_status: 'registered', media_disposition: 'unassessed' }));
    expect(() => importBackfill(root, inputPath)).toThrow(/assignment|date mismatch/); expect(loadBackfill(root).services).toEqual([]);
  });
  it('validates source references, input hash, source order and immutable histories independently', () => {
    const root = fixture(); importBackfill(root, inputPath); const files = snapshot(root);
    for (const change of [
      (m: ReturnType<typeof loadBackfill>) => { m.services[0].sourceFileRef = 'services/2026/other/service.yaml'; },
      (m: ReturnType<typeof loadBackfill>) => { m.services.reverse(); },
      (m: ReturnType<typeof loadBackfill>) => { m.services[0].workflow_status = 'complete'; },
    ]) {
      const manifest = loadBackfill(root); change(manifest); const bad = new Map(files); bad.set(MANIFEST_PATH, stringify(manifest));
      expect(() => manifestFromFiles(bad)).toThrow();
    }
    files.delete(inputPath); expect(() => manifestFromFiles(files)).toThrow('missing discovery_source');
  });
  it('integrated indexes validate manifest when present; absent is valid; production never gains unreviewed content', () => {
    const root = fixture(); expect(validateBackfill(root).services).toEqual([]);
    expect(JSON.parse(readFileSync(buildIndex(root), 'utf8'))).toEqual([]);
    importBackfill(root, inputPath); putSource(root);
    expect(JSON.parse(readFileSync(buildIndex(root, 'preview'), 'utf8'))).toHaveLength(1);
    expect(JSON.parse(readFileSync(buildIndex(root, 'production'), 'utf8'))).toEqual([]);
    put(root, MANIFEST_PATH, 'schema_version: 999'); expect(() => buildIndex(root, 'preview')).toThrow('corpus/manifest.yaml');
    expect(JSON.parse(readFileSync(path.join(root, 'site/public/generated/passages.json'), 'utf8'))).toEqual([]);
  });
  it('reads live media and exact editorial_status, reports eligibility only, and never rewrites sources', () => {
    const root = fixture(); importBackfill(root, inputPath);
    let report = reportBackfill(root, { batch: 'fixture-001', year: '2026' });
    expect(report.services[0]).not.toHaveProperty('editorial_status'); expect(report.services[0].videos[0].media_disposition).toBe('unassessed');
    const service = source(); putSource(root, service); claim(root); transitionBackfill(root, service.id, 'complete');
    expect(reportBackfill(root).services[0].editorial_status).toBe('needs_review');
    // Synthetic human-reviewed source, never real data or a toolkit promotion.
    service.editorial_status = 'reviewed'; service.reviewed_by = 'Fictional human'; service.reviewed_at = '2026-01-02T00:00:00Z'; putSource(root, service);
    report = reportBackfill(root); expect(report.services[0].eligible).toBe(true); expect(report.services[0].editorial_status).toBe('reviewed');
    expect(JSON.stringify(report)).not.toContain('published');
    service.videos[0].media_disposition = 'failed'; service.videos[0].disposition_evidence = 'Fictional later removal'; putSource(root, service);
    const before = snapshot(root); const manifest = loadBackfill(root);
    validateBackfill(root); nextBackfill(manifest, 'fixture-001'); report = reportBackfill(root);
    expect(report.services[0].eligible).toBe(false); expect(report.services[0].videos[0].media_disposition).toBe('failed');
    expect(report.batches[0].counts.media_disposition).toEqual({ unassessed: 2, playable: 0, failed: 1, rejected: 0 });
    expect(report.counts.workflow_status.complete).toBe(1); expect(report.years['2026'].total).toBe(3); expect(snapshot(root)).toEqual(before);
  });
  it('reports all review aids with references rather than duplicating or rewriting interpretation', () => {
    const service = source();
    service.sections.push({ ...service.sections[0], id: 'overlap', start: 280 });
    service.passages.push({ ...service.passages[0], id: 'duplicate', start: 40, end: 280 });
    service.topics = Array.from({ length: 13 }, (_, i) => ({ id: `topic-${i}`, name: `Topic ${i}` }));
    for (let i = 1; i <= 3; i++) service.videos.push({ ...service.videos[0], id: `VID${String(i).padStart(8, '0')}`, sequence: i + 1 });
    const baseline = structuredClone(service); baseline.editorial_status = 'reviewed'; baseline.reviewed_by = 'Fictional human'; baseline.reviewed_at = '2026-01-02T00:00:00Z';
    const before = structuredClone(service); const aids = editorialReviewAids([service], [baseline]);
    expect(new Set(aids.map((a) => a.code))).toEqual(new Set(['low_confidence_boundary', 'metadata_gap', 'section_gap', 'section_overlap', 'duplicate_overlap_text', 'topic_proliferation', 'unusual_video_count', 'unusual_passage_length', 'changed_reviewed_record']));
    expect(JSON.stringify(aids)).not.toContain(service.passages[0].transcript); expect(service).toEqual(before);
    expect(editorialReviewAids([], [baseline])[0].detail).toContain('absent');
  });
  it('CLI routes all commands with strict options and a read-only baseline root', () => {
    const root = fixture(); backfillCli(['import', '--input', inputPath], root);
    expect(backfillCli(['next', '--batch', 'fixture-001', '--limit', '2'], root)).toHaveLength(2);
    backfillCli(['transition', '--service', '2026-01-01', '--to', 'registered'], root);
    expect(backfillCli(['validate'], root)).toEqual(loadBackfill(root));
    const baseline = fixture(0); expect(backfillCli(['report', '--batch', 'fixture-001', '--baseline', baseline], root)).toMatchObject({ counts: { total: 3 } });
    for (const args of [[], ['import'], ['validate', '--unknown', 'x'], ['next', '--batch', 'fixture-001', '--batch', 'fixture-001'], ['transition', '--service', '2026-01-01', '--to', 'complete', '--editorial_status', 'reviewed']]) expect(() => backfillCli(args, root)).toThrow('Usage');
  });
});
