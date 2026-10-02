/** The chapter editor's keyboard shortcuts: one table drives both the key handler and the help screen,
 * and a unit test rejects any key bound twice. Mouse and touch can do everything without these.
 * Avoided on purpose: Alt+arrows (browser back/forward on Windows), Cmd/Ctrl +/- (browser zoom),
 * J/L as playback keys (YouTube cannot play backwards, so a half-working J would mislead); K adds a key point. */
export type EditorAction =
  | 'play' | 'back' | 'forward' | 'backMore' | 'forwardMore' | 'backFine' | 'forwardFine'
  | 'previousBoundary' | 'nextBoundary' | 'uploadStart' | 'uploadEnd'
  | 'setStart' | 'setEnd' | 'addSubchapter' | 'addPoint' | 'delete' | 'hear' | 'confirm'
  | 'zoomIn' | 'zoomOut' | 'zoomFit' | 'snapping' | 'help' | 'escape' | 'undo' | 'redo' | 'mark';

/** `mod` is Cmd on a Mac and Ctrl elsewhere. Unset modifiers must be up. */
export interface KeySpec { key: string; shift?: boolean; mod?: boolean }
export interface Shortcut { action: EditorAction; keys: KeySpec[]; label: string; help: string; group: 'Play and move' | 'Edit at the playhead' | 'View' | 'General' }

export const SHORTCUTS: readonly Shortcut[] = [
  { action: 'play', group: 'Play and move', label: 'Space', help: 'Play or pause', keys: [{ key: ' ' }] },
  { action: 'back', group: 'Play and move', label: '←', help: 'Back 1 second', keys: [{ key: 'ArrowLeft' }] },
  { action: 'forward', group: 'Play and move', label: '→', help: 'Forward 1 second', keys: [{ key: 'ArrowRight' }] },
  { action: 'backMore', group: 'Play and move', label: 'Shift ←', help: 'Back 5 seconds', keys: [{ key: 'ArrowLeft', shift: true }] },
  { action: 'forwardMore', group: 'Play and move', label: 'Shift →', help: 'Forward 5 seconds', keys: [{ key: 'ArrowRight', shift: true }] },
  { action: 'backFine', group: 'Play and move', label: ',', help: 'Back a tenth of a second', keys: [{ key: ',' }] },
  { action: 'forwardFine', group: 'Play and move', label: '.', help: 'Forward a tenth of a second', keys: [{ key: '.' }] },
  { action: 'previousBoundary', group: 'Play and move', label: '↑', help: 'Jump to the previous boundary', keys: [{ key: 'ArrowUp' }] },
  { action: 'nextBoundary', group: 'Play and move', label: '↓', help: 'Jump to the next boundary', keys: [{ key: 'ArrowDown' }] },
  { action: 'uploadStart', group: 'Play and move', label: 'Home', help: 'Go to the start of the recording', keys: [{ key: 'Home' }] },
  { action: 'uploadEnd', group: 'Play and move', label: 'End', help: 'Go to the end of the recording', keys: [{ key: 'End' }] },
  { action: 'setStart', group: 'Edit at the playhead', label: 'I', help: 'Start the selected chapter or subchapter here, or move the point here', keys: [{ key: 'i' }, { key: '[' }] },
  { action: 'setEnd', group: 'Edit at the playhead', label: 'O', help: 'End the selected chapter or subchapter here', keys: [{ key: 'o' }, { key: ']' }] },
  { action: 'addSubchapter', group: 'Edit at the playhead', label: 'P', help: 'Add a subchapter here', keys: [{ key: 'p' }] },
  { action: 'addPoint', group: 'Edit at the playhead', label: 'K', help: 'Add a timestamped point here', keys: [{ key: 'k' }] },
  { action: 'delete', group: 'Edit at the playhead', label: 'Delete', help: 'Remove the selected chapter, subchapter or point', keys: [{ key: 'Delete' }, { key: 'Backspace' }] },
  { action: 'mark', group: 'Edit at the playhead', label: 'M', help: 'Mark this moment to look at again', keys: [{ key: 'm' }] },
  { action: 'hear', group: 'Edit at the playhead', label: '/', help: 'Hear the selected boundary (3 seconds before to 2 after)', keys: [{ key: '/' }] },
  { action: 'confirm', group: 'Edit at the playhead', label: 'Enter', help: 'Looks right: check this item and go to the next', keys: [{ key: 'Enter' }] },
  { action: 'zoomIn', group: 'View', label: '=', help: 'Zoom in around the playhead', keys: [{ key: '=' }, { key: '+', shift: true }] },
  { action: 'zoomOut', group: 'View', label: '−', help: 'Zoom out', keys: [{ key: '-' }] },
  { action: 'zoomFit', group: 'View', label: '\\', help: 'Show the whole recording', keys: [{ key: '\\' }] },
  { action: 'snapping', group: 'View', label: 'N', help: 'Snapping on or off', keys: [{ key: 'n' }] },
  { action: 'help', group: 'General', label: '?', help: 'Show this help', keys: [{ key: '?', shift: true }] },
  { action: 'escape', group: 'General', label: 'Esc', help: 'Cancel a drag or deselect', keys: [{ key: 'Escape' }] },
  { action: 'undo', group: 'General', label: 'Mod Z', help: 'Undo', keys: [{ key: 'z', mod: true }] },
  { action: 'redo', group: 'General', label: 'Mod Shift Z', help: 'Redo (also Mod Y)', keys: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }] },
];

/** Apple keyboards use Cmd; Windows, Linux, ChromeOS and everything else use Ctrl. */
export const isMac = () => typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iOS/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent);
export const specId = (spec: KeySpec) => `${spec.mod ? 'mod+' : ''}${spec.shift ? 'shift+' : ''}${spec.key.toLowerCase()}`;

/** The action for a key press, or undefined. Alt combinations are never ours. */
export function matchShortcut(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>, mac = isMac()): EditorAction | undefined {
  if (event.altKey) return undefined;
  const mod = mac ? event.metaKey : event.ctrlKey;
  if (mac ? event.ctrlKey : event.metaKey) return undefined;
  const id = specId({ key: event.key, shift: event.shiftKey, mod });
  return SHORTCUTS.find(shortcut => shortcut.keys.some(spec => specId(spec) === id))?.action;
}
/** Tooltip suffix for a button: "Split (S)". */
/** Shows `Mod` as this keyboard's modifier: Cmd on a Mac, Ctrl elsewhere. */
export const keyText = (text: string, mac = isMac()) => text.replace(/\bMod\b/g, mac ? 'Cmd' : 'Ctrl');
export function shortcutHint(action: EditorAction): string {
  const shortcut = SHORTCUTS.find(item => item.action === action);
  return shortcut ? ` (${keyText(shortcut.label)})` : '';
}
