import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  initialState,
  type EditorRecording,
  type EditorState,
} from '../lib/recording-editor';
import { editorHistory } from '../lib/editor-history';
import { readEditorDraft, writeEditorDraft } from '../lib/editor-draft';

/** Owns restore/save/reset and undo grouping, independently of player and view state. */
export function useEditorSession(base: EditorRecording) {
  const original = useMemo(() => initialState(base), [base]);
  const [history, dispatch] = useReducer(editorHistory, {
    past: [],
    present: original,
    future: [],
  });
  const [loaded, setLoaded] = useState<EditorRecording>();
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const draft = readEditorDraft(base);
    dispatch({ type: 'load', original, draft });
    setRestored(Boolean(draft));
    setLoaded(base);
  }, [base, original]);

  useEffect(() => {
    if (loaded !== base) {
      return;
    }

    // Undo back to the original must remove the saved draft, not restore it on reload.
    const draft = history.present === original ? undefined : history.present;
    writeEditorDraft(base, draft);
  }, [base, loaded, original, history.present]);

  const apply = useCallback((next: EditorState, key?: string) => {
    dispatch({ type: 'apply', next, key });
  }, []);

  const resetDraft = useCallback(() => {
    dispatch({ type: 'reset', state: original });
    setRestored(false);
    writeEditorDraft(base, undefined);
  }, [base, original]);

  return {
    original,
    history,
    state: history.present,
    dispatch,
    apply,
    restored,
    resetDraft,
    hydrated: loaded === base,
  };
}
