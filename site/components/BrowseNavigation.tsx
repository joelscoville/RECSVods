import { browseUrl, type BrowseLink } from '../lib/browse';

export default function BrowseNavigation({ base, categories, className = 'category-grid', label = 'Browse the archive by category', includeIndex = false }: { base: string; categories: readonly BrowseLink[]; className?: string; label?: string; includeIndex?: boolean }) {
  return <nav className={`browse-navigation ${className}`} aria-label={label}>
    {includeIndex && <a href={browseUrl(base)}>Browse all</a>}
    {categories.map(({ path, title }) => <a className={className.includes('home-filters') || className.includes('chip-list') ? 'chip' : undefined} key={path} href={browseUrl(base, path)}>{title}</a>)}
  </nav>;
}
