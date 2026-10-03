import { browseUrl, type BrowseLink } from '../lib/browse';
import Icon from './Icon';

export interface BrowseNavigationLink extends BrowseLink { href?: string }
export default function BrowseNavigation({ base, categories, className = 'category-grid', label = 'Browse the archive by category', includeIndex = false, currentPath }: { base: string; categories: readonly BrowseNavigationLink[]; className?: string; label?: string; includeIndex?: boolean; currentPath?: string }) {
  return <nav className={`browse-navigation ${className}`} aria-label={label}>
    {includeIndex && <a href={browseUrl(base)}>Browse all</a>}
    {categories.map(({ path, title, href }) => <a className={className.includes('home-filters') || className.includes('chip-list') ? 'chip' : undefined} key={path} href={href ?? browseUrl(base, path)} aria-current={currentPath === path ? 'page' : undefined}>
      {currentPath === path && <Icon name="check" />}{title}
    </a>)}
  </nav>;
}
