import { useState } from 'react';
import { scriptureUrl } from '../lib/scripture';

export default function ScriptureLinks({ references, displayReferences }: { references: string[]; displayReferences?: string[] }) {
  return <>{references.map((reference, index) => <span key={reference}>
    {index > 0 && ' · '}
    <a href={scriptureUrl(reference)} aria-label={`Read ${reference} in the ESV`}>{displayReferences?.[index] || reference} (ESV)</a>
  </span>)}</>;
}

/** Labelled, compact reference line; long service lists collapse behind a toggle. */
export function ScriptureLine({ references, displayReferences, limit = 4 }: { references: string[]; displayReferences?: string[]; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = references.length - limit;
  const shown = expanded || hidden <= 1 ? references : references.slice(0, limit);
  return <p className="scripture-line"><span className="meta-label">Scripture</span> <ScriptureLinks references={shown} displayReferences={displayReferences?.slice(0, shown.length)} />
    {hidden > 1 && <> <button type="button" className="inline-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show Fewer' : `+${hidden} More`}</button></>}</p>;
}
