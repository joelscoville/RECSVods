import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { stringify } from 'yaml';
import { z } from 'zod';
import { archiveFromFiles, assertWorkflowTransition, IdentifierRecordSchema, parseWithPath, parseYaml,
  ScriptureInputSchema, SOURCE_CHANNEL_ID, WorkflowStatusSchema, YoutubeIdSchema, type Service, type WorkflowStatus } from './archive';

export const MANIFEST_PATH = 'corpus/manifest.yaml';
export const DEFAULT_BATCH_LIMIT = 20;
const Text = z.string().trim().min(1);
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const date = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
});
const RelativePath = z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_./-]+$/);
const Known = z.object({ speaker: Text.optional(), scripture: z.array(ScriptureInputSchema).optional() }).strict();
const InputService = z.object({ service_id: Id.optional(), date: DateOnly, title: Text.optional(),
  videos: z.array(z.object({ youtube_id: YoutubeIdSchema }).strict()).min(1), known: Known.optional(), notes: Text.optional() }).strict();
export const BackfillInputSchema = z.object({ schema_version: z.literal(1), batch_id: Id,
  approved_by: z.string(), approved_at: DateOnly.optional(), services: z.array(InputService) }).strict().superRefine((input, ctx) => {
  const ids = new Set<string>(); const videos = new Set<string>();
  input.services.forEach((service, i) => {
    const id = service.service_id ?? service.date;
    if (ids.has(id)) ctx.addIssue({ code: 'custom', path: ['services', i], message: `duplicate service ID ${id}; supply distinct service_id for same-date services` });
    ids.add(id);
    for (const video of service.videos) {
      if (videos.has(video.youtube_id)) ctx.addIssue({ code: 'custom', path: ['services', i, 'videos'], message: `duplicate input ID ${video.youtube_id}` });
      videos.add(video.youtube_id);
    }
  });
});
const TransitionSchema = z.object({ to: WorkflowStatusSchema.exclude(['discovered']), reason: Text.optional() }).strict();
const EntrySchema = z.object({ service_id: Id, batch_id: Id, source_order: z.number().int().nonnegative(), date: DateOnly,
  sourceFileRef: RelativePath, title: Text.optional(), known: Known.optional(), notes: Text.optional(),
  videos: z.array(z.object({ youtube_id: YoutubeIdSchema, channel_id: z.literal(SOURCE_CHANNEL_ID),
    sequence: z.number().int().positive() }).strict()).min(1),
  workflow_status: WorkflowStatusSchema, blocked_reason: Text.optional(), history: z.array(TransitionSchema),
}).strict().superRefine((entry, ctx) => {
  let status: WorkflowStatus = 'discovered'; let reason: string | undefined;
  for (const edge of entry.history) {
    try { assertWorkflowTransition(status, edge.to); }
    catch (error) { ctx.addIssue({ code: 'custom', path: ['history'], message: String(error) }); }
    if ((edge.to === 'blocked') !== Boolean(edge.reason)) ctx.addIssue({ code: 'custom', path: ['history'], message: 'reason required exactly for blocked transitions' });
    status = edge.to; reason = edge.reason;
  }
  if (status !== entry.workflow_status || reason !== entry.blocked_reason) ctx.addIssue({ code: 'custom', path: ['workflow_status'], message: 'status and blocked_reason must match history' });
  if (entry.sourceFileRef !== `services/${entry.date.slice(0, 4)}/${entry.service_id}/service.yaml`) ctx.addIssue({ code: 'custom', path: ['sourceFileRef'], message: 'must match service ID and date' });
  entry.videos.forEach((video, i) => { if (video.sequence !== i + 1) ctx.addIssue({ code: 'custom', path: ['videos', i], message: 'sequence must preserve supplied order' }); });
});
export const BackfillManifestSchema = z.object({ schema_version: z.literal(1),
  batches: z.array(z.object({ batch_id: Id, discovery_source: RelativePath, input_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    approved_by: z.string(), approved_at: DateOnly.optional(), approved_count: z.number().int().nonnegative() }).strict()),
  services: z.array(EntrySchema),
}).strict();
export type BackfillManifest = z.infer<typeof BackfillManifestSchema>;
export type BackfillEntry = BackfillManifest['services'][number];
export const emptyManifest = (): BackfillManifest => ({ schema_version: 1, batches: [], services: [] });
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const immutableEntry = ({ workflow_status: _status, blocked_reason: _reason, history: _history, ...entry }: BackfillEntry) => entry;

function inputEntries(input: z.infer<typeof BackfillInputSchema>): BackfillEntry[] {
  if (!input.approved_by.trim()) return [];
  return input.services.map(({ service_id, videos, ...metadata }, source_order) => {
    const id = service_id ?? metadata.date;
    return { service_id: id, batch_id: input.batch_id, source_order, ...metadata,
      sourceFileRef: `services/${metadata.date.slice(0, 4)}/${id}/service.yaml`,
      videos: videos.map((video, i) => ({ ...video, channel_id: SOURCE_CHANNEL_ID, sequence: i + 1 })),
      workflow_status: 'discovered', history: [] };
  });
}

/** Strict registry + approved input validation. No authoritative content is cached. */
export function manifestFromFiles(files: ReadonlyMap<string, string>): BackfillManifest {
  const text = files.get(MANIFEST_PATH);
  if (text === undefined) return emptyManifest();
  const manifest = parseWithPath(BackfillManifestSchema, parseYaml(text, MANIFEST_PATH), MANIFEST_PATH);
  const batches = new Set<string>(); const services = new Set<string>(); const videos = new Set<string>();
  for (const batch of manifest.batches) {
    if (batches.has(batch.batch_id)) throw new Error(`duplicate batch ID ${batch.batch_id}`);
    batches.add(batch.batch_id);
    const inputText = files.get(batch.discovery_source);
    if (inputText === undefined) throw new Error(`missing discovery_source ${batch.discovery_source}`);
    if (sha(inputText) !== batch.input_sha256) throw new Error(`${batch.batch_id}: approved input content hash changed`);
    const input = parseWithPath(BackfillInputSchema, parseYaml(inputText, batch.discovery_source), batch.discovery_source);
    if (input.batch_id !== batch.batch_id || input.approved_by !== batch.approved_by || input.approved_at !== batch.approved_at
      || batch.approved_count !== (input.approved_by.trim() ? input.services.length : 0)) throw new Error(`${batch.batch_id}: approved input metadata mismatch`);
    if (!isDeepStrictEqual(manifest.services.filter((e) => e.batch_id === batch.batch_id).map(immutableEntry), inputEntries(input).map(immutableEntry))) {
      throw new Error(`${batch.batch_id}: source assignment/order/trusted metadata mismatch`);
    }
  }
  for (const entry of manifest.services) {
    if (!batches.has(entry.batch_id)) throw new Error(`${entry.service_id}: unknown batch`);
    if (services.has(entry.service_id)) throw new Error(`duplicate service ID ${entry.service_id}`);
    services.add(entry.service_id);
    for (const video of entry.videos) {
      if (videos.has(video.youtube_id)) throw new Error(`duplicate video assignment ${video.youtube_id}`);
      videos.add(video.youtube_id);
    }
  }
  return manifest;
}

/** Validate assignments against ALL interpreted sources, even entries not yet complete. */
export function validateManifestReferences(manifest: BackfillManifest, services: readonly Service[], files: ReadonlyMap<string, string>): void {
  for (const entry of manifest.services) {
    const service = services.find((s) => s.id === entry.service_id);
    for (const video of entry.videos) {
      const owner = services.find((s) => s.videos.some((v) => v.id === video.youtube_id));
      if (owner && owner.id !== entry.service_id) throw new Error(`${video.youtube_id}: source assignment mismatch (${owner.id})`);
      for (const [filename, text] of files) if (filename !== MANIFEST_PATH && filename.startsWith('corpus/') && /\.ya?ml$/.test(filename)) {
        const legacy = parseWithPath(IdentifierRecordSchema, parseYaml(text, filename), filename);
        if (legacy.youtube_id === video.youtube_id && legacy.date !== entry.date) throw new Error(`${filename}: source date mismatch`);
      }
    }
    if (service && (service.date !== entry.date || !isDeepStrictEqual(service.videos.map((v) => v.id), entry.videos.map((v) => v.youtube_id)))) {
      throw new Error(`${entry.service_id}: source assignment/date/order mismatch`);
    }
    if (entry.workflow_status === 'complete' && (!service || service.workflow_status !== 'complete')) throw new Error(`${entry.service_id}: complete requires matching complete interpreted source`);
  }
}

/** History is append-only, including when several legal edges land in one commit. */
export function assertManifestDiff(before: BackfillManifest, after: BackfillManifest): void {
  for (const batch of before.batches) if (!isDeepStrictEqual(batch, after.batches.find((b) => b.batch_id === batch.batch_id))) throw new Error(`${batch.batch_id}: immutable approved batch changed or removed`);
  for (const entry of before.services) {
    const next = after.services.find((e) => e.service_id === entry.service_id);
    if (!next || !isDeepStrictEqual(immutableEntry(entry), immutableEntry(next)) || !isDeepStrictEqual(entry.history, next.history.slice(0, entry.history.length))) {
      throw new Error(`${entry.service_id}: immutable assignment or workflow history changed/removed`);
    }
  }
}

// Fail closed on symlinks; input paths are repository-relative, never copied or rewritten.
function safePath(root: string, relative: string): string {
  RelativePath.parse(relative);
  let current = path.resolve(root);
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${relative}: symlinks are not allowed`);
  }
  return current;
}
function registryFiles(root: string): Map<string, string> {
  const files = new Map<string, string>(); const filename = safePath(root, MANIFEST_PATH);
  if (!existsSync(filename)) return files;
  const text = readFileSync(filename, 'utf8'); files.set(MANIFEST_PATH, text);
  const manifest = parseWithPath(BackfillManifestSchema, parseYaml(text, MANIFEST_PATH), MANIFEST_PATH);
  for (const batch of manifest.batches) files.set(batch.discovery_source, readFileSync(safePath(root, batch.discovery_source), 'utf8'));
  return files;
}
function addArchiveFiles(root: string, files: Map<string, string>, scope?: string): void {
  const walk = (relative: string) => {
    const absolute = safePath(root, relative);
    if (!existsSync(absolute)) return;
    if (lstatSync(absolute).isDirectory()) for (const name of readdirSync(absolute).sort()) walk(`${relative}/${name}`);
    else if (/\.(ya?ml|md)$/.test(relative) && relative !== MANIFEST_PATH) files.set(relative, readFileSync(absolute, 'utf8'));
  };
  if (scope) walk(path.posix.dirname(scope));
  else { walk('services'); walk('corpus'); }
}
export function validateBackfill(root = process.cwd(), services?: readonly Service[]): BackfillManifest {
  const files = registryFiles(root); const manifest = manifestFromFiles(files);
  if (!files.has(MANIFEST_PATH)) return manifest;
  addArchiveFiles(root, files);
  validateManifestReferences(manifest, services ?? archiveFromFiles(files), files);
  return manifest;
}

/** Main-only serialized mutations: lock, validate in memory, atomic rename, cleanup on failure. */
function mutate(root: string, operation: (files: Map<string, string>, manifest: BackfillManifest) => BackfillManifest): BackfillManifest {
  const filename = safePath(root, MANIFEST_PATH); mkdirSync(path.dirname(filename), { recursive: true });
  const lock = `${filename}.lock`; const temp = `${filename}.${randomUUID()}.tmp`;
  writeFileSync(lock, '', { flag: 'wx' });
  try {
    const files = registryFiles(root); const before = manifestFromFiles(files);
    const after = operation(files, structuredClone(before));
    if (isDeepStrictEqual(before, after)) return after;
    const text = stringify(after, { lineWidth: 100 }); files.set(MANIFEST_PATH, text);
    manifestFromFiles(files); assertManifestDiff(before, after);
    writeFileSync(temp, text, { flag: 'wx' }); renameSync(temp, filename);
    return after;
  } finally { rmSync(temp, { force: true }); rmSync(lock, { force: true }); }
}
export function importBackfill(root: string, inputPath: string): BackfillManifest {
  const relative = path.relative(path.resolve(root), path.resolve(root, inputPath)).split(path.sep).join('/');
  if (relative === MANIFEST_PATH) throw new Error('input cannot be the manifest');
  const text = readFileSync(safePath(root, relative), 'utf8');
  const input = parseWithPath(BackfillInputSchema, parseYaml(text, relative), relative);
  return mutate(root, (files, manifest) => {
    const old = manifest.batches.find((b) => b.batch_id === input.batch_id);
    if (old && (old.input_sha256 !== sha(text) || old.discovery_source !== relative)) throw new Error(`${input.batch_id}: approved input content hash/source changed`);
    if (!old) {
      manifest.batches.push({ batch_id: input.batch_id, discovery_source: relative, input_sha256: sha(text),
        approved_by: input.approved_by, ...(input.approved_at ? { approved_at: input.approved_at } : {}),
        approved_count: input.approved_by.trim() ? input.services.length : 0 });
      manifest.services.push(...inputEntries(input));
    }
    files.set(relative, text); files.set(MANIFEST_PATH, stringify(manifest)); manifestFromFiles(files);
    addArchiveFiles(root, files); validateManifestReferences(manifest, archiveFromFiles(files), files);
    return manifest;
  });
}
export function nextBackfill(manifest: BackfillManifest, batchId: string, options: { limit?: number; resume?: string } = {}): BackfillEntry[] {
  const batch = manifest.batches.find((b) => b.batch_id === batchId);
  if (!batch) throw new Error(`unknown batch ${batchId}`);
  const limit = options.limit ?? Math.min(DEFAULT_BATCH_LIMIT, batch.approved_count);
  if (!Number.isSafeInteger(limit) || limit < (options.limit === undefined ? 0 : 1) || limit > batch.approved_count) throw new Error('limit must be positive and bounded by approved input');
  const entries = manifest.services.filter((e) => e.batch_id === batchId);
  if (options.resume) {
    const entry = entries.find((e) => e.service_id === options.resume);
    if (!entry || !['in_progress', 'blocked'].includes(entry.workflow_status)) throw new Error('resume requires an in_progress or blocked service in this batch');
    return [entry];
  }
  return entries.filter((e) => ['discovered', 'registered'].includes(e.workflow_status)).slice(0, limit);
}
export function loadBackfill(root = process.cwd()): BackfillManifest { return manifestFromFiles(registryFiles(root)); }
export function transitionBackfill(root: string, serviceId: string, to: Exclude<WorkflowStatus, 'discovered'>, reason?: string): BackfillManifest {
  const edge = TransitionSchema.parse({ to, ...(reason !== undefined ? { reason } : {}) });
  if ((to === 'blocked') !== Boolean(edge.reason)) throw new Error('reason required exactly for blocked transitions');
  return mutate(root, (files, manifest) => {
    const entry = manifest.services.find((e) => e.service_id === serviceId);
    if (!entry) throw new Error(`unknown service ${serviceId}`);
    assertWorkflowTransition(entry.workflow_status, to);
    entry.workflow_status = to; entry.history.push(edge);
    if (edge.reason) entry.blocked_reason = edge.reason; else delete entry.blocked_reason;
    // Other workers may be mid-write. Only completing a claim inspects its own source.
    if (to === 'complete') {
      addArchiveFiles(root, files, entry.sourceFileRef);
      validateManifestReferences({ ...manifest, services: [entry] }, archiveFromFiles(files), files);
    }
    return manifest;
  });
}

export interface ReviewAid { service_id: string; code: string; refs: string[]; detail: string }
export function editorialReviewAids(services: readonly Service[], baseline?: readonly Service[]): ReviewAid[] {
  const aids: ReviewAid[] = [];
  for (const service of services) {
    const add = (code: string, refs: string[], detail: string) => aids.push({ service_id: service.id, code, refs, detail });
    for (const segment of [...service.sections, ...service.passages]) if (segment.confidence < 0.8) add('low_confidence_boundary', [segment.id], `confidence ${segment.confidence}; ${segment.start}–${segment.end}s`);
    if (!service.speakers.length) add('metadata_gap', [], 'No speaker metadata');
    if (!service.sermon_title) add('metadata_gap', [], 'No sermon title; may be intentional');
    if (!service.passages.some((p) => p.scripture.length)) add('metadata_gap', [], 'No scripture references; may be intentional');
    if (service.videos.length > 3) add('unusual_video_count', service.videos.map((v) => v.id), `${service.videos.length} physical videos`);
    if (service.topics.length > 12 || service.topics.length > Math.max(4, service.passages.length)) add('topic_proliferation', service.topics.map((t) => t.id), `${service.topics.length} topics / ${service.passages.length} passages`);
    for (const passage of service.passages) if (passage.end - passage.start < 15 || passage.end - passage.start > 180) add('unusual_passage_length', [passage.id], `${passage.end - passage.start}s`);
    for (const video of service.videos) {
      const sections = service.sections.filter((s) => s.video_id === video.id).sort((a, b) => a.start - b.start || a.end - b.end);
      let end = video.transcribed_span?.start ?? 0; let previous = video.id;
      for (const section of sections) {
        if (section.start !== end) add(section.start > end ? 'section_gap' : 'section_overlap', [previous, section.id], `${Math.min(end, section.start)}–${Math.max(end, section.start)}s`);
        if (section.end > end) { end = section.end; previous = section.id; }
      }
      const last = video.transcribed_span?.end ?? video.duration;
      if (end < last) add('section_gap', [previous, video.id], `${end}–${last}s (coverage edge; may be intentional)`);
    }
    const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
    for (let i = 0; i < service.passages.length; i++) for (let j = i + 1; j < service.passages.length; j++) {
      const a = service.passages[i]; const b = service.passages[j]; const left = words(a.transcript); const right = words(b.transcript);
      let overlap = 0;
      for (let n = Math.min(left.length, right.length, 80); n >= 8; n--) if (left.slice(-n).join(' ') === right.slice(0, n).join(' ')) { overlap = n; break; }
      if (overlap || (left.length >= 8 && left.join(' ') === right.join(' '))) add('duplicate_overlap_text', [a.id, b.id], 'Matching text; repeated liturgy is not proof of duplication');
    }
  }
  for (const old of baseline ?? []) if (old.editorial_status === 'reviewed') {
    const current = services.find((s) => s.id === old.id);
    if (!isDeepStrictEqual(old, current)) aids.push({ service_id: old.id, code: 'changed_reviewed_record', refs: [old.id], detail: current ? 'Differs from reviewed baseline; human comparison required' : 'Reviewed baseline record absent' });
  }
  return aids;
}
export function reportBackfill(root: string, options: { batch?: string; year?: string; baseline?: readonly Service[] } = {}) {
  const files = registryFiles(root); const manifest = manifestFromFiles(files);
  addArchiveFiles(root, files); const services = archiveFromFiles(files); validateManifestReferences(manifest, services, files);
  if (options.batch && !manifest.batches.some((b) => b.batch_id === options.batch)) throw new Error(`unknown batch ${options.batch}`);
  if (options.year && !/^\d{4}$/.test(options.year)) throw new Error('year must be YYYY');
  const selected = manifest.services.filter((e) => (!options.batch || e.batch_id === options.batch) && (!options.year || e.date.startsWith(options.year)));
  const rows = selected.map((entry) => {
    const source = services.find((s) => s.id === entry.service_id);
    return { service_id: entry.service_id, batch_id: entry.batch_id, year: entry.date.slice(0, 4), sourceFileRef: entry.sourceFileRef,
      workflow_status: entry.workflow_status, ...(entry.blocked_reason ? { blocked_reason: entry.blocked_reason } : {}),
      ...(source ? { editorial_status: source.editorial_status, source_workflow_status: source.workflow_status } : {}),
      videos: entry.videos.map((v) => { const live = source?.videos.find((s) => s.id === v.youtube_id);
        return { youtube_id: v.youtube_id, media_disposition: live?.media_disposition ?? 'unassessed',
          ...(live?.disposition_evidence ? { disposition_evidence: live.disposition_evidence } : {}),
          eligible: source?.editorial_status === 'reviewed' && live?.media_disposition === 'playable' }; }),
      eligible: source?.editorial_status === 'reviewed' && source.videos.some((v) => v.media_disposition === 'playable') };
  });
  const counts = (items: typeof rows) => ({ total: items.length,
    workflow_status: Object.fromEntries(WorkflowStatusSchema.options.map((s) => [s, items.filter((r) => r.workflow_status === s).length])),
    editorial_status: { absent: items.filter((r) => !r.editorial_status).length, needs_review: items.filter((r) => r.editorial_status === 'needs_review').length, reviewed: items.filter((r) => r.editorial_status === 'reviewed').length },
    media_disposition: Object.fromEntries(['unassessed', 'playable', 'failed', 'rejected'].map((s) => [s, items.flatMap((r) => r.videos).filter((v) => v.media_disposition === s).length])),
    eligible: items.filter((r) => r.eligible).length });
  const ids = new Set(selected.map((e) => e.service_id));
  return { batches: manifest.batches.filter((b) => !options.batch || b.batch_id === options.batch).map((b) => ({ batch_id: b.batch_id,
    acceptance_condition: b.approved_count ? 'approved_input' : 'pending_operator_input', approved_count: b.approved_count,
    counts: counts(rows.filter((r) => r.batch_id === b.batch_id)) })),
    counts: counts(rows), years: Object.fromEntries([...new Set(rows.map((r) => r.year))].sort().map((year) => [year, counts(rows.filter((r) => r.year === year))])),
    services: rows, review_aids: editorialReviewAids(services.filter((s) => ids.has(s.id)), options.baseline?.filter((s) => ids.has(s.id))) };
}
