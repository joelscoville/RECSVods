/** Developer view: opens a recording that is not on the website yet (an AI draft) in the editor, loaded
 * live from GitHub. Sending from here publishes it once the pull request is merged. */
import { useEffect, useState } from 'react';
import type { EditorRecording } from '../lib/recording-editor';
import { loadArchiveOnce, repositoryUrl } from '../lib/github-archive';
import ChapterEditorPage from './ChapterEditorPage';

export default function DevEdit({ base }: { base: string }) {
  const [recording, setRecording] = useState<EditorRecording>();
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    const repository = repositoryUrl();
    if (!id) { setProblem('No recording chosen. Open one from the developer page.'); return; }
    if (!repository) { setProblem('This build has no GitHub repository set.'); return; }
    loadArchiveOnce(repository).then(archive => {
      const found = archive.recordings.find(item => item.recording?.recordingId === id);
      if (!found?.recording) { setProblem(found ? `${found.path} has problems: ${found.problems.join('; ')}` : `No recording called “${id}” on GitHub.`); return; }
      const { recordingId, ...rest } = found.recording;
      setRecording({ id: recordingId, recording: rest, topics: archive.topics });
    }).catch(error => setProblem(error instanceof Error ? error.message : String(error)));
  }, []);
  if (problem) return <div className="page-width"><h1>Could not open the recording</h1><p role="alert">{problem}</p><p><a href={`${base}dev/`}>Developer page</a></p></div>;
  if (!recording) return <div className="page-width"><p role="status">Loading from GitHub…</p></div>;
  return <ChapterEditorPage recording={recording} base={base} backHref={`${base}dev/#unapproved`} />;
}
