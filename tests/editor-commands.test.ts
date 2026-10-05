import { describe, expect, it, vi } from 'vitest';
import { createEditorCommands } from '../site/components/editor-commands';
import { outline, type EditorState } from '../site/lib/recording-editor';
import { boundaryState } from './editor-boundary-fixtures';

function setup(selectedId: string, state = boundaryState()) {
  const rows = outline(state, 120);
  const selected = rows.find((item) => item.id === selectedId);
  const selection = {
    selectedId,
    selected,
    selectedSection:
      selected?.lane === 'point'
        ? rows.find((item) => item.id === selected.parentId)
        : selected,
    setSelectedId: vi.fn(),
    setSelectionRequest: vi.fn(),
    setActiveBoundary: vi.fn(),
    revealParents: vi.fn(),
    setMobileList: vi.fn(),
  };
  const feedback = {
    activateEditor: vi.fn(),
    focusTitle: vi.fn(),
    select: vi.fn(),
    notify: vi.fn(),
  };
  const apply = vi.fn<(state: EditorState, key?: string) => void>();
  const commands = createEditorCommands(
    { state, original: state, apply },
    selection,
    { rows, length: 120, playhead: 30, linked: true },
    feedback,
  );
  return { commands, apply, selection, feedback };
}

describe('editor command coordination', () => {
  it('deletes a section and descendants, selecting the next surviving item', () => {
    const env = setup('opening');
    env.commands.removeSelected();
    expect(env.apply).toHaveBeenCalledOnce();
    const next = env.apply.mock.calls[0][0];
    expect(next.chapters.map((item) => item.id)).toEqual(['sermon', 'closing']);
    expect(next.subchapters).toEqual([]);
    expect(next.points.map((item) => item.id)).toEqual(['sermon-note']);
    expect(env.selection.setSelectedId).toHaveBeenCalledExactlyOnceWith(
      'sermon',
    );
    expect(env.selection.setSelectionRequest).toHaveBeenCalledWith({
      id: 'sermon',
    });
    expect(env.selection.setActiveBoundary).toHaveBeenCalledWith(undefined);
    expect(env.selection.revealParents).toHaveBeenCalledWith(
      'sermon',
      expect.arrayContaining([expect.objectContaining({ id: 'sermon' })]),
    );
  });

  it('selects the previous surviving row when the final section is deleted', () => {
    const env = setup('closing');
    env.commands.removeSelected();
    expect(env.selection.setSelectedId).toHaveBeenCalledWith('sermon-note');
    expect(env.apply.mock.calls[0][0].chapters.map((item) => item.id)).toEqual([
      'opening',
      'sermon',
    ]);
  });

  it('honours an explicit menu target rather than deleting the current selection', () => {
    const env = setup('closing');
    env.commands.removeSelected('song');
    const next = env.apply.mock.calls[0][0];
    expect(next.chapters.map((item) => item.id)).toEqual([
      'opening',
      'sermon',
      'closing',
    ]);
    expect(next.subchapters).toEqual([]);
    expect(env.selection.setSelectedId).toHaveBeenCalledWith('sermon');
  });

  it('preserves the only remaining chapter and selection', () => {
    const state = boundaryState();
    state.chapters = state.chapters.slice(0, 1);
    state.points = state.points.filter((point) => point.parentId === 'song');
    const env = setup('opening', state);
    env.commands.removeSelected();
    expect(env.apply).not.toHaveBeenCalled();
    expect(env.selection.setSelectedId).not.toHaveBeenCalled();
    expect(env.feedback.notify).toHaveBeenCalledWith(
      'A recording keeps at least one chapter.',
    );
  });

  it('coordinates adding a point with selection, reveal and focus', () => {
    const env = setup('opening');
    env.commands.addPoint();
    expect(env.apply).toHaveBeenCalledOnce();
    const next = env.apply.mock.calls[0][0];
    const point = next.points.at(-1)!;
    expect(point).toMatchObject({ parentId: 'song', time: 30, text: '' });
    expect(env.selection.setSelectedId).toHaveBeenCalledWith(point.id);
    expect(env.selection.setSelectionRequest).toHaveBeenCalledWith({
      id: point.id,
    });
    expect(env.selection.setActiveBoundary).toHaveBeenCalledWith(undefined);
    expect(env.selection.revealParents).toHaveBeenCalledWith(
      point.id,
      expect.arrayContaining([
        expect.objectContaining({ id: point.id, parentId: 'song' }),
      ]),
    );
    expect(env.selection.setMobileList).toHaveBeenCalledWith(false);
    expect(env.feedback.activateEditor).toHaveBeenCalledOnce();
    expect(env.feedback.focusTitle).toHaveBeenCalledOnce();
  });
});
