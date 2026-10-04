import type { EditorState } from './recording-editor';

export interface EditorHistory {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
  key?: string;
}

export type HistoryAction =
  | { type: 'apply'; next: EditorState; key?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'break' }
  | { type: 'reset'; state: EditorState }
  | { type: 'load'; original: EditorState; draft?: EditorState };

const HISTORY_LIMIT = 200;

/** A field's editing session shares one undo step until an explicit break. */
export function editorHistory(
  history: EditorHistory,
  action: HistoryAction,
): EditorHistory {
  switch (action.type) {
    case 'load':
      return {
        past: action.draft ? [action.original] : [],
        present: action.draft ?? action.original,
        future: [],
      };

    case 'break':
      if (history.key === undefined) {
        return history;
      }
      return { ...history, key: undefined };

    case 'apply':
      if (action.next === history.present) {
        return history;
      }
      if (action.key && action.key === history.key) {
        return { ...history, present: action.next };
      }
      return {
        past: [...history.past, history.present].slice(-HISTORY_LIMIT),
        present: action.next,
        future: [],
        key: action.key,
      };

    case 'undo':
      if (!history.past.length) {
        return history;
      }
      return {
        past: history.past.slice(0, -1),
        present: history.past.at(-1)!,
        future: [history.present, ...history.future],
      };

    case 'redo':
      if (!history.future.length) {
        return history;
      }
      return {
        past: [...history.past, history.present],
        present: history.future[0],
        future: history.future.slice(1),
      };

    case 'reset':
      return {
        past: [...history.past, history.present].slice(-HISTORY_LIMIT),
        present: action.state,
        future: [],
      };
  }
}
