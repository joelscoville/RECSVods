import { z } from 'zod';

export const TIMECODE_PATTERN = /^(\d+):([0-5]\d)(?::([0-5]\d))?(?:\.(\d{1,9}))?$/;
export const TIMECODE_HELP = 'Use a quoted clock time such as "42:54.62" or "1:02:03" (MM:SS or HH:MM:SS, optional fractional seconds)';

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
  return seconds;
}
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(Math.floor(seconds))) throw new Error('Invalid time in seconds');
  const decimal = String(seconds).includes('e') ? seconds.toFixed(9).replace(/0+$/, '').replace(/\.$/, '') : String(seconds);
  const [integer, fraction] = decimal.split('.'), whole = Number(integer);
  const hours = Math.floor(whole / 3600), minutes = Math.floor(whole / 60) % 60;
  const clock = `${hours ? `${hours}:${String(minutes).padStart(2, '0')}` : Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}${fraction ? `.${fraction}` : ''}`;
  if (parseTimecode(clock) !== seconds) throw new Error('Time cannot be represented without losing precision');
  return clock;
}
/** Import/tooling compatibility only. Editable service YAML uses ClockSchema. */
export function timeInSeconds(value: unknown): number {
  if (typeof value === 'string') return parseTimecode(value);
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  throw new Error(TIMECODE_HELP);
}
export const ClockSchema = z.string({ invalid_type_error: TIMECODE_HELP }).regex(TIMECODE_PATTERN, TIMECODE_HELP)
  .refine(value => { try { parseTimecode(value); return true; } catch { return false; } }, 'Clock time is too large')
  .describe(TIMECODE_HELP).transform(parseTimecode);
