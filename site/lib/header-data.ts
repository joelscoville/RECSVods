import type { BuildMode } from './display';
import { loadPublicArchive } from './public-archive';
import { availableBrowseCategories, suggestedTopics, type BrowseLink } from './browse';

export interface HeaderSearchData { categories: BrowseLink[]; topics: string[]; hasSearchContent: boolean }

/** Build-time only: every page's header shares one archive read per build. */
export function headerSearchData(mode: BuildMode): HeaderSearchData {
  const { recordings, units } = loadPublicArchive(mode);
  return { categories: availableBrowseCategories(recordings), topics: suggestedTopics(units), hasSearchContent: units.length > 0 };
}
