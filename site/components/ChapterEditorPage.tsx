/** The editor, after a one-time explanation of GitHub for people who have never used it. */
import { useState } from 'react';
import type { EditorRecording } from '../lib/recording-editor';
import { formatDate, serviceUrl } from '../lib/urls';
import ChapterEditor from './ChapterEditor';
import { GitHubIntro, readGitHubReady } from './GitHubGuide';

export default function ChapterEditorPage({ recording, base, backHref }: { recording: EditorRecording; base: string; backHref?: string }) {
  const [ready, setReady] = useState(readGitHubReady);
  if (!ready) return <GitHubIntro title={recording.recording.recordingTitle} subtitle={`Suggesting changes · ${formatDate(recording.recording.serviceDate)}`} backHref={backHref ?? serviceUrl(base, recording.id)} onReady={() => setReady(true)} />;
  return <ChapterEditor base={recording} siteBase={base} backHref={backHref} />;
}
