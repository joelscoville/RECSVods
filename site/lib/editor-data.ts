/** Build-only: each recording the build publishes, as its editor page receives it. */
import { publishable, type BuildMode } from './display';
import { loadRecordings } from './recordings';
import type { EditorRecording } from './recording-editor';

export function editorRecordings(mode: BuildMode, root = process.cwd()): EditorRecording[] {
  const { recordings, topics } = loadRecordings(root);
  return publishable(recordings, mode).map(({ recordingId, ...recording }) => ({ id: recordingId, recording, topics }));
}
