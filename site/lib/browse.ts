import type { DisplayService } from '../components/archive-display';
import type { SearchPassage } from './types';
import { siteUrl } from './urls';

export const BROWSE_CATEGORIES = [
  { path: 'services', title: 'Services' },
  { path: 'sermons', title: 'Sermons' },
  { path: 'speakers', title: 'Speakers' },
  { path: 'scripture', title: 'Bible books' },
  { path: 'topics', title: 'Topics' },
  { path: 'years', title: 'Years' },
] as const;
export interface BrowseLink { path: string; title: string }
export interface BrowsePage extends BrowseLink {
  parent?: BrowseLink;
  links?: BrowseLink[];
  serviceIds?: string[];
  sectionIds?: string[];
  passageIds?: string[];
}

export function browseUrl(base: string, path = ''): string {
  return siteUrl(base, `browse/${path ? `${path.split('/').map(encodeURIComponent).join('/')}/` : ''}`);
}
export function scriptureBook(reference: string): string {
  return reference.replace(/\s+\d.*$/, '');
}
export function scriptureBookId(book: string): string {
  return book.toLowerCase().replace(/\s+/g, '-');
}
export function availableBrowseCategories(services: readonly DisplayService[], passages = services.flatMap((service) => service.passages)): BrowseLink[] {
  return BROWSE_CATEGORIES.filter(({ path }) => {
    switch (path) {
      case 'services': case 'years': return services.length > 0 || passages.length > 0;
      case 'sermons': return services.some((service) => service.type === 'sermon' || service.sections.some((section) => section.type === 'sermon')) || passages.some((passage) => passage.type === 'sermon');
      case 'speakers': return services.some((service) => service.sections.some((section) => section.speaker)) || passages.some((passage) => passage.speaker);
      case 'scripture': return passages.some((passage) => passage.scripture.length > 0);
      case 'topics': return passages.some((passage) => passage.topics.length > 0);
    }
  });
}

/** Input must come from publishedServices + flattenArchive for the current build mode.
 * No filesystem imports: navigation can share these helpers with React islands. */
export function buildBrowsePages(services: readonly DisplayService[]): BrowsePage[] {
  const ordered = [...services].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const passages = ordered.flatMap((service) => service.passages);
  const pages: BrowsePage[] = [];
  const category = (path: string) => BROWSE_CATEGORIES.find((item) => item.path === path)!;
  if (!ordered.length) return pages;
  pages.push({ ...category('services'), serviceIds: ordered.map((service) => service.id) });
  const sermonSections = ordered.flatMap((service) => service.sections.filter((section) => section.type === 'sermon'));
  const sermonServices = ordered.filter((service) => service.type === 'sermon' && !service.sections.some((section) => section.type === 'sermon'));
  const sermonPassages = ordered.filter((service) => service.type !== 'sermon' && !service.sections.some((section) => section.type === 'sermon'))
    .flatMap((service) => service.passages.filter((passage) => passage.type === 'sermon'));
  if (sermonSections.length || sermonServices.length || sermonPassages.length) pages.push({ ...category('sermons'), sectionIds: sermonSections.map((section) => section.id), serviceIds: sermonServices.map((service) => service.id), passageIds: sermonPassages.map((passage) => passage.id) });

  function addGroups(path: string, groups: Map<string, { title: string; serviceIds?: string[]; sectionIds?: string[]; passageIds?: string[] }>) {
    if (!groups.size) return;
    const parent = category(path);
    const leaves = [...groups].sort(([a, av], [b, bv]) => path === 'years' ? b.localeCompare(a) : av.title.localeCompare(bv.title) || a.localeCompare(b)).map(([id, group]) => ({ path: `${path}/${id}`, ...group, parent }));
    pages.push({ ...parent, links: leaves.map(({ path, title }) => ({ path, title })) }, ...leaves);
  }
  const speakers = new Map<string, { title: string; sectionIds: string[]; passageIds: string[] }>();
  const topics = new Map<string, { title: string; passageIds: string[] }>();
  for (const service of ordered) {
    for (const speaker of service.speakers) {
      const sections = service.sections.filter((section) => section.speakerId === speaker.id);
      const matches = service.passages.filter((passage) => speaker.passageIds.includes(passage.id));
      if (!sections.length && !matches.length) continue;
      const group = speakers.get(speaker.id) ?? { title: speaker.name, sectionIds: [], passageIds: [] };
      group.sectionIds.push(...sections.map((section) => section.id));
      group.passageIds.push(...matches.map((passage) => passage.id));
      speakers.set(speaker.id, group);
    }
    for (const topic of service.topics) {
      const matches = service.passages.filter((passage) => topic.passageIds.includes(passage.id));
      if (!matches.length) continue;
      const group = topics.get(topic.id) ?? { title: topic.name, passageIds: [] };
      group.passageIds.push(...matches.map((passage) => passage.id));
      topics.set(topic.id, group);
    }
  }
  addGroups('speakers', speakers);
  const books = new Map<string, { title: string; passageIds: string[] }>();
  for (const passage of passages) for (const book of new Set(passage.scripture.map(scriptureBook))) {
    const id = scriptureBookId(book);
    const group = books.get(id) ?? { title: book, passageIds: [] };
    group.passageIds.push(passage.id);
    books.set(id, group);
  }
  addGroups('scripture', books);
  addGroups('topics', topics);
  const years = new Map<string, { title: string; serviceIds: string[] }>();
  for (const service of ordered) {
    const year = service.date.slice(0, 4);
    const group = years.get(year) ?? { title: year, serviceIds: [] };
    group.serviceIds.push(service.id);
    years.set(year, group);
  }
  addGroups('years', years);
  return pages;
}

/** Adjacent indexed segments on this upload, never concatenated across gaps or videos. */
export function surroundingPassages(passages: readonly SearchPassage[], selected: SearchPassage): { previous?: SearchPassage; next?: SearchPassage } {
  const sameVideo = passages.filter((passage) => passage.serviceId === selected.serviceId && passage.videoId === selected.videoId)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const index = sameVideo.findIndex((passage) => passage.id === selected.id);
  return index < 0 ? {} : { previous: sameVideo[index - 1], next: sameVideo[index + 1] };
}
