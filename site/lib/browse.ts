import type { DisplayService } from '../components/archive-display';
import { siteUrl } from './urls';

export const BROWSE_CATEGORIES = [
  { path: 'services', title: 'Services' }, { path: 'sermons', title: 'Sermons' },
  { path: 'speakers', title: 'Speakers' }, { path: 'scripture', title: 'Bible books' },
  { path: 'topics', title: 'Topics' }, { path: 'series', title: 'Series' }, { path: 'years', title: 'Years' },
] as const;
export interface BrowseLink { path: string; title: string }
export interface BrowsePage extends BrowseLink {
  parent?: BrowseLink; links?: BrowseLink[]; serviceIds?: string[]; chapterIds?: string[];
}
export function browseUrl(base: string, path = ''): string {
  return siteUrl(base, `browse/${path ? `${path.split('/').map(encodeURIComponent).join('/')}/` : ''}`);
}
export function scriptureBook(reference: string): string { return reference.replace(/\s+\d.*$/, ''); }
export function scriptureBookId(book: string): string { return book.toLowerCase().replace(/\s+/g, '-'); }
export function availableBrowseCategories(services: readonly DisplayService[], chapters = services.flatMap((service) => service.chapters)): BrowseLink[] {
  return BROWSE_CATEGORIES.filter(({ path }) => {
    switch (path) {
      case 'services': case 'years': return services.length > 0 || chapters.length > 0;
      case 'sermons': return services.some((service) => service.type === 'sermon') || chapters.some((chapter) => chapter.type === 'sermon');
      case 'speakers': return chapters.some((chapter) => chapter.speaker);
      case 'scripture': return chapters.some((chapter) => chapter.scripture.length > 0);
      case 'topics': return chapters.some((chapter) => chapter.topics.length > 0);
      case 'series': return services.some((service) => service.series) || chapters.some((chapter) => chapter.series);
    }
  });
}

/** Inputs come from publishedServices + flattenChapters for the current build mode. */
export function buildBrowsePages(services: readonly DisplayService[]): BrowsePage[] {
  const ordered = [...services].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const chapters = ordered.flatMap((service) => service.chapters);
  const pages: BrowsePage[] = [];
  const category = (path: string) => BROWSE_CATEGORIES.find((item) => item.path === path)!;
  if (!ordered.length) return pages;
  pages.push({ ...category('services'), serviceIds: ordered.map((service) => service.id) });
  const sermonChapters = chapters.filter((chapter) => chapter.type === 'sermon');
  const sermonServices = ordered.filter((service) => service.type === 'sermon' && !service.chapters.some((chapter) => chapter.type === 'sermon'));
  if (sermonChapters.length || sermonServices.length) pages.push({ ...category('sermons'), chapterIds: sermonChapters.map((chapter) => chapter.id), serviceIds: sermonServices.map((service) => service.id) });
  function addGroups(path: string, groups: Map<string, { title: string; serviceIds?: string[]; chapterIds?: string[] }>) {
    if (!groups.size) return;
    const parent = category(path);
    const leaves = [...groups].sort(([a, av], [b, bv]) => path === 'years' ? b.localeCompare(a) : av.title.localeCompare(bv.title) || a.localeCompare(b)).map(([id, group]) => ({ path: `${path}/${id}`, ...group, parent }));
    pages.push({ ...parent, links: leaves.map(({ path, title }) => ({ path, title })) }, ...leaves);
  }
  const speakers = new Map<string, { title: string; chapterIds: string[] }>();
  const topics = new Map<string, { title: string; chapterIds: string[] }>();
  for (const service of ordered) {
    for (const [records, groups] of [[service.speakers, speakers], [service.topics, topics]] as const) {
      for (const record of records) {
        const matches = service.chapters.filter((chapter) => record.chapterIds.includes(chapter.id));
        if (!matches.length) continue;
        const group = groups.get(record.id) ?? { title: record.name, chapterIds: [] };
        group.chapterIds.push(...matches.map((chapter) => chapter.id));
        groups.set(record.id, group);
      }
    }
  }
  addGroups('speakers', speakers);
  const books = new Map<string, { title: string; chapterIds: string[] }>();
  for (const chapter of chapters) for (const book of new Set(chapter.scripture.map(scriptureBook))) {
    const id = scriptureBookId(book);
    const group = books.get(id) ?? { title: book, chapterIds: [] };
    group.chapterIds.push(chapter.id); books.set(id, group);
  }
  addGroups('scripture', books); addGroups('topics', topics);
  const series = new Map<string, { title: string; serviceIds: string[] }>();
  for (const service of ordered) {
    if (!service.series) continue;
    const group = series.get(service.series.id) ?? { title: service.series.name, serviceIds: [] };
    if (group.title !== service.series.name) throw new Error(`Conflicting name for series ID ${service.series.id}`);
    group.serviceIds.push(service.id); series.set(service.series.id, group);
  }
  addGroups('series', series);
  const years = new Map<string, { title: string; serviceIds: string[] }>();
  for (const service of ordered) {
    const year = service.date.slice(0, 4);
    const group = years.get(year) ?? { title: year, serviceIds: [] };
    group.serviceIds.push(service.id); years.set(year, group);
  }
  addGroups('years', years);
  return pages;
}
