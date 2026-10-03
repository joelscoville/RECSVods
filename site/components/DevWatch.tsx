/** Developer view: plays a recording that is waiting for approval, loaded live from GitHub, in the normal
 * watch page. Its links stay under /dev/, where these recordings exist. */
import { useEffect, useState } from 'react';
import type { DisplayRecording } from './archive-display';
import { loadArchiveOnce, repositoryUrl, unapprovedDisplay } from '../lib/github-archive';
import Watch from './Watch';

export default function DevWatch({ base }: { base: string }) {
  const [recordings, setRecordings] = useState<DisplayRecording[]>();
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    const repository = repositoryUrl();
    if (!repository) { setProblem('This build has no GitHub repository set.'); return; }
    loadArchiveOnce(repository).then(loaded => setRecordings(unapprovedDisplay(loaded)))
      .catch(error => setProblem(error instanceof Error ? error.message : String(error)));
  }, []);
  if (problem) return <main id="main" className="page-width" tabIndex={-1}><h1>Could not load from GitHub</h1><p role="alert">{problem}</p></main>;
  if (!recordings) return <main id="main" className="page-width" tabIndex={-1}><p role="status">Loading from GitHub…</p></main>;
  return <>
    <p className="dev-watch-note page-width">Developer view · waiting for approval · not published</p>
    <Watch recordings={recordings} base={`${base}dev/`} servicePages={false} homeHref={`${base}#unapproved`} />
  </>;
}
