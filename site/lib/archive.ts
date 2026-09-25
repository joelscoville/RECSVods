import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { normalizeScriptureReference, parseScriptureReference } from './scripture';
export { BIBLE_BOOKS } from './scripture';

export const SOURCE_CHANNEL_ID = 'UCLjwcZaIkiFEed1VgQYSsrw';
export const WorkflowStatusSchema = z.enum(['discovered', 'registered', 'in_progress', 'complete', 'blocked']);
export const EditorialStatusSchema = z.enum(['needs_review', 'reviewed']);
export const MediaDispositionSchema = z.enum(['unassessed', 'playable', 'failed', 'rejected']);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type BuildMode = 'production' | 'preview';
export const WORKFLOW_TRANSITIONS: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  discovered: ['registered', 'blocked'],
  registered: ['in_progress', 'blocked'],
  in_progress: ['complete', 'blocked', 'registered'],
  complete: ['in_progress'],
  blocked: ['registered', 'in_progress'],
};
export function canTransitionWorkflow(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return WORKFLOW_TRANSITIONS[from].includes(to);
}
export function assertWorkflowTransition(from: WorkflowStatus, to: WorkflowStatus): void {
  if (!canTransitionWorkflow(from, to)) throw new Error(`workflow_status: forbidden transition ${from} -> ${to}`);
}

const Text = z.string().trim().min(1);
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'expected a stable identifier');
export const YoutubeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'expected an 11-character YouTube ID');
const Seconds = z.number().finite().nonnegative();
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'expected a real ISO calendar date');
const Confidence = z.number().finite().min(0).max(1);
const RangeSchema = z.object({ start: Seconds, end: Seconds }).strict().refine((v) => v.end > v.start, {
  path: ['end'], message: 'must be greater than start',
});
const workflowFields = {
  workflow_status: WorkflowStatusSchema,
  blocked_reason: Text.optional(),
};
const mediaFields = {
  media_disposition: MediaDispositionSchema,
  disposition_evidence: Text.optional(),
};
function axisChecks(v: { workflow_status: WorkflowStatus; blocked_reason?: string; media_disposition?: string; disposition_evidence?: string }, ctx: z.RefinementCtx) {
  if ((v.workflow_status === 'blocked') !== Boolean(v.blocked_reason)) {
    ctx.addIssue({ code: 'custom', path: ['blocked_reason'], message: 'required exactly when workflow_status is blocked; clear when resolved' });
  }
  if (['failed', 'rejected'].includes(v.media_disposition ?? '') && !v.disposition_evidence) {
    ctx.addIssue({ code: 'custom', path: ['disposition_evidence'], message: 'failed/rejected media requires objective evidence' });
  }
}

/** Strict identifier-only discovery/registration records; no editorial or interpretive keys. */
export const IdentifierRecordSchema = z.object({
  youtube_id: YoutubeIdSchema,
  date: DateSchema,
  channel_id: z.literal(SOURCE_CHANNEL_ID).optional(),
  source_title: Text.optional(),
  duration: z.number().finite().positive().optional(),
  ...workflowFields,
  ...mediaFields,
}).strict().superRefine((v, ctx) => {
  axisChecks(v, ctx);
  if (v.workflow_status === 'complete') ctx.addIssue({ code: 'custom', path: ['workflow_status'], message: 'complete requires an interpreted service' });
});
export type IdentifierRecord = z.infer<typeof IdentifierRecordSchema>;

export const SpeakerSchema = z.object({ id: Id, name: Text, role: Text.optional() }).strict();
export const TopicSchema = z.object({ id: Id, name: Text, description: Text.optional() }).strict();
export type Speaker = z.infer<typeof SpeakerSchema>;
export type Topic = z.infer<typeof TopicSchema>;

export const ScriptureInputSchema = z.string().min(1).refine((reference) => Boolean(parseScriptureReference(reference)),
  'expected a valid scripture reference, e.g. Romans 13:1-7 or John 3:16-4:2 (no verse text)');
/** Canonical-output validator retained for existing callers; editable inputs accept aliases. */
export const ScriptureReferenceSchema = ScriptureInputSchema.refine((reference) => parseScriptureReference(reference)?.canonical === reference,
  'expected a canonical scripture reference');

/** Safe archive projection of the local manual-import receipt; no paths or transcript text. */
export const TranscriptionProvenanceSchema = z.object({
  engine: z.literal('faster-whisper'),
  engine_version: z.literal('1.2.1'),
  model: z.literal('large-v3-turbo'),
  backend_version: z.literal('4.8.2'),
  compute_type: z.literal('float16'),
  device: z.literal('Tesla T4'),
  settings: z.object({
    beam_size: z.literal(5), word_timestamps: z.literal(true),
    vad_filter: z.literal(false), condition_on_previous_text: z.literal(false),
  }).strict(),
  audio_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  transcript_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  duration_seconds: z.number().finite().positive(),
  elapsed_seconds: z.number().finite().positive(),
  real_time_factor: z.number().finite().positive(),
  transcribed_at: z.string().datetime({ offset: true }),
  source_duration_seconds: z.number().finite().positive(),
  duration_delta_seconds: z.number().finite().min(-2).max(2),
  audio_hash_verified: z.boolean(),
}).strict().superRefine((v, ctx) => {
  if (Math.abs(v.real_time_factor - v.elapsed_seconds / v.duration_seconds) > 0.0000051) {
    ctx.addIssue({ code: 'custom', path: ['real_time_factor'], message: 'inconsistent with elapsed/duration (five-decimal rounding tolerance)' });
  }
  if (Math.abs(v.duration_delta_seconds - (v.duration_seconds - v.source_duration_seconds)) > 1e-9) {
    ctx.addIssue({ code: 'custom', path: ['duration_delta_seconds'], message: 'must equal transcript duration minus ffprobe source duration' });
  }
});
export type TranscriptionProvenance = z.infer<typeof TranscriptionProvenanceSchema>;

export const VideoSchema = z.object({
  id: YoutubeIdSchema,
  channel_id: z.literal(SOURCE_CHANNEL_ID),
  duration: z.number().finite().positive(),
  sequence: z.number().int().positive(),
  ...workflowFields,
  ...mediaFields,
  transcription_language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
  transcribed_span: RangeSchema.optional(),
  transcription_provenance: TranscriptionProvenanceSchema.optional(),
}).strict().superRefine((v, ctx) => {
  axisChecks(v, ctx);
  if (v.transcribed_span && v.transcribed_span.end > v.duration) {
    ctx.addIssue({ code: 'custom', path: ['transcribed_span', 'end'], message: 'exceeds video duration' });
  }
  if (v.transcribed_span && !v.transcription_language) {
    ctx.addIssue({ code: 'custom', path: ['transcription_language'], message: 'required with transcribed_span' });
  }
  if (v.transcription_provenance && (!v.transcription_language || !v.transcribed_span)) {
    ctx.addIssue({ code: 'custom', path: ['transcription_provenance'], message: 'requires original transcription language and transcribed span' });
  }
  if (['discovered', 'registered'].includes(v.workflow_status) && (v.transcribed_span || v.transcription_language || v.transcription_provenance)) {
    ctx.addIssue({ code: 'custom', path: ['workflow_status'], message: 'never-interpreted videos cannot contain transcription metadata' });
  }
});
export type Video = z.infer<typeof VideoSchema>;

const segmentFields = {
  id: Id,
  video_id: YoutubeIdSchema,
  start: Seconds,
  end: Seconds,
  type: Id,
  title: Text,
  confidence: Confidence,
  review_notes: z.array(Text).default([]),
  speaker_id: Id.optional(),
};
export const SectionSchema = z.object(segmentFields).strict().refine((v) => v.end > v.start, {
  path: ['end'], message: 'must be greater than start',
});
const passageFields = {
  ...segmentFields,
  section_id: Id,
  summary: Text,
  questions: z.array(Text),
  topics: z.array(Id),
  scripture: z.array(ScriptureInputSchema),
};
export const PassageSchema = z.object({ ...passageFields, transcript: Text, scriptureDisplay: z.array(ScriptureInputSchema).optional() }).strict().refine((v) => v.end > v.start, {
  path: ['end'], message: 'must be greater than start',
}).refine((passage) => !passage.scriptureDisplay || (passage.scriptureDisplay.length === passage.scripture.length
  && passage.scriptureDisplay.every((value, index) => parseScriptureReference(value)?.canonical === parseScriptureReference(passage.scripture[index])?.canonical)),
{ path: ['scriptureDisplay'], message: 'must align with canonical scripture references' })
  .transform((passage) => {
    const scripture = passage.scripture.map(normalizeScriptureReference);
    return { ...passage, scripture, ...(scripture.some((value, index) => value !== passage.scripture[index])
      ? { scriptureDisplay: passage.scriptureDisplay ?? [...passage.scripture] } : {}) };
  });
const TranscriptFileSchema = z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9_./-]+\.md$/, 'expected a relative Markdown path inside the service directory');
export const PassageSourceSchema = z.object({
  ...passageFields,
  transcript: Text.optional(),
  transcript_file: TranscriptFileSchema.optional(),
}).strict().superRefine((v, ctx) => {
  if (v.end <= v.start) ctx.addIssue({ code: 'custom', path: ['end'], message: 'must be greater than start' });
  if (Boolean(v.transcript) === Boolean(v.transcript_file)) {
    ctx.addIssue({ code: 'custom', path: ['transcript'], message: 'provide exactly one of transcript or transcript_file' });
  }
});
export type Passage = z.infer<typeof PassageSchema>;
export type Section = z.infer<typeof SectionSchema>;
const serviceFields = {
  id: Id,
  date: DateSchema,
  title: Text,
  sermon_title: Text.optional(),
  type: Id,
  ...workflowFields,
  editorial_status: EditorialStatusSchema,
  reviewed_by: Text.optional(),
  reviewed_at: z.string().datetime({ offset: true }).optional(),
  review_notes: z.array(Text).default([]),
  speakers: z.array(SpeakerSchema).default([]),
  topics: z.array(TopicSchema).default([]),
  videos: z.array(VideoSchema).min(1),
  sections: z.array(SectionSchema),
};
type ServiceCheck = z.infer<z.ZodObject<typeof serviceFields>> & { passages: z.infer<typeof PassageSourceSchema>[] };
function checkService(v: ServiceCheck, ctx: z.RefinementCtx) {
  axisChecks(v, ctx);
  const issue = (field: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path: field, message });
  if (['discovered', 'registered'].includes(v.workflow_status)) issue(['workflow_status'], 'identifier-only workflow cannot contain interpretation; use corpus/');
  if (v.editorial_status === 'reviewed') {
    if (!v.reviewed_by) issue(['reviewed_by'], 'required for reviewed services');
    if (!v.reviewed_at) issue(['reviewed_at'], 'required for reviewed services');
  } else if (v.reviewed_by || v.reviewed_at) issue(['editorial_status'], 'clear reviewed_by and reviewed_at when returning to needs_review');
  for (const key of ['videos', 'sections', 'passages', 'speakers', 'topics'] as const) {
    const seen = new Set<string>();
    v[key].forEach((item, i) => {
      if (seen.has(item.id)) issue([key, i, 'id'], `duplicate ${key} ID ${item.id}`);
      seen.add(item.id);
    });
  }
  v.videos.forEach((video, i) => {
    if (video.sequence !== i + 1) issue(['videos', i, 'sequence'], 'videos must be ordered with contiguous sequence starting at 1');
  });
  const videos = new Map(v.videos.map((video) => [video.id, video]));
  const sections = new Map(v.sections.map((section) => [section.id, section]));
  for (const key of ['sections', 'passages'] as const) v[key].forEach((segment, i) => {
    const video = videos.get(segment.video_id);
    if (!video) issue([key, i, 'video_id'], 'unknown video reference');
    else {
      if (segment.end > video.duration) issue([key, i, 'end'], 'exceeds video duration');
      if (['discovered', 'registered'].includes(video.workflow_status)) issue([key, i, 'video_id'], 'never-interpreted video cannot have sections/passages');
    }
    if (segment.speaker_id && !v.speakers.some((s) => s.id === segment.speaker_id)) issue([key, i, 'speaker_id'], 'unknown speaker reference');
  });
  v.passages.forEach((passage, i) => {
    const section = sections.get(passage.section_id);
    if (!section) issue(['passages', i, 'section_id'], 'unknown section reference');
    else if (section.video_id !== passage.video_id || passage.start < section.start || passage.end > section.end) {
      issue(['passages', i, 'section_id'], 'passage must fit within its section on the same video');
    }
    passage.topics.forEach((topic, j) => {
      if (!v.topics.some((t) => t.id === topic)) issue(['passages', i, 'topics', j], 'unknown topic reference');
    });
  });
}
export const ServiceSourceSchema = z.object({ ...serviceFields, passages: z.array(PassageSourceSchema) }).strict().superRefine(checkService);
export const ServiceSchema = z.object({ ...serviceFields, passages: z.array(PassageSchema) }).strict().superRefine(checkService);
export type Service = z.infer<typeof ServiceSchema>;
export type ServiceSource = z.infer<typeof ServiceSourceSchema>;

export interface SearchPassage {
  id: string;
  serviceId: string;
  serviceTitle: string;
  videoId: string;
  start: number;
  end: number;
  title: string;
  summary: string;
  transcript: string;
  questions: string[];
  topics: string[];
  scripture: string[];
  /** Entered references, positionally aligned with canonical scripture. */
  scriptureDisplay?: string[];
  /** Public-domain BSB text for generated search input only; never render as ESV. */
  verseText?: string;
  speaker?: string;
  date: string;
  type: string;
  preview: boolean;
}

export function parseYaml(text: string, filename: string): unknown {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(`${filename}: ${doc.errors.map((e) => e.message).join('; ')}`);
  try { return doc.toJS({ maxAliasCount: 50 }); }
  catch (error) { throw new Error(`${filename}: ${String(error)}`); }
}
export function parseWithPath<S extends z.ZodTypeAny>(schema: S, value: unknown, filename: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues.map((i) => `${filename}:${i.path.join('.') || '<record>'}: ${i.message}`).join('\n'));
  return result.data;
}

/** Also used by the editorial guard to validate immutable Git trees. Keys are repository-relative POSIX paths. */
export function archiveFromFiles(files: ReadonlyMap<string, string>): Service[] {
  const services: Service[] = [];
  const globalIds = new Map<string, string>();
  const corpusIds = new Map<string, { filename: string; record: IdentifierRecord }>();
  const register = (id: string, filename: string, field: string) => {
    const previous = globalIds.get(id);
    if (previous) throw new Error(`${filename}:${field}: duplicate global ID ${id} (first at ${previous})`);
    globalIds.set(id, `${filename}:${field}`);
  };
  for (const [filename, text] of [...files].sort(([a], [b]) => compareText(a, b))) {
    if (filename.startsWith('corpus/') && /\.ya?ml$/.test(filename)) {
      const record = parseWithPath(IdentifierRecordSchema, parseYaml(text, filename), filename);
      if (corpusIds.has(record.youtube_id)) throw new Error(`${filename}:youtube_id: duplicate corpus ID ${record.youtube_id}`);
      corpusIds.set(record.youtube_id, { filename, record });
    }
    if (!filename.startsWith('services/') || !/\.ya?ml$/.test(filename)) continue;
    const match = /^services\/(\d{4})\/([^/]+)\/service\.yaml$/.exec(filename);
    if (!match) throw new Error(`${filename}: expected services/YYYY/<service-id>/service.yaml`);
    const source = parseWithPath(ServiceSourceSchema, parseYaml(text, filename), filename);
    if (source.id !== match[2]) throw new Error(`${filename}:id: must match service directory`);
    if (!source.date.startsWith(match[1])) throw new Error(`${filename}:date: must match year directory`);
    const passages = source.passages.map(({ transcript_file, ...passage }, i) => {
      if (!transcript_file) return passage;
      const transcriptPath = path.posix.join(path.posix.dirname(filename), transcript_file);
      const transcript = files.get(transcriptPath);
      if (transcript === undefined) throw new Error(`${filename}:passages.${i}.transcript_file: missing ${transcriptPath}`);
      return { ...passage, transcript };
    });
    const service = parseWithPath(ServiceSchema, { ...source, passages }, filename);
    register(service.id, filename, 'id');
    for (const key of ['videos', 'sections', 'passages'] as const) service[key].forEach((item, i) => register(item.id, filename, `${key}.${i}.id`));
    services.push(service);
  }
  for (const service of services) for (const video of service.videos) {
    const entry = corpusIds.get(video.id);
    if (entry && entry.record.date !== service.date) throw new Error(`${entry.filename}:date: differs from service ${service.id}`);
  }
  return services.sort((a, b) => compareText(b.date, a.date) || compareText(a.id, b.id));
}

/** Read-only, synchronous, deterministic; missing services/ and corpus/ are a valid empty archive. */
export function loadArchive(root = process.cwd()): Service[] {
  const files = new Map<string, string>();
  const absoluteRoot = realpathSync(root);
  const walk = (relative: string) => {
    const absolute = path.join(absoluteRoot, relative);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`${name}: archive symlinks are not allowed`);
      if (entry.isDirectory()) walk(name);
      else if (/\.(ya?ml|md)$/.test(name)) files.set(name, readFileSync(path.join(absoluteRoot, name), 'utf8'));
    }
  };
  // Check the archive roots too, including a symlink to a directory outside the repository.
  for (const directory of ['services', 'corpus']) {
    if (existsSync(path.join(absoluteRoot, directory)) && realpathSync(path.join(absoluteRoot, directory)) !== path.join(absoluteRoot, directory)) {
      throw new Error(`${directory}: archive symlinks are not allowed`);
    }
    walk(directory);
  }
  return archiveFromFiles(files);
}

function assertMode(mode: BuildMode): void {
  if (mode !== 'production' && mode !== 'preview') throw new Error(`Unknown archive build mode: ${String(mode)}`);
}
/** Returns sanitized copies: non-playable videos and their sections/passages never escape this gate. */
export function publishedServices(services: readonly Service[], mode: BuildMode = 'production'): Service[] {
  assertMode(mode);
  return services.filter((s) => s.editorial_status === 'reviewed' || (mode === 'preview' && s.editorial_status === 'needs_review')).flatMap((service) => {
    const videos = service.videos.filter((v) => v.media_disposition === 'playable');
    if (!videos.length) return [];
    const ids = new Set(videos.map((v) => v.id));
    return [{ ...service, videos, sections: service.sections.filter((s) => ids.has(s.video_id)), passages: service.passages.filter((p) => ids.has(p.video_id)) }];
  });
}
export function flattenArchive(services: readonly Service[], mode: BuildMode = 'production'): SearchPassage[] {
  const sequence = new Map(services.flatMap((s) => s.videos.map((v) => [v.id, v.sequence] as const)));
  return publishedServices(services, mode).flatMap((service) => service.passages.map((passage): SearchPassage => {
    const speakerId = passage.speaker_id ?? service.sections.find((s) => s.id === passage.section_id)?.speaker_id;
    const speaker = service.speakers.find((s) => s.id === speakerId)?.name;
    return {
      id: passage.id, serviceId: service.id, serviceTitle: service.title, videoId: passage.video_id,
      start: passage.start, end: passage.end, title: passage.title, summary: passage.summary,
      transcript: passage.transcript, questions: [...passage.questions],
      topics: passage.topics.map((id) => service.topics.find((t) => t.id === id)!.name),
      scripture: passage.scripture.map(normalizeScriptureReference),
      ...(passage.scriptureDisplay || passage.scripture.some((value) => normalizeScriptureReference(value) !== value)
        ? { scriptureDisplay: [...(passage.scriptureDisplay ?? passage.scripture)] } : {}),
      ...(speaker ? { speaker } : {}), date: service.date,
      type: passage.type, preview: service.editorial_status !== 'reviewed',
    };
  })).sort((a, b) => compareText(b.date, a.date) || compareText(a.serviceId, b.serviceId)
    || sequence.get(a.videoId)! - sequence.get(b.videoId)!
    || a.start - b.start || compareText(a.id, b.id));
}
export const eligiblePassages = flattenArchive;
