/** Historical/import receipts. These are diagnostic report data, not editable service fields. */
import { z } from 'zod';
import { axisChecks, videoFields, YoutubeIdSchema } from './archive';
import captionConfig from '../../scripts/caption-config.json';

const Text = z.string().refine(value => Boolean(value.trim()));
const Seconds = z.number().finite().nonnegative();
const Range = z.object({ start: Seconds, end: Seconds }).strict().refine(v => v.end > v.start, { path: ['end'], message: 'must be greater than start' });
export const TranscriptionProvenanceSchema = z.object({
  engine: z.literal('faster-whisper'), engine_version: z.literal('1.2.1'), model: z.literal('large-v3-turbo'),
  backend_version: z.literal('4.8.2'), compute_type: z.literal('float16'), device: z.literal('Tesla T4'),
  settings: z.object({ beam_size: z.literal(5), word_timestamps: z.literal(true), vad_filter: z.literal(false), condition_on_previous_text: z.literal(false) }).strict(),
  audio_sha256: z.string().regex(/^[0-9a-f]{64}$/), transcript_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  duration_seconds: z.number().finite().positive(), elapsed_seconds: z.number().finite().positive(), real_time_factor: z.number().finite().positive(),
  transcribed_at: z.string().datetime({ offset: true }), source_duration_seconds: z.number().finite().positive(),
  duration_delta_seconds: z.number().finite().min(-2).max(2), audio_hash_verified: z.boolean(),
}).strict().superRefine((v, ctx) => {
  if (Math.abs(v.real_time_factor - v.elapsed_seconds / v.duration_seconds) > .0000051) ctx.addIssue({ code: 'custom', path: ['real_time_factor'], message: 'inconsistent with elapsed/duration' });
  if (Math.abs(v.duration_delta_seconds - (v.duration_seconds - v.source_duration_seconds)) > 1e-9) ctx.addIssue({ code: 'custom', path: ['duration_delta_seconds'], message: 'must equal transcript duration minus source duration' });
});
export const CaptionProvenanceSchema = z.object({
  engine: z.literal('youtube-auto-captions'), track: z.literal('en-orig'), gate_version: z.literal(1), video_id: YoutubeIdSchema,
  yt_dlp_version: Text, dictionary_id: z.literal(captionConfig.dictionary.id), dictionary_blob_sha1: z.literal(captionConfig.dictionary.gitBlobSha1),
  dictionary_sha256: z.literal(captionConfig.dictionary.sha256), caption_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  evidence_sha256: z.string().regex(/^[0-9a-f]{64}$/), fetched_at: z.string().datetime({ offset: true }),
  words: z.number().int().min(captionConfig.minimumWords), dictionary_words: z.number().int().nonnegative(),
  english_ratio: z.number().min(captionConfig.minimumEnglishRatio).max(1),
  words_per_minute: z.number().finite().min(captionConfig.minimumWordsPerMinute).max(captionConfig.maximumWordsPerMinute), scope: Range,
}).strict().superRefine((v, ctx) => {
  if (v.dictionary_words > v.words || Math.abs(v.english_ratio - v.dictionary_words / v.words) > .000001
    || Math.abs(v.words_per_minute - v.words * 60 / (v.scope.end - v.scope.start)) > .000001) ctx.addIssue({ code: 'custom', message: 'Caption quality counts, ratio and scoped rate must agree' });
});
export const processingFields = {
  transcription_language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
  transcript_engine: z.enum(['whisper.cpp', 'faster-whisper', 'youtube-auto-captions']).optional(), transcribed_span: Range.optional(),
  transcription_provenance: TranscriptionProvenanceSchema.optional(), caption_provenance: CaptionProvenanceSchema.optional(),
};
export const HistoricalVideoSchema = z.object({ ...videoFields, ...processingFields }).strict().superRefine((v, ctx) => {
  axisChecks(v, ctx);
  const issue = (field: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path: field, message });
  if (v.transcribed_span && v.transcribed_span.end > v.duration) issue(['transcribed_span', 'end'], 'exceeds video duration');
  if (v.transcribed_span && !v.transcription_language) issue(['transcription_language'], 'required with transcribed_span');
  if (v.transcription_provenance && (!v.transcription_language || !v.transcribed_span)) issue(['transcription_provenance'], 'requires original transcription language and transcribed span');
  if (v.caption_provenance && (v.transcription_provenance || v.caption_provenance.video_id !== v.id || v.transcription_language !== 'en'
    || v.caption_provenance.scope.end > v.duration || v.transcribed_span?.start !== v.caption_provenance.scope.start || v.transcribed_span?.end !== v.caption_provenance.scope.end)) issue(['caption_provenance'], 'Caption provenance must match this video and its English caption scope');
  if (v.transcript_engine && (!v.transcribed_span || !v.transcription_language
    || v.transcript_engine === 'youtube-auto-captions' && !v.caption_provenance || v.caption_provenance && v.transcript_engine !== 'youtube-auto-captions'
    || v.transcript_engine === 'faster-whisper' && !v.transcription_provenance || v.transcription_provenance && v.transcript_engine !== 'faster-whisper')) issue(['transcript_engine'], 'Transcript engine must agree with scoped language and source provenance');
  if (['discovered', 'registered'].includes(v.workflow_status) && (v.transcribed_span || v.transcription_language || v.transcription_provenance || v.caption_provenance || v.transcript_engine)) issue(['workflow_status'], 'never-interpreted videos cannot contain transcription metadata');
});
