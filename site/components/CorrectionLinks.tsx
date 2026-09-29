import { correctionLinks, type CorrectionConfig, type CorrectionTarget } from '../lib/corrections';

/** Native navigation needs no live status or hydration. Suppress the page's search/referrer state. */
export default function CorrectionLinks({ target, base, config }: { target: CorrectionTarget; base: string; config?: CorrectionConfig }) {
  const { issueUrl } = correctionLinks(target, base, config);
  if (!issueUrl) return <span className="correction-note">Correction links are unavailable in this build.</span>;
  return <>
    <a className="button button-secondary" href={issueUrl} rel="noreferrer" referrerPolicy="no-referrer">Suggest a correction</a>
  </>;
}
