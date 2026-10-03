/** Reads a transcript file chosen by the reviewer: the archive's canonical transcript JSON, whisper.cpp or
 * (faster-)whisper JSON, or SRT/VTT captions such as YouTube's (e.g. from `yt-dlp --write-auto-subs`).
 * Transcripts stay in this browser; they are never published or sent anywhere. */
export interface TranscriptLine { start: number; end: number; text: string }
export interface Transcript { name: string; videoId?: string; lines: TranscriptLine[] }

const clean = (text: string) => text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, '\'').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();
/** 00:01:02,345 · 01:02.345 · 1:02:03.4 */
function clock(value: string): number {
  const parts = value.trim().replace(',', '.').split(':').map(Number);
  if (!parts.length || parts.some(part => !Number.isFinite(part))) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function fromCues(text: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const rows = block.split('\n');
    const at = rows.findIndex(row => row.includes('-->'));
    if (at < 0) continue;
    const [from, to] = rows[at].split('-->');
    const start = clock(from), end = clock(to.trim().split(/\s+/)[0]);
    const words = clean(rows.slice(at + 1).join(' '));
    if (Number.isFinite(start) && Number.isFinite(end) && words) lines.push({ start, end, text: words });
  }
  // Rolling auto-captions repeat the previous line at the start of the next; keep only the new words.
  const out: TranscriptLine[] = [];
  for (const line of lines) {
    const previous = out.at(-1);
    if (previous && line.text === previous.text) { previous.end = Math.max(previous.end, line.end); continue; }
    if (previous && line.text.startsWith(`${previous.text} `)) { out.push({ ...line, text: line.text.slice(previous.text.length + 1) }); continue; }
    out.push({ ...line });
  }
  return out;
}

function fromJson(value: unknown): { lines: TranscriptLine[]; videoId?: string } {
  const data = value as Record<string, unknown>;
  const videoId = typeof data?.youtube_id === 'string' ? data.youtube_id : typeof data?.video_id === 'string' ? data.video_id : undefined;
  // Canonical and (faster-)whisper: { segments: [{ start, end, text }] } in seconds.
  if (Array.isArray(data?.segments)) {
    return { videoId, lines: (data.segments as Record<string, unknown>[]).flatMap(segment =>
      finite(segment.start) && finite(segment.end) && typeof segment.text === 'string' && clean(segment.text) ? [{ start: segment.start, end: segment.end, text: clean(segment.text) }] : []) };
  }
  // whisper.cpp -oj: { transcription: [{ offsets: { from, to } (ms), timestamps: { from, to }, text }] }.
  if (Array.isArray(data?.transcription)) {
    return { videoId, lines: (data.transcription as Record<string, unknown>[]).flatMap(item => {
      const offsets = item.offsets as { from?: unknown; to?: unknown } | undefined, stamps = item.timestamps as { from?: string; to?: string } | undefined;
      const start = finite(offsets?.from) ? offsets.from / 1000 : stamps?.from ? clock(stamps.from) : NaN;
      const end = finite(offsets?.to) ? offsets.to / 1000 : stamps?.to ? clock(stamps.to) : NaN;
      const text = typeof item.text === 'string' ? clean(item.text) : '';
      return Number.isFinite(start) && Number.isFinite(end) && text ? [{ start, end, text }] : [];
    }) };
  }
  throw new Error('This JSON has no transcript segments.');
}

export function parseTranscript(name: string, text: string): Transcript {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  const parsed = trimmed.startsWith('{') ? fromJson(JSON.parse(trimmed)) : trimmed.includes('-->') ? { lines: fromCues(trimmed) } : undefined;
  if (!parsed) throw new Error('Use a transcript JSON, .srt or .vtt file.');
  const lines = parsed.lines.filter(line => line.end >= line.start).sort((a, b) => a.start - b.start || a.end - b.end);
  if (!lines.length) throw new Error('The file has no timed lines.');
  return { name, videoId: parsed.videoId, lines };
}

/** The line being spoken at `time`, or the last one before it. */
export function lineAt(lines: readonly TranscriptLine[], time: number): number {
  let low = 0, high = lines.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lines[middle].start <= time) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found;
}

// Kept per upload in localStorage: a two-hour transcript is roughly 150 KB.
const key = (videoId: string) => `recs-chapter-editor:transcript:v1:${videoId}`;
export function readSavedTranscript(videoId: string): Transcript | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(key(videoId)) || 'null') as Transcript | null;
    return saved && Array.isArray(saved.lines) ? saved : undefined;
  } catch { return undefined; }
}
export function saveTranscript(videoId: string, transcript: Transcript | undefined): boolean {
  try {
    if (transcript) localStorage.setItem(key(videoId), JSON.stringify(transcript)); else localStorage.removeItem(key(videoId));
    return true;
  } catch { return false; }
}
