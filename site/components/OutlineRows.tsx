import type { DisplayEntry, DisplayRecording } from './archive-display';
import { formatTime, watchUrl } from '../lib/urls';
import { useEffect, useId, useRef, useState } from 'react';

/** The same compact chapter/subchapter outline on recording and watch pages.
 * Timestamped point text never enters this component. */
export default function OutlineRows({ recording, base, time = -1, onChoose, selectedId, subsections, listId: controlledListId }: {
  recording: DisplayRecording; base: string; time?: number; selectedId?: string;
  onChoose?: (entry: DisplayEntry) => void;
  subsections?: { shown: boolean; toggle: () => void }; listId?: string;
}) {
  const ownListId = useId(), listId = controlledListId ?? ownListId;
  const list = useRef<HTMLOListElement>(null);
  const [ownShown, setOwnShown] = useState(false);
  const showSubsections = subsections ? subsections.shown : ownShown;
  const toggleSubsections = subsections ? subsections.toggle : () => setOwnShown((shown) => !shown);
  // Opening a point or part directly (search result or link) reveals them so it can be highlighted.
  useEffect(() => { if (!subsections && recording.entries.some((entry) => entry.id === selectedId && entry.parentId)) setOwnShown(true); }, [selectedId, recording, subsections]);
  const chapters = recording.entries.filter((entry) => entry.kind === 'chapter');
  const inside = (chapter: DisplayEntry) => recording.entries.filter((entry) => entry.parentId === chapter.id);
  const hasInside = recording.entries.some((entry) => entry.parentId);
  const playing = (entry: DisplayEntry) => time >= entry.start && time < entry.end;
  const currentId = showSubsections && recording.entries.find((entry) => entry.parentId && playing(entry))?.id || chapters.find(playing)?.id;
  // Keep the current entry visible inside a scrolling panel without scrolling the page.
  useEffect(() => {
    const element = list.current, row = element?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!element || !row || element.scrollHeight <= element.clientHeight) return;
    const top = row.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop, bottom = top + row.offsetHeight;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
  }, [currentId, showSubsections]);
   const label = (entry: DisplayEntry) => entry.parentId ? 'Current subchapter' : 'Current chapter';
  const row = (entry: DisplayEntry, active: boolean) => {
    const content = <><span className="timestamp">{formatTime(entry.start)}</span><span className="chapter-copy">
      <strong>{entry.title}</strong>
      {active && <span className="current-chapter sr-only">{label(entry)}</span>}
    </span></>;
    return onChoose
      ? <button className="chapter-row" type="button" aria-current={active ? 'true' : undefined} onClick={() => onChoose(entry)}>{content}</button>
      : <a className="chapter-row" href={watchUrl(base, { recording: recording.id, start: entry.start, focus: entry.id })}>{content}</a>;
  };
  const hours = recording.length >= 3600;
  return <div className={`outline${hours ? ' outline-hours' : ''}`}>
    <ol className="outline-list" id={listId} ref={list}>{chapters.map((chapter) => {
      const children = inside(chapter);
      // One highlight at a time: a visible playing point or part takes it from its chapter.
      const activeChild = showSubsections ? children.find(playing) : undefined;
      return <li className="outline-item" key={chapter.id}>
        <div className="outline-entry">{row(chapter, playing(chapter) && !activeChild)}</div>
        {children.length > 0 && <ol className="chapter-subsections" hidden={!showSubsections}>{children.map((child) => <li key={child.id}>
          <div className="outline-entry">{row(child, child === activeChild)}</div>
        </li>)}</ol>}
      </li>;
    })}</ol>
    {hasInside && <button className="subsection-toggle" type="button" aria-expanded={showSubsections} aria-controls={listId}
      onClick={toggleSubsections}>{showSubsections ? 'Hide Subchapters' : 'Show Subchapters'}</button>}
  </div>;
}
