/** Recording edits shared by keyboard, panels and menus. This module coordinates
 * document changes with selection/focus; it owns no DOM, player, or layout state. */
import {
  addSubchapterAt,
  addPointAt,
  startChapterAt,
  removeItem,
  outline,
  edgeLimits,
  setEdge,
  editChapter,
  editPoint,
  toggleChecked,
  formatClock,
  type AddResult,
  type EditorChapter,
  type EditorPoint,
  type EditorState,
  type EditorItem,
} from '../lib/recording-editor';
import type { ChapterKind } from '../lib/recording-schema';
import type { useEditorSelection } from './use-editor-selection';

interface CommandDocument {
  state: EditorState;
  original: EditorState;
  apply: (state: EditorState, key?: string) => void;
}
type CommandSelection = Pick<
  ReturnType<typeof useEditorSelection>,
  | 'selectedId'
  | 'selected'
  | 'selectedSection'
  | 'setSelectedId'
  | 'setSelectionRequest'
  | 'setActiveBoundary'
  | 'revealParents'
  | 'setMobileList'
>;
interface CommandFeedback {
  activateEditor: () => void;
  focusTitle: () => void;
  select: (item: EditorItem) => void;
  notify: (message: string) => void;
}

export function createEditorCommands(
  document: CommandDocument,
  selection: CommandSelection,
  timing: {
    length: number;
    playhead: number;
    linked: boolean;
    rows: EditorItem[];
  },
  feedback: CommandFeedback,
) {
  const { state, original, apply } = document;
  const { length, playhead, linked, rows } = timing;

  function setItemEdge(
    edge: 'start' | 'end',
    seconds: number,
    id = selection.selectedId,
    link = linked,
    key?: string,
  ) {
    const item = rows.find((row) => row.id === id);
    if (!item) {
      feedback.notify('Select a chapter, subchapter or point first.');
      return;
    }
    const [low, high] = edgeLimits(
      state,
      length,
      { lane: item.lane, id: item.id, edge },
      link,
    );
    if (!Number.isFinite(seconds) || seconds < low || seconds > high) {
      feedback.notify(
        `Use a time from ${formatClock(low)} to ${formatClock(high)}.`,
      );
      return;
    }
    if (item.lane === 'point') {
      if (edge === 'end') {
        feedback.notify(
          'A key point is a moment: set its time with Start here.',
        );
        return;
      }
      apply(
        setEdge(
          state,
          length,
          { lane: 'point', id: item.id, edge: 'start' },
          seconds,
        ),
        key,
      );
    } else {
      apply(
        setEdge(
          state,
          length,
          { lane: item.lane, id: item.id, edge },
          seconds,
          link,
        ),
        key,
      );
    }
  }

  function canSetEdge(
    item: EditorItem | undefined,
    edge: 'start' | 'end',
    seconds: number,
  ) {
    if (!item || (item.lane === 'point' && edge === 'end')) return false;
    const [low, high] = edgeLimits(
      state,
      length,
      { lane: item.lane, id: item.id, edge },
      linked,
    );
    return seconds >= low && seconds <= high;
  }

  function applyCreatedItem(result: AddResult, rename: boolean) {
    if (!result.id) {
      feedback.notify(result.reason ?? 'Nothing to add here.');
      return;
    }
    feedback.activateEditor();
    apply(result.state);
    selection.setSelectedId(result.id);
    selection.setSelectionRequest({ id: result.id });
    selection.setActiveBoundary(undefined);
    selection.revealParents(result.id, outline(result.state, length));
    selection.setMobileList(false);
    if (rename) feedback.focusTitle();
  }

  function addSubchapter(seconds = playhead) {
    applyCreatedItem(addSubchapterAt(state, length, seconds), true);
  }
  function addPoint(seconds = playhead, parentId?: string) {
    applyCreatedItem(addPointAt(state, length, seconds, parentId), false);
    feedback.focusTitle();
  }
  function startChapter(kind: ChapterKind, seconds = playhead) {
    applyCreatedItem(startChapterAt(state, length, kind, seconds), true);
  }

  function removeSelected(id = selection.selectedId) {
    if (!id) return;
    const isChapter = state.chapters.some((chapter) => chapter.id === id);
    if (isChapter && state.chapters.length < 2) {
      feedback.notify('A recording keeps at least one chapter.');
      return;
    }
    const index = rows.findIndex((item) => item.id === id);
    const next = removeItem(state, id);
    const remaining = outline(next, length);
    const ids = new Set(remaining.map((item) => item.id));
    apply(next);
    selection.setActiveBoundary(undefined);
    const nextId =
      rows.slice(index + 1).find((item) => ids.has(item.id))?.id ??
      rows
        .slice(0, index)
        .reverse()
        .find((item) => ids.has(item.id))?.id ??
      remaining[0]?.id;
    selection.setSelectedId(nextId);
    if (nextId) {
      selection.setSelectionRequest({ id: nextId });
      selection.revealParents(nextId, remaining);
    }
  }

  function selectNextSection(id?: string) {
    const sections = rows.filter((item) => item.lane !== 'point');
    const next = sections[sections.findIndex((item) => item.id === id) + 1];
    if (next) feedback.select(next);
  }
  function confirmAndNext() {
    if (!selection.selected) return;
    if (selection.selected.lane !== 'point')
      apply(toggleChecked(state, selection.selected.id, true));
    selectNextSection(selection.selectedSection?.id);
  }
  function confirmSection(id: string) {
    apply(toggleChecked(state, id, true));
    selectNextSection(id);
  }
  function revertItem(id: string) {
    const section = [...original.chapters, ...original.subchapters].find(
      (item) => item.id === id,
    );
    const point = original.points.find((item) => item.id === id);
    if (section) apply(editChapter(state, id, section));
    if (point)
      apply({
        ...state,
        points: state.points.map((item) =>
          item.id === id ? { ...point } : item,
        ),
      });
  }

  return {
    setItemEdge,
    canSetEdge,
    addSubchapter,
    addPoint,
    startChapter,
    removeSelected,
    confirmAndNext,
    confirmSection,
    revertItem,
    editSection: (id: string, change: Partial<Omit<EditorChapter, 'id'>>) =>
      apply(editChapter(state, id, change)),
    editPoint: (
      id: string,
      change: Partial<Omit<EditorPoint, 'id'>>,
      key?: string,
    ) => apply(editPoint(state, id, change), key),
    toggleChecked: (id: string) => apply(toggleChecked(state, id)),
  };
}
export type EditorCommands = ReturnType<typeof createEditorCommands>;
