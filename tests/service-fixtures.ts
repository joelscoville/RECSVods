/** Test fixtures use numeric runtime models; files on disk use the human authoring format. */
import { Document, stringify as yamlStringify } from 'yaml';
import { formatTimecode } from '../site/lib/timecode';
import { quoteClockNodes } from '../site/lib/service-document';

const clock = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? formatTimecode(value) : value;
export function sourceValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const service = value as Record<string, unknown>;
  if (!Array.isArray(service.videos) || !Array.isArray(service.chapters)) return value;
  return { ...service, videos: service.videos.map(video => ({ ...video, duration: clock(video.duration) })),
    chapters: service.chapters.map(chapter => ({ ...chapter, start: clock(chapter.start), end: clock(chapter.end) })) };
}
export function stringify(value: unknown, options?: { indent?: number; lineWidth?: number }): string {
  const source = sourceValue(value);
  if (source === value) return yamlStringify(value, options);
  const document = new Document(source); quoteClockNodes(document);
  return document.toString(options);
}
