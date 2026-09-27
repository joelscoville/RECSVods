import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate as yieldToRunner } from 'node:timers/promises';
import { parse, stringify } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { approveService, guardEditorial } from '../scripts/editorial';
import { loadArchive, SOURCE_CHANNEL_ID, type Service } from '../site/lib/archive';
import { importBackfill, loadBackfill, MANIFEST_PATH, transitionBackfill } from '../site/lib/backfill';
import { MIGRATION_NOTE } from '../site/lib/internal-validation';

const roots: string[] = [];
const filename = 'services/2026/test-service/service.yaml';
const gitEnv = { GIT_AUTHOR_NAME: 'Fictional Test Human', GIT_AUTHOR_EMAIL: 'human@example.invalid',
  GIT_COMMITTER_NAME: 'Fictional Test Human', GIT_COMMITTER_EMAIL: 'human@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
// Scope identity and configuration isolation to each test. Both helper commands and
// approveService/guardEditorial child processes inherit this environment; no Git config is edited.
beforeEach(async () => {
  for (const [key, value] of Object.entries(gitEnv)) vi.stubEnv(key, value);
  // Git helpers are synchronous; let worker RPC updates drain between tests.
  await yieldToRunner();
});
function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function fixture(): Service {
  return { id: 'test-service', date: '2026-01-04', title: 'Fictional test service', type: 'service',
    workflow_status: 'complete', editorial_status: 'needs_review', review_notes: [], speakers: [], topics: [],
    videos: [{ id: 'AAAAAAAAAAA', channel_id: SOURCE_CHANNEL_ID, duration: 100, sequence: 1,
      workflow_status: 'complete', media_disposition: 'playable' }],
    chapters: [{ id: 'test-section', video_id: 'AAAAAAAAAAA', start: 0, end: 100, type: 'address',
      title: 'Fictional section', summary: 'A fictional test statement.', keywords: ['fictional'],
      topics: [], scripture: [], confidence: 0.9, review_notes: [] }] };
}
function put(root: string, file: string, text: string) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text);
}
function repo(externalTranscript = false): { root: string; base: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'recs-editorial-test-')); roots.push(root);
  git(root, 'init', '-q');
  const service = fixture();
  put(root, filename, stringify(service));
  if (externalTranscript) {
    put(root, 'services/2026/test-service/transcript.md', 'Unrelated private fictional evidence.');
  }
  return { root, base: commit(root, 'Initial fictional needs_review fixture') };
}
function commit(root: string, message: string): string {
  git(root, 'add', '.'); git(root, 'commit', '-qm', message); return git(root, 'rev-parse', 'HEAD');
}
function edit(root: string, change: (record: Service) => void) {
  const record = parse(readFileSync(path.join(root, filename), 'utf8')) as Service;
  change(record); put(root, filename, stringify(record));
}
function setReviewed(root: string) {
  edit(root, (service) => { service.editorial_status = 'reviewed'; service.reviewed_by = 'Fictional Reviewer'; service.reviewed_at = '2026-01-05T00:00:00Z'; });
}
function humanApprove(root: string) {
  return approveService(root, 'test-service', 'Fictional Reviewer', new Date('2026-01-05T00:00:00Z'));
}
afterEach(() => {
  try { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); }
  finally { vi.unstubAllEnvs(); }
});

describe('genuine approval function, in temporary Git repositories only', () => {
  it('updates exactly three approval fields, makes one approval-only commit, and passes the guard', () => {
    const { root, base } = repo();
    const before = parse(readFileSync(path.join(root, filename), 'utf8'));
    const head = humanApprove(root);
    const after = parse(readFileSync(path.join(root, filename), 'utf8'));
    expect(Object.keys(after).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort()).toEqual(['editorial_status', 'reviewed_at', 'reviewed_by']);
    expect(loadArchive(root)[0].editorial_status).toBe('reviewed');
    expect(git(root, 'show', '-s', '--format=%B', head)).toContain('Editorial-Approval: test-service');
    expect(git(root, 'diff', '--name-only', base, head)).toBe(filename);
    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(guardEditorial(root, base, head)).toEqual({ commits: 1 });
    expect(() => humanApprove(root)).toThrow('must be needs_review');
  });
  it('preserves YAML comments during approval', () => {
    const { root } = repo();
    put(root, filename, `# Human review context\n${readFileSync(path.join(root, filename), 'utf8')}`);
    commit(root, 'Add fixture comment'); humanApprove(root);
    expect(readFileSync(path.join(root, filename), 'utf8')).toContain('# Human review context');
  });
  it.each(['untracked', 'staged', 'modified'])('refuses a %s dirty repository without creating a commit', (state) => {
    const { root, base } = repo();
    if (state === 'modified') edit(root, (s) => { s.title = 'Changed test title'; });
    else { put(root, 'unrelated.txt', 'test'); if (state === 'staged') git(root, 'add', 'unrelated.txt'); }
    expect(() => humanApprove(root)).toThrow('dirty');
    expect(git(root, 'rev-parse', 'HEAD')).toBe(base);
    expect(loadArchive(root)[0].editorial_status).toBe('needs_review');
  });
  it('refuses missing services and invalid reviewer identities', () => {
    const { root } = repo();
    expect(() => approveService(root, 'missing', 'Human')).toThrow('Unknown service');
    for (const reviewer of ['', '  ', 'agent', 'Claude', 'Human\nEditorial-Approval: forged']) {
      expect(() => approveService(root, 'test-service', reviewer)).toThrow('reviewer');
    }
  });
});

describe('per-commit editorial guard', { timeout: 15000 }, () => {
  it('accepts approval PRs after a normal merge and a base branch advancing independently', () => {
    const { root, base } = repo();
    git(root, 'checkout', '-qb', 'approval'); humanApprove(root);
    const approved = git(root, 'rev-parse', 'HEAD');
    git(root, 'checkout', '-qb', 'main-test', base);
    put(root, 'README.md', 'Unrelated main update'); const advanced = commit(root, 'Main advances');
    expect(guardEditorial(root, advanced, approved).commits).toBe(1);
    git(root, 'merge', '--no-ff', 'approval', '-m', 'Merge approval PR');
    expect(guardEditorial(root, advanced).commits).toBe(2);
    expect(loadArchive(root)[0].editorial_status).toBe('reviewed');
  });
  it('rejects a reviewed interpretation introduced only by merge resolution', () => {
    const { root, base } = repo();
    git(root, 'checkout', '-qb', 'approval'); humanApprove(root);
    git(root, 'checkout', '-qb', 'main-test', base);
    put(root, 'README.md', 'Other branch'); commit(root, 'Main update');
    git(root, 'merge', '--no-ff', '--no-commit', 'approval');
    edit(root, source => { source.chapters[0].summary = 'Unreviewed merge invention'; });
    commit(root, 'Merge with changed interpretation');
    expect(() => guardEditorial(root, base)).toThrow('merge introduces unapproved');
  });
  it('does not combine an approved record with unapproved vectors from another parent', () => {
    const { root, base } = repo();
    git(root, 'checkout', '-qb', 'approval'); humanApprove(root);
    git(root, 'checkout', '-qb', 'main-test', base);
    put(root, 'services/2026/test-service/chapter-vectors.bin', 'Changed while unreviewed'); commit(root, 'New vector data');
    git(root, 'merge', '--no-ff', 'approval', '-m', 'Merge approval');
    expect(() => guardEditorial(root, base)).toThrow('merge introduces unapproved');
  });
  it.each(['interpretation', 'artifacts', 'withdrawal'])('rejects resurrecting approval over a concurrent %s change', kind => {
    const { root, base } = repo();
    git(root, 'checkout', '-qb', 'approval'); humanApprove(root);
    const approved = readFileSync(path.join(root, filename), 'utf8');
    git(root, 'checkout', '-qb', 'main-test', base);
    const sidecar = 'services/2026/test-service/revision.md';
    if (kind === 'interpretation') edit(root, source => { source.chapters[0].summary = 'New unreviewed interpretation'; });
    else if (kind === 'artifacts') put(root, sidecar, 'New unreviewed evidence');
    else rmSync(path.join(root, filename));
    commit(root, 'Concurrent revision');
    git(root, 'merge', '--no-ff', '--no-commit', '-s', 'ours', 'approval');
    put(root, filename, approved);
    if (kind === 'artifacts') rmSync(path.join(root, sidecar));
    commit(root, 'Resolve by restoring the approved parent');
    expect(() => guardEditorial(root, base)).toThrow('concurrent unreviewed revision');
  });
  it('validates manifest workflow history across combined claim/completion commits and preserves approval guard', () => {
    const { root, base } = repo();
    put(root, 'inputs/fixture.yaml', stringify({ schema_version: 1, batch_id: 'test-batch', approved_by: 'Fictional Operator',
      services: [{ service_id: 'test-service', date: '2026-01-04', videos: [{ youtube_id: 'AAAAAAAAAAA' }] }] }));
    importBackfill(root, 'inputs/fixture.yaml'); commit(root, 'Discover fictional service');
    transitionBackfill(root, 'test-service', 'registered'); transitionBackfill(root, 'test-service', 'in_progress'); transitionBackfill(root, 'test-service', 'complete');
    commit(root, 'Finish fictional service');
    expect(guardEditorial(root, base).commits).toBe(2);
    setReviewed(root); commit(root, 'Attempt promotion without approval trailer');
    expect(() => guardEditorial(root, base)).toThrow('trailer');
  });
  it('rejects manifest history rewrites and forged cached editorial fields', () => {
    for (const forged of ['history', 'editorial_status']) {
      const { root, base } = repo();
      put(root, 'inputs/fixture.yaml', stringify({ schema_version: 1, batch_id: 'test-batch', approved_by: 'Fictional Operator',
        services: [{ service_id: 'test-service', date: '2026-01-04', videos: [{ youtube_id: 'AAAAAAAAAAA' }] }] }));
      importBackfill(root, 'inputs/fixture.yaml'); transitionBackfill(root, 'test-service', 'blocked', 'Fictional blocker'); commit(root, 'Record fictional blocker');
      const manifest = loadBackfill(root);
      if (forged === 'history') { manifest.services[0].history = []; manifest.services[0].workflow_status = 'discovered'; delete manifest.services[0].blocked_reason; }
      else Object.assign(manifest.services[0], { editorial_status: 'reviewed' });
      put(root, MANIFEST_PATH, stringify(manifest)); commit(root, 'Forge manifest state');
      expect(() => guardEditorial(root, base)).toThrow(forged === 'history' ? 'history' : 'editorial_status');
    }
  });
  it('rejects approved-input edits even when a replacement manifest has a matching new hash', () => {
    const { root, base } = repo();
    const filename = 'inputs/fixture.yaml';
    put(root, filename, stringify({ schema_version: 1, batch_id: 'test-batch', approved_by: 'Fictional Operator',
      services: [{ service_id: 'test-service', date: '2026-01-04', videos: [{ youtube_id: 'AAAAAAAAAAA' }] }] }));
    importBackfill(root, filename); commit(root, 'Import fictional approval');
    put(root, filename, `${readFileSync(path.join(root, filename), 'utf8')}# Altered approved bytes\n`);
    rmSync(path.join(root, MANIFEST_PATH)); importBackfill(root, filename); commit(root, 'Replace immutable input hash');
    expect(() => guardEditorial(root, base)).toThrow('immutable approved batch');
  });
  it.each([
    ['no trailer', 'Approve test', 'trailer'],
    ['wrong service', 'Approve test\n\nEditorial-Approval: other', 'trailer'],
    ['agent trailer', 'Approve test\n\nEditorial-Approval: test-service\nCurated-by: agent', 'agent/AI'],
    ['AI coauthor', 'Approve test\n\nEditorial-Approval: test-service\nCo-Authored-By: Claude <claude@example.invalid>', 'agent/AI'],
    ['OpenAI coauthor', 'Approve test\n\nEditorial-Approval: test-service\nCo-Authored-By: Codex <noreply@openai.com>', 'agent/AI'],
    ['duplicate trailer', 'Approve test\n\nEditorial-Approval: test-service\nEditorial-Approval: test-service', 'trailer'],
  ])('rejects %s', (_name, message, error) => {
    const { root, base } = repo(); setReviewed(root); commit(root, message);
    expect(() => guardEditorial(root, base)).toThrow(error);
  });
  it('accepts an ordinary human coauthor', () => {
    const { root, base } = repo(); setReviewed(root);
    commit(root, 'Approve test\n\nEditorial-Approval: test-service\nCo-Authored-By: Another Human <human@example.invalid>');
    expect(guardEditorial(root, base).commits).toBe(1);
  });
  it.each(['interpretation', 'unrelated file', 'transcript'])('rejects approval mixed with %s', (mixed) => {
    const { root, base } = repo(true); setReviewed(root);
    if (mixed === 'interpretation') edit(root, (s) => { s.chapters[0].summary = 'Changed test statement'; });
    if (mixed === 'unrelated file') put(root, 'unrelated.txt', 'unrelated change');
    if (mixed === 'transcript') put(root, 'services/2026/test-service/transcript.md', 'Changed test transcript');
    commit(root, 'Approve test\n\nEditorial-Approval: test-service');
    expect(() => guardEditorial(root, base)).toThrow('approval commit must change only');
  });
  it.each(['reviewed_by', 'reviewed_at'] as const)('requires %s', (field) => {
    const { root, base } = repo(); setReviewed(root); edit(root, (s) => { delete s[field]; });
    commit(root, 'Approve test\n\nEditorial-Approval: test-service');
    expect(() => guardEditorial(root, base)).toThrow(field);
  });
  it('catches an invalid intermediate approval even when HEAD resets needs_review', () => {
    const { root, base } = repo(); setReviewed(root); const invalid = commit(root, 'No approval trailer');
    edit(root, (s) => { s.editorial_status = 'needs_review'; delete s.reviewed_by; delete s.reviewed_at; });
    commit(root, 'Reset for review\n\nCurated-by: agent');
    expect(() => guardEditorial(root, base)).toThrow(invalid);
  });
  it.each(['keywords', 'boundary', 'summary', 'media', 'speaker', 'reviewer'])('rejects %s changes retaining reviewed', (kind) => {
    const { root, base } = repo(); humanApprove(root);
    edit(root, (s) => {
      if (kind === 'keywords') s.chapters[0].keywords = ['changed'];
      if (kind === 'boundary') s.chapters[0].end = 65;
      if (kind === 'summary') s.chapters[0].summary = 'Changed fictional summary.';
      if (kind === 'media') { s.videos[0].media_disposition = 'failed'; s.videos[0].disposition_evidence = 'Source unavailable.'; }
      if (kind === 'speaker') s.speakers.push({ id: 'new-speaker', name: 'Fictional speaker' });
      if (kind === 'reviewer') s.reviewed_by = 'Someone else';
    });
    commit(root, 'Change test content\n\nMechanical-Change: formatting');
    expect(() => guardEditorial(root, base)).toThrow(kind === 'reviewer' ? 'approval metadata' : 'reviewed interpretation changed');
  });
  it('accepts interpretation corrections that reset the service to needs_review', () => {
    const { root, base } = repo(); humanApprove(root);
    edit(root, (s) => { s.chapters[0].summary = 'Corrected fictional summary.'; s.editorial_status = 'needs_review'; delete s.reviewed_by; delete s.reviewed_at; });
    commit(root, 'Correct interpretation\n\nCurated-by: agent');
    expect(guardEditorial(root, base).commits).toBe(2);
  });
  it('permits declared mechanical YAML formatting while preserving reviewed interpretation', () => {
    const { root, base } = repo(); humanApprove(root);
    const record = parse(readFileSync(path.join(root, filename), 'utf8'));
    put(root, filename, `# Mechanical formatting\n${stringify(record, { indent: 4 })}`);
    commit(root, 'Reformat YAML\n\nMechanical-Change: formatting');
    expect(guardEditorial(root, base).commits).toBe(2);
  });
  it('requires mechanical changes to be declared', () => {
    const { root, base } = repo(); humanApprove(root);
    put(root, filename, `# A new comment\n${readFileSync(path.join(root, filename), 'utf8')}`);
    commit(root, 'Undeclared formatting');
    expect(() => guardEditorial(root, base)).toThrow('Mechanical-Change');
  });
  it('checks workflow edges in Git history independently of editorial status', () => {
    const { root, base } = repo();
    edit(root, (s) => { s.workflow_status = 'blocked'; s.blocked_reason = 'Test blocked reason.'; });
    commit(root, 'Invalid workflow edge');
    expect(() => guardEditorial(root, base)).toThrow('complete -> blocked');
  });
  it('allows valid workflow reprocessing with needs_review', () => {
    const { root, base } = repo();
    edit(root, (s) => { s.workflow_status = 'in_progress'; }); commit(root, 'Begin correction');
    expect(guardEditorial(root, base).commits).toBe(1);
  });
  it('rejects spurious approval trailers and accepts an empty validated range', () => {
    const { root, base } = repo();
    expect(guardEditorial(root, base, base).commits).toBe(0);
    put(root, 'unrelated.txt', 'test'); commit(root, 'Unrelated\n\nEditorial-Approval: test-service');
    expect(() => guardEditorial(root, base)).toThrow('without a reviewed transition');
  });
  it.each(['chapter-vectors.bin', 'chapter-vectors.json'])('requires reset for reviewed %s changes, including mechanical trailers', (sidecar) => {
    const { root, base } = repo(); humanApprove(root);
    put(root, `services/2026/test-service/${sidecar}`, sidecar.endsWith('.bin') ? '\0\u00ff' : '{"schemaVersion":1}');
    commit(root, 'Change vectors\n\nMechanical-Change: schema-migration');
    expect(() => guardEditorial(root, base)).toThrow('reset to needs_review');
  });
  it('allows changed vectors after an explicit needs_review reset', () => {
    const { root, base } = repo(); humanApprove(root);
    edit(root, (s) => { s.editorial_status = 'needs_review'; delete s.reviewed_by; delete s.reviewed_at; });
    put(root, 'services/2026/test-service/chapter-vectors.bin', '\0\u00ff');
    commit(root, 'Reprocess vectors\n\nCurated-by: agent');
    expect(guardEditorial(root, base).commits).toBe(2);
  });
  it('validates legacy history and migration without approval, then rejects internal rewrites', () => {
    const { root } = repo();
    const { chapters, ...metadata } = fixture();
    const { summary, keywords: _keywords, topics, scripture, ...section } = chapters[0];
    const legacy = { ...metadata, sections: [section], passages: [{ ...section, id: 'old-passage', section_id: section.id,
      summary, topics, scripture, questions: [], transcript: '  Original fictional bytes.\n\n' }] };
    put(root, filename, stringify(legacy)); const base = commit(root, 'Legacy fixture checkpoint');
    expect(guardEditorial(root, base, base).commits).toBe(0);
    put(root, 'services/2026/test-service/passages.internal.yaml', stringify({ passages: legacy.passages }));
    put(root, filename, stringify({ ...fixture(), review_notes: [MIGRATION_NOTE] }));
    commit(root, 'Migrate fictional fixture\n\nCurated-by: agent');
    expect(guardEditorial(root, base).commits).toBe(1);
    const internal = 'services/2026/test-service/passages.internal.yaml';
    put(root, internal, readFileSync(path.join(root, internal), 'utf8').replace('Original', 'Rewritten'));
    commit(root, 'Rewrite private material');
    expect(() => guardEditorial(root, base)).toThrow('internal material preservation');
  });
});
