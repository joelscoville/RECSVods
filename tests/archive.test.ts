import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import {
  archiveFromFiles, assertWorkflowTransition, canTransitionWorkflow, flattenArchive,
  IdentifierRecordSchema, loadArchive, parseYaml, publishedServices, ScriptureReferenceSchema,
  ServiceSchema, SOURCE_CHANNEL_ID, WorkflowStatusSchema, type Service, type WorkflowStatus,
} from '../site/lib/archive';
import { archiveCli, buildIndex } from '../scripts/archive';

const roots: string[] = [];
const filename = 'services/2026/fixture-service/service.yaml';
function fixture(): Service {
  return {
    id: 'fixture-service', date: '2026-01-04', title: 'Fictional test service', type: 'service',
    workflow_status: 'complete', editorial_status: 'needs_review', review_notes: [],
    speakers: [{ id: 'fixture-speaker', name: 'Fictional speaker' }],
    topics: [{ id: 'fixture-topic', name: 'Fictional topic' }],
    videos: [{ id: 'AAAAAAAAAAA', channel_id: SOURCE_CHANNEL_ID, duration: 120, sequence: 1,
      workflow_status: 'complete', media_disposition: 'playable', transcription_language: 'en',
      transcribed_span: { start: 0, end: 100 } }],
    sections: [{ id: 'fixture-section', video_id: 'AAAAAAAAAAA', start: 0, end: 100,
      type: 'address', title: 'Fictional section', confidence: 0.8, speaker_id: 'fixture-speaker', review_notes: [] }],
    passages: [{ id: 'fixture-passage', video_id: 'AAAAAAAAAAA', section_id: 'fixture-section',
      start: 10, end: 60, type: 'address', title: 'Fictional passage', summary: 'The fictional speaker discusses a test example.',
      questions: ['What does the test example show?'], topics: ['fixture-topic'], scripture: ['Romans 13:1-7'],
      transcript: 'Fictional test transcript, not archive content.', confidence: 0.7, review_notes: [] }],
  };
}
function root(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'recs-archive-test-'));
  roots.push(directory);
  return directory;
}
function put(directory: string, file: string, content: string) {
  mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
  writeFileSync(path.join(directory, file), content);
}
afterEach(() => roots.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('workflow contract', () => {
  const edges = new Set(['discovered:registered', 'discovered:blocked', 'registered:in_progress', 'registered:blocked',
    'in_progress:complete', 'in_progress:blocked', 'in_progress:registered', 'complete:in_progress',
    'blocked:registered', 'blocked:in_progress']);
  for (const from of WorkflowStatusSchema.options) for (const to of WorkflowStatusSchema.options) {
    it(`${from} -> ${to} is ${edges.has(`${from}:${to}`) ? 'allowed' : 'forbidden'}`, () => {
      expect(canTransitionWorkflow(from, to)).toBe(edges.has(`${from}:${to}`));
      if (edges.has(`${from}:${to}`)) expect(() => assertWorkflowTransition(from, to)).not.toThrow();
      else expect(() => assertWorkflowTransition(from, to)).toThrow('forbidden transition');
    });
  }
});

describe('strict schemas', () => {
  it('accepts interpreted services and the existing identifier-only corpus format', () => {
    expect(ServiceSchema.parse(fixture())).toEqual(fixture());
    expect(IdentifierRecordSchema.parse({ youtube_id: 'ZTDYIJUDb0M', date: '2026-09-06',
      workflow_status: 'registered', media_disposition: 'unassessed' }).workflow_status).toBe('registered');
  });
  it.each(['editorial_status', 'title', 'summary', 'transcript', 'passages', 'published'])('forbids identifier interpretation key %s', (key) => {
    expect(IdentifierRecordSchema.safeParse({ youtube_id: 'AAAAAAAAAAA', date: '2026-01-04',
      workflow_status: 'blocked', blocked_reason: 'Media authorization is unavailable.', media_disposition: 'unassessed', [key]: 'invented' }).success).toBe(false);
  });
  it.each(['pending', 'in_progress', 'published', undefined])('rejects editorial value %s', (editorial_status) => {
    expect(ServiceSchema.safeParse({ ...fixture(), editorial_status }).success).toBe(false);
  });
  it.each(['discovered', 'registered'])('forbids interpretation in workflow %s', (workflow_status) => {
    expect(ServiceSchema.safeParse({ ...fixture(), workflow_status }).success).toBe(false);
  });
  it('requires blocked reasons and clears them on resolution, independently for video and service', () => {
    const service = fixture();
    service.workflow_status = 'blocked';
    expect(ServiceSchema.safeParse(service).success).toBe(false);
    service.blocked_reason = 'Source became inaccessible while processing.';
    expect(ServiceSchema.safeParse(service).success).toBe(true);
    service.videos[0].workflow_status = 'blocked';
    expect(ServiceSchema.safeParse(service).success).toBe(false);
    service.videos[0].blocked_reason = 'No source access.';
    expect(ServiceSchema.safeParse(service).success).toBe(true);
    service.workflow_status = 'in_progress';
    expect(ServiceSchema.safeParse(service).success).toBe(false);
  });
  it('requires review metadata and rejects stale metadata on needs_review', () => {
    const service = fixture();
    service.editorial_status = 'reviewed';
    expect(ServiceSchema.safeParse(service).success).toBe(false);
    service.reviewed_by = 'Test Reviewer';
    service.reviewed_at = '2026-01-05T10:00:00Z';
    expect(ServiceSchema.safeParse(service).success).toBe(true);
    service.reviewed_at = 'yesterday';
    expect(ServiceSchema.safeParse(service).success).toBe(false);
    service.editorial_status = 'needs_review';
    expect(ServiceSchema.safeParse(service).success).toBe(false);
  });
  const invalid: [string, (service: Service) => void][] = [
    ['videos.0.id', (s) => { s.videos[0].id = 'invalid'; }],
    ['videos.0.channel_id', (s) => { (s.videos[0] as { channel_id: string }).channel_id = 'UCforeign'; }],
    ['videos.0.duration', (s) => { s.videos[0].duration = 0; }],
    ['videos.0.duration', (s) => { s.videos[0].duration = Infinity; }],
    ['videos.0.sequence', (s) => { s.videos[0].sequence = 2; }],
    ['videos.0.transcribed_span.end', (s) => { s.videos[0].transcribed_span!.end = 121; }],
    ['videos.0.transcribed_span.end', (s) => { s.videos[0].transcribed_span!.end = 0; }],
    ['videos.0.transcription_language', (s) => { delete s.videos[0].transcription_language; }],
    ['videos.0.workflow_status', (s) => { s.videos[0].workflow_status = 'registered'; }],
    ['passages.0.start', (s) => { s.passages[0].start = -1; }],
    ['passages.0.end', (s) => { s.passages[0].end = 10; }],
    ['passages.0.end', (s) => { s.passages[0].end = 121; }],
    ['passages.0.video_id', (s) => { s.passages[0].video_id = 'BBBBBBBBBBB'; }],
    ['passages.0.section_id', (s) => { s.passages[0].section_id = 'missing'; }],
    ['passages.0.section_id', (s) => { s.passages[0].end = 110; }],
    ['passages.0.speaker_id', (s) => { s.passages[0].speaker_id = 'missing'; }],
    ['passages.0.topics.0', (s) => { s.passages[0].topics = ['missing']; }],
    ['passages.0.confidence', (s) => { s.passages[0].confidence = 1.1; }],
    ['passages.0.summary', (s) => { s.passages[0].summary = ''; }],
    ['sections.0.end', (s) => { s.sections[0].end = 121; }],
    ['sections.0.video_id', (s) => { s.sections[0].video_id = 'BBBBBBBBBBB'; }],
    ['date', (s) => { s.date = '2026-02-30'; }],
  ];
  it.each(invalid)('reports file and invalid field %s', (field, mutate) => {
    const service = fixture(); mutate(service);
    expect(() => archiveFromFiles(new Map([[filename, stringify(service)]]))).toThrow(`${filename}:${field}`);
  });
  it.each(['videos', 'sections', 'passages', 'speakers', 'topics'] as const)('rejects duplicate %s IDs', (key) => {
    const service = fixture();
    const values = service[key] as { id: string }[];
    values.push({ ...values[0] });
    expect(ServiceSchema.safeParse(service).success).toBe(false);
  });
  it.each(['Romans 13:1-7', 'John 3:16-4:2', 'Genesis 1-2', 'Psalms 23', '1 John 1:1'])('accepts normalized reference %s', (value) => {
    expect(ScriptureReferenceSchema.safeParse(value).success).toBe(true);
  });
  it.each(['Rom 13:1', 'John 3:7-1', 'John 4:2-3:1', 'John 0:1', 'Imaginary 1:1', 'John 3-4:2', 'ESV verse text'])('rejects reference %s', (value) => {
    expect(ScriptureReferenceSchema.safeParse(value).success).toBe(false);
  });
});

describe('loader and global validation', () => {
  it('loads external Markdown and validates optional corpus without interpreting it', () => {
    const directory = root();
    const service = fixture();
    const { transcript: _transcript, ...passage } = service.passages[0];
    put(directory, filename, stringify({ ...service, passages: [{ ...passage, transcript_file: 'transcripts/passage.md' }] }));
    put(directory, 'services/2026/fixture-service/transcripts/passage.md', 'Fictional markdown transcript.\n');
    put(directory, 'corpus/AAAAAAAAAAA.yaml', 'youtube_id: AAAAAAAAAAA\ndate: 2026-01-04\nworkflow_status: registered\nmedia_disposition: unassessed\n');
    expect(loadArchive(directory)[0].passages[0].transcript).toBe('Fictional markdown transcript.');
  });
  it('names transcript errors and rejects traversal, missing, empty, or ambiguous transcript sources', () => {
    const service = fixture();
    const { transcript: _transcript, ...passage } = service.passages[0];
    for (const transcript_file of ['../outside.md', '/absolute.md', 'missing.md']) {
      expect(() => archiveFromFiles(new Map([[filename, stringify({ ...service, passages: [{ ...passage, transcript_file }] })]]))).toThrow('transcript_file');
    }
    for (const p of [passage, { ...passage, transcript: '' }, { ...passage, transcript: 'text', transcript_file: 'text.md' }]) {
      expect(() => archiveFromFiles(new Map([[filename, stringify({ ...service, passages: [p] })]]))).toThrow('transcript');
    }
  });
  it('rejects symlinks', () => {
    const directory = root();
    mkdirSync(path.join(directory, 'services'));
    symlinkSync(root(), path.join(directory, 'services', 'outside'));
    expect(() => loadArchive(directory)).toThrow('symlinks');
  });
  it.each(['videos', 'sections', 'passages'] as const)('rejects global %s duplicates', (key) => {
    const first = fixture();
    const second = fixture();
    second.id = 'other-service';
    if (key !== 'videos') {
      second.videos[0].id = 'BBBBBBBBBBB';
      second.sections[0].video_id = second.passages[0].video_id = 'BBBBBBBBBBB';
    }
    if (key === 'passages') second.sections[0].id = second.passages[0].section_id = 'other-section';
    expect(() => archiveFromFiles(new Map([[filename, stringify(first)], ['services/2026/other-service/service.yaml', stringify(second)]]))).toThrow('duplicate global ID');
  });
  it('rejects duplicate service IDs across years and IDs across entity kinds', () => {
    const a = fixture(); const b = fixture(); b.date = '2025-01-05';
    expect(() => archiveFromFiles(new Map([[filename, stringify(a)], ['services/2025/fixture-service/service.yaml', stringify(b)]]))).toThrow('duplicate global ID');
    a.passages[0].id = a.id;
    expect(() => archiveFromFiles(new Map([[filename, stringify(a)]]))).toThrow('duplicate global ID');
  });
  it('validates corpus even without interpreted services', () => {
    expect(() => archiveFromFiles(new Map([['corpus/bad.yaml', 'youtube_id: bad']]))).toThrow('corpus/bad.yaml');
    const text = 'youtube_id: AAAAAAAAAAA\ndate: 2026-01-04\nworkflow_status: registered\nmedia_disposition: unassessed\n';
    expect(() => archiveFromFiles(new Map([['corpus/a.yaml', text], ['corpus/b.yaml', text]]))).toThrow('duplicate corpus ID');
    expect(() => archiveFromFiles(new Map([[filename, stringify(fixture())], ['corpus/a.yaml', text.replace('2026-01-04', '2026-01-05')]]))).toThrow('differs from service');
  });
  it('rejects misplaced source files and duplicate YAML keys', () => {
    expect(() => archiveFromFiles(new Map([['services/wrong.yaml', stringify(fixture())]]))).toThrow('expected services/');
    expect(() => archiveFromFiles(new Map([['services/2026/wrong/service.yaml', stringify(fixture())]]))).toThrow('id: must match');
    expect(() => archiveFromFiles(new Map([['services/2025/fixture-service/service.yaml', stringify(fixture())]]))).toThrow('date: must match');
    expect(() => parseYaml('id: first\nid: second\n', 'test.yaml')).toThrow('test.yaml');
  });
});

describe('publication and flat frontend contract', () => {
  for (const editorial of ['needs_review', 'reviewed'] as const) for (const media of ['unassessed', 'playable', 'failed', 'rejected'] as const) {
    it(`${editorial}/${media} are independent axes with exact publication gating`, () => {
      const service = fixture(); service.editorial_status = editorial;
      if (editorial === 'reviewed') { service.reviewed_by = 'Test Reviewer'; service.reviewed_at = '2026-01-05T00:00:00Z'; }
      service.videos[0].media_disposition = media;
      if (media === 'failed' || media === 'rejected') {
        expect(ServiceSchema.safeParse(service).success).toBe(false);
        service.videos[0].disposition_evidence = 'Fictional test evidence.';
      }
      expect(ServiceSchema.safeParse(service).success).toBe(true);
      expect(flattenArchive([service], 'production')).toHaveLength(editorial === 'reviewed' && media === 'playable' ? 1 : 0);
      const preview = flattenArchive([service], 'preview');
      expect(preview).toHaveLength(media === 'playable' ? 1 : 0);
      if (preview[0]) expect(preview[0].preview).toBe(editorial === 'needs_review');
    });
  }
  it('removes non-playable videos and sections even from mixed-service output', () => {
    const service = fixture();
    service.videos.push({ ...service.videos[0], id: 'BBBBBBBBBBB', sequence: 2, media_disposition: 'unassessed' });
    service.sections.push({ ...service.sections[0], id: 'second-section', video_id: 'BBBBBBBBBBB' });
    service.passages.push({ ...service.passages[0], id: 'second-passage', section_id: 'second-section', video_id: 'BBBBBBBBBBB' });
    const filtered = publishedServices([service], 'preview')[0];
    expect(filtered.videos).toHaveLength(1); expect(filtered.sections).toHaveLength(1); expect(filtered.passages).toHaveLength(1);
    expect(service.videos).toHaveLength(2);
  });
  it('flattens display names, inherited speakers and preview without leaking editorial notes', () => {
    const result = flattenArchive([fixture()], 'preview')[0];
    expect(result).toEqual({ id: 'fixture-passage', serviceId: 'fixture-service', serviceTitle: 'Fictional test service',
      videoId: 'AAAAAAAAAAA', start: 10, end: 60, title: 'Fictional passage', summary: 'The fictional speaker discusses a test example.',
      transcript: 'Fictional test transcript, not archive content.', questions: ['What does the test example show?'],
      topics: ['Fictional topic'], scripture: ['Romans 13:1-7'], speaker: 'Fictional speaker', date: '2026-01-04', type: 'address', preview: true });
  });
  it('orders passages deterministically by service date, upload sequence, timestamp, ID', () => {
    const service = fixture();
    service.passages.push({ ...service.passages[0], id: 'earlier', start: 0 });
    expect(flattenArchive([service], 'preview').map((p) => p.id)).toEqual(['earlier', 'fixture-passage']);
  });
  it('accepts all interpreted workflow states without treating completion as approval', () => {
    for (const status of ['in_progress', 'complete', 'blocked'] as WorkflowStatus[]) {
      const service = fixture(); service.workflow_status = status;
      if (status === 'blocked') service.blocked_reason = 'Test blocker.';
      expect(ServiceSchema.safeParse(service).success).toBe(true);
      expect(flattenArchive([service])).toEqual([]);
    }
  });
  it('builds deterministic labeled preview JSON and replaces it with empty production JSON', () => {
    const directory = root();
    expect(loadArchive(directory)).toEqual([]);
    expect(JSON.parse(readFileSync(buildIndex(directory), 'utf8'))).toEqual([]);
    put(directory, filename, stringify(fixture()));
    const production = buildIndex(directory);
    expect(JSON.parse(readFileSync(production, 'utf8'))).toEqual([]);
    const preview = buildIndex(directory, 'preview');
    expect(preview).toBe(production);
    expect(JSON.parse(readFileSync(preview, 'utf8'))[0].preview).toBe(true);
    const original = readFileSync(preview, 'utf8'); buildIndex(directory, 'preview');
    expect(readFileSync(preview, 'utf8')).toBe(original);
    buildIndex(directory, 'production');
    expect(JSON.parse(readFileSync(production, 'utf8'))).toEqual([]);
  });
  it('rejects unknown build modes and CLI arguments rather than falling back to preview', () => {
    expect(() => flattenArchive([fixture()], 'typo' as 'preview')).toThrow('Unknown archive build mode');
    expect(() => archiveCli(['build-index', '--mode', 'typo'])).toThrow('Usage');
  });
});
