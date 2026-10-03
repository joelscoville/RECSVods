import type { EditorState } from './recording-editor';

export interface EditorHistory { past: EditorState[]; present: EditorState; future: EditorState[]; key?: string }
export type HistoryAction = { type: 'apply'; next: EditorState; key?: string } | { type: 'undo' } | { type: 'redo' } | { type: 'break' }
  | { type: 'reset'; state: EditorState } | { type: 'load'; original: EditorState; draft?: EditorState };
const LIMIT = 200;
export function editorHistory(history: EditorHistory, action: HistoryAction): EditorHistory {
  switch (action.type) {
    case 'load': return { past: action.draft ? [action.original] : [], present: action.draft ?? action.original, future: [] };
    case 'break': return history.key === undefined ? history : { ...history, key: undefined };
    case 'apply':
      if (action.next === history.present) return history;
      if (action.key && action.key === history.key) return { ...history, present: action.next };
      return { past: [...history.past, history.present].slice(-LIMIT), present: action.next, future: [], key: action.key };
    case 'undo': return history.past.length ? { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future] } : history;
    case 'redo': return history.future.length ? { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) } : history;
    case 'reset': return { past: [...history.past, history.present].slice(-LIMIT), present: action.state, future: [] };
  }
}
