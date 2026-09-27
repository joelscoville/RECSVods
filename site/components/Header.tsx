import type { ReactNode } from 'react';
import Icon from './Icon';
import HeaderSearch from './HeaderSearch';
import type { BrowseLink } from '../lib/browse';
import { siteUrl } from '../lib/urls';

export default function Header({ base, children, categories, topics }: { base: string; children?: ReactNode; categories?: readonly BrowseLink[]; topics?: readonly string[] }) {
  return <header className="site-header">
    <a className="wordmark" href={siteUrl(base)} aria-label="RECS Replay home">RECS <span>REPLAY</span></a>
    <div className="desktop-search">{children ?? <HeaderSearch base={base} categories={categories} topics={topics} />}</div>
    <a className="mobile-search-link icon-button" href={siteUrl(base, 'search/')} aria-label="Search the archive"><Icon name="search" /></a>
  </header>;
}
