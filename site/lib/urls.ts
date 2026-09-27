/** Internal URLs are always relative to the deployment root, including nested previews. */
export function basePath(base: string): string {
  const segments = base.split('/').filter(Boolean);
  if (segments.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid deployment base');
  return segments.length ? `/${segments.join('/')}/` : '/';
}

export function siteUrl(base: string, path = ''): string {
  return `${basePath(base)}${path.replace(/^\/+/, '')}`;
}

export function searchUrl(base: string, query = ''): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  return `${siteUrl(base, 'search/')}${params.size ? `?${params}` : ''}`;
}

export interface WatchTarget {
  chapter?: string; /** Legacy input only. */ id?: string; service?: string; video?: string; start?: number;
  /** With a chapter: the chapter a search or category matched, offered as "Chapter only" under the player. */
  match?: string;
}
export function watchUrl(base: string, target: WatchTarget): string {
  const params = new URLSearchParams();
  if (target.chapter) return `${siteUrl(base, 'watch/')}?${new URLSearchParams({ chapter: target.chapter, ...(target.match && target.match !== target.chapter ? { match: target.match } : {}) })}`;
  if (target.service) params.set('service', target.service);
  if (target.video) params.set('video', target.video);
  if (Number.isFinite(target.start) && target.start! >= 0) params.set('t', String(Math.floor(target.start!)));
  return `${siteUrl(base, 'watch/')}${params.size ? `?${params}` : ''}`;
}

export function readWatchTarget(query: string): WatchTarget {
  const params = new URLSearchParams(query);
  const time = params.get('t');
  return {
    chapter: params.get('chapter') || undefined,
    match: params.get('match') || undefined,
    id: params.get('id') || undefined,
    service: params.get('service') || undefined,
    video: params.get('video') || undefined,
    start: time !== null && /^\d+(?:\.\d+)?$/.test(time) && Number.isFinite(Number(time)) ? Number(time) : undefined,
  };
}

export function serviceUrl(base: string, id: string): string {
  return siteUrl(base, `services/${encodeURIComponent(id)}/`);
}

export function youtubeUrl(videoId: string, start = 0): string {
  const params = new URLSearchParams({ v: videoId, t: String(Math.max(0, Math.floor(start))) });
  return `https://www.youtube.com/watch?${params}`;
}

export function formatTime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${hours ? `${hours}:` : ''}${hours ? String(minutes).padStart(2, '0') : minutes}:${String(value % 60).padStart(2, '0')}`;
}

/** Human duration for labels: "1 h 50 min", "12 min", "1 min 16 s", "45 s". */
export function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  if (hours) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes) return minutes < 10 && rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  return `${rest} s`;
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

export function displayType(type: string): string {
  return type.replace(/[_-]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}
