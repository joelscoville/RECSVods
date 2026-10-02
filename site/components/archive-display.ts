import type { DisplayRecording, SearchUnit } from '../lib/display';
import { sermonOf } from '../lib/display';
import { watchUrl } from '../lib/urls';
import { availableBrowseCategories } from '../lib/browse';
import type { SavedPlayback } from '../lib/local-state';
import type { PublicQuirk } from '../lib/video-quirks';

export type { DisplayEntry, DisplayRecording, DisplayUpload } from '../lib/display';

/** One card per recording, however many uploads it took. */
export interface HomeItem {
  /** The first upload's id: it seeds the thumbnail pattern. */
  id: string; recordingId: string; title: string; date: string; hasSermon: boolean;
  href: string; length: number; preview: boolean; start: number;
  browseCategories?: string[];
  /** Replaces the type line, e.g. a series position. */
  context?: string;
  /** The point or part a topic, Bible book or search matched. The card still opens the sermon. */
  match?: RecordingMatch;
  quirks?: PublicQuirk[];
  speaker?: string;
}
export interface RecordingMatch { id: string; title: string; start: number; href: string; more: number }

/** Cards open at the sermon when there is one, else at the start. */
export function homeItems(recordings: readonly DisplayRecording[], base: string): HomeItem[] {
  return [...recordings].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).map((recording): HomeItem => {
    const sermon = sermonOf(recording), start = sermon?.start ?? 0;
    const quirks = [...new Map(recording.uploads.flatMap(upload => upload.quirks ?? []).map(flag => [flag.kind, flag])).values()];
    return {
      id: recording.uploads[0].id, recordingId: recording.id, title: recording.title, date: recording.date, hasSermon: Boolean(sermon),
      href: watchUrl(base, { recording: recording.id, start }), length: recording.length, preview: recording.preview, start,
      ...(recording.speaker ? { speaker: recording.speaker } : {}),
      ...(quirks.length ? { quirks } : {}),
      browseCategories: availableBrowseCategories([recording]).map((category) => category.path),
    };
  });
}

export function homeSelection(items: HomeItem[], saved: SavedPlayback | null, base: string) {
  const returning = saved ? items.find((item) => item.recordingId === saved.recordingId && saved.time > 0 && saved.time < item.length - 2) : undefined;
  const latest = items.find((item) => item.hasSermon) ?? items[0];
  const featured = returning ? { ...returning, href: watchUrl(base, { recording: returning.recordingId, start: saved!.time }) } : latest;
  // A resumed recording swaps places with the latest one, so the saved state (read only after hydration)
  // changes one card's content instead of reflowing every card after it.
  const supporting = latest ? items.filter((item) => item.id !== latest.id).map((item) => item.id === returning?.id ? latest : item) : [];
  return { returning, featured, supporting };
}

/** Groups ranked matches into one entry per recording, in the rank of each recording's best match. A match on
 * a point or part rides along, offered under the player; the recording still opens at its sermon. */
export function groupByRecording<T extends { unit: Pick<SearchUnit, 'id' | 'recordingId' | 'kind' | 'title' | 'start' | 'entryId'> }>(
  ranked: readonly T[], recordings: readonly HomeItem[], base: string,
): (T & { recording: HomeItem & { match?: RecordingMatch } })[] {
  const byId = new Map(recordings.map((recording) => [recording.recordingId, recording]));
  const groups = new Map<string, T & { recording: HomeItem & { match?: RecordingMatch } }>();
  for (const entry of ranked) {
    const recording = byId.get(entry.unit.recordingId);
    if (!recording) continue;
    const group = groups.get(recording.recordingId);
    if (group) { if (group.recording.match) group.recording.match.more++; continue; }
    const { id, kind, title, start } = entry.unit;
    if (kind === 'recording') { groups.set(recording.recordingId, { ...entry, recording }); continue; }
    const focus = entry.unit.entryId ?? id.slice(recording.recordingId.length + 1);
    groups.set(recording.recordingId, { ...entry, recording: { ...recording, href: watchUrl(base, { recording: recording.recordingId, start: recording.start, focus }),
      match: { id: focus, title, start, href: watchUrl(base, { recording: recording.recordingId, start, focus }), more: 0 } } });
  }
  return [...groups.values()];
}

/** Cards for a browse category page, in the page's order (a series keeps its playlist order). */
export function browseItems(page: { recordingIds?: string[]; path: string }, recordings: readonly DisplayRecording[], base: string): HomeItem[] {
  const cards = new Map(homeItems(recordings, base).map((item) => [item.recordingId, item]));
  const series = page.path.startsWith('series/');
  return (page.recordingIds ?? []).flatMap((id) => {
    const card = cards.get(id), recording = recordings.find((item) => item.id === id);
    if (!card) return [];
    return [series && recording?.series ? { ...card, context: `Part ${recording.series.position} of ${recording.series.total}` } : card];
  });
}
