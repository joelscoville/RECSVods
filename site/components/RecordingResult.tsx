import type { HomeItem, RecordingMatch } from './archive-display';
import type { SearchChapter } from '../lib/types';
import { formatDate, formatTime } from '../lib/urls';
import { parseScriptureReference, scriptureOverlaps } from '../lib/scripture';
import ScriptureLinks from './ScriptureLinks';
import { VideoArt } from './VideoCard';
import { QuirkBadges } from './VideoQuirks';
import type { BestVerseSelector } from '../lib/verse-selection';

interface ShownReference { reference: string; display: string }

/** Selects and orders the references a search result shows for a chapter:
 * 1. Order: a reference overlapping the searched reference comes first ("Psalms 1" shows Psalms 1:1-6);
 *    otherwise the passage holding the best-matching verse comes first; ties keep the chapter's order.
 * 2. Narrow: that leading passage is narrowed to its best verse ("living sacrifice" shows Romans 12:1,
 *    not Romans 12:1-8).
 * 3. Deduplicate: a narrowed verse the chapter also cites on its own is listed once. */
export function selectResultReferences(chapter: Pick<SearchChapter, 'scripture' | 'scriptureDisplay'>, query?: string, findBestVerse?: BestVerseSelector) {
  const searched = query ? parseScriptureReference(query) : undefined;
  const overlapsSearch = (value: string) => {
    const parsed = searched && parseScriptureReference(value);
    return Boolean(parsed && scriptureOverlaps(searched!, parsed));
  };
  const candidates = chapter.scripture.map((value, index) => ({
    index, value, overlapsSearch: overlapsSearch(value),
    // A searched reference decides the order by itself; verse wording only matters without one.
    bestVerse: searched ? undefined : findBestVerse?.(value),
  }));
  const ordered = [...candidates].sort((a, b) => Number(b.overlapsSearch) - Number(a.overlapsSearch)
    || (b.bestVerse?.score ?? 0) - (a.bestVerse?.score ?? 0)
    || a.index - b.index);
  const shown: ShownReference[] = ordered.map(({ index, value, bestVerse }, position) => {
    const narrowToVerse = position === 0 && bestVerse !== undefined && bestVerse.score > 0 && bestVerse.reference !== value;
    return narrowToVerse
      ? { reference: bestVerse.reference, display: bestVerse.reference }
      : { reference: value, display: chapter.scriptureDisplay?.[index] ?? value };
  });
  const unique = shown.filter((item, position) => shown.findIndex((other) => other.reference === item.reference) === position);
  return { references: unique.map((item) => item.reference), displayReferences: unique.map((item) => item.display) };
}

/** One search result per recording. It opens the sermon; the chapter that matched is named here (with its
 * scripture and why it matched) and offered as "Chapter only" under the player. */
export default function RecordingResult({ recording, chapter, reasons, query, findBestVerse }: {
  recording: HomeItem & { match: RecordingMatch }; chapter: SearchChapter; reasons?: string[]; query?: string; findBestVerse?: BestVerseSelector;
}) {
  const primaryReason = reasons?.find(reason => reason.startsWith('Scripture:') || reason === 'Verse-text match (BSB)')
    ?? reasons?.find(reason => reason === 'Keyword') ?? reasons?.[0];
  const conciseReasons = [...new Set([primaryReason, reasons?.includes('Similar in meaning') ? 'Similar in meaning' : undefined].filter(Boolean))];
  const { match } = recording;
  const { references, displayReferences } = selectResultReferences(chapter, query, findBestVerse);
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
      {references.length > 0 && <p className="scripture"><ScriptureLinks references={references.slice(0, 2)} displayReferences={displayReferences.slice(0, 2)} />{references.length > 2 && <span> · +{references.length - 2} references</span>}</p>}
      {conciseReasons.length > 0 && <p className="match-reasons"><strong>Matched:</strong> {conciseReasons.join(' · ')}</p>}
    </div>
  </article>;
}
