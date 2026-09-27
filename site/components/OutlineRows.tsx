import type { DisplayChapter, DisplayService } from './archive-display';
import { formatTime, watchUrl } from '../lib/urls';
import CorrectionLinks from './CorrectionLinks';
import { useId, useState } from 'react';
import Icon from './Icon';

/** The same compact peer outline on service and watch pages. Synopses never enter this component. */
export default function OutlineRows({ service, base, videoId, time = -1, onChoose }: {
  service: DisplayService; base: string; videoId?: string; time?: number;
  onChoose?: (chapter: DisplayChapter) => void;
}) {
  const prefix = useId();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const entry = (chapter: DisplayChapter) => {
    const active = chapter.videoId === videoId && time >= chapter.start && time < chapter.end;
    const content = <><span className="timestamp">{formatTime(chapter.start)}</span><span className="chapter-copy">
      <strong>{chapter.title}</strong>{!chapter.parentId && <span>{formatTime(chapter.end - chapter.start)}{service.videos.length > 1 && ` · Video ${service.videos.find(video => video.id === chapter.videoId)?.sequence}`}</span>}
      {active && <span className="current-chapter">{chapter.parentId ? 'Current subsection' : 'Current chapter'}</span>}
    </span></>;
    return onChoose
      ? <button className="chapter-row" type="button" aria-current={active ? 'true' : undefined} onClick={() => onChoose(chapter)}>{content}</button>
      : <a className="chapter-row" href={watchUrl(base, { chapter: chapter.id })}>{content}</a>;
  };
  return <ol className="outline-list">{service.chapters.filter(chapter => !chapter.parentId).map(chapter => {
    const cues = service.chapters.filter(cue => cue.parentId === chapter.id);
    const expanded = Boolean(expandedGroups[chapter.id]);
    const subtreeId = `${prefix}-${chapter.id}-subsections`;
    return <li className="outline-item" key={chapter.id}><div className="outline-node">
      <div className="outline-node-header">{entry(chapter)}{cues.length > 0 && <button className="outline-toggle" type="button"
        aria-expanded={expanded} aria-controls={subtreeId} aria-label={`${expanded ? 'Hide' : 'Show'} ${cues.length} ${cues.length === 1 ? 'subsection' : 'subsections'} in ${chapter.title}`}
        onClick={() => setExpandedGroups(current => ({ ...current, [chapter.id]: !expanded }))}>
        <span aria-hidden="true">{cues.length}</span><Icon name="chevron" />
      </button>}</div>
      {cues.length > 0 && <ol id={subtreeId} className="chapter-subsections" hidden={!expanded}>
        {cues.map(cue => <li key={cue.id}>{entry(cue)}{!onChoose && <CorrectionLinks target={{ chapterId: cue.id }} base={base} />}</li>)}
      </ol>}
    </div>{!onChoose && <CorrectionLinks target={{ chapterId: chapter.id }} base={base} />}</li>;
  })}</ol>;
}
