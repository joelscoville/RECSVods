import { useCallback, useRef } from 'react';
import type { EditorState } from '../lib/recording-editor';
import { createBoundaryDragTransaction } from '../lib/boundary-drag-transaction';
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
  const transaction =
    useRef<ReturnType<typeof createBoundaryDragTransaction>>(undefined);
  transaction.current ??= createBoundaryDragTransaction();

  const move = useCallback(
    ({ boundary, time, unlinked }: BoundaryMove) => {
      const preview = transaction.current!.preview(
        state,
        length,
        { boundary, time, unlinked },
        linked,
      );
      showPreview(preview);
      followPreview(boundary.id, time);
    },
    [state, length, linked, showPreview, followPreview],
  );

  const commit = useCallback(() => {
    transaction.current!.commit(apply);
    showPreview(undefined);
    finishSeek();
  }, [apply, showPreview, finishSeek]);

  const cancel = useCallback(() => {
    transaction.current!.cancel();
    showPreview(undefined);
  }, [showPreview]);

  return { move, commit, cancel };
}
