import type { DisplayChapter, DisplayService } from './archive-display';
import { formatTime, watchUrl } from '../lib/urls';
import { useEffect, useId, useRef, useState } from 'react';

/** The same compact outline on service and watch pages. Internal summaries never enter this component;
 * primary chapters may show their public one-line summary, subsections show only time and title. */
/** On the watch page the subsection state is shared with a second toggle, so it can be controlled. */
export default function OutlineRows({ service, base, videoId, time = -1, onChoose, selectedId, subsections, listId: controlledListId }: {
  service: DisplayService; base: string; videoId?: string; time?: number; selectedId?: string;
  onChoose?: (chapter: DisplayChapter) => void;
  subsections?: { shown: boolean; toggle: () => void }; listId?: string;
}) {
  const ownListId = useId(), listId = controlledListId ?? ownListId;
  const list = useRef<HTMLOListElement>(null);
  const [ownShown, setOwnShown] = useState(false);
  const showSubsections = subsections ? subsections.shown : ownShown;
  const toggleSubsections = subsections ? subsections.toggle : () => setOwnShown((shown) => !shown);
  // Opening a subsection directly (search result or link) reveals subsections so it can be highlighted.
  useEffect(() => { if (!subsections && service.chapters.some((chapter) => chapter.id === selectedId && chapter.parentId)) setOwnShown(true); }, [selectedId, service, subsections]);
  const primaries = service.chapters.filter((chapter) => !chapter.parentId);
  const cuesOf = (chapter: DisplayChapter) => service.chapters.filter((cue) => cue.parentId === chapter.id);
  const hasSubsections = service.chapters.some((chapter) => chapter.parentId);
  const playing = (chapter: DisplayChapter) => chapter.videoId === videoId && time >= chapter.start && time < chapter.end;
  const currentId = showSubsections && service.chapters.find((chapter) => chapter.parentId && playing(chapter))?.id
    || primaries.find(playing)?.id;
  // Keep the current chapter visible inside a scrolling panel without scrolling the page.
  useEffect(() => {
    const element = list.current, row = element?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!element || !row || element.scrollHeight <= element.clientHeight) return;
    const top = row.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop, bottom = top + row.offsetHeight;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
  }, [currentId, showSubsections]);
  const entry = (chapter: DisplayChapter, active: boolean) => {
    const sequence = service.videos.length > 1 ? service.videos.find((video) => video.id === chapter.videoId)?.sequence : undefined;
    const content = <><span className="timestamp">{formatTime(chapter.start)}</span><span className="chapter-copy">
      <strong>{chapter.title}</strong>
      {!chapter.parentId && chapter.shortSummary && <span className="chapter-summary">{chapter.shortSummary}</span>}
      {!chapter.parentId && sequence !== undefined && <span className="chapter-video">Video {sequence}</span>}
      {active && <span className="current-chapter sr-only">{chapter.parentId ? 'Current subsection' : 'Current chapter'}</span>}
    </span></>;
    return onChoose
      ? <button className="chapter-row" type="button" aria-current={active ? 'true' : undefined} onClick={() => onChoose(chapter)}>{content}</button>
      : <a className="chapter-row" href={watchUrl(base, { chapter: chapter.id })}>{content}</a>;
  };
  const hours = service.chapters.some((chapter) => chapter.start >= 3600);
  return <div className={`outline${hours ? ' outline-hours' : ''}`}>
    <ol className="outline-list" id={listId} ref={list}>{primaries.map((chapter) => {
      const cues = cuesOf(chapter);
      // One highlight at a time: a visible playing subsection takes it from its parent.
      const activeCue = showSubsections ? cues.find(playing) : undefined;
      return <li className="outline-item" key={chapter.id}>
        <div className="outline-entry">{entry(chapter, playing(chapter) && !activeCue)}</div>
        {cues.length > 0 && <ol className="chapter-subsections" hidden={!showSubsections}>{cues.map((cue) => <li key={cue.id}>
          <div className="outline-entry">{entry(cue, cue === activeCue)}</div>
        </li>)}</ol>}
      </li>;
    })}</ol>
    {hasSubsections && <button className="subsection-toggle" type="button" aria-expanded={showSubsections} aria-controls={listId}
      onClick={toggleSubsections}>{showSubsections ? 'Hide Subsections' : 'Show Subsections'}</button>}
  </div>;
}
