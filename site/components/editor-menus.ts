/** Menu descriptions and action bindings. DOM placement and applying selection
 * intents stay in the workspace; edits are delegated to the shared commands. */
import {
  chapterTitle,
  formatClock,
  isFileMarker,
  roundTime,
  type Edge,
  type EditorItem,
  type EditorMarker,
} from '../lib/recording-editor';
import { CHAPTER_KINDS } from '../lib/recording-schema';
import { keyText, SHORTCUTS, type EditorAction } from '../lib/editor-keys';
import type { TimelineContext } from '../lib/timeline-geometry';
import type { EditorCommands } from './editor-commands';
import type { MenuItem } from './editor-controls';

interface MenuModel {
  playhead: number;
  rows: readonly EditorItem[];
  checked: readonly string[];
  chapterCount: number;
  changed: ReadonlySet<string>;
  originalIds: { has: (id: string) => boolean };
}
type MenuCommands = Pick<
  EditorCommands,
  | 'startChapter'
  | 'canSetEdge'
  | 'setItemEdge'
  | 'addSubchapter'
  | 'addPoint'
  | 'toggleChecked'
  | 'removeSelected'
  | 'revertItem'
>;
interface MenuActions {
  seek: (seconds: number, options?: { play?: boolean }) => void;
  hear: (seconds: number, lead?: number) => void;
  mark: (seconds: number) => void;
  editMarker: (
    id: string,
    change: Partial<Pick<EditorMarker, 'at' | 'include'>>,
  ) => void;
  focusMarker: (marker: EditorMarker) => void;
  removeMarker: (id: string) => void;
  rename: (item: EditorItem) => void;
  zoomAt: (seconds: number) => void;
  fit: () => void;
}
export type MenuSelection =
  | { kind: 'marker'; id: string }
  | { kind: 'boundary'; boundary: Edge }
  | { kind: 'item'; id: string };
export interface TimelineMenu {
  items: MenuItem[];
  selection?: MenuSelection;
}

function keyOf(action: EditorAction) {
  const label = SHORTCUTS.find((item) => item.action === action)?.label;
  return label && keyText(label);
}

export function createEditorMenus(
  model: MenuModel,
  commands: MenuCommands,
  actions: MenuActions,
) {
  const { playhead } = model;

  function chapters(at: number): MenuItem[] {
    return CHAPTER_KINDS.map((kind) => ({
      label: `Add ${chapterTitle(kind)} chapter at ${formatClock(at)}`,
      onSelect: () => commands.startChapter(kind, at),
    }));
  }

  function marker(marker: EditorMarker): MenuItem[] {
    const mine = !isFileMarker(marker);
    return [
      {
        label: `Go to ${formatClock(marker.at)}`,
        onSelect: () => actions.seek(marker.at),
      },
      {
        label: `Move it to the playhead (${formatClock(playhead)})`,
        disabled: Math.abs(playhead - marker.at) < 0.01,
        onSelect: () => actions.editMarker(marker.id, { at: playhead }),
      },
      { label: 'Edit the note', onSelect: () => actions.focusMarker(marker) },
      ...(mine
        ? [
            {
              label: 'Send with my changes',
              checked: marker.include,
              onSelect: () =>
                actions.editMarker(marker.id, { include: !marker.include }),
            },
          ]
        : []),
      { separator: true, label: '' },
      {
        label: mine ? 'Delete marker' : 'Remove from the file (resolved)',
        onSelect: () => actions.removeMarker(marker.id),
      },
    ];
  }

  function item(item: EditorItem, at: number): MenuItem[] {
    const checked = model.checked.includes(item.id);
    const inside = at > item.start + 0.5 && at < item.end - 0.5;
    const entries: (MenuItem | false)[] = [
      {
        label: `Play from ${formatClock(at)}`,
        onSelect: () => actions.seek(at, { play: true }),
      },
      {
        label: 'Play from its start',
        onSelect: () => actions.seek(item.start, { play: true }),
      },
      item.lane !== 'point' && {
        label: 'Play up to its end (from 5 s before)',
        onSelect: () => actions.hear(item.end, 5),
      },
      {
        label: 'Hear its start (3 s before to 2 s after)',
        onSelect: () => actions.hear(item.start),
      },
      {
        label: `Mark ${formatClock(at)}`,
        hint: at === playhead ? keyOf('mark') : undefined,
        onSelect: () => actions.mark(at),
      },
      { separator: true, label: '' },
      {
        label:
          item.lane === 'point'
            ? `Move it to ${formatClock(at)}`
            : `Start here (${formatClock(at)})`,
        hint: at === playhead ? keyOf('setStart') : undefined,
        disabled: !commands.canSetEdge(item, 'start', at),
        onSelect: () => commands.setItemEdge('start', at, item.id),
      },
      item.lane !== 'point' && {
        label: `End here (${formatClock(at)})`,
        hint: at === playhead ? keyOf('setEnd') : undefined,
        disabled: !commands.canSetEdge(item, 'end', at),
        onSelect: () => commands.setItemEdge('end', at, item.id),
      },
      item.lane === 'chapter' && {
        label: `Add a subchapter at ${formatClock(at)}`,
        hint: at === playhead ? keyOf('addSubchapter') : undefined,
        disabled: !inside,
        onSelect: () => commands.addSubchapter(at),
      },
      item.lane !== 'point' && {
        label: `Add a point at ${formatClock(at)}`,
        hint: at === playhead ? keyOf('addPoint') : undefined,
        disabled: at < item.start || at >= item.end,
        onSelect: () => commands.addPoint(at),
      },
      { separator: true, label: '' },
      {
        label: item.lane === 'point' ? 'Edit point text' : 'Rename',
        onSelect: () => actions.rename(item),
      },
      item.lane !== 'point' && {
        label: checked ? 'Mark as not checked' : 'Mark as checked',
        onSelect: () => commands.toggleChecked(item.id),
      },
      { separator: true, label: '' },
      {
        label:
          item.lane === 'chapter'
            ? 'Remove chapter and its contents'
            : item.lane === 'subchapter'
              ? 'Remove subchapter and its points'
              : 'Remove point',
        hint: keyOf('delete'),
        disabled: item.lane === 'chapter' && model.chapterCount < 2,
        onSelect: () => commands.removeSelected(item.id),
      },
      model.changed.has(item.id) &&
        model.originalIds.has(item.id) && {
          label: 'Undo my edits to this',
          onSelect: () => commands.revertItem(item.id),
        },
    ];
    return entries.filter((entry): entry is MenuItem => Boolean(entry));
  }

  function timeline(context: TimelineContext): TimelineMenu {
    const at = roundTime(context.time);
    if (context.marker) {
      return {
        items: marker(context.marker),
        selection: { kind: 'marker', id: context.marker.id },
      };
    }
    if (context.lane === 'marks') {
      return {
        items: [
          {
            label: `Mark ${formatClock(at)}`,
            hint: at === playhead ? keyOf('mark') : undefined,
            onSelect: () => actions.mark(at),
          },
          {
            label: `Play from ${formatClock(at)}`,
            onSelect: () => actions.seek(at, { play: true }),
          },
        ],
      };
    }
    if (context.boundary) {
      const boundary = context.boundary;
      const owner = model.rows.find((item) => item.id === boundary.id);
      return {
        selection: { kind: 'boundary', boundary },
        items: [
          {
            label: `Hear this edge (${formatClock(boundary.time)})`,
            hint: keyOf('hear'),
            onSelect: () => actions.hear(boundary.time),
          },
          {
            label: `Move it to the playhead (${formatClock(playhead)})`,
            disabled:
              Math.abs(playhead - boundary.time) < 0.01 ||
              !commands.canSetEdge(owner, boundary.edge, playhead),
            onSelect: () =>
              commands.setItemEdge(boundary.edge, playhead, boundary.id),
          },
        ],
      };
    }
    if (context.item) {
      return {
        items: item(context.item, at),
        selection: { kind: 'item', id: context.item.id },
      };
    }
    if (context.lane === 'ruler') {
      return {
        items: [
          {
            label: `Play from ${formatClock(at)}`,
            onSelect: () => actions.seek(at, { play: true }),
          },
          { label: 'Move the playhead here', onSelect: () => actions.seek(at) },
          {
            label: `Mark ${formatClock(at)}`,
            onSelect: () => actions.mark(at),
          },
          { separator: true, label: '' },
          { label: 'Zoom in here', onSelect: () => actions.zoomAt(at) },
          {
            label: 'Show the whole recording',
            hint: keyOf('zoomFit'),
            onSelect: actions.fit,
          },
        ],
      };
    }
    const additions =
      context.lane === 'subchapter'
        ? [
            {
              label: `Add a subchapter at ${formatClock(at)}`,
              onSelect: () => commands.addSubchapter(at),
            },
          ]
        : context.lane === 'point'
          ? [
              {
                label: `Add a key point at ${formatClock(at)}`,
                onSelect: () => commands.addPoint(at),
              },
            ]
          : chapters(at);
    return {
      items: [
        ...additions,
        {
          label: `Play from ${formatClock(at)}`,
          onSelect: () => actions.seek(at, { play: true }),
        },
      ],
    };
  }

  return { chapters, marker, item, timeline };
}
