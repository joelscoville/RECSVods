import { serviceUrl, watchUrl } from './urls';

export const CORRECTION_KINDS = ['chapter time', 'title', 'scripture', 'speaker', 'topic', 'other'] as const;
export type CorrectionKind = typeof CORRECTION_KINDS[number];
export interface CorrectionChapter { serviceId: string; videoId: string; start: number; end: number }
export interface CorrectionService { videos: { id: string; duration: number }[] }
/** Build-produced public identifiers and bounds only. */
export interface CorrectionConfig {
  repositoryUrl?: string;
  sourceRef?: string;
  services: Record<string, CorrectionService>;
  chapters: Record<string, CorrectionChapter>;
}
export type CorrectionTarget = { chapterId: string } | { serviceId: string; videoId?: string };
const stableId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
const videoId = (value: string) => /^[A-Za-z0-9_-]{11}$/.test(value);

/** Reject credentials, queries, ports and URL normalization tricks. */
export function validateRepositoryUrl(value: string): string | undefined {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_.-]+)\/?$/.exec(value);
  if (!match) return undefined;
  const repository = match[2].replace(/\.git$/, '');
  if (!repository || repository === '.' || repository === '..') return undefined;
  return `https://github.com/${match[1]}/${repository}`;
}
export function validateSourceRef(value: string): string | undefined {
  if (!value || value === 'HEAD' || value === '@' || /[\s~^:?*[\\]/.test(value)
    || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || value.includes('..') || value.includes('@{') || value.startsWith('-')
    || value.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) return undefined;
  return value;
}
export function correctionConfig(): CorrectionConfig {
  return typeof __RECS_CORRECTIONS__ === 'undefined' ? { services: {}, chapters: {} } : __RECS_CORRECTIONS__;
}
const own = <T,>(map: Record<string, T>, key: string): T | undefined => Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

/** No location, query, history, resume state, free-form text or private archive objects. */
export function correctionLinks(target: CorrectionTarget, base: string, config = correctionConfig(), kind?: CorrectionKind): { issueUrl?: string } {
  const repository = config.repositoryUrl && validateRepositoryUrl(config.repositoryUrl);
  if (!repository) return {};
  let serviceId: string;
  let chapterId = '';
  let videos: { id: string; start: number; end: number }[];
  let page: string;
  if ('chapterId' in target) {
    chapterId = target.chapterId;
    const chapter = own(config.chapters, chapterId);
    if (!stableId(chapterId) || !chapter) return {};
    serviceId = chapter.serviceId;
    videos = [{ id: chapter.videoId, start: chapter.start, end: chapter.end }];
    page = watchUrl(base, { chapter: chapterId });
  } else {
    serviceId = target.serviceId;
    const service = own(config.services, serviceId);
    if (!service) return {};
    videos = service.videos.filter((video) => !target.videoId || video.id === target.videoId)
      .map((video) => ({ id: video.id, start: 0, end: video.duration }));
    page = target.videoId ? watchUrl(base, { service: serviceId, video: target.videoId }) : serviceUrl(base, serviceId);
  }
  const service = own(config.services, serviceId);
  if (!stableId(serviceId) || !service || !videos.length || videos.some((video) => {
    const known = service.videos.find((item) => item.id === video.id);
    return !videoId(video.id) || !known || !Number.isFinite(known.duration) || !Number.isFinite(video.start) || !Number.isFinite(video.end)
      || video.start < 0 || video.end <= video.start || video.end > known.duration;
  })) return {};
  const params = new URLSearchParams({
    template: 'archive-correction.yml', title: `Archive correction: ${chapterId || serviceId}`,
    'service-id': serviceId, 'video-id': videos.map((video) => video.id).join(', '),
    'chapter-id': chapterId || 'Not selected (whole recording/service)',
    timestamps: videos.map((video) => `${video.id}: ${video.start}–${video.end} seconds`).join('\n'), page,
  });
  if (kind && CORRECTION_KINDS.includes(kind)) params.set('problem', kind);
  // GitHub installs forms from the default branch only; retain a Markdown fallback.
  params.set('body', [
    '## Archive correction',
    ...['service-id', 'video-id', 'chapter-id', 'timestamps', 'page'].map((field) => `### ${field}\n${params.get(field)}`),
    '## Problem', ...CORRECTION_KINDS.map((choice) => `- [${params.get('problem') === choice ? 'x' : ' '}] ${choice}`),
    '## Suggested correction\nDescribe the problem and your suggested correction here.',
  ].join('\n\n'));
  return { issueUrl: `${repository}/issues/new?${params}` };
}
