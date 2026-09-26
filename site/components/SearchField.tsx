import Icon from './Icon';
import { siteUrl } from '../lib/urls';

export default function SearchField({ base, value, onChange, onSubmit, id = 'site-search', compact = false }: {
  base: string; value?: string; onChange?: (value: string) => void; onSubmit?: () => void; id?: string; compact?: boolean;
}) {
  return <form className="search-field" role="search" action={siteUrl(base, 'search/')} onSubmit={onSubmit ? (event) => { event.preventDefault(); onSubmit(); } : undefined}>
    <label className="sr-only" htmlFor={id}>Search chapters, dates or Bible references</label>
    <input id={id} name="q" type="search" maxLength={300} placeholder={compact ? 'Search sermons or chapters' : 'Search chapters, dates or Bible references'} autoComplete="off" {...(value !== undefined ? { value } : {})} onChange={onChange ? (event) => onChange(event.target.value) : undefined} />
    <button type="submit" aria-label="Search"><Icon name="search" /></button>
  </form>;
}
