import type { MouseEvent, RefObject } from 'react';
import {
  formatClock,
  type EditorIssue,
  type EditorItem,
} from '../lib/recording-editor';
import Icon from './Icon';

interface OutlineProps {
  rows: EditorItem[];
  selectedId?: string;
  selectedSectionId?: string;
  playingId?: string;
  checked: string[];
  expanded: Set<string>;
  changed: Set<string>;
  originalIds: { has: (id: string) => boolean };
  issues: EditorIssue[];
  listRef: RefObject<HTMLOListElement | null>;
  onSelect: (item: EditorItem, jump?: boolean) => void;
  onRename: (item: EditorItem) => void;
  onCheck: (id: string) => void;
  onExpand: (id: string) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, item: EditorItem) => void;
}

export default function EditorOutlinePanel(props: OutlineProps) {
  function row(item: EditorItem) {
    const selected = item.id === props.selectedId;
    const checked = props.checked.includes(item.id);
    const changed = props.changed.has(item.id);
    const isNew = !props.originalIds.has(item.id);
    const errors = props.issues.filter(
      (issue) => issue.itemId === item.id && issue.level === 'error',
    );
    const children = props.rows.filter(
      (child) => child.parentId === item.id && child.lane !== 'point',
    );
    const contentsId = `ce-contents-${item.id}`;
    return (
      <li
        key={item.id}
        data-entry={item.id}
        data-lane={item.lane}
        className={`ce-entry ce-chapter${item.lane !== 'chapter' ? ' is-sub' : ''}${props.selectedSectionId === item.id ? ' is-current' : ''}${selected ? ' is-selected' : ''}${checked ? ' is-checked' : ''}${props.playingId === item.id ? ' is-playing' : ''}${errors.length ? ' has-error' : ''}`}
        onContextMenu={(event) => props.onContextMenu(event, item)}
      >
        <div
          className="ce-row"
          data-entry-header
          onClick={(event) => {
            if (
              !(event.target as HTMLElement).closest(
                'button, select, input, textarea, a, summary',
              )
            )
              props.onSelect(item);
          }}
        >
          <button
            type="button"
            className="ce-check"
            aria-pressed={checked}
            aria-label={
              checked
                ? `Unmark “${item.title}” as checked`
                : `Mark “${item.title}” as checked`
            }
            onClick={() => props.onCheck(item.id)}
          >
            <span className="ce-check-mark">
              {checked && <Icon name="check" />}
            </span>
          </button>
          <button
            type="button"
            className="ce-range"
            onClick={() => props.onSelect(item, true)}
            aria-current={selected ? 'true' : undefined}
            title="Jump to its start"
            aria-label={`${formatClock(item.start)}${item.lane === 'point' ? '' : ` to ${formatClock(item.end)}`}: jump to the start`}
          >
            {formatClock(Math.floor(item.start))}
            {item.lane !== 'point' && `–${formatClock(Math.floor(item.end))}`}
          </button>
          <div className="ce-title-cell">
            {children.length > 0 ? (
              <button
                type="button"
                className="ce-expand"
                aria-expanded={props.expanded.has(item.id)}
                aria-controls={contentsId}
                aria-label={`${props.expanded.has(item.id) ? 'Collapse' : 'Expand'} ${item.title}`}
                onClick={() => props.onExpand(item.id)}
              >
                <Icon name="chevron" />
              </button>
            ) : (
              <span className="ce-expand-space" aria-hidden="true" />
            )}
            <button
              type="button"
              className="ce-title"
              aria-current={
                props.selectedSectionId === item.id ? 'true' : undefined
              }
              onClick={() => props.onSelect(item)}
              onDoubleClick={() => props.onRename(item)}
              onKeyDown={(event) => {
                if (event.key === 'F2') {
                  event.preventDefault();
                  props.onRename(item);
                }
              }}
              title={item.title}
            >
              {item.title}
            </button>
          </div>
          <span className="ce-flags">
            {isNew ? (
              <span className="ce-flag">New</span>
            ) : (
              changed && <span className="ce-flag">Edited</span>
            )}
            {errors.length > 0 && (
              <span
                className="ce-flag ce-flag-error"
                title={errors.map((issue) => issue.message).join('\n')}
              >
                Fix
              </span>
            )}
          </span>
        </div>
        {children.length > 0 && (
          <ol
            id={contentsId}
            className="ce-children"
            hidden={!props.expanded.has(item.id)}
          >
            {children.map(row)}
          </ol>
        )}
      </li>
    );
  }
  return (
    <section className="ce-window ce-list-pane" aria-label="Chapter navigation">
      <div className="ce-nav-caption">
        <span>Choose a section to edit</span>
        <span>Checked</span>
      </div>
      <ol className="ce-list" ref={props.listRef}>
        {props.rows.filter((item) => item.lane === 'chapter').map(row)}
      </ol>
    </section>
  );
}
