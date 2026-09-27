import { useEffect, useRef, useState } from 'react';
import type { BrowseLink } from '../lib/browse';
import { getSearchHistory } from '../lib/local-state';
import { searchUrl } from '../lib/urls';
import BrowseNavigation from './BrowseNavigation';
import SearchField from './SearchField';

/** Desktop header search: focusing the field opens the same browse sections as the search page. */
export default function HeaderSearch({ base, categories = [], topics = [] }: { base: string; categories?: readonly BrowseLink[]; topics?: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const returningFocus = useRef(false);

  useEffect(() => {
    if (!open) return;
    setHistory(getSearchHistory());
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      const input = root.current?.querySelector('input');
      if (input && document.activeElement !== input) { returningFocus.current = true; input.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  return <div className="header-search" ref={root}
    onFocus={() => { if (returningFocus.current) returningFocus.current = false; else setOpen(true); }}
    onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <SearchField base={base} />
    {open && <div className="search-panel" role="region" aria-label="Search suggestions">
      <section className="history-section">
        <h2>Your history</h2>
        {history.length ? <div className="chip-list">{history.map((item) => <a className="chip" key={item} href={searchUrl(base, item)}>{item}</a>)}</div> : <p>Your searches will appear here on this device.</p>}
      </section>
      {categories.length > 0 && <section className="category-section"><h2>Search by category</h2><BrowseNavigation base={base} categories={categories} /></section>}
      {topics.length > 0 && <section className="topics-section"><h2>Suggested topics</h2><div className="chip-list">{topics.map((topic) => <a className="chip" key={topic} href={searchUrl(base, topic)}>{topic}</a>)}</div></section>}
    </div>}
  </div>;
}
