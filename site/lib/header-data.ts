import { loadArchive, publishedServices, flattenChapters, type BuildMode } from './archive';
import { displayServices } from '../components/archive-display';
import { availableBrowseCategories, suggestedTopics, type BrowseLink } from './browse';

export interface HeaderSearchData { categories: BrowseLink[]; topics: string[]; hasSearchContent: boolean }
const cached = new Map<BuildMode, HeaderSearchData>();

/** Build-time only: every page's header shares one archive read per build. */
export function headerSearchData(mode: BuildMode): HeaderSearchData {
  const previous = cached.get(mode);
  if (previous) return previous;
  const eligible = publishedServices(loadArchive(), mode);
  const chapters = flattenChapters(eligible, mode);
  const result = { categories: availableBrowseCategories(displayServices(eligible, chapters), chapters), topics: suggestedTopics(chapters), hasSearchContent: chapters.length > 0 };
  cached.set(mode, result);
  return result;
}
