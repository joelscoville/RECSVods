import { useMemo, useState } from 'react';
import type { HomeItem } from './archive-display';
import { browseUrl, type BrowsePage as BrowsePageData } from '../lib/browse';
import { siteUrl } from '../lib/urls';
import BrowseNavigation from './BrowseNavigation';
import VideoCard from './VideoCard';

const SORTS = {
  newest: { label: 'Newest first', compare: (a: HomeItem, b: HomeItem) => b.date.localeCompare(a.date) || a.start - b.start },
  oldest: { label: 'Oldest first', compare: (a: HomeItem, b: HomeItem) => a.date.localeCompare(b.date) || a.start - b.start },
  title: { label: 'Title A–Z', compare: (a: HomeItem, b: HomeItem) => a.title.localeCompare(b.title) || b.date.localeCompare(a.date) },
} as const;
type Sort = keyof typeof SORTS;

/** A category page uses the home page's card grid; list-of-categories pages use its tiles. */
export default function BrowsePage({ page, items, base }: { page: BrowsePageData; items: HomeItem[]; base: string }) {
  const [sort, setSort] = useState<Sort>('newest');
  const sorted = useMemo(() => [...items].sort(SORTS[sort].compare), [items, sort]);
  return <main id="main" className="browse-main" tabIndex={-1}>
    <div className="page-width browse-heading">
      <nav className="breadcrumbs" aria-label="Breadcrumb"><a href={siteUrl(base)}>Home</a>{page.parent && <><span aria-hidden="true"> / </span><a href={browseUrl(base, page.parent.path)}>{page.parent.title}</a></>}</nav>
      <div className="browse-title-row">
        <h1>{page.title}</h1>
        {items.length > 1 && <label className="sort-control"><span className="sr-only">Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            {Object.entries(SORTS).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>}
      </div>
    </div>
    {page.links && <BrowseNavigation base={base} categories={page.links} className="category-grid browse-links page-width" label={`Browse ${page.title.toLowerCase()}`} />}
    {sorted.length > 0 && <div className="home-catalogue browse-grid">{sorted.map((item) => <VideoCard key={item.id} item={item} />)}</div>}
  </main>;
}
