import { describe, expect, it, vi } from 'vitest';
import { createEditorMenus } from '../site/components/editor-menus';
import type { MenuItem } from '../site/components/editor-controls';
import { items, type EditorMarker } from '../site/lib/recording-editor';
import { boundaryState } from './editor-boundary-fixtures';

function setup(
  overrides: Partial<Parameters<typeof createEditorMenus>[0]> = {},
) {
  const rows = items(boundaryState(), 120);
  const commands = {
    startChapter: vi.fn(),
    canSetEdge: vi.fn(() => true),
    setItemEdge: vi.fn(),
    addSubchapter: vi.fn(),
    addPoint: vi.fn(),
    toggleChecked: vi.fn(),
    removeSelected: vi.fn(),
    revertItem: vi.fn(),
  };
  const actions = {
    seek: vi.fn(),
    hear: vi.fn(),
    mark: vi.fn(),
    editMarker: vi.fn(),
    focusMarker: vi.fn(),
    removeMarker: vi.fn(),
    rename: vi.fn(),
    zoomAt: vi.fn(),
    fit: vi.fn(),
  };
  const menus = createEditorMenus(
    {
      playhead: 30,
      rows,
      checked: [],
      chapterCount: 3,
      changed: new Set(['opening']),
      originalIds: new Set(rows.map((item) => item.id)),
      ...overrides,
    },
    commands,
    actions,
  );
  return { menus, commands, actions, rows };
}
function named(items: MenuItem[], label: string): MenuItem {
  const item = items.find((item) => item.label === label);
  expect(item, label).toBeDefined();
  return item!;
}

describe('editor context menus', () => {
  it('binds section actions to the shared commands and the clicked item', () => {
    const env = setup();
    const section = env.rows.find((item) => item.id === 'opening')!;
    const menu = env.menus.item(section, 30);
    named(menu, 'Start here (0:30)').onSelect?.();
    expect(env.commands.setItemEdge).toHaveBeenCalledWith(
      'start',
      30,
      'opening',
    );
    named(menu, 'End here (0:30)').onSelect?.();
    expect(env.commands.setItemEdge).toHaveBeenCalledWith('end', 30, 'opening');
    named(menu, 'Add a point at 0:30').onSelect?.();
    expect(env.commands.addPoint).toHaveBeenCalledWith(30);
    named(menu, 'Remove chapter and its contents').onSelect?.();
    expect(env.commands.removeSelected).toHaveBeenCalledWith('opening');
    named(menu, 'Undo my edits to this').onSelect?.();
    expect(env.commands.revertItem).toHaveBeenCalledWith('opening');
    named(menu, 'Rename').onSelect?.();
    expect(env.actions.rename).toHaveBeenCalledWith(section);
  });

  it('does not offer range or checked-state actions for a timestamp-only point', () => {
    const env = setup();
    const point = env.rows.find((item) => item.id === 'song-note')!;
    const menu = env.menus.item(point, 30);
    expect(menu.some((item) => item.label.startsWith('End here'))).toBe(false);
    expect(
      menu.some(
        (item) => item.label === 'Play up to its end (from 5 s before)',
      ),
    ).toBe(false);
    expect(menu.some((item) => /Mark as/.test(item.label))).toBe(false);
    named(menu, 'Move it to 0:30').onSelect?.();
    expect(env.commands.setItemEdge).toHaveBeenCalledWith(
      'start',
      30,
      point.id,
    );
    named(menu, 'Edit point text').onSelect?.();
    expect(env.actions.rename).toHaveBeenCalledWith(point);
  });

  it('preserves disabled states and omits revert for a newly created item', () => {
    const env = setup({ chapterCount: 1, originalIds: new Set() });
    env.commands.canSetEdge.mockReturnValue(false);
    const menu = env.menus.item(env.rows[0], 0);
    expect(named(menu, 'Remove chapter and its contents').disabled).toBe(true);
    expect(named(menu, 'Start here (0:00)').disabled).toBe(true);
    expect(named(menu, 'Add a subchapter at 0:00').disabled).toBe(true);
    expect(menu.some((item) => item.label === 'Undo my edits to this')).toBe(
      false,
    );
  });

  it('distinguishes local marker inclusion from resolving a saved marker', () => {
    const env = setup();
    const local: EditorMarker = {
      id: 'mark-1',
      at: 20,
      note: 'Check',
      include: false,
    };
    const localMenu = env.menus.marker(local);
    expect(named(localMenu, 'Send with my changes').checked).toBe(false);
    named(localMenu, 'Send with my changes').onSelect?.();
    expect(env.actions.editMarker).toHaveBeenCalledWith(local.id, {
      include: true,
    });
    named(localMenu, 'Edit the note').onSelect?.();
    expect(env.actions.focusMarker).toHaveBeenCalledWith(local);
    const saved = { ...local, id: 'file-0', include: true };
    const savedMenu = env.menus.marker(saved);
    expect(
      savedMenu.some((item) => item.label === 'Send with my changes'),
    ).toBe(false);
    named(savedMenu, 'Remove from the file (resolved)').onSelect?.();
    expect(env.actions.removeMarker).toHaveBeenCalledWith('file-0');
  });

  it('describes selection separately from constructing or invoking a menu', () => {
    const env = setup();
    const item = env.rows[0];
    const boundary = {
      id: item.id,
      lane: 'chapter',
      edge: 'end',
      time: 50,
    } as const;
    const context = {
      x: 10,
      y: 20,
      time: 50,
      lane: 'chapter' as const,
      item,
      boundary,
    };
    const edgeMenu = env.menus.timeline(context);
    expect(edgeMenu.selection).toEqual({ kind: 'boundary', boundary });
    named(edgeMenu.items, 'Move it to the playhead (0:30)').onSelect?.();
    expect(env.commands.setItemEdge).toHaveBeenCalledWith('end', 30, item.id);
    expect(
      env.menus.timeline({ ...context, boundary: undefined }).selection,
    ).toEqual({ kind: 'item', id: item.id });
    const marker: EditorMarker = {
      id: 'mark-1',
      at: 50,
      note: 'Check',
      include: false,
    };
    expect(env.menus.timeline({ ...context, marker }).selection).toEqual({
      kind: 'marker',
      id: marker.id,
    });
    expect(env.actions.focusMarker).not.toHaveBeenCalled();
    expect(
      env.menus.timeline({ ...context, lane: 'marks' }).selection,
    ).toBeUndefined();
  });

  it('binds ruler actions to the rounded click time rather than the playhead', () => {
    const env = setup();
    const menu = env.menus.timeline({
      x: 5,
      y: 10,
      time: 40.123,
      lane: 'ruler',
    });
    expect(menu.selection).toBeUndefined();
    named(menu.items, 'Move the playhead here').onSelect?.();
    expect(env.actions.seek).toHaveBeenCalledWith(40.12);
    named(menu.items, 'Zoom in here').onSelect?.();
    expect(env.actions.zoomAt).toHaveBeenCalledWith(40.12);
    named(menu.items, 'Show the whole recording').onSelect?.();
    expect(env.actions.fit).toHaveBeenCalledOnce();
  });

  it('offers the appropriate creation commands for empty lanes and chapter types', () => {
    const env = setup();
    const context = { x: 5, y: 10, time: 30 };
    named(env.menus.chapters(30), 'Add Sermon chapter at 0:30').onSelect?.();
    expect(env.commands.startChapter).toHaveBeenCalledWith('sermon', 30);
    named(
      env.menus.timeline({ ...context, lane: 'subchapter' }).items,
      'Add a subchapter at 0:30',
    ).onSelect?.();
    expect(env.commands.addSubchapter).toHaveBeenCalledWith(30);
    named(
      env.menus.timeline({ ...context, lane: 'point' }).items,
      'Add a key point at 0:30',
    ).onSelect?.();
    expect(env.commands.addPoint).toHaveBeenCalledWith(30);
  });
});
