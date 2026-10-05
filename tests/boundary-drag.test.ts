import { describe, expect, it, vi } from 'vitest';
import { createBoundaryDragTransaction } from '../site/lib/boundary-drag-transaction';
import { editorHistory, type EditorHistory } from '../site/lib/editor-history';
import type { EditorState } from '../site/lib/recording-editor';
import { boundaryState } from './editor-boundary-fixtures';

const boundary = {
  id: 'opening',
  lane: 'chapter',
  edge: 'end',
  time: 50,
} as const;
const move = (time: number, unlinked = false) => ({ boundary, time, unlinked });

describe('boundary drag transaction', () => {
  it('previews linked changes without mutating the source or adding undo steps', () => {
    const original = boundaryState();
    const saved = structuredClone(original);
    const transaction = createBoundaryDragTransaction();
    const preview = transaction.preview(original, 120, move(55), true);
    expect(
      preview.chapters.map((chapter) => [chapter.start, chapter.end]),
    ).toEqual([
      [0, 55],
      [55, 100],
      [100, 120],
    ]);
    expect(preview.subchapters[0].end).toBe(55);
    expect(
      preview.points.find((point) => point.id === 'sermon-note')?.time,
    ).toBe(55);
    expect(original).toEqual(saved);
  });

  it('commits many previews as exactly one undoable change', () => {
    const original = boundaryState();
    let history: EditorHistory = { past: [], present: original, future: [] };
    const transaction = createBoundaryDragTransaction();
    const apply = vi.fn((next: EditorState) => {
      history = editorHistory(history, { type: 'apply', next });
    });
    transaction.preview(original, 120, move(53), true);
    const final = transaction.preview(original, 120, move(58), true);
    expect(history.past).toEqual([]);
    transaction.commit(apply);
    transaction.commit(apply);
    expect(apply).toHaveBeenCalledExactlyOnceWith(final);
    expect(history.past).toEqual([original]);
    expect(editorHistory(history, { type: 'undo' }).present).toBe(original);
  });

  it('always recomputes from the initial snapshot, including when linking changes', () => {
    const original = boundaryState();
    const transaction = createBoundaryDragTransaction();
    const first = transaction.preview(original, 120, move(55), true);
    // Without linking, the old touching neighbour still ends/starts at 50.
    // Computing from the previous preview would instead permit a boundary at 55.
    const unlinked = transaction.preview(
      { ...first, title: 'Rerendered preview' },
      120,
      move(55, true),
      true,
    );
    expect(unlinked).toBe(original);
    const final = transaction.preview(first, 120, move(60), true);
    expect(final.title).toBe(original.title);
    expect(final.chapters[0].end).toBe(60);
  });

  it('cancels without applying, then starts the next gesture from its new source', () => {
    const transaction = createBoundaryDragTransaction();
    const apply = vi.fn();
    transaction.preview(boundaryState(), 120, move(55), true);
    transaction.cancel();
    transaction.commit(apply);
    expect(apply).not.toHaveBeenCalled();
    const nextSource = { ...boundaryState(), title: 'A later source' };
    const next = transaction.preview(nextSource, 120, move(56), true);
    transaction.commit(apply);
    expect(apply).toHaveBeenCalledExactlyOnceWith(next);
    expect(next.title).toBe('A later source');
  });
});
