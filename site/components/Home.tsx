import { useEffect, useState } from 'react';
import type { HomeItem } from './archive-display';
import { homeItems, homeSelection } from './archive-display';
import { getSavedPlayback, type SavedPlayback } from '../lib/local-state';
import { searchUrl, siteUrl } from '../lib/urls';
import { BROWSE_CATEGORIES, browseUrl } from '../lib/browse';
import BrowseNavigation from './BrowseNavigation';
import VideoCard from './VideoCard';
import Icon from './Icon';

type Unapproved = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: HomeItem[] };
/** Developer switch (set on /dev): recordings waiting for approval, loaded live from GitHub into an
 * "Unapproved" category. The loader is only downloaded while the switch is on. */
function useUnapproved(items: HomeItem[], base: string): Unapproved | undefined {
  const [state, setState] = useState<Unapproved>();
  useEffect(() => {
    let on = false;
    try { on = localStorage.getItem('recs-dev:unapproved') === '1'; } catch { /* storage blocked */ }
    if (!on) return;
    setState({ status: 'loading' });
    import('../lib/github-archive').then(async archive => {
      const repository = archive.repositoryUrl();
      if (!repository) throw new Error('This build has no GitHub repository set.');
      const display = archive.unapprovedDisplay(await archive.loadArchiveOnce(repository)).filter(recording => !items.some(item => item.recordingId === recording.id));
      // Fetched ones open in the dev-only player, which loads them the same way. A preview build already
      // has some of its own; they keep their normal pages.
      const all = [...items.filter(item => item.preview), ...homeItems(display, `${base}dev/`)].sort((x, y) => y.date.localeCompare(x.date));
      setState({ status: 'ready', items: all });
    }).catch(error => setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }));
  }, [items, base]);
  return state;
}

export default function Home({ items, base }: { items: HomeItem[]; base: string }) {
  const [saved, setSaved] = useState<SavedPlayback | null>(null);
  const unapproved = useUnapproved(items, base);
  const [hash, setHash] = useState('');
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read(); window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const showingUnapproved = Boolean(unapproved) && hash === '#unapproved';
  useEffect(() => {
    const refresh = () => setSaved(getSavedPlayback());
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('recs-local-state-cleared', refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('recs-local-state-cleared', refresh); };
  }, []);
  const categories = BROWSE_CATEGORIES.filter(({ path }) => items.some((item) => item.browseCategories?.includes(path)));
  const { returning, featured, supporting } = homeSelection(items, saved, base);
  // Three rows on desktop: the featured row and the next row are the most recent recordings; the third row
  // is chosen at random from the rest. Server HTML uses the next few so hydration matches, then shuffles.
  const recent = supporting.slice(0, 7), pool = supporting.slice(7);
  const poolKey = pool.map((item) => item.id).join();
  const [random, setRandom] = useState(pool.slice(0, 5));
  useEffect(() => {
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    setRandom(shuffled.slice(0, 5));
    // Reshuffle only when the candidate set changes, not on every render.
  }, [poolKey]);
  return <main id="main" className="home-main" tabIndex={-1}>
    <nav className="home-filters browse-navigation" aria-label="Browse the archive by category">
      <a className="chip" href={siteUrl(base)} aria-current="page"><Icon name="check" />All</a>
      {categories.filter(({ path }) => path !== 'all').map(({ path, title }) => <a className="chip" key={path} href={browseUrl(base, path)}>{title}</a>)}
    </nav>
    {unapproved && <nav className="dev-categories page-width" aria-label="Developer categories">
      <a className="chip chip-dev" href={showingUnapproved ? '#' : '#unapproved'} aria-current={showingUnapproved ? 'page' : undefined}>{showingUnapproved && <Icon name="check" />}Unapproved
        {unapproved.status === 'ready' ? ` (${unapproved.items.length})` : ''}</a>
    </nav>}
    {showingUnapproved ? <section className="unapproved-view" aria-labelledby="unapproved-title">
      <div className="page-width"><h1 id="unapproved-title">Waiting for approval</h1>
        <p>Developer view, loaded live from GitHub. Not published; turn it off on the <a href={`${base}dev/`}>developer page</a>.</p>
        {unapproved!.status === 'loading' && <p role="status">Loading from GitHub…</p>}
        {unapproved!.status === 'error' && <p role="alert">{unapproved!.message}</p>}
        {unapproved!.status === 'ready' && !unapproved!.items.length && <p>Nothing is waiting for approval.</p>}
      </div>
      {unapproved!.status === 'ready' && unapproved!.items.length > 0 && <div className="home-catalogue browse-grid">{unapproved!.items.map(item => <VideoCard key={item.id} item={item} />)}</div>}
    </section> : !featured ? <section className="empty-archive page-width">
      <h1>The archive is being prepared</h1>
      <p>There are no published recordings to watch yet. Services will appear here when they are ready.</p>
      <a className="button" href={searchUrl(base)}>Explore search</a>
    </section> : <>
      <div className="home-catalogue">
        <section className={`featured ${returning ? 'featured-returning' : ''}`} aria-labelledby="featured-title">
          <h1 id="featured-title">{returning ? <><span className="editorial-label">Pick up where you left off</span><span className="compact-label">Continue watching</span></> : <>Watch the latest {featured.hasSermon ? 'sermon' : 'service'}</>}</h1>
          <VideoCard item={featured} progress={returning ? saved!.time : undefined} />
        </section>
        {/* Keyed by slot, not recording, so a swapped or shuffled card updates in place instead of moving. */}
        {recent.map((item, index) => <div key={`recent-${index}`} data-slot={`recent-${index}`} className={`supporting-video ${index === 0 ? 'supporting-lead' : ''}`}><VideoCard item={item} /></div>)}
        {random.map((item, index) => <div key={`random-${index}`} data-slot={`random-${index}`} className="supporting-video home-random"><VideoCard item={item} /></div>)}
      </div>
      {categories.length > 0 && <BrowseNavigation base={base} categories={categories} className="category-grid home-categories page-width" />}
    </>}
  </main>;
}
