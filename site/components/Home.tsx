import { useEffect, useState } from 'react';
import type { HomeItem } from './archive-display';
import { homeSelection } from './archive-display';
import { getSavedPlayback, type SavedPlayback } from '../lib/local-state';
import { searchUrl, siteUrl } from '../lib/urls';
import { BROWSE_CATEGORIES, browseUrl } from '../lib/browse';
import BrowseNavigation from './BrowseNavigation';
import VideoCard from './VideoCard';
import Icon from './Icon';

export default function Home({ items, base }: { items: HomeItem[]; base: string }) {
  const [saved, setSaved] = useState<SavedPlayback | null>(null);
  useEffect(() => {
    const refresh = () => setSaved(getSavedPlayback());
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('recs-local-state-cleared', refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('recs-local-state-cleared', refresh); };
  }, []);
  const categories = BROWSE_CATEGORIES.filter(({ path }) => items.some((item) => item.browseCategories?.includes(path)));
  const { returning, featured, supporting } = homeSelection(items, saved, base);
  return <main id="main" className="home-main" tabIndex={-1}>
    <nav className="home-filters browse-navigation" aria-label="Browse the archive by category">
      <a className="chip" href={siteUrl(base)} aria-current="page"><Icon name="check" />All</a>
      {categories.map(({ path, title }) => <a className="chip" key={path} href={browseUrl(base, path)}>{title}</a>)}
      <a className="chip" href={browseUrl(base)}>Browse all</a>
    </nav>
    {!featured ? <section className="empty-archive page-width">
      <h1>The archive is being prepared</h1>
      <p>There are no published recordings to watch yet. Services will appear here when they are ready.</p>
      <a className="button" href={searchUrl(base)}>Explore search</a>
    </section> : <>
      <div className="home-catalogue">
        <section className={`featured ${returning ? 'featured-returning' : ''}`} aria-labelledby="featured-title">
          <h1 id="featured-title">{returning ? <><span className="editorial-label">Pick up where you left off</span><span className="compact-label">Continue watching</span></> : <>Watch the latest {featured.type === 'sermon' ? 'sermon' : 'service'}</>}</h1>
          <VideoCard item={featured} progress={returning ? saved!.time : undefined} />
        </section>
        {supporting.map((item, index) => <div key={item.id} className={`supporting-video ${index === 0 ? 'supporting-lead' : ''}`}><VideoCard item={item} /></div>)}
      </div>
      {categories.length > 0 && <BrowseNavigation base={base} categories={categories} className="category-grid home-categories page-width" includeIndex />}
    </>}
  </main>;
}
