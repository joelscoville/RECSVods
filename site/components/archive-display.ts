import type { SearchPassage, Service } from '../lib/types';
import { displayType, watchUrl } from '../lib/urls';
import { availableBrowseCategories } from '../lib/browse';
import type { SavedPlayback } from '../lib/local-state';

export interface DisplaySection { id: string; videoId: string; start: number; end: number; title: string; type: string; speaker?: string; speakerId?: string }
export interface DisplayService {
  id: string; title: string; date: string; type: string; preview: boolean;
  sermonTitle?: string;
  speakers: { id: string; name: string; passageIds: string[] }[];
  topics: { id: string; name: string; passageIds: string[] }[];
  videos: { id: string; duration: number; sequence: number }[];
  sections: DisplaySection[];
  passages: SearchPassage[];
}
/** Explicit allowlist at the server/client boundary: editorial notes and workflow never serialize. */
export function displayServices(services: Service[], passages: SearchPassage[]): DisplayService[] {
  return services.map((service) => ({
    id: service.id, title: service.title, date: service.date, type: service.type,
    sermonTitle: service.sermon_title,
    preview: service.editorial_status !== 'reviewed',
    speakers: service.speakers.map(({ id, name }) => ({ id, name, passageIds: service.passages.filter((passage) => (passage.speaker_id ?? service.sections.find((section) => section.id === passage.section_id)?.speaker_id) === id).map((passage) => passage.id) }))
      .filter((speaker) => speaker.passageIds.length > 0 || service.sections.some((section) => section.speaker_id === speaker.id)),
    topics: service.topics.map(({ id, name }) => ({ id, name, passageIds: service.passages.filter((passage) => passage.topics.includes(id)).map((passage) => passage.id) }))
      .filter((topic) => topic.passageIds.length > 0),
    videos: service.videos.map(({ id, duration, sequence }) => ({ id, duration, sequence })).sort((a, b) => a.sequence - b.sequence),
    sections: service.sections.map((section) => ({
      id: section.id, videoId: section.video_id, start: section.start, end: section.end,
      title: section.title, type: section.type,
      speaker: service.speakers.find((speaker) => speaker.id === section.speaker_id)?.name,
      speakerId: section.speaker_id,
    })).sort((a, b) => service.videos.find((video) => video.id === a.videoId)!.sequence - service.videos.find((video) => video.id === b.videoId)!.sequence || a.start - b.start || a.id.localeCompare(b.id)),
    passages: passages.filter((passage) => passage.serviceId === service.id && service.videos.some((video) => video.id === passage.videoId)),
  }));
}
export interface HomeItem {
  id: string; serviceId: string; videoId: string; title: string; date: string; type: string;
  speaker?: string; href: string; duration: number; preview: boolean; start: number;
  browseCategories?: string[];
}
export function homeItems(services: DisplayService[], base: string): HomeItem[] {
  return [...services].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).flatMap((service) => [...service.videos].sort((a, b) => a.sequence - b.sequence).map((video) => {
    const sermon = service.sections.find((section) => section.videoId === video.id && section.type === 'sermon');
    return {
      id: video.id, serviceId: service.id, videoId: video.id,
      title: sermon || service.type === 'sermon' ? service.sermonTitle ?? sermon?.title ?? service.title : service.title, date: service.date, type: sermon?.type ?? service.type,
      speaker: sermon?.speaker, href: watchUrl(base, { service: service.id, video: video.id, start: sermon?.start }),
      duration: video.duration, preview: service.preview, start: sermon?.start ?? 0,
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
