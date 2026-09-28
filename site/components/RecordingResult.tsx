import type { HomeItem, RecordingMatch } from './archive-display';
import type { SearchChapter } from '../lib/types';
import { formatDate, formatTime } from '../lib/urls';
import { parseScriptureReference, scriptureOverlaps } from '../lib/scripture';
import ScriptureLinks from './ScriptureLinks';
import { VideoArt } from './VideoCard';
import type { BestVerse } from '../lib/verse-selection';

/** One search result per recording. It opens the sermon; the chapter that matched is named here (with its
 * scripture and why it matched) and offered as "Chapter only" under the player. */
/** A chapter's references in the order a search result shows them. A searched reference comes first
 * ("Psalms 1" shows Psalms 1:1-6, not whichever reference the chapter lists first). Otherwise the passage
 * holding the verse the search's words best match comes first, narrowed to that verse, so "living
 * sacrifice" leads with Romans 12:1 rather than Romans 12:1-8 or an unrelated psalm. */
export function referencesFor(chapter: Pick<SearchChapter, 'scripture' | 'scriptureDisplay'>, query?: string, bestVerse?: BestVerse) {
  const searched = query ? parseScriptureReference(query) : undefined;
  const overlaps = (value: string) => { const parsed = searched && parseScriptureReference(value); return Boolean(parsed && scriptureOverlaps(searched!, parsed)); };
  const ranked = chapter.scripture.map((value, index) => ({ index, value, overlap: overlaps(value), best: searched ? undefined : bestVerse?.(value) }))
    .sort((a, b) => Number(b.overlap) - Number(a.overlap) || (b.best?.score ?? 0) - (a.best?.score ?? 0) || a.index - b.index);
  const shown = ranked.map(({ index, value, best }, position) => position === 0 && best && best.score > 0 && best.verse !== value
    ? { reference: best.verse, display: best.verse }
    : { reference: value, display: chapter.scriptureDisplay?.[index] ?? value });
  // Narrowing a passage to one verse can repeat a verse the chapter also cites on its own.
  const unique = shown.filter((item, position) => shown.findIndex((other) => other.reference === item.reference) === position);
  return { references: unique.map((item) => item.reference), displayReferences: unique.map((item) => item.display) };
}

export default function RecordingResult({ recording, chapter, reasons, query, bestVerse }: {
  recording: HomeItem & { match: RecordingMatch }; chapter: SearchChapter; reasons?: string[]; query?: string; bestVerse?: BestVerse;
}) {
  const primaryReason = reasons?.find(reason => reason.startsWith('Scripture:') || reason === 'Verse-text match (BSB)')
    ?? reasons?.find(reason => reason === 'Keyword') ?? reasons?.[0];
  const conciseReasons = [...new Set([primaryReason, reasons?.includes('Similar in meaning') ? 'Similar in meaning' : undefined].filter(Boolean))];
  const { match } = recording;
  const { references, displayReferences } = referencesFor(chapter, query, bestVerse);
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
