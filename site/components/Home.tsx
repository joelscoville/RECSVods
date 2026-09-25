import { useEffect, useState } from 'react';
import type { HomeItem } from './archive-display';
import { archiveCategories } from './archive-display';
import { getSavedPlayback, type SavedPlayback } from '../lib/local-state';
import { searchUrl, watchUrl } from '../lib/urls';
import VideoCard from './VideoCard';
import Icon from './Icon';

export default function Home({ items, base }: { items: HomeItem[]; base: string }) {
  const [saved, setSaved] = useState<SavedPlayback | null>(null);
  const [category, setCategory] = useState('');
  useEffect(() => {
    const refresh = () => setSaved(getSavedPlayback());
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('recs-local-state-cleared', refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('recs-local-state-cleared', refresh); };
  }, []);
  const categories = archiveCategories(items);
  const available = category ? items.filter((item) => item.type === category) : items;
  const returning = saved && available.find((item) => item.serviceId === saved.serviceId && item.videoId === saved.videoId && saved.time > 0 && saved.time < item.duration - 2);
  const featured = returning ? { ...returning, href: watchUrl(base, { service: returning.serviceId, video: returning.videoId, start: saved!.time }) } : available[0];
  const supporting = featured ? available.filter((item) => item.id !== featured.id) : [];
  return <main id="main" className="home-main" tabIndex={-1}>
    <nav className="home-filters" aria-label="Video categories">
      <button className="chip" type="button" aria-pressed={!category} onClick={() => setCategory('')}>{!category && <Icon name="check" />}All</button>
      {categories.map(({ value, label }) => <button className="chip" type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{category === value && <Icon name="check" />}{label}</button>)}
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
      {categories.length > 0 && <nav className="category-grid home-categories page-width" aria-label="Browse the archive by category">{categories.map(({ value, label }) => <a key={value} href={searchUrl(base, label)}>{label}</a>)}</nav>}
    </>}
  </main>;
}
