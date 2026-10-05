import {
  DraftStateSchema,
  type EditorRecording,
  type EditorState,
} from './recording-editor';

function draftKey(recordingId: string): string {
  return `recs-recording-editor:v3:${recordingId}`;
}

/** A draft belongs to the exact source recording it was edited against. */
function recordingFingerprint(base: EditorRecording): string {
  const text = JSON.stringify(base.recording);
  let hash = 5381;
  for (let index = 0; index < text.length; index++) {
    hash = (hash * 33 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export function readEditorDraft(
  base: EditorRecording,
): EditorState | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey(base.id)) ?? 'null');
    const parsed = DraftStateSchema.safeParse(saved?.state);
    const matchesSource = saved?.fingerprint === recordingFingerprint(base);
    if (!matchesSource || !parsed.success) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

export function writeEditorDraft(
  base: EditorRecording,
  state: EditorState | undefined,
): void {
  try {
    if (!state) {
      localStorage.removeItem(draftKey(base.id));
      return;
    }

    const saved = { fingerprint: recordingFingerprint(base), state };
    localStorage.setItem(draftKey(base.id), JSON.stringify(saved));
  } catch {
    // Local drafts are optional; the source file is authoritative.
  }
}
