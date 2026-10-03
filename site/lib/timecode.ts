import { z } from 'zod';

export const TIMECODE_PATTERN = /^(\d+):([0-5]\d)(?::([0-5]\d))?(?:\.(\d{1,9}))?$/;
export const TIMECODE_HELP = 'Use a quoted clock time such as "42:54.62" or "1:02:03" (MM:SS or HH:MM:SS, up to 9 fractional digits)';

export function parseTimecode(value: string): number {
  const match = TIMECODE_PATTERN.exec(value);
  if (!match) throw new Error(TIMECODE_HELP);
  const whole = match[3] === undefined ? Number(match[1]) * 60 + Number(match[2])
    : Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!Number.isSafeInteger(whole)) throw new Error('Clock time is too large');
  // Parse the decimal once instead of adding a fractional float to minutes/hours.
  // This round-trips the numeric timestamps bound to existing vector manifests exactly.
  const seconds = Number(`${whole}${match[4] ? `.${match[4]}` : ''}`);
  if (!Number.isSafeInteger(Math.floor(seconds))) throw new Error('Clock time is too large');
  const fraction = match[4]?.replace(/0+$/, '') ?? '';
  const canonical = `${whole}${fraction ? `.${fraction}` : ''}`;
  if (seconds.toFixed(9).replace(/0+$/, '').replace(/\.$/, '') !== canonical) {
    throw new Error('This clock precision cannot be represented at this duration; use fewer fractional digits.');
  }
  return seconds;
}
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(Math.floor(seconds))) throw new Error('Invalid time in seconds');
  // Calculated recording times can contain binary floating-point residue (e.g.
  // 776 + 1802.801 + 3003). Normalize to the clock format's supported precision.
  const decimal = seconds.toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
  const [integer, fraction] = decimal.split('.'), whole = Number(integer);
  const hours = Math.floor(whole / 3600), minutes = Math.floor(whole / 60) % 60;
  const clock = `${hours ? `${hours}:${String(minutes).padStart(2, '0')}` : Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}${fraction ? `.${fraction}` : ''}`;
  if (parseTimecode(clock) !== Number(decimal)) throw new Error('Time cannot be represented at supported clock precision');
  return clock;
}
/** Import/tooling compatibility only. Editable service YAML uses ClockSchema. */
export function timeInSeconds(value: unknown): number {
  if (typeof value === 'string') return parseTimecode(value);
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  throw new Error(TIMECODE_HELP);
}
export const ClockSchema = z.string({ invalid_type_error: TIMECODE_HELP }).regex(TIMECODE_PATTERN, TIMECODE_HELP)
  .describe(TIMECODE_HELP).transform((value, ctx) => {
    try { return parseTimecode(value); }
    catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : TIMECODE_HELP }); return z.NEVER; }
  });
