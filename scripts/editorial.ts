import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument } from 'yaml';
import {
  assertWorkflowTransition, IdentifierRecordSchema, loadArchive,
  parseWithPath, parseYaml, ServiceSourceSchema, type WorkflowStatus,
} from '../site/lib/archive';
import { historyArchiveFromFiles, historySource, type HistoryService } from '../site/lib/legacy-schema';
import { assertInternalHistory } from '../site/lib/internal-validation';
import { assertManifestDiff, BackfillManifestSchema, MANIFEST_PATH, manifestFromFiles, validateManifestReferences } from '../site/lib/backfill';

const APPROVAL_FIELDS = ['editorial_status', 'reviewed_by', 'reviewed_at'] as const;
function git(root: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}
function withoutApproval(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !(APPROVAL_FIELDS as readonly string[]).includes(key)));
}
function treeFiles(root: string, revision: string): Map<string, string> {
  const files = new Map<string, string>();
  const entries = git(root, ['ls-tree', '-r', '-z', revision]).split('\0').filter(Boolean);
  const manifestEntry = entries.find((entry) => entry.endsWith(`\t${MANIFEST_PATH}`));
  const inputPaths = new Set<string>();
  if (manifestEntry) {
    const match = /^(\d+) blob ([a-f0-9]+)\t/.exec(manifestEntry);
    if (!match || match[1] === '120000') throw new Error(`${revision}:${MANIFEST_PATH}: invalid manifest tree entry`);
    const text = execFileSync('git', ['cat-file', 'blob', match[2]], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const manifest = parseWithPath(BackfillManifestSchema, parseYaml(text, MANIFEST_PATH), MANIFEST_PATH);
    manifest.batches.forEach((batch) => inputPaths.add(batch.discovery_source));
  }
  for (const entry of entries) {
    const filenameInTree = entry.slice(entry.indexOf('\t') + 1);
    if (!filenameInTree.startsWith('services/') && !filenameInTree.startsWith('corpus/') && !inputPaths.has(filenameInTree)) continue;
    const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match) throw new Error(`${revision}: unsupported archive tree entry ${entry}`);
    const [, mode, hash, filename] = match;
    if (mode === '120000') throw new Error(`${revision}:${filename}: archive symlinks are not allowed`);
    if (filename.endsWith('.bin')) files.set(filename, `git-blob:${hash}`);
    else if (/\.(ya?ml|md|json)$/.test(filename) || inputPaths.has(filename)) {
      // Preserve transcript whitespace; git() trims command-oriented outputs only.
      files.set(filename, execFileSync('git', ['cat-file', 'blob', hash], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    }
  }
  return files;
}
function serviceSources(files: ReadonlyMap<string, string>) {
  return new Map([...files].filter(([filename]) => /^services\/\d{4}\/[^/]+\/service\.yaml$/.test(filename)).map(([filename, text]) => {
    const source = historySource(text, filename);
    return [source.id, { filename, source, raw: parseYaml(text, filename) as Record<string, unknown> }] as const;
  }));
}
function workflowRecords(files: ReadonlyMap<string, string>, services: readonly HistoryService[]) {
  const records = new Map<string, WorkflowStatus>();
  for (const service of services) {
    records.set(`service:${service.id}`, service.workflow_status);
    for (const video of service.videos) records.set(`video:${video.id}`, video.workflow_status);
  }
  for (const [filename, text] of files) if (filename !== MANIFEST_PATH && filename.startsWith('corpus/') && /\.ya?ml$/.test(filename)) {
    const record = parseWithPath(IdentifierRecordSchema, parseYaml(text, filename), filename);
    records.set(`corpus:${record.youtube_id}`, record.workflow_status);
  }
  return records;
}
function trailers(root: string, message: string): string[] {
  return git(root, ['interpret-trailers', '--parse'], message).split('\n').filter(Boolean);
}
const AI_ATTRIBUTION = /(?:\b(?:ai|agent|claude|anthropic|openai|chatgpt|gpt|codex|copilot|cursor|gemini|aider|opencode|devin|codeium|windsurf|deepseek|qwen|grok)\b|\[bot\])/i;

function checkCommit(root: string, parent: string, commit: string, message: string): void {
  const beforeFiles = treeFiles(root, parent);
  const afterFiles = treeFiles(root, commit);
  const before = historyArchiveFromFiles(beforeFiles);
  const after = historyArchiveFromFiles(afterFiles);
  assertInternalHistory(beforeFiles, afterFiles);
  const oldManifest = manifestFromFiles(beforeFiles); const newManifest = manifestFromFiles(afterFiles);
  validateManifestReferences(oldManifest, before, beforeFiles);
  validateManifestReferences(newManifest, after, afterFiles);
  assertManifestDiff(oldManifest, newManifest);
  const oldSources = serviceSources(beforeFiles);
  const newSources = serviceSources(afterFiles);
  const changed = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--no-renames', parent, commit]).split('\0').filter(Boolean);
  const commitTrailers = trailers(root, message);
  const approvalTrailers = commitTrailers.filter((t) => /^Editorial-Approval:/i.test(t));
  const approvals: string[] = [];
  const oldWorkflows = workflowRecords(beforeFiles, before);
  for (const [id, status] of workflowRecords(afterFiles, after)) {
    const old = oldWorkflows.get(id);
    if (old && old !== status) {
      try { assertWorkflowTransition(old, status); }
      catch (error) { throw new Error(`${id}: ${String(error)}`); }
    }
  }
  for (const service of after) {
    const previous = before.find((s) => s.id === service.id);
    if (service.editorial_status !== 'reviewed') continue;
    const source = newSources.get(service.id)!;
    if (previous?.editorial_status !== 'reviewed') {
      approvals.push(service.id);
      const oldSource = oldSources.get(service.id);
      if (!oldSource || !isDeepStrictEqual(withoutApproval(oldSource.raw), withoutApproval(source.raw))) {
        throw new Error(`${source.filename}: approval commit must change only the three approval fields on an existing service`);
      }
      if (changed.length !== 1 || changed[0] !== source.filename || oldSource.filename !== source.filename) {
        throw new Error(`${source.filename}: approval commit must change only that service.yaml, with no other files`);
      }
      if (!APPROVAL_FIELDS.every((field) => !isDeepStrictEqual(oldSource.raw[field], source.raw[field]))) {
        throw new Error(`${source.filename}: approval must update exactly editorial_status, reviewed_by, reviewed_at`);
      }
      if (approvalTrailers.length !== 1 || approvalTrailers[0] !== `Editorial-Approval: ${service.id}`) {
        throw new Error(`${source.filename}: missing or mismatched Editorial-Approval trailer`);
      }
      if (commitTrailers.some((t) => /^Curated-by:\s*agent\b/i.test(t)
        || (/^Co-Authored-By:/i.test(t) && AI_ATTRIBUTION.test(t)))) {
        throw new Error(`${source.filename}: agent/AI-attributed commits cannot approve interpretation`);
      }
    } else {
      if (!isDeepStrictEqual(withoutApproval(previous), withoutApproval(service))) {
        throw new Error(`${source.filename}: reviewed interpretation changed; reset to needs_review and clear review metadata`);
      }
      if (previous.reviewed_by !== service.reviewed_by || previous.reviewed_at !== service.reviewed_at) {
        throw new Error(`${source.filename}: reviewed approval metadata cannot be rewritten while retaining reviewed`);
      }
      const oldSource = oldSources.get(service.id)!;
      const related = new Set([source.filename, oldSource.filename]);
      for (const record of [source, oldSource]) if ('passages' in record.source) for (const passage of record.source.passages) {
        if (passage.transcript_file) {
          const external = path.posix.join(path.posix.dirname(record.filename), passage.transcript_file);
          related.add(external);
          if (beforeFiles.get(external) !== afterFiles.get(external)) throw new Error(`${source.filename}: reviewed interpretation changed; reset to needs_review and clear review metadata`);
        }
      }
      const directories = [source.filename, oldSource.filename].map((filename) => `${path.posix.dirname(filename)}/`);
      if (changed.some((filename) => directories.some((directory) => filename.startsWith(directory)) && /\.(bin|json)$/.test(filename))) {
        throw new Error(`${source.filename}: reviewed vector/compatibility sidecar changed; reset to needs_review and clear review metadata`);
      }
      if (changed.some((filename) => related.has(filename))
        && !commitTrailers.some((t) => /^Mechanical-Change:\s*(formatting|schema-migration)$/i.test(t))) {
        throw new Error(`${source.filename}: mechanical changes retaining reviewed require Mechanical-Change: formatting (or schema-migration)`);
      }
    }
  }
  if (approvalTrailers.length && !approvals.length) throw new Error('Editorial-Approval trailer without a reviewed transition');
}

/** Check every commit reachable from HEAD but not BASE, including every merge parent. */
export function guardEditorial(root: string, base: string, head = 'HEAD'): { commits: number } {
  const baseId = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
  const headId = git(root, ['rev-parse', '--verify', '--end-of-options', `${head}^{commit}`]);
  try { git(root, ['merge-base', '--is-ancestor', baseId, headId]); }
  catch { throw new Error('editorial guard BASE must be an ancestor of HEAD'); }
  // Validate the final tree even for an empty range.
  const finalFiles = treeFiles(root, headId);
  validateManifestReferences(manifestFromFiles(finalFiles), historyArchiveFromFiles(finalFiles), finalFiles);
  const commits = git(root, ['rev-list', '--reverse', '--topo-order', `${baseId}..${headId}`]).split('\n').filter(Boolean);
  for (const commit of commits) {
    const parents = git(root, ['show', '-s', '--format=%P', commit]).split(' ').filter(Boolean);
    const message = git(root, ['show', '-s', '--format=%B', commit]);
    for (const parent of parents) {
      try { checkCommit(root, parent, commit, message); }
      catch (error) { throw new Error(`${commit}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  return { commits: commits.length };
}

/** Human-only command. Tests invoke this solely in disposable fictional repositories. */
export function approveService(root: string, serviceId: string, reviewer: string, now = new Date()): string {
  if (!reviewer.trim() || /[\r\n]/.test(reviewer)) throw new Error('reviewer must be a non-empty single-line human name');
  if (AI_ATTRIBUTION.test(reviewer)) throw new Error('reviewer must identify the human reviewer, not an agent');
  const repositoryRoot = git(root, ['rev-parse', '--show-toplevel']);
  if (realpathSync(root) !== realpathSync(repositoryRoot)) throw new Error('approval must run from the repository root');
  if (git(root, ['status', '--porcelain=v1', '--untracked-files=all'])) throw new Error('Refusing approval: repository is dirty (including staged or untracked files)');
  const service = loadArchive(root).find((s) => s.id === serviceId);
  if (!service) throw new Error(`Unknown service: ${serviceId}`);
  if (service.editorial_status !== 'needs_review') throw new Error(`${serviceId}: service must be needs_review before approval`);
  const filename = `services/${service.date.slice(0, 4)}/${service.id}/service.yaml`;
  git(root, ['ls-files', '--error-unmatch', '--', filename]);
  const absolute = path.join(root, filename);
  const original = readFileSync(absolute, 'utf8');
  const document = parseDocument(original);
  document.set('editorial_status', 'reviewed');
  document.set('reviewed_by', reviewer.trim());
  document.set('reviewed_at', now.toISOString());
  const updated = document.toString();
  parseWithPath(ServiceSourceSchema, parseYaml(updated, filename), filename);
  const before = parseYaml(original, filename) as Record<string, unknown>;
  const after = parseYaml(updated, filename) as Record<string, unknown>;
  if (!isDeepStrictEqual(withoutApproval(before), withoutApproval(after))) throw new Error('Approval would modify interpretation');
  const base = git(root, ['rev-parse', 'HEAD']);
  writeFileSync(absolute, updated);
  git(root, ['add', '--', filename]);
  // Do not skip hooks, amend, reset, or hide a rejected commit. A failed hook leaves the approval for human inspection.
  git(root, ['commit', '-m', `Approve service ${serviceId}\n\nEditorial-Approval: ${serviceId}`]);
  const commit = git(root, ['rev-parse', 'HEAD']);
  guardEditorial(root, base, commit);
  return commit;
}

export function editorialCli(args = process.argv.slice(2)): void {
  const [command, ...rest] = args.filter((arg) => arg !== '--');
  if (command === 'approve' && rest.length === 3 && rest[1] === '--reviewer') {
    console.log(approveService(process.cwd(), rest[0], rest[2]));
  } else if (command === 'guard' && rest.length === 2) {
    console.log(`Editorial guard passed: ${guardEditorial(process.cwd(), rest[0], rest[1]).commits} commit(s).`);
  } else throw new Error('Usage: tsx scripts/editorial.ts approve -- <service-id> --reviewer <human-name> | guard <BASE> <HEAD>');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { editorialCli(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
