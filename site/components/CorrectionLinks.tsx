import { editUrl } from '../lib/urls';

/** One button: "Suggest a change" opens the chapter editor at the moment being watched. Native navigation. */
export default function CorrectionLinks({ recordingId, start, base }: { recordingId: string; start?: number; base: string }) {
  return <a className="button button-secondary" href={editUrl(base, recordingId, start)}>Suggest a change</a>;
}
