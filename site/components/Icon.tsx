export default function Icon({ name, className = '' }: { name: 'search' | 'back' | 'play' | 'video' | 'check' | 'copy'; className?: string }) {
  return <svg className={`icon ${className}`} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'search' && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 6 6" /></>}
    {name === 'back' && <><path d="m9 5-6 6 6 6" /><path d="M3 11h10a7 7 0 0 1 7 7" /></>}
    {name === 'play' && <path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none" />}
    {name === 'video' && <><rect x="2" y="5" width="14" height="14" rx="1.5" /><path d="m17 10 6-5v14l-6-5Z" fill="currentColor" stroke="none" /></>}
    {name === 'check' && <path d="m4 12 5 5L20 6" />}
    {name === 'copy' && <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M15 8V3H3v13h5" /></>}
  </svg>;
}
