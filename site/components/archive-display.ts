import type { SearchPassage, Service } from '../lib/types';
import { displayType, watchUrl } from '../lib/urls';

export interface DisplaySection { id: string; videoId: string; start: number; end: number; title: string; type: string; speaker?: string }
export interface DisplayService {
  id: string; title: string; date: string; type: string; preview: boolean;
  sermonTitle?: string;
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
    videos: service.videos.map(({ id, duration, sequence }) => ({ id, duration, sequence })),
    sections: service.sections.map((section) => ({
      id: section.id, videoId: section.video_id, start: section.start, end: section.end,
      title: section.title, type: section.type,
      speaker: service.speakers.find((speaker) => speaker.id === section.speaker_id)?.name,
    })),
    passages: passages.filter((passage) => passage.serviceId === service.id),
  }));
}
export interface HomeItem {
  id: string; serviceId: string; videoId: string; title: string; date: string; type: string;
  speaker?: string; href: string; duration: number; preview: boolean; start: number;
}
export function homeItems(services: DisplayService[], base: string): HomeItem[] {
  return services.flatMap((service) => service.videos.map((video) => {
    const sermon = service.sections.find((section) => section.videoId === video.id && section.type === 'sermon');
    return {
      id: video.id, serviceId: service.id, videoId: video.id,
      title: service.sermonTitle ?? sermon?.title ?? service.title, date: service.date, type: sermon?.type ?? service.type,
      speaker: sermon?.speaker, href: watchUrl(base, { service: service.id, video: video.id, start: sermon?.start }),
      duration: video.duration, preview: service.preview, start: sermon?.start ?? 0,
    };
  }));
}
export function archiveCategories(items: { type: string }[]): { value: string; label: string }[] {
  return [...new Set(items.map((item) => item.type))].map((value) => ({ value, label: displayType(value) }));
}
