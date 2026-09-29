import { quirkLabel, type PublicQuirk } from '../lib/video-quirks';

export function QuirkBadges({ quirks, multipart = false }: { quirks?: PublicQuirk[]; multipart?: boolean }) {
  if (!quirks?.length) return null;
  return <span className="quirk-badges">{quirks.map(quirk => <span className="quirk-badge" key={quirk.kind}>{multipart && quirk.kind === 'embed_blocked' ? 'Some parts open on YouTube' : quirkLabel(quirk)}</span>)}</span>;
}

export default function VideoQuirks({ quirks }: { quirks?: PublicQuirk[] }) {
  if (!quirks?.length) return null;
  return <aside className="video-quirks" aria-label="Recording notes">
    <h2>Recording notes</h2>
    <ul>{quirks.map(quirk => <li key={quirk.kind}>
      <strong>{quirkLabel(quirk)}</strong>
    </li>)}</ul>
  </aside>;
}
