/** Active playback flags. Diagnostic details belong in check reports, not service metadata. */
import { z } from 'zod';

export const QUIRK_LABELS = {
  embed_blocked: 'Opens on YouTube', video_unavailable: 'Video unavailable',
  audio_choppy: 'Choppy audio', audio_left_only: 'Audio on the left only',
  audio_right_only: 'Audio on the right only', audio_clipping: 'Audio clipping',
  audio_missing: 'No audio track', audio_out_of_sync: 'Audio out of sync',
  video_freezes: 'Video freezes', other: 'Playback issue',
} as const;
export const QuirkKindSchema = z.enum(['embed_blocked', 'video_unavailable', 'audio_choppy', 'audio_left_only', 'audio_right_only', 'audio_clipping', 'audio_missing', 'audio_out_of_sync', 'video_freezes', 'other']);
export type QuirkKind = z.infer<typeof QuirkKindSchema>;
export interface PublicQuirk { kind: QuirkKind }
export function publicQuirks(flags: readonly QuirkKind[] = []): PublicQuirk[] {
  return flags.map(kind => ({ kind }));
}
export function quirkLabel(quirk: PublicQuirk): string { return QUIRK_LABELS[quirk.kind]; }
