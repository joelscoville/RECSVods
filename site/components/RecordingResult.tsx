import type { HomeItem, RecordingMatch } from './archive-display';
import type { SearchChapter } from '../lib/types';
import { formatDate, formatTime } from '../lib/urls';
import { parseScriptureReference, scriptureOverlaps } from '../lib/scripture';
import ScriptureLinks from './ScriptureLinks';
import { VideoArt } from './VideoCard';

/** One search result per recording. It opens the sermon; the chapter that matched is named here (with its
 * scripture and why it matched) and offered as "Chapter only" under the player. */
/** A chapter's references with those overlapping the searched reference first, so a result found by
 * "Psalms 1" shows Psalms 1:1-6 rather than whichever references the chapter happens to list first. */
export function referencesFor(chapter: Pick<SearchChapter, 'scripture' | 'scriptureDisplay'>, query?: string) {
  const searched = query ? parseScriptureReference(query) : undefined;
  const matches = (value: string) => { const parsed = searched && parseScriptureReference(value); return Boolean(parsed && scriptureOverlaps(searched!, parsed)); };
  const order = chapter.scripture.map((_, index) => index).sort((a, b) => Number(matches(chapter.scripture[b])) - Number(matches(chapter.scripture[a])));
  return { references: order.map((index) => chapter.scripture[index]), displayReferences: order.map((index) => chapter.scriptureDisplay?.[index] ?? chapter.scripture[index]) };
}

export default function RecordingResult({ recording, chapter, reasons, query }: {
  recording: HomeItem & { match: RecordingMatch }; chapter: SearchChapter; reasons?: string[]; query?: string;
}) {
  const primaryReason = reasons?.find(reason => reason.startsWith('Scripture:') || reason === 'Verse-text match (BSB)')
    ?? reasons?.find(reason => reason === 'Keyword') ?? reasons?.[0];
  const conciseReasons = [...new Set([primaryReason, reasons?.includes('Similar in meaning') ? 'Similar in meaning' : undefined].filter(Boolean))];
  const { match } = recording;
  const { references, displayReferences } = referencesFor(chapter, query);
  return <article className="recording-result" data-match={match.id} data-service={recording.serviceId}>
    <a className="result-art" href={recording.href} tabIndex={-1} aria-hidden="true"><VideoArt item={recording} /></a>
    <div className="result-head">
      <h2><a href={recording.href}>{recording.title}</a></h2>
      <p className="metadata"><time dateTime={recording.date}>{formatDate(recording.date)}</time>{recording.speaker && <> · {recording.speaker}</>}</p>
      {recording.preview && <p className="preview-label">Unreviewed preview</p>}
    </div>
    <div className="result-match">
      <p className="matched-chapter"><span className="timestamp">{formatTime(match.start)}</span><span><strong>{match.title}</strong>
        {match.parentTitle && <> in {match.parentTitle}</>}
        {match.more > 0 && <span className="matched-more"> · +{match.more} more matching {match.more === 1 ? 'chapter' : 'chapters'}</span>}</span></p>
      {references.length > 0 && <p className="scripture"><ScriptureLinks references={references.slice(0, 2)} displayReferences={displayReferences.slice(0, 2)} />{references.length > 2 && <span> · +{references.length - 2} references</span>}</p>}
      {conciseReasons.length > 0 && <p className="match-reasons"><strong>Matched:</strong> {conciseReasons.join(' · ')}</p>}
    </div>
  </article>;
}
