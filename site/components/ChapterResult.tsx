import type { SearchChapter } from '../lib/types';
import { displayType, formatDate, formatTime, serviceUrl, watchUrl } from '../lib/urls';
import Icon from './Icon';
import ScriptureLinks from './ScriptureLinks';
import CorrectionLinks from './CorrectionLinks';

export default function ChapterResult({ chapter, reasons, base }: { chapter: SearchChapter; reasons?: string[]; base: string }) {
  const primaryReason = reasons?.find(reason => reason.startsWith('Scripture:') || reason === 'Verse-text match (BSB)')
    ?? reasons?.find(reason => reason === 'Keyword') ?? reasons?.[0];
  const conciseReasons = [...new Set([primaryReason, reasons?.includes('Similar in meaning') ? 'Similar in meaning' : undefined].filter(Boolean))];
  return <article className="chapter-result">
    <div className="chapter-time"><span>{formatTime(chapter.start)}–{formatTime(chapter.end)}</span><span>{formatTime(chapter.end - chapter.start)}</span></div>
    <div className="chapter-result-body">
      <h2><a href={watchUrl(base, { chapter: chapter.id })}>{chapter.title}</a></h2>
      <p className="metadata"><time dateTime={chapter.date}>{formatDate(chapter.date)}</time> · {displayType(chapter.type)}{chapter.speaker && <> · {chapter.speaker}</>}</p>
      <p className="service-context">{chapter.serviceTitle}</p>
      {chapter.parentId && <p className="parent-context">In <a href={watchUrl(base, { chapter: chapter.parentId })}>{chapter.parentTitle}</a></p>}
      {chapter.scripture.length > 0 && <p className="scripture"><ScriptureLinks references={chapter.scripture.slice(0, 2)} displayReferences={chapter.scriptureDisplay?.slice(0, 2)} />{chapter.scripture.length > 2 && <span> · +{chapter.scripture.length - 2} references</span>}</p>}
      {chapter.preview && <p className="preview-label">Unreviewed preview</p>}
      {conciseReasons.length > 0 && <p className="match-reasons"><strong>Matched:</strong> {conciseReasons.join(' · ')}</p>}
      <div className="action-row"><a className="button" href={watchUrl(base, { chapter: chapter.id })}><Icon name="play" />Play chapter</a><a className="text-link" href={serviceUrl(base, chapter.serviceId)}>{chapter.type === 'sermon' ? 'View full sermon' : 'View full service'}</a><CorrectionLinks target={{ chapterId: chapter.id }} base={base} /></div>
    </div>
  </article>;
}
