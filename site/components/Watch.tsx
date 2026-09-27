import { useEffect, useId, useRef, useState } from 'react';
import type { DisplayChapter, DisplayService } from './archive-display';
import { displayType, formatDate, formatDuration, readWatchTarget, serviceUrl, siteUrl, watchUrl, youtubeUrl, type WatchTarget } from '../lib/urls';
import { resolveLegacyChapter } from '../lib/chapter-index';
import Chapters from './Chapters';
import YouTubePlayer, { type PlaybackChoice } from './YouTubePlayer';
import CopyLink from './CopyLink';
import Icon from './Icon';
import { ScriptureLine } from './ScriptureLinks';
import CorrectionLinks from './CorrectionLinks';

/** `match` is the chapter a search or category matched, offered as "Chapter only" while the sermon plays. */
interface Selection { service: DisplayService; video: DisplayService['videos'][number]; chapter?: DisplayChapter; match?: DisplayChapter; start: number }
/** Where playback softly stops: the end of the service (its last chapter, the closing), the end of the
 * whole sermon, the end of the selected chapter, or nowhere. */
type Stop = 'service' | 'sermon' | 'chapter' | 'none';

/** The whole sermon around a chapter: the run of consecutive top-level sermon chapters in its upload.
 * The archive divides a sermon into several chapters, so one sermon chapter is not the sermon. */
export function sermonSpan(service: DisplayService, chapter?: DisplayChapter): { first: DisplayChapter; start: number; end: number } | undefined {
  const top = chapter?.parentId ? service.chapters.find((item) => item.id === chapter.parentId) : chapter;
  if (top?.type !== 'sermon') return undefined;
  const run = service.chapters.filter((item) => item.videoId === top.videoId && !item.parentId).sort((a, b) => a.start - b.start);
  let first = run.findIndex((item) => item.id === top.id), last = first;
  while (first > 0 && run[first - 1].type === 'sermon') first--;
  while (last < run.length - 1 && run[last + 1].type === 'sermon') last++;
  return { first: run[first], start: run[first].start, end: run[last].end };
}
export function resolveSelection(services: DisplayService[], target: WatchTarget): Selection | null {
  if (target.chapter) {
    const service = services.find((item) => item.chapters.some((chapter) => chapter.id === target.chapter));
    const chapter = service?.chapters.find((item) => item.id === target.chapter);
    const video = service?.videos.find((item) => item.id === chapter?.videoId);
    // The match may sit in another part of a split recording; "Chapter only" then switches part.
    const match = target.match ? service?.chapters.find((item) => item.id === target.match) : undefined;
    return service && chapter && video ? { service, chapter, video, start: chapter.start, ...(match && match.id !== chapter.id ? { match } : {}) } : null;
  }
  if (target.id) return null; // Resolve old IDs asynchronously, never guess from their spelling.
  const service = target.service ? services.find((item) => item.id === target.service) : services.find((item) => item.videos.some((video) => video.id === target.video));
  const video = target.video ? service?.videos.find((item) => item.id === target.video) : service?.videos[0];
  if (!service || !video) return null;
  const requested = Number.isFinite(target.start) ? Math.max(0, target.start!) : 0;
  const start = Math.min(requested, Math.max(0, video.duration - 1));
  // A full-recording/resume URL retains its exact offset and has no soft endpoint.
  // The chapter list still highlights the span containing the playback clock.
  return { service, video, start };
}

export default function Watch({ services, base }: { services: DisplayService[]; base: string }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [time, setTime] = useState(0);
  const [seekRequest, setSeekRequest] = useState(0);
  // One subsection state drives both the panel toggle (desktop) and the footer toggle (phones).
  const [showSubsections, setShowSubsections] = useState(false);
  // A chapter link plays to the end of the service; the choices under the player change that.
  const [stop, setStop] = useState<Stop>('none');
  const [resumeAt, setResumeAt] = useState<number>();
  const [offer, setOffer] = useState(false);
  const outlineId = useId();
  const generation = useRef(0);
  useEffect(() => {
    let abort: AbortController | undefined;
    const sync = async () => {
      const version = ++generation.current;
      abort?.abort(); abort = new AbortController();
      setReady(false); setLinkError(false);
      let target = readWatchTarget(window.location.search);
      try {
        if ((!target.chapter && target.id) || (target.chapter && !resolveSelection(services, target))) {
          setSelection(null);
          const chapter = await resolveLegacyChapter(base, target.chapter ?? target.id!, abort.signal);
          if (generation.current !== version) return;
          target = chapter ? { chapter } : target;
        }
        const next = resolveSelection(services, target);
        if (generation.current !== version) return;
        setSelection(next); setTime(next?.start ?? 0); setSeekRequest(value => value + 1); setReady(true);
        setStop(next?.chapter ? 'service' : 'none'); setResumeAt(undefined); setOffer(Boolean(next?.chapter));
        if (next?.chapter?.parentId) setShowSubsections(true);
        if (next) {
          document.title = `${next.service.title} | RECS Replay`;
          if (next.chapter) window.history.replaceState({}, '', watchUrl(base, { chapter: next.chapter.id, match: next.match?.id }));
        }
      } catch {
        if (generation.current === version) { setSelection(null); setReady(true); setLinkError(true); }
      }
    };
    void sync();
    window.addEventListener('popstate', sync);
    return () => { generation.current++; abort?.abort(); window.removeEventListener('popstate', sync); };
  }, [services, base, attempt]);

  function choose(chapter: DisplayChapter, nextStop: Stop = 'service', match?: DisplayChapter) {
    generation.current++;
    const next = resolveSelection(services, { chapter: chapter.id, match: match?.id });
    if (!next) return;
    const url = watchUrl(base, { chapter: chapter.id, match: next.match?.id });
    if (window.location.pathname + window.location.search !== url) window.history.pushState({}, '', url);
    setSeekRequest(value => value + 1);
    setSelection(next); setTime(next.start); setReady(true); setLinkError(false);
    setStop(nextStop); setResumeAt(undefined); setOffer(true);
    document.title = `${next.service.title} | RECS Replay`;
  }
  function watchFull() {
    if (!selection) return;
    generation.current++;
    // The full service starts at the beginning of its first part, whichever part is playing now.
    const { service, match } = selection, video = service.videos[0];
    window.history.pushState({}, '', watchUrl(base, { service: service.id, video: video.id }));
    setSelection({ service, video, start: 0, ...(match ? { match } : {}) }); setTime(0); setSeekRequest(value => value + 1);
    setStop('service'); setResumeAt(undefined); setOffer(true);
  }

  if (!selection) return <main id="main" className="page-width empty-archive" tabIndex={-1}>
    <a className="text-link" href={siteUrl(base)}><Icon name="back" />Back to home</a>
    <h1>{!ready ? 'Watch a recording' : linkError ? 'Recording link unavailable' : services.length ? 'Recording not found' : 'No published recordings yet'}</h1>
    <p role="status">{!ready ? 'Loading the selected recording…' : linkError ? 'This older link could not be resolved. Check your connection and retry.' : services.length ? 'This link does not match a published chapter or recording. Browse the archive to find one.' : 'Recordings will be available here once they are ready to publish.'}</p>
    {linkError && <button className="button button-secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry recording link</button>}
    {services.length > 0 && <ul className="plain-service-list">{services.map((service) => <li key={service.id}><a href={serviceUrl(base, service.id)}>{service.title} · {formatDate(service.date)}</a></li>)}</ul>}
    <noscript><p>Playback needs JavaScript. Open a service page for its direct YouTube links.</p></noscript>
  </main>;

  const { service, video, chapter, start } = selection;
  // The heading, details and description describe the recording; the chapter shows only in the panel.
  const title = service.title;
  const speaker = service.chapters.find((item) => item.videoId === video.id && item.type === 'sermon' && item.speaker)?.speaker
    ?? service.chapters.find((item) => item.videoId === video.id && item.speaker)?.speaker;
  // The service ends with its last chapter (the closing); anything recorded after it is not the service.
  // A livestream split into parts ends in its last part, so earlier parts play through to their end.
  const lastPart = service.videos[service.videos.length - 1];
  const primaries = service.chapters.filter((item) => item.videoId === video.id && !item.parentId);
  const serviceEnd = video.id === lastPart?.id && primaries.length ? Math.max(...primaries.map((item) => item.end)) : undefined;
  const rangeStart = chapter?.start ?? start;
  const sermon = sermonSpan(service, chapter);
  const end = stop === 'chapter' && chapter ? chapter.end
    : stop === 'sermon' && sermon ? sermon.end
    : stop === 'service' && serviceEnd !== undefined && serviceEnd < video.duration - 1 && serviceEnd > rangeStart ? serviceEnd : undefined;
  // Changing only the stop keeps the playback position (resumeAt), so the player does not jump back.
  const range = { id: `${chapter?.id ?? `${video.id}:${start}`}:${stop}`, start: rangeStart, end, resumeAt: resumeAt ?? start };
  const endLabel = stop === 'sermon' ? 'the end of the sermon' : stop === 'chapter' ? 'the end of this chapter' : 'the end of the service';
  // A matched chapter is offered as "Chapter only". Otherwise the sermon being watched is offered as
  // "Sermon only" (all of its chapters), any other chapter as "Chapter only", and the full recording
  // offers the service's sermon.
  const matched = selection.match && selection.match.id !== chapter?.id ? selection.match : undefined;
  const firstSermon = sermonSpan(service, service.chapters.find((item) => item.type === 'sermon' && !item.parentId));
  const only: PlaybackChoice | undefined = matched ? { label: 'Chapter only', onChoose: () => choose(matched, 'chapter', matched) }
    : chapter && sermon ? (stop === 'sermon' ? undefined : { label: 'Sermon only', onChoose: () => { setResumeAt(time); setStop('sermon'); } })
    : chapter ? (stop === 'chapter' ? undefined : { label: 'Chapter only', onChoose: () => { setResumeAt(time); setStop('chapter'); } })
    : firstSermon ? { label: 'Sermon only', onChoose: () => choose(firstSermon.first, 'sermon') }
    : undefined;
  const atServiceStart = !chapter && start <= 1 && video.id === service.videos[0]?.id;
  const choices: PlaybackChoice[] = !offer ? [] : [
    ...(atServiceStart ? [] : [{ label: 'Full service instead', onChoose: watchFull }]),
    ...(only ? [only] : []),
  ];
  const shareUrl = chapter ? watchUrl(base, { chapter: chapter.id }) : watchUrl(base, { service: service.id, video: video.id, start });
  const references = [...new Set(service.chapters.filter((item) => item.videoId === video.id).flatMap((item) => item.scripture))];
  const displayReferences = references.map((reference) => {
    const source = service.chapters.find((item) => item.videoId === video.id && item.scripture.includes(reference));
    return source?.scriptureDisplay?.[source.scripture.indexOf(reference)] ?? reference;
  });
  return <main id="main" className="watch-main" tabIndex={-1}>
    <div className="playback-layout">
      <YouTubePlayer key={video.id} videoId={video.id} serviceId={service.id} title={title} range={range} seekRequest={seekRequest} onTime={setTime} endLabel={endLabel} choices={choices} />
      <section className="playback-details" aria-labelledby="recording-title">
        <div className="playback-identity">
          <h1 id="recording-title">{title}</h1>
          <p className="metadata"><time dateTime={service.date}>{formatDate(service.date)}</time>{speaker && <> · {speaker}</>}{service.videos.length > 1 && <> · Recording {service.videos.findIndex((item) => item.id === video.id) + 1} of {service.videos.length}</>}</p>
          <p className="metadata">{displayType(service.type)} · <span className="nowrap"><span className="meta-label">Duration</span> {formatDuration(video.duration)}</span></p>
          {service.preview && <p className="preview-label">Unreviewed preview</p>}
        </div>
        {references.length > 0 && <ScriptureLine references={references} displayReferences={displayReferences} />}
        {service.sermonDescription && <SermonDescription text={service.sermonDescription} />}
      </section>
      <Chapters service={service} videoId={video.id} time={time} onChoose={choose} base={base} selectedId={chapter?.id} subsections={{ shown: showSubsections, toggle: () => setShowSubsections((shown) => !shown) }} listId={outlineId} />
      {/* After the chapters on mobile; placed beneath the details on desktop. */}
      <div className="playback-footer" role="group" aria-label="Recording actions">
        <div className="playback-actions">
          <div className="action-row">{service.chapters.some((item) => item.parentId) && <button type="button" className="button button-secondary subsection-button" aria-expanded={showSubsections} aria-controls={outlineId} onClick={() => setShowSubsections((shown) => !shown)}>{showSubsections ? 'Hide Subsections' : 'Show Subsections'}</button>}<a className="button button-secondary" href={serviceUrl(base, service.id)}>View full service</a><a className="button" href={youtubeUrl(video.id, chapter?.start ?? start)}>Watch on YouTube</a><CopyLink href={shareUrl} /></div>
          <div className="action-row correction-row"><CorrectionLinks target={chapter ? { chapterId: chapter.id } : { serviceId: service.id, videoId: video.id }} base={base} /></div>
        </div>
      </div>
    </div>
  </main>;
}

/** Full text on desktop; phones show a few lines with Read More so the chapters stay close. */
function SermonDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const paragraph = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const measure = () => { const element = paragraph.current; if (element && !expanded) setClamped(element.scrollHeight > element.clientHeight + 1); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [text, expanded]);
  return <div className="sermon-description" data-expanded={expanded ? 'true' : undefined}>
    <p ref={paragraph}>{text}</p>
    {(clamped || expanded) && <button type="button" className="inline-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show Less' : 'Read More'}</button>}
  </div>;
}
