import { scriptureUrl } from '../lib/scripture';

export default function ScriptureLinks({ references, displayReferences }: { references: string[]; displayReferences?: string[] }) {
  return <>{references.map((reference, index) => <span key={reference}>
    {index > 0 && ' · '}
    <a href={scriptureUrl(reference)} aria-label={`Read ${reference} in the ESV`}>{displayReferences?.[index] || reference} (ESV)</a>
  </span>)}</>;
}
