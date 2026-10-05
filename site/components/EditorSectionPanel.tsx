import type { MouseEvent, RefObject } from 'react';
import {
  edgeLimits,
  formatClock,
  type EditorIssue,
  type EditorItem,
  type EditorState,
} from '../lib/recording-editor';
import {
  CHAPTER_KINDS,
  CHAPTER_TITLES,
  type ChapterKind,
} from '../lib/recording-schema';
import { parseScriptureReference } from '../lib/scripture';
import type { EditorCommands } from './editor-commands';
import { ChipList, EdgeControl } from './editor-fields';
import EditorPointNote from './EditorPointNote';
import EditorTitleField from './EditorTitleField';
import Icon from './Icon';

interface SectionPanelProps {
  state: EditorState;
  rows: EditorItem[];
  selectedId?: string;
  selectedSection?: EditorItem;
  issues: EditorIssue[];
  changed: Set<string>;
  originalIds: { has: (id: string) => boolean };
  length: number;
  linked: boolean;
  playhead: number;
  commands: EditorCommands;
  titleRef: RefObject<HTMLTextAreaElement | null>;
  pointRef: RefObject<HTMLTextAreaElement | null>;
  paneRef: RefObject<HTMLDivElement | null>;
  scrubSession: RefObject<number>;
  onSelect: (item: EditorItem, jump?: boolean) => void;
  onSeek: (seconds: number, options?: { live?: boolean }) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, item: EditorItem) => void;
  onBack: () => void;
}

export default function EditorSectionPanel(props: SectionPanelProps) {
  const {
    state,
    rows,
    selectedSection: item,
    commands,
    playhead,
    length,
    linked,
  } = props;
  const section =
    item &&
    [...state.chapters, ...state.subchapters].find(
      (section) => section.id === item.id,
    );
  const own = props.issues.filter((issue) => issue.itemId === item?.id);
  const parentTitle =
    rows.find((row) => row.id === item?.parentId)?.title ?? item?.parentId;
  const wasChanged = Boolean(item && props.changed.has(item.id));
  const isNew = Boolean(item && !props.originalIds.has(item.id));

  function pointRow(child: EditorItem) {
    const point = state.points.find((point) => point.id === child.id);
    if (!point) return null;
    return (
      <EditorPointNote
        key={point.id}
        point={point}
        selected={child.id === props.selectedId}
        playhead={playhead}
        issues={props.issues.filter((issue) => issue.itemId === child.id)}
        inputRef={props.pointRef}
        limits={edgeLimits(state, length, {
          id: point.id,
          lane: 'point',
          edge: 'start',
        })}
        onSelect={() => props.onSelect(child)}
        onGo={() => props.onSelect(child, true)}
        onText={(text) =>
          commands.editPoint(point.id, { text }, `point-text:${point.id}`)
        }
        onTime={(value) => commands.setItemEdge('start', value, point.id)}
        onRemove={() => commands.removeSelected(point.id)}
        onContextMenu={(event) => props.onContextMenu(event, child)}
      />
    );
  }
  function edge(label: string, which: 'start' | 'end', value: number) {
    return (
      <EdgeControl
        key={which}
        label={label}
        value={value}
        playhead={playhead}
        changed={wasChanged}
        limits={edgeLimits(
          state,
          length,
          { lane: item!.lane, id: item!.id, edge: which },
          linked,
        )}
        onSet={(seconds) => commands.setItemEdge(which, seconds, item!.id)}
        onPlayhead={() => commands.setItemEdge(which, playhead, item!.id)}
        onGo={() => props.onSeek(value)}
        onScrub={(seconds) => {
          commands.setItemEdge(
            which,
            seconds,
            item!.id,
            linked,
            `scrub-${props.scrubSession.current}`,
          );
          props.onSeek(seconds, { live: true });
        }}
        onScrubEnd={() => {
          props.scrubSession.current++;
        }}
      />
    );
  }
  return (
    <section className="ce-window ce-editor-pane" aria-label="Selected section">
      <div className="ce-list-head ce-mobile-editor-head">
        <button
          type="button"
          className="ce-link ce-back-to-list"
          onClick={props.onBack}
        >
          Back to chapters
        </button>
        <h2>Edit {item?.lane === 'subchapter' ? 'subchapter' : 'chapter'}</h2>
      </div>
      <div className="ce-editor-body" ref={props.paneRef} tabIndex={-1}>
        {item && section ? (
          <div
            className="ce-section-editor"
            key={item.id}
            data-entry={item.id}
            data-lane={item.lane}
            onContextMenu={(event) => props.onContextMenu(event, item)}
          >
            {item.parentId && (
              <p className="ce-parent-name">In {parentTitle}</p>
            )}
            <EditorTitleField
              value={section.title}
              label={
                item.lane === 'subchapter'
                  ? 'Subchapter title'
                  : 'Chapter title'
              }
              inputRef={props.titleRef}
              onSelect={() => props.onSelect(item)}
              onCommit={(title) => commands.editSection(item.id, { title })}
              onExit={() =>
                props.paneRef.current?.focus({ preventScroll: true })
              }
            />
            <section
              className="ce-descriptions"
              aria-label="Timestamped descriptions"
            >
              <h3>Timestamped descriptions</h3>
              <ol>
                {rows
                  .filter(
                    (child) =>
                      child.parentId === item.id && child.lane === 'point',
                  )
                  .map(pointRow)}
              </ol>
              {!state.points.some((point) => point.parentId === item.id) && (
                <p className="ce-muted">
                  No descriptions yet. Move the playhead to a moment in this
                  section, then add one.
                </p>
              )}
              <button
                type="button"
                className="ce-action"
                disabled={playhead < section.start || playhead >= section.end}
                onClick={() => commands.addPoint(playhead, section.id)}
              >
                <Icon name="plus" />
                Add description at {formatClock(playhead)}
              </button>
            </section>
            <section
              className="ce-section-settings"
              aria-label="Section timing and metadata"
            >
              <h3>Timing and details</h3>
              {edge('Start', 'start', section.start)}
              {edge('End', 'end', section.end)}
              <label className="ce-field">
                <span className="ce-label">Type</span>
                <select
                  value={section.kind}
                  onChange={(event) =>
                    commands.editSection(section.id, {
                      kind: event.target.value as ChapterKind,
                    })
                  }
                >
                  {CHAPTER_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {CHAPTER_TITLES[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <ChipList
                label="Scripture"
                items={section.scripture}
                placeholder="e.g. John 16:25–33"
                onChange={(scripture) =>
                  commands.editSection(section.id, { scripture })
                }
                validate={(value) =>
                  parseScriptureReference(value)
                    ? undefined
                    : 'Enter a Bible passage, such as John 16:25–33.'
                }
              />
            </section>
            {own.length > 0 && (
              <ul className="ce-notes">
                {own.map((issue) => (
                  <li key={issue.message} className={`is-${issue.level}`}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="ce-actions">
              {item.lane === 'chapter' && (
                <button
                  type="button"
                  className="ce-action"
                  disabled={
                    playhead <= section.start || playhead >= section.end
                  }
                  onClick={() => commands.addSubchapter()}
                >
                  <Icon name="plus" />
                  Subchapter at {formatClock(playhead)}
                </button>
              )}
              <button
                type="button"
                className="ce-action"
                onClick={() => commands.removeSelected(item.id)}
                disabled={item.lane === 'chapter' && state.chapters.length < 2}
              >
                <Icon name="close" />
                Remove {item.lane}
              </button>
              {!isNew && wasChanged && (
                <button
                  type="button"
                  className="ce-action"
                  onClick={() => commands.revertItem(item.id)}
                >
                  <Icon name="undo" />
                  Undo edits
                </button>
              )}
              <button
                type="button"
                className="ce-confirm"
                onClick={() => commands.confirmSection(item.id)}
              >
                <Icon name="check" />
                Mark checked & next
              </button>
            </div>
          </div>
        ) : (
          <p className="ce-muted">
            Choose a chapter or subchapter to edit its title and descriptions.
          </p>
        )}
      </div>
    </section>
  );
}
