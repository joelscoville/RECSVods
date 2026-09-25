export default function ScriptureLinks({ references }: { references: string[] }) {
  return <>{references.map((reference, index) => <span key={reference}>
    {index > 0 && ' · '}
    <a href={`https://www.esv.org/${encodeURIComponent(reference)}/`} aria-label={`Read ${reference} in the ESV`}>{reference} (ESV)</a>
  </span>)}</>;
}
