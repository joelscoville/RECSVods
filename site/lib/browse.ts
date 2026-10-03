import type { DisplayRecording } from './display';
import { siteUrl } from './urls';
import { BIBLE_BOOKS } from './scripture';

/** Every recording lives under "All recordings"; the other categories narrow it. */
export const BROWSE_CATEGORIES = [
  { path: 'all', title: 'All recordings' }, { path: 'scripture', title: 'Bible books' },
  { path: 'topics', title: 'Topics' }, { path: 'series', title: 'Series' }, { path: 'years', title: 'Years' },
] as const;
export interface BrowseLink { path: string; title: string }
/** A category page lists recordings, newest first, except a series, which keeps its playlist order. */
export interface BrowsePage extends BrowseLink { parent?: BrowseLink; links?: BrowseLink[]; recordingIds?: string[] }
export function browseUrl(base: string, path = ''): string {
  return siteUrl(base, `browse/${path ? `${path.split('/').map(encodeURIComponent).join('/')}/` : ''}`);
}
export function scriptureBook(reference: string): string { return reference.replace(/\s+\d.*$/, ''); }
export function scriptureBookId(book: string): string { return book.toLowerCase().replace(/\s+/g, '-'); }
export function availableBrowseCategories(recordings: readonly { scripture: readonly unknown[]; topics: readonly unknown[]; series?: unknown }[]): BrowseLink[] {
  return BROWSE_CATEGORIES.filter(({ path }) => {
    switch (path) {
      case 'all': case 'years': return recordings.length > 0;
      case 'scripture': return recordings.some((recording) => recording.scripture.length > 0);
      case 'topics': return recordings.some((recording) => recording.topics.length > 0);
      case 'series': return recordings.some((recording) => recording.series);
    }
  });
}

export function buildBrowsePages(recordings: readonly DisplayRecording[]): BrowsePage[] {
  const ordered = [...recordings].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const pages: BrowsePage[] = [];
  const category = (path: string) => BROWSE_CATEGORIES.find((item) => item.path === path)!;
  if (!ordered.length) return pages;
  pages.push({ ...category('all'), recordingIds: ordered.map((recording) => recording.id) });
  function addGroups(path: string, groups: Map<string, { title: string; recordingIds: string[] }>) {
    if (!groups.size) return;
    const parent = category(path);
    // Years newest first, Bible books in canonical order, everything else alphabetically.
    const canon = (title: string) => { const index = (BIBLE_BOOKS as readonly string[]).indexOf(title); return index < 0 ? BIBLE_BOOKS.length : index; };
    const leaves = [...groups].sort(([a, av], [b, bv]) => path === 'years' ? b.localeCompare(a)
      : path === 'scripture' ? canon(av.title) - canon(bv.title) || av.title.localeCompare(bv.title)
        : av.title.localeCompare(bv.title) || a.localeCompare(b)).map(([id, group]) => ({ path: `${path}/${id}`, ...group, parent }));
    pages.push({ ...parent, links: leaves.map(({ path, title }) => ({ path, title })) }, ...leaves);
  }
  const group = (groups: Map<string, { title: string; recordingIds: string[] }>, id: string, title: string, recordingId: string) => {
    const entry = groups.get(id) ?? { title, recordingIds: [] };
    if (!entry.recordingIds.includes(recordingId)) entry.recordingIds.push(recordingId);
    groups.set(id, entry);
  };
  const books = new Map<string, { title: string; recordingIds: string[] }>(), topics = new Map<string, { title: string; recordingIds: string[] }>();
  const years = new Map<string, { title: string; recordingIds: string[] }>(), series = new Map<string, { title: string; recordingIds: string[] }>();
  for (const recording of ordered) {
    for (const book of new Set(recording.scripture.map(scriptureBook))) group(books, scriptureBookId(book), book, recording.id);
    for (const topic of recording.topics) group(topics, topic.id, topic.name, recording.id);
    group(years, recording.date.slice(0, 4), recording.date.slice(0, 4), recording.id);
  }
  // A series is a playlist: its own order, not newest first.
  for (const recording of [...recordings].filter((item) => item.series).sort((a, b) => a.series!.position - b.series!.position)) {
    group(series, recording.series!.id, recording.series!.title, recording.id);
  }
  addGroups('scripture', books); addGroups('topics', topics); addGroups('series', series); addGroups('years', years);
  return pages;
}

/** Most frequent topics first, so suggestions reflect the archive rather than file order. */
export function suggestedTopics(items: readonly { topics: readonly string[] }[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const item of items) for (const topic of item.topics) counts.set(topic, (counts.get(topic) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([topic]) => topic);
}
