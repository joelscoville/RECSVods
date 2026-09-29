import type { HomeItem } from './archive-display';
import { formatDate, formatTime } from '../lib/urls';
import { thumbnailPattern } from '../lib/thumbnail';
import { usePerformanceMode } from '../lib/use-performance-mode';
import { QuirkBadges } from './VideoQuirks';

/** Decorative procedural thumbnail; the same title and date are repeated as real text beside it. */
export function VideoArt({ item, progress }: { item: HomeItem; progress?: number }) {
  const mode = usePerformanceMode();
  return <div className="video-art" aria-hidden="true">
    {mode.compute === 'normal' && mode.data === 'normal' && <svg className="thumb-pattern" viewBox="0 0 352 610" preserveAspectRatio="xMidYMid slice" shapeRendering="crispEdges" dangerouslySetInnerHTML={{ __html: thumbnailPattern(item.id) }} />}
    {/* A resumable card shows its resume point in place of the thumbnail date (the date is repeated
        below), so the saved state, known only after hydration, never changes the card's height. */}
    <span className="thumb-text"><span className="thumb-title">{item.title}</span><span className="thumb-date">{progress !== undefined ? `Resume at ${formatTime(progress)}` : formatDate(item.date)}</span></span>
    {progress !== undefined && <span className="resume-track"><span style={{ width: `${Math.min(100, Math.max(0, progress / item.duration * 100))}%` }} /></span>}
  </div>;
}

export default function VideoCard({ item, progress }: { item: HomeItem; progress?: number }) {
  // A matched recording names the chapter that placed it here; the watch page offers it under the player.
  const chapter = item.match && item.match.id !== item.sermonId ? item.match : undefined;
  return <article className="video-card">
    <a className="video-card-link" href={item.href}>
      <VideoArt item={item} progress={progress} />
      <div className="card-text">
        <h2>{item.title}</h2>
        <p className="card-metadata"><time dateTime={item.date}>{formatDate(item.date)}</time>{item.speaker && <> · {item.speaker}</>}{progress !== undefined && <span className="sr-only"> · Resume at {formatTime(progress)}</span>}</p>
        {/* No type line: only useful context (the service a chapter belongs to, or the chapter that matched). */}
        {item.context && <p className="card-context">{item.context}</p>}
        {chapter && <p className="card-context">Chapter: {chapter.title}</p>}
        {item.preview && <span className="preview-label">Unreviewed preview</span>}
        <QuirkBadges quirks={item.quirks} multipart={item.parts.length > 1} />
      </div>
    </a>
  </article>;
}
