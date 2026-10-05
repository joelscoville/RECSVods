import { useCallback, useRef } from 'react';
import { setEdge, type EditorState } from '../lib/recording-editor';
import type { BoundaryMove } from '../lib/timeline-geometry';

interface BoundaryDragOptions {
  state: EditorState;
  length: number;
  linked: boolean;
  showPreview: (state: EditorState | undefined) => void;
  apply: (state: EditorState) => void;
  followPreview: (id: string, seconds: number) => void;
  finishSeek: () => void;
}

/** One pointer gesture is one transaction. Every preview is computed from the
 * initial snapshot, never from a previous preview. Commit applies once; cancellation
 * only discards the preview and deliberately leaves the playhead where it is. */
export function useBoundaryDrag({
  state,
  length,
  linked,
  showPreview,
  apply,
  followPreview,
  finishSeek,
}: BoundaryDragOptions) {
  const transaction = useRef<{ snapshot: EditorState; preview?: EditorState }>(
    undefined,
  );

  const move = useCallback(
    ({ boundary, time, unlinked }: BoundaryMove) => {
      const active = (transaction.current ??= { snapshot: state });
      active.preview = setEdge(
        active.snapshot,
        length,
        boundary,
        time,
        linked && !unlinked,
      );
      showPreview(active.preview);
      followPreview(boundary.id, time);
    },
    [state, length, linked, showPreview, followPreview],
  );

  const commit = useCallback(() => {
    if (transaction.current?.preview) {
      apply(transaction.current.preview);
    }
    transaction.current = undefined;
    showPreview(undefined);
    finishSeek();
  }, [apply, showPreview, finishSeek]);

  const cancel = useCallback(() => {
    transaction.current = undefined;
    showPreview(undefined);
  }, [showPreview]);

  return { move, commit, cancel };
}
