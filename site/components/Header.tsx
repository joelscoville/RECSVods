import type { ReactNode } from 'react';
import Icon from './Icon';
import SearchField from './SearchField';
import { siteUrl } from '../lib/urls';

export default function Header({ base, children }: { base: string; children?: ReactNode }) {
  return <header className="site-header">
    <a className="wordmark" href={siteUrl(base)} aria-label="RECS Replay home">RECS <span>REPLAY</span></a>
    <div className="desktop-search">{children ?? <SearchField base={base} />}</div>
    <a className="mobile-search-link icon-button" href={siteUrl(base, 'search/')} aria-label="Search the archive"><Icon name="search" /></a>
  </header>;
}
