import type { HomeItem, RecordingMatch } from './archive-display';
import type { SearchChapter } from '../lib/types';
import { formatDate, formatTime } from '../lib/urls';
import ScriptureLinks from './ScriptureLinks';
import { VideoArt } from './VideoCard';
import { QuirkBadges } from './VideoQuirks';

/** One search result per recording. It opens the sermon; the chapter that matched is named here (with its
 * scripture and why it matched) and offered as "Chapter only" under the player. */
export default function RecordingResult({ recording, chapter, reasons }: {
  recording: HomeItem & { match: RecordingMatch }; chapter: SearchChapter; reasons?: string[];
}) {
  const primaryReason = reasons?.find(reason => reason.startsWith('Scripture:') || reason === 'Verse-text match (BSB)')
    ?? reasons?.find(reason => reason === 'Keyword') ?? reasons?.[0];
  const conciseReasons = [...new Set([primaryReason, reasons?.includes('Similar in meaning') ? 'Similar in meaning' : undefined].filter(Boolean))];
  const { match } = recording;
  return <article className="recording-result" data-match={match.id} data-service={recording.serviceId}>
    <a className="result-art" href={recording.href} tabIndex={-1} aria-hidden="true"><VideoArt item={recording} /></a>
    <div className="result-head">
      <h2><a href={recording.href}>{recording.title}</a></h2>
      <p className="metadata"><time dateTime={recording.date}>{formatDate(recording.date)}</time>{recording.speaker && <> · {recording.speaker}</>}</p>
      {recording.preview && <p className="preview-label">Unreviewed preview</p>}
      <QuirkBadges quirks={recording.quirks} multipart={recording.parts.length > 1} />
    </div>
    <div className="result-match">
      <p className="matched-chapter"><span className="timestamp">{formatTime(match.start)}</span><span><strong>{match.title}</strong>
        {match.parentTitle && <> in {match.parentTitle}</>}
        {match.more > 0 && <span className="matched-more"> · +{match.more} more matching {match.more === 1 ? 'chapter' : 'chapters'}</span>}</span></p>
      {chapter.scripture.length > 0 && <p className="scripture"><ScriptureLinks references={chapter.scripture.slice(0, 2)} displayReferences={chapter.scriptureDisplay?.slice(0, 2)} />{chapter.scripture.length > 2 && <span> · +{chapter.scripture.length - 2} references</span>}</p>}
      {conciseReasons.length > 0 && <p className="match-reasons"><strong>Matched:</strong> {conciseReasons.join(' · ')}</p>}
    </div>
  </article>;
}
