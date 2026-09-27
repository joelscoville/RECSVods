import type { SearchChapter, Service } from '../lib/types';
import { displayType, watchUrl } from '../lib/urls';
import { availableBrowseCategories } from '../lib/browse';
import type { SavedPlayback } from '../lib/local-state';

export type DisplayChapter = Omit<SearchChapter, 'summary' | 'verseText'>;
export interface DisplayService {
  id: string; title: string; date: string; type: string; preview: boolean;
  sermonTitle?: string;
  sermonDescription?: string;
  series?: Service['series'];
  speakers: { id: string; name: string; chapterIds: string[] }[];
  topics: { id: string; name: string; chapterIds: string[] }[];
  videos: { id: string; duration: number; sequence: number }[];
  chapters: DisplayChapter[];
}
/** Explicit allowlist at the server/client boundary: editorial notes and workflow never serialize. */
export function displayServices(services: Service[], chapters: SearchChapter[]): DisplayService[] {
  return services.map((service) => ({
    id: service.id, title: service.title, date: service.date, type: service.type,
    sermonTitle: service.sermon_title,
    ...(service.sermon_description ? { sermonDescription: service.sermon_description } : {}),
    ...(service.series ? { series: { id: service.series.id, name: service.series.name } } : {}),
    preview: service.editorial_status !== 'reviewed',
    speakers: service.speakers.map(({ id, name }) => ({ id, name, chapterIds: service.chapters.filter((chapter) => chapter.speaker_id === id).map((chapter) => chapter.id) }))
      .filter((speaker) => speaker.chapterIds.length > 0),
    topics: service.topics.map(({ id, name }) => ({ id, name, chapterIds: service.chapters.filter((chapter) => chapter.topics.includes(id)).map((chapter) => chapter.id) }))
      .filter((topic) => topic.chapterIds.length > 0),
    videos: service.videos.map(({ id, duration, sequence }) => ({ id, duration, sequence })).sort((a, b) => a.sequence - b.sequence),
    chapters: chapters.filter((chapter) => chapter.serviceId === service.id && service.videos.some((video) => video.id === chapter.videoId))
      .map(({ id, serviceId, serviceTitle, videoId, start, end, type, title, shortSummary, parentId, parentTitle, keywords, topics, scripture, scriptureDisplay, speaker, date, series, preview }) => ({
        id, serviceId, serviceTitle, videoId, start, end, type, title, keywords: [...keywords], topics: [...topics], scripture: [...scripture],
        ...(shortSummary && !parentId ? { shortSummary } : {}),
        ...(parentId ? { parentId, parentTitle } : {}),
        ...(scriptureDisplay ? { scriptureDisplay: [...scriptureDisplay] } : {}), ...(speaker ? { speaker } : {}), date,
        ...(series ? { series: { id: series.id, name: series.name } } : {}), preview,
      })).sort((a, b) => service.videos.find((video) => video.id === a.videoId)!.sequence - service.videos.find((video) => video.id === b.videoId)!.sequence || a.start - b.start || a.id.localeCompare(b.id)),
  }));
}
export interface HomeItem {
  id: string; serviceId: string; videoId: string; title: string; date: string; type: string;
  speaker?: string; href: string; duration: number; preview: boolean; start: number;
  browseCategories?: string[];
  /** Replaces the type line, e.g. the service a chapter card belongs to. */
  context?: string;
  /** The sermon chapter the card opens, if the recording has one. */
  sermonId?: string;
  /** The chapter a topic, Bible book or search matched. The card still opens the sermon; the watch page
   * offers this chapter as "Chapter only" under the player. */
  match?: RecordingMatch;
  /** Every YouTube upload of the recording, in order. A livestream split into parts is still one recording:
   * one card, one search result. `videoId` and `duration` describe the part the card opens. */
  parts: { id: string; duration: number }[];
}
export interface RecordingMatch { id: string; title: string; start: number; href: string; parentTitle?: string; more: number }
/** One item per recording (service), however many parts YouTube split it into. It opens at the sermon,
 * in whichever part holds it, or at the first chapter. Its ID is the first part's, so thumbnails of
 * single-upload recordings stay the same. */
export function homeItems(services: DisplayService[], base: string): HomeItem[] {
  return [...services].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).flatMap((service): HomeItem[] => {
    const videos = [...service.videos].sort((a, b) => a.sequence - b.sequence);
    if (!videos.length) return [];
    const first = service.chapters[0];
    const sermon = service.chapters.find((chapter) => chapter.type === 'sermon');
    const opens = sermon ?? first, video = videos.find((item) => item.id === opens?.videoId) ?? videos[0];
    return [{
      id: videos[0].id, serviceId: service.id, videoId: video.id, parts: videos.map(({ id, duration }) => ({ id, duration })),
      title: sermon || service.type === 'sermon' ? service.sermonTitle ?? sermon?.title ?? service.title : service.title, date: service.date, type: sermon?.type ?? service.type,
      speaker: sermon?.speaker, href: watchUrl(base, opens ? { chapter: opens.id } : { service: service.id, video: video.id }),
      duration: video.duration, preview: service.preview, start: opens?.start ?? 0,
      ...(sermon ? { sermonId: sermon.id } : {}),
      browseCategories: availableBrowseCategories([service]).map((category) => category.path),
    }];
  });
}
export function archiveCategories(items: { type: string }[]): { value: string; label: string }[] {
  return [...new Set(items.map((item) => item.type))].map((value) => ({ value, label: displayType(value) }));
}

export function homeSelection(items: HomeItem[], saved: SavedPlayback | null, base: string) {
  // Resume may be in any part of a split recording; the featured card then opens (and measures) that part.
  const part = saved ? (item: HomeItem) => item.serviceId === saved.serviceId ? item.parts.find((candidate) => candidate.id === saved.videoId) : undefined : () => undefined;
  const returning = saved ? items.find((item) => { const resumed = part(item); return resumed && saved.time > 0 && saved.time < resumed.duration - 2; }) : undefined;
  const latest = items.find((item) => item.type === 'sermon') ?? items[0];
  const featured = returning ? { ...returning, videoId: saved!.videoId, duration: part(returning)!.duration, href: watchUrl(base, { service: returning.serviceId, video: saved!.videoId, start: saved!.time }) } : latest;
  // A resumed recording swaps places with the latest one, so the saved state (read only after hydration)
  // changes one card's content instead of reflowing every card after it.
  const supporting = latest ? items.filter((item) => item.id !== latest.id).map((item) => item.id === returning?.id ? latest : item) : [];
  return { returning, featured, supporting };
}

/** Groups ranked chapter matches into one entry per recording, in the rank of each recording's best
 * chapter. The recording carries that chapter as its match and counts the other matching chapters. */
export function groupByRecording<T extends { chapter: Pick<DisplayChapter, 'id' | 'videoId' | 'title' | 'start' | 'parentTitle'> }>(
  ranked: readonly T[], recordings: readonly HomeItem[], base: string,
): (T & { recording: HomeItem & { match: RecordingMatch } })[] {
  // Every part of a split recording maps to that one recording.
  const byVideo = new Map(recordings.flatMap((recording) => recording.parts.map((part) => [part.id, recording] as const)));
  const groups = new Map<string, T & { recording: HomeItem & { match: RecordingMatch } }>();
  for (const entry of ranked) {
    const recording = byVideo.get(entry.chapter.videoId);
    if (!recording) continue;
    const group = groups.get(recording.id);
    if (group) { group.recording.match.more++; continue; }
    const { id, title, start, parentTitle } = entry.chapter;
    // The recording opens at its sermon (or the matched chapter when it has none), carrying the match along.
    const href = watchUrl(base, { chapter: recording.sermonId ?? id, match: id });
    groups.set(recording.id, { ...entry, recording: { ...recording, href, match: { id, title, start, href: watchUrl(base, { chapter: id }), ...(parentTitle ? { parentTitle } : {}), more: 0 } } });
  }
  return [...groups.values()];
}

/** Cards for a browse category page, in the same shape as the home page cards: one per recording.
 * On topic and Bible-book pages each card also names the chapter that placed it there. */
export function browseItems(page: { path: string; serviceIds?: string[]; chapterIds?: string[] }, services: DisplayService[], base: string): HomeItem[] {
  const recordings = homeItems(services, base);
  const serviceIds = new Set(page.serviceIds), chapterIds = new Set(page.chapterIds);
  if (!page.chapterIds?.length) return recordings.filter((item) => serviceIds.has(item.serviceId));
  const matches = services.flatMap((service) => service.chapters.filter((chapter) => !chapter.parentId && chapterIds.has(chapter.id)).map((chapter) => ({ chapter })));
  return groupByRecording(matches, recordings, base).map(({ recording }) => recording);
}
