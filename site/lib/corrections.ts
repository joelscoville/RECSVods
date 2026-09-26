import { serviceUrl, watchUrl } from './urls';

export const CORRECTION_KINDS = ['transcript', 'timestamp', 'scripture', 'speaker', 'section', 'other'] as const;
export type CorrectionKind = typeof CORRECTION_KINDS[number];
export interface CorrectionPassage {
  serviceId: string; videoId: string; sectionId: string; start: number; end: number; sourcePath?: string;
}
export interface CorrectionService {
  videos: { id: string; duration: number }[];
  sections: { id: string; videoId: string; start: number; end: number }[];
  sourcePath?: string;
}
/** Only stable public identifiers, bounds and repository-relative source paths cross this boundary. */
export interface CorrectionConfig {
  repositoryUrl?: string;
  sourceRef?: string;
  services: Record<string, CorrectionService>;
  passages: Record<string, CorrectionPassage>;
}
export type CorrectionTarget = { passageId: string } | { serviceId: string; videoId?: string; sectionId?: string };
const stableId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
const videoId = (value: string) => /^[A-Za-z0-9_-]{11}$/.test(value);

/** Deliberately narrower than URL parsing: reject credentials, queries, ports and URL normalization tricks. */
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
export function validSourcePath(value: string): boolean {
  if (!/^services\/\d{4}\/[A-Za-z0-9][A-Za-z0-9_-]*\/(?:service\.yaml|[A-Za-z0-9_./-]+\.md)$/.test(value)) return false;
  return value.split('/').every((part) => part !== '.' && part !== '..' && part !== '');
}
const encodeSegment = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
export function sourceFileUrl(repository: string, ref: string, sourcePath: string, action: 'blob' | 'edit' = 'edit'): string | undefined {
  const url = validateRepositoryUrl(repository);
  if (!url || !validateSourceRef(ref) || !validSourcePath(sourcePath) || !['blob', 'edit'].includes(action)) return undefined;
  return `${url}/${action}/${encodeSegment(ref)}/${sourcePath.split('/').map(encodeSegment).join('/')}`;
}
export function correctionConfig(): CorrectionConfig {
  return typeof __RECS_CORRECTIONS__ === 'undefined' ? { services: {}, passages: {} } : __RECS_CORRECTIONS__;
}
const own = <T,>(map: Record<string, T>, key: string): T | undefined => Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

/** No location, query, history, resume state, free-form text or archive objects are accepted here. */
export function correctionLinks(target: CorrectionTarget, base: string, config = correctionConfig(), kind?: CorrectionKind): { issueUrl?: string; editUrl?: string } {
  const repository = config.repositoryUrl && validateRepositoryUrl(config.repositoryUrl);
  if (!repository) return {};
  let serviceId: string;
  let passageId = '';
  let sectionId = '';
  let videos: { id: string; start: number; end: number }[];
  let sourcePath: string | undefined;
  let page: string;
  if ('passageId' in target) {
    passageId = target.passageId;
    const passage = own(config.passages, passageId);
    if (!stableId(passageId) || !passage || !stableId(passage.sectionId)) return {};
    serviceId = passage.serviceId;
    sectionId = passage.sectionId;
    videos = [{ id: passage.videoId, start: passage.start, end: passage.end }];
    sourcePath = passage.sourcePath;
    page = watchUrl(base, { id: passageId });
  } else {
    serviceId = target.serviceId;
    const service = own(config.services, serviceId);
    if (!service) return {};
    videos = service.videos.filter((video) => !target.videoId || video.id === target.videoId).map((video) => ({ id: video.id, start: 0, end: video.duration }));
    sourcePath = service.sourcePath;
    page = target.videoId ? watchUrl(base, { service: serviceId, video: target.videoId }) : serviceUrl(base, serviceId);
    if (target.sectionId) {
      const section = service.sections.find((item) => item.id === target.sectionId);
      if (!stableId(target.sectionId) || !section || (target.videoId && target.videoId !== section.videoId)) return {};
      sectionId = section.id;
      videos = [{ id: section.videoId, start: section.start, end: section.end }];
      page = watchUrl(base, { service: serviceId, video: section.videoId, start: section.start });
    }
  }
  const service = own(config.services, serviceId);
  if (!stableId(serviceId) || !service || !videos.length || videos.some((video) => {
    const known = service.videos.find((item) => item.id === video.id);
    return !videoId(video.id) || !known || !Number.isFinite(known.duration) || !Number.isFinite(video.start) || !Number.isFinite(video.end)
      || video.start < 0 || video.end <= video.start || video.end > known.duration;
  })) return {};
  if (passageId) {
    const section = service.sections.find((item) => item.id === sectionId);
    const video = videos[0];
    if (!section || section.videoId !== video.id || video.start < section.start || video.end > section.end) return {};
  }
  const params = new URLSearchParams({
    template: 'archive-correction.yml',
    title: `Archive correction: ${passageId || serviceId}`,
    'service-id': serviceId,
    'video-id': videos.map((video) => video.id).join(', '),
    'passage-id': passageId || (sectionId ? 'Not selected (whole section)' : 'Not selected (whole recording/service)'),
    'section-id': sectionId || 'Not selected (whole recording/service)',
    timestamps: videos.map((video) => `${video.id}: ${video.start}–${video.end} seconds`).join('\n'),
    page,
  });
  if (kind && CORRECTION_KINDS.includes(kind)) params.set('problem', kind);
  // GitHub installs issue forms from the default branch only. Keep a standard
  // Markdown draft usable before this form is merged, using the same allowlist.
  params.set('body', [
    '## Archive correction',
    ...['service-id', 'video-id', 'passage-id', 'section-id', 'timestamps', 'page'].map((field) => `### ${field}\n${params.get(field)}`),
    '## Problem',
    ...CORRECTION_KINDS.map((choice) => `- [${params.get('problem') === choice ? 'x' : ' '}] ${choice}`),
    '## Suggested correction\nDescribe the problem and your suggested correction here.',
  ].join('\n\n'));
  // Even a tampered map cannot point an edit action outside this service directory.
  const sameService = sourcePath?.split('/')[2] === serviceId;
  return {
    issueUrl: `${repository}/issues/new?${params}`,
    editUrl: sameService && sourcePath && config.sourceRef ? sourceFileUrl(repository, config.sourceRef, sourcePath) : undefined,
  };
}
