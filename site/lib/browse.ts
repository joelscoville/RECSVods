import type { DisplayService } from '../components/archive-display';
import { siteUrl } from './urls';
import { BIBLE_BOOKS } from './scripture';

/** Every recording lives under "All recordings"; the other categories narrow it. */
export const BROWSE_CATEGORIES = [
  { path: 'all', title: 'All recordings' }, { path: 'scripture', title: 'Bible books' },
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
      case 'all': case 'years': return services.length > 0 || chapters.length > 0;
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
  pages.push({ ...category('all'), serviceIds: ordered.map((service) => service.id) });
  function addGroups(path: string, groups: Map<string, { title: string; serviceIds?: string[]; chapterIds?: string[] }>) {
    if (!groups.size) return;
    const parent = category(path);
    // Years newest first, Bible books in canonical order, everything else alphabetically.
    const canon = (title: string) => { const index = (BIBLE_BOOKS as readonly string[]).indexOf(title); return index < 0 ? BIBLE_BOOKS.length : index; };
    const leaves = [...groups].sort(([a, av], [b, bv]) => path === 'years' ? b.localeCompare(a)
      : path === 'scripture' ? canon(av.title) - canon(bv.title) || av.title.localeCompare(bv.title)
        : av.title.localeCompare(bv.title) || a.localeCompare(b)).map(([id, group]) => ({ path: `${path}/${id}`, ...group, parent }));
    pages.push({ ...parent, links: leaves.map(({ path, title }) => ({ path, title })) }, ...leaves);
  }
  const topics = new Map<string, { title: string; chapterIds: string[] }>();
  for (const service of ordered) {
    for (const record of service.topics) {
      const matches = service.chapters.filter((chapter) => record.chapterIds.includes(chapter.id));
      if (!matches.length) continue;
      const group = topics.get(record.id) ?? { title: record.name, chapterIds: [] };
      group.chapterIds.push(...matches.map((chapter) => chapter.id));
      topics.set(record.id, group);
    }
  }
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

/** Most frequent topics first, so suggestions reflect the archive rather than file order. */
export function suggestedTopics(items: readonly { topics: readonly string[] }[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const item of items) for (const topic of item.topics) counts.set(topic, (counts.get(topic) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([topic]) => topic);
}
