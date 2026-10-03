export type IconName = 'search' | 'back' | 'play' | 'pause' | 'video' | 'check' | 'copy' | 'chevron' | 'undo' | 'redo' | 'help' | 'close' | 'listen' | 'split' | 'join' | 'indent' | 'outdent' | 'plus' | 'minus' | 'trash' | 'magnet' | 'setStart' | 'setEnd' | 'external' | 'pencil' | 'send' | 'person' | 'panels' | 'goto';
export default function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'search' && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 6 6" /></>}
    {name === 'back' && <><path d="m9 5-6 6 6 6" /><path d="M3 11h10a7 7 0 0 1 7 7" /></>}
    {name === 'play' && <path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none" />}
    {name === 'video' && <><rect x="2" y="5" width="14" height="14" rx="1.5" /><path d="m17 10 6-5v14l-6-5Z" fill="currentColor" stroke="none" /></>}
    {name === 'check' && <path d="m4 12 5 5L20 6" />}
    {name === 'copy' && <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M15 8V3H3v13h5" /></>}
    {name === 'chevron' && <path d="m9 5 7 7-7 7" />}
    {name === 'pause' && <><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /></>}
    {name === 'undo' && <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>}
    {name === 'redo' && <><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>}
    {name === 'help' && <><circle cx="12" cy="12" r="9.5" /><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.5-2.7 4.1" /><path d="M12 17.6h.01" strokeWidth="2.6" /></>}
    {name === 'close' && <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>}
    {name === 'split' && <><path d="M12 3v18" /><path d="m8 8-4 4 4 4" /><path d="m16 8 4 4-4 4" /></>}
    {name === 'join' && <><path d="M4 12h6" /><path d="M14 12h6" /><path d="m7 8 4 4-4 4" /><path d="m17 8-4 4 4 4" /></>}
    {name === 'indent' && <><path d="M4 5h16" /><path d="M11 12h9" /><path d="M11 19h9" /><path d="m4 9 4 3-4 3" /></>}
    {name === 'outdent' && <><path d="M4 5h16" /><path d="M11 12h9" /><path d="M11 19h9" /><path d="m8 9-4 3 4 3" /></>}
    {name === 'plus' && <><path d="M12 5v14" /><path d="M5 12h14" /></>}
    {name === 'minus' && <path d="M5 12h14" />}
    {name === 'trash' && <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>}
    {name === 'magnet' && <><path d="M6 4v8a6 6 0 0 0 12 0V4" /><path d="M6 4h4v8a2 2 0 0 0 4 0V4h4" /><path d="M6 8h4" /><path d="M14 8h4" /></>}
    {name === 'setStart' && <><path d="M6 4v16" /><path d="M10 12h10" /><path d="m14 8-4 4 4 4" /></>}
    {name === 'setEnd' && <><path d="M18 4v16" /><path d="M4 12h10" /><path d="m10 8 4 4-4 4" /></>}
    {name === 'external' && <><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>}
    {name === 'pencil' && <><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="m13 7 4 4" /></>}
    {name === 'send' && <><path d="M21 3 3 10.5l7 2.5 2.5 7Z" /><path d="m21 3-11 10" /></>}
    {name === 'person' && <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>}
    {name === 'panels' && <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" /><path d="M3 14h11" /></>}
    {name === 'goto' && <><path d="M3 12h13" /><path d="m12 7 5 5-5 5" /><path d="M21 4v16" /></>}
    {name === 'listen' && <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" /><path d="M15.5 9a4.2 4.2 0 0 1 0 6" /><path d="M18.3 6.5a8 8 0 0 1 0 11" /></>}
  </svg>;
}
