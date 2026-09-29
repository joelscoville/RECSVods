/** Checker results only. The site does not load these reports. */
import { z } from 'zod';
import type { QuirkKind } from '../site/lib/video-quirks';
const date = z.string().datetime({ offset: true });
const seconds = z.number().finite().nonnegative();
const span = z.object({ start: seconds, end: seconds }).strict().refine(value => value.end > value.start);
export const EmbedObservationSchema = z.object({
  checkedAt: date, outcome: z.enum(['playable', 'blocked', 'unavailable', 'inconclusive']),
  errorCode: z.number().int().nonnegative().optional(),
  reason: z.enum(['playback_advanced', 'embedding_denied', 'video_unavailable', 'player_error', 'timeout', 'network_or_browser_error']).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.outcome === 'blocked' && ![101, 150].includes(value.errorCode ?? -1)) ctx.addIssue({ code: 'custom', message: 'Embedding denial needs YouTube error 101 or 150' });
  if (value.outcome === 'unavailable' && value.errorCode !== 100) ctx.addIssue({ code: 'custom', message: 'Unavailability needs YouTube error 100' });
  if (value.outcome === 'playable' && value.errorCode !== undefined) ctx.addIssue({ code: 'custom', message: 'Successful playback cannot have an error code' });
});
export type EmbedObservation = z.infer<typeof EmbedObservationSchema>;
export const AudioObservationSchema = z.object({
  checkedAt: date, outcome: z.enum(['analysed', 'inconclusive']), source: z.enum(['local', 'youtube']),
  sample: span.optional(), candidates: z.number().int().min(0).max(3),
  detected: z.array(z.enum(['audio_choppy', 'audio_left_only', 'audio_right_only', 'audio_clipping', 'audio_missing'])),
  reason: z.enum(['no_audible_sample', 'tool_unavailable', 'source_or_tool_error', 'different_sample', 'duration_changed']).optional(),
  metrics: z.object({ channels: z.number().int().min(0).max(64), leftDb: z.number().finite().min(-120).max(6), rightDb: z.number().finite().min(-120).max(6),
    activeFraction: z.number().min(0).max(1), dropouts: z.number().int().nonnegative(), clippedFraction: z.number().min(0).max(1) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.detected).size !== value.detected.length) ctx.addIssue({ code: 'custom', message: 'Duplicate audio findings' });
  if (value.outcome === 'inconclusive' && value.detected.length) ctx.addIssue({ code: 'custom', message: 'An inconclusive attempt cannot add findings' });
  if (value.outcome === 'analysed' && !value.detected.includes('audio_missing') && (!value.sample || !value.metrics)) ctx.addIssue({ code: 'custom', message: 'Audio analysis requires its measured sample and metrics' });
});
export type AudioObservation = z.infer<typeof AudioObservationSchema>;
export function embeddingAdditions(flags: readonly QuirkKind[], input: EmbedObservation): QuirkKind[] {
  const observation = EmbedObservationSchema.parse(input);
  const detected = observation.outcome === 'blocked' ? 'embed_blocked' : observation.outcome === 'unavailable' ? 'video_unavailable' : undefined;
  return detected && !flags.includes(detected) ? [detected] : [];
}
export function embeddingRemovalsToReview(flags: readonly QuirkKind[], input: EmbedObservation): QuirkKind[] {
  return input.outcome === 'playable' ? flags.filter(flag => flag === 'embed_blocked' || flag === 'video_unavailable') : [];
}
