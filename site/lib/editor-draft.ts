import { DraftStateSchema, type EditorRecording, type EditorState } from './recording-editor';

const draftKey = (id: string) => `recs-recording-editor:v3:${id}`;
function fingerprint(base: EditorRecording): string {
  const text = JSON.stringify(base.recording);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}
export function readEditorDraft(base: EditorRecording): EditorState | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey(base.id)) ?? 'null');
    const parsed = DraftStateSchema.safeParse(saved?.state);
    return saved?.fingerprint === fingerprint(base) && parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}
export function writeEditorDraft(base: EditorRecording, state: EditorState | undefined): void {
  try {
    if (state) localStorage.setItem(draftKey(base.id), JSON.stringify({ fingerprint: fingerprint(base), state }));
    else localStorage.removeItem(draftKey(base.id));
  } catch { /* Local drafts are optional; the source file is authoritative. */ }
}
