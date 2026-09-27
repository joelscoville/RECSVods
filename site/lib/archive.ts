import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { normalizeScriptureReference, parseScriptureReference } from './scripture';
import captionConfig from '../../scripts/caption-config.json';
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

const Text = z.string().refine((value) => Boolean(value.trim()), 'required nonblank text');
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
export const SeriesSchema = z.object({ id: Id, name: Text }).strict();
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

export const CaptionProvenanceSchema = z.object({
  engine: z.literal('youtube-auto-captions'), track: z.literal('en-orig'), gate_version: z.literal(1), video_id: YoutubeIdSchema,
  yt_dlp_version: Text, dictionary_id: z.literal(captionConfig.dictionary.id),
  dictionary_blob_sha1: z.literal(captionConfig.dictionary.gitBlobSha1),
  dictionary_sha256: z.literal(captionConfig.dictionary.sha256), caption_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  evidence_sha256: z.string().regex(/^[0-9a-f]{64}$/), fetched_at: z.string().datetime({ offset: true }),
  words: z.number().int().min(captionConfig.minimumWords), dictionary_words: z.number().int().nonnegative(),
  english_ratio: z.number().min(captionConfig.minimumEnglishRatio).max(1),
  words_per_minute: z.number().finite().min(captionConfig.minimumWordsPerMinute).max(captionConfig.maximumWordsPerMinute),
  scope: RangeSchema,
}).strict().superRefine((v, ctx) => {
  if (v.dictionary_words > v.words || Math.abs(v.english_ratio - v.dictionary_words / v.words) > 0.000001
    || Math.abs(v.words_per_minute - v.words * 60 / (v.scope.end - v.scope.start)) > 0.000001) {
    ctx.addIssue({ code: 'custom', message: 'Caption quality counts, ratio and scoped rate must agree' });
  }
});

export const VideoSchema = z.object({
  id: YoutubeIdSchema,
  channel_id: z.literal(SOURCE_CHANNEL_ID),
  duration: z.number().finite().positive(),
  sequence: z.number().int().positive(),
  ...workflowFields,
  ...mediaFields,
  transcription_language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
  transcript_engine: z.enum(['whisper.cpp', 'faster-whisper', 'youtube-auto-captions']).optional(),
  transcribed_span: RangeSchema.optional(),
  transcription_provenance: TranscriptionProvenanceSchema.optional(),
  caption_provenance: CaptionProvenanceSchema.optional(),
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
  if (v.caption_provenance && (v.transcription_provenance || v.caption_provenance.video_id !== v.id
    || v.transcription_language !== 'en' || v.caption_provenance.scope.end > v.duration
    || v.transcribed_span?.start !== v.caption_provenance.scope.start || v.transcribed_span?.end !== v.caption_provenance.scope.end)) {
    ctx.addIssue({ code: 'custom', path: ['caption_provenance'], message: 'Caption provenance must match this video and its English caption scope, without conflicting ASR provenance' });
  }
  if (v.transcript_engine && (!v.transcribed_span || !v.transcription_language
    || v.transcript_engine === 'youtube-auto-captions' && !v.caption_provenance
    || v.caption_provenance && v.transcript_engine !== 'youtube-auto-captions'
    || v.transcript_engine === 'faster-whisper' && !v.transcription_provenance
    || v.transcription_provenance && v.transcript_engine !== 'faster-whisper')) {
    ctx.addIssue({ code: 'custom', path: ['transcript_engine'], message: 'Transcript engine must agree with scoped language and source provenance' });
  }
  if (['discovered', 'registered'].includes(v.workflow_status) && (v.transcribed_span || v.transcription_language || v.transcription_provenance || v.caption_provenance || v.transcript_engine)) {
    ctx.addIssue({ code: 'custom', path: ['workflow_status'], message: 'never-interpreted videos cannot contain transcription metadata' });
  }
});
export type Video = z.infer<typeof VideoSchema>;

export const segmentFields = {
  id: Id,
  video_id: YoutubeIdSchema,
  start: Seconds,
  end: Seconds,
  type: Id,
  title: Text,
  confidence: Confidence.optional(),
  review_notes: z.array(z.string().min(1)).default([]),
  speaker_id: Id.optional(),
};
export const ChapterSourceSchema = z.object({
  ...segmentFields,
  parent_id: Id.optional(),
  /** Private migration lineage, never serialized to the site. */
  source_chapters: z.array(Id).min(1).optional(),
  summary: Text,
  keywords: z.array(Text).max(10),
  topics: z.array(Id),
  scripture: z.array(ScriptureInputSchema),
  scriptureDisplay: z.array(ScriptureInputSchema).optional(),
}).strict().refine((v) => v.end > v.start, {
  path: ['end'], message: 'must be greater than start',
}).refine((chapter) => !chapter.scriptureDisplay || (chapter.scriptureDisplay.length === chapter.scripture.length
  && chapter.scriptureDisplay.every((value, index) => parseScriptureReference(value)?.canonical === parseScriptureReference(chapter.scripture[index])?.canonical)),
{ path: ['scriptureDisplay'], message: 'must align with canonical scripture references' })
  .transform((chapter) => {
    const scripture = chapter.scripture.map(normalizeScriptureReference);
    return { ...chapter, scripture, ...(scripture.some((value, index) => value !== chapter.scripture[index])
      ? { scriptureDisplay: chapter.scriptureDisplay ?? [...chapter.scripture] } : {}) };
  });
export type Chapter = z.infer<typeof ChapterSourceSchema>;
export const serviceFields = {
  id: Id,
  date: DateSchema,
  title: Text,
  sermon_title: Text.optional(),
  sermon_description: Text.optional(),
  series: SeriesSchema.optional(),
  type: Id,
  ...workflowFields,
  editorial_status: EditorialStatusSchema,
  reviewed_by: Text.optional(),
  reviewed_at: z.string().datetime({ offset: true }).optional(),
  review_notes: z.array(Text).default([]),
  speakers: z.array(SpeakerSchema).default([]),
  topics: z.array(TopicSchema).default([]),
  videos: z.array(VideoSchema).min(1),
};
type ServiceCheck = z.infer<z.ZodObject<typeof serviceFields>> & { chapters: Chapter[] };
export function checkService(v: ServiceCheck, ctx: z.RefinementCtx) {
  axisChecks(v, ctx);
  const issue = (field: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path: field, message });
  if (['discovered', 'registered'].includes(v.workflow_status)) issue(['workflow_status'], 'identifier-only workflow cannot contain interpretation; use corpus/');
  if (v.editorial_status === 'reviewed') {
    if (!v.reviewed_by) issue(['reviewed_by'], 'required for reviewed services');
    if (!v.reviewed_at) issue(['reviewed_at'], 'required for reviewed services');
  } else if (v.reviewed_by || v.reviewed_at) issue(['editorial_status'], 'clear reviewed_by and reviewed_at when returning to needs_review');
  for (const key of ['videos', 'chapters', 'speakers', 'topics'] as const) {
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
  for (const key of ['chapters'] as const) v[key].forEach((segment, i) => {
    const video = videos.get(segment.video_id);
    if (!video) issue([key, i, 'video_id'], 'unknown video reference');
    else {
      if (segment.end > video.duration) issue([key, i, 'end'], 'exceeds video duration');
      if (['discovered', 'registered'].includes(video.workflow_status)) issue([key, i, 'video_id'], 'never-interpreted video cannot have chapters');
    }
    if (segment.speaker_id && !v.speakers.some((s) => s.id === segment.speaker_id)) issue([key, i, 'speaker_id'], 'unknown speaker reference');
  });
  v.chapters.forEach((chapter, i) => {
    if (chapter.parent_id) {
      const parent = v.chapters.find((candidate) => candidate.id === chapter.parent_id);
      if (!parent || parent.parent_id || parent.id === chapter.id || parent.video_id !== chapter.video_id
        || chapter.start < parent.start || chapter.end > parent.end) {
        issue(['chapters', i, 'parent_id'], 'subsection requires a top-level parent on the same video containing its bounds');
      }
    }
    chapter.topics.forEach((topic, j) => {
      if (!v.topics.some((t) => t.id === topic)) issue(['chapters', i, 'topics', j], 'unknown topic reference');
    });
  });
}
export const ServiceSourceSchema = z.object({ ...serviceFields, chapters: z.array(ChapterSourceSchema) }).strict().superRefine(checkService);
export const ServiceSchema = ServiceSourceSchema;
export type Service = z.infer<typeof ServiceSchema>;
export type ServiceSource = z.infer<typeof ServiceSourceSchema>;

export interface SearchChapter {
  id: string;
  serviceId: string;
  serviceTitle: string;
  series?: Service['series'];
  videoId: string;
  start: number;
  end: number;
  title: string;
  parentId?: string;
  parentTitle?: string;
  /** Retrieval-only synopsis. Never render in a chapter, subsection or result. */
  summary: string;
  keywords: string[];
  topics: string[];
  scripture: string[];
  /** Entered references, positionally aligned with canonical scripture. */
  scriptureDisplay?: string[];
  /** Browser-only BSB enrichment; never serialize per chapter or render as ESV. */
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
  const seriesNames = new Map<string, { name: string; filename: string }>();
  const corpusIds = new Map<string, { filename: string; record: IdentifierRecord }>();
  const register = (id: string, filename: string, field: string) => {
    const previous = globalIds.get(id);
    if (previous) throw new Error(`${filename}:${field}: duplicate global ID ${id} (first at ${previous})`);
    globalIds.set(id, `${filename}:${field}`);
  };
  for (const [filename, text] of [...files].sort(([a], [b]) => compareText(a, b))) {
    // The canonical backfill registry has its own validator, orchestrated by scripts/archive.ts.
    if (filename !== 'corpus/manifest.yaml' && filename.startsWith('corpus/') && /\.ya?ml$/.test(filename)) {
      const record = parseWithPath(IdentifierRecordSchema, parseYaml(text, filename), filename);
      if (corpusIds.has(record.youtube_id)) throw new Error(`${filename}:youtube_id: duplicate corpus ID ${record.youtube_id}`);
      corpusIds.set(record.youtube_id, { filename, record });
    }
    if (!filename.startsWith('services/') || !/\.ya?ml$/.test(filename) || filename.endsWith('.internal.yaml')) continue;
    const match = /^services\/(\d{4})\/([^/]+)\/service\.yaml$/.exec(filename);
    if (!match) throw new Error(`${filename}: expected services/YYYY/<service-id>/service.yaml`);
    const source = parseWithPath(ServiceSourceSchema, parseYaml(text, filename), filename);
    if (source.id !== match[2]) throw new Error(`${filename}:id: must match service directory`);
    if (!source.date.startsWith(match[1])) throw new Error(`${filename}:date: must match year directory`);
    const service = source;
    if (service.series) {
      const previous = seriesNames.get(service.series.id);
      if (previous && previous.name !== service.series.name) {
        throw new Error(`${filename}:series.name: conflicting name for series ID ${service.series.id} (first at ${previous.filename}:series.name)`);
      }
      seriesNames.set(service.series.id, previous ?? { name: service.series.name, filename });
    }
    register(service.id, filename, 'id');
    for (const key of ['videos', 'chapters'] as const) service[key].forEach((item, i) => register(item.id, filename, `${key}.${i}.id`));
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
      else if (/\.ya?ml$/.test(name) && !name.endsWith('.internal.yaml')) files.set(name, readFileSync(path.join(absoluteRoot, name), 'utf8'));
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
/** Eligibility gate. Source records remain private; use flattenChapters for public metadata. */
export function publishedServices(services: readonly Service[], mode: BuildMode = 'production'): Service[] {
  assertMode(mode);
  return services.filter((s) => s.editorial_status === 'reviewed' || (mode === 'preview' && s.editorial_status === 'needs_review')).flatMap((service) => {
    const videos = service.videos.filter((v) => v.media_disposition === 'playable');
    if (!videos.length) return [];
    const ids = new Set(videos.map((v) => v.id));
    return [{ ...service, videos, chapters: service.chapters.filter((chapter) => ids.has(chapter.video_id)) }];
  });
}
export function flattenChapters(services: readonly Service[], mode: BuildMode = 'production'): SearchChapter[] {
  const sequence = new Map(services.flatMap((s) => s.videos.map((v) => [v.id, v.sequence] as const)));
  return publishedServices(services, mode).flatMap((service) => service.chapters.map((chapter): SearchChapter => {
    const speakerId = chapter.speaker_id;
    const speaker = service.speakers.find((s) => s.id === speakerId)?.name;
    return {
      id: chapter.id, serviceId: service.id, serviceTitle: service.title, videoId: chapter.video_id,
      ...(service.series ? { series: { id: service.series.id, name: service.series.name } } : {}),
      start: chapter.start, end: chapter.end, title: chapter.title, summary: chapter.summary,
      ...(chapter.parent_id ? { parentId: chapter.parent_id, parentTitle: service.chapters.find((parent) => parent.id === chapter.parent_id)!.title } : {}),
      keywords: [...chapter.keywords],
      topics: chapter.topics.map((id) => service.topics.find((t) => t.id === id)!.name),
      scripture: chapter.scripture.map(normalizeScriptureReference),
      ...(chapter.scriptureDisplay || chapter.scripture.some((value) => normalizeScriptureReference(value) !== value)
        ? { scriptureDisplay: [...(chapter.scriptureDisplay ?? chapter.scripture)] } : {}),
      ...(speaker ? { speaker } : {}), date: service.date,
      type: chapter.type, preview: service.editorial_status !== 'reviewed',
    };
  })).sort((a, b) => compareText(b.date, a.date) || compareText(a.serviceId, b.serviceId)
    || sequence.get(a.videoId)! - sequence.get(b.videoId)!
    || a.start - b.start || compareText(a.id, b.id));
}
