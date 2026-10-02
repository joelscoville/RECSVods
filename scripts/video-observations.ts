/** Checker results only. The site does not load these reports. */
import { z } from 'zod';
const date = z.string().datetime({ offset: true });
const seconds = z.number().finite().nonnegative();
const span = z.object({ start: seconds, end: seconds }).strict().refine(value => value.end > value.start);
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
