import { correctionLinks, type CorrectionConfig, type CorrectionTarget } from '../lib/corrections';

/** Native navigation needs no live status or hydration. Suppress the page's search/referrer state. */
export default function CorrectionLinks({ target, base, config }: { target: CorrectionTarget; base: string; config?: CorrectionConfig }) {
  const { issueUrl, editUrl } = correctionLinks(target, base, config);
  if (!issueUrl) return <span className="transcript-note">Correction links are unavailable in this build.</span>;
  return <>
    <a className="text-link" href={issueUrl} rel="noreferrer" referrerPolicy="no-referrer">Suggest a correction<span className="sr-only"> on GitHub</span></a>
    {editUrl && <a className="text-link" href={editUrl} rel="noreferrer" referrerPolicy="no-referrer">Edit this transcript<span className="sr-only"> on GitHub</span></a>}
  </>;
}
