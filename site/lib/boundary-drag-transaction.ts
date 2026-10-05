import { setEdge, type EditorState } from './recording-editor';
import type { BoundaryMove } from './timeline-geometry';

/** The document part of a drag, independent of React and pointer events. */
export function createBoundaryDragTransaction() {
  let active: { snapshot: EditorState; preview?: EditorState } | undefined;

  function preview(
    state: EditorState,
    length: number,
    move: BoundaryMove,
    linked: boolean,
  ) {
    active ??= { snapshot: state };
    active.preview = setEdge(
      active.snapshot,
      length,
      move.boundary,
      move.time,
      linked && !move.unlinked,
    );
    return active.preview;
  }

  function commit(apply: (state: EditorState) => void) {
    if (active?.preview) {
      apply(active.preview);
    }
    active = undefined;
  }

  function cancel() {
    active = undefined;
  }

  return { preview, commit, cancel };
}
