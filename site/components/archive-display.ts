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
      .map(({ id, serviceId, serviceTitle, videoId, start, end, type, title, parentId, parentTitle, keywords, topics, scripture, scriptureDisplay, speaker, date, series, preview }) => ({
        id, serviceId, serviceTitle, videoId, start, end, type, title, keywords: [...keywords], topics: [...topics], scripture: [...scripture],
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
}
export function homeItems(services: DisplayService[], base: string): HomeItem[] {
  return [...services].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).flatMap((service) => [...service.videos].sort((a, b) => a.sequence - b.sequence).map((video) => {
    const first = service.chapters.find((chapter) => chapter.videoId === video.id);
    const sermon = service.chapters.find((chapter) => chapter.videoId === video.id && chapter.type === 'sermon');
    return {
      id: video.id, serviceId: service.id, videoId: video.id,
      title: sermon || service.type === 'sermon' ? service.sermonTitle ?? sermon?.title ?? service.title : service.title, date: service.date, type: sermon?.type ?? service.type,
      speaker: sermon?.speaker, href: watchUrl(base, sermon || first ? { chapter: (sermon ?? first)!.id } : { service: service.id, video: video.id }),
      duration: video.duration, preview: service.preview, start: sermon?.start ?? first?.start ?? 0,
      browseCategories: availableBrowseCategories([service]).map((category) => category.path),
    };
  }));
}
export function archiveCategories(items: { type: string }[]): { value: string; label: string }[] {
  return [...new Set(items.map((item) => item.type))].map((value) => ({ value, label: displayType(value) }));
}

export function homeSelection(items: HomeItem[], saved: SavedPlayback | null, base: string) {
  const returning = saved ? items.find((item) => item.serviceId === saved.serviceId && item.videoId === saved.videoId && saved.time > 0 && saved.time < item.duration - 2) : undefined;
  const featured = returning ? { ...returning, href: watchUrl(base, { service: returning.serviceId, video: returning.videoId, start: saved!.time }) } : items.find((item) => item.type === 'sermon') ?? items[0];
  return { returning, featured, supporting: featured ? items.filter((item) => item.id !== featured.id) : [] };
}
