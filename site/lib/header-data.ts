import { loadArchive, publishedServices, flattenChapters, type BuildMode } from './archive';
import { displayServices } from '../components/archive-display';
import { availableBrowseCategories, suggestedTopics, type BrowseLink } from './browse';

export interface HeaderSearchData { categories: BrowseLink[]; topics: string[] }
let cached: HeaderSearchData | undefined;

/** Build-time only: every page's header shares one archive read per build. */
export function headerSearchData(mode: BuildMode): HeaderSearchData {
  if (cached) return cached;
  const eligible = publishedServices(loadArchive(), mode);
  const chapters = flattenChapters(eligible, mode);
  cached = { categories: availableBrowseCategories(displayServices(eligible, chapters), chapters), topics: suggestedTopics(chapters) };
  return cached;
}
