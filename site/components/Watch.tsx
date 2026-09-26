import { useEffect, useRef, useState } from 'react';
import type { DisplayChapter, DisplayService } from './archive-display';
import { displayType, formatDate, formatTime, readWatchTarget, serviceUrl, siteUrl, watchUrl, youtubeUrl, type WatchTarget } from '../lib/urls';
import { resolveLegacyChapter } from '../lib/chapter-index';
import Chapters from './Chapters';
import YouTubePlayer from './YouTubePlayer';
import CopyLink from './CopyLink';
import Icon from './Icon';
import ScriptureLinks from './ScriptureLinks';
import CorrectionLinks from './CorrectionLinks';

interface Selection { service: DisplayService; video: DisplayService['videos'][number]; chapter?: DisplayChapter; start: number }
export function resolveSelection(services: DisplayService[], target: WatchTarget): Selection | null {
  if (target.chapter) {
    const service = services.find((item) => item.chapters.some((chapter) => chapter.id === target.chapter));
    const chapter = service?.chapters.find((item) => item.id === target.chapter);
    const video = service?.videos.find((item) => item.id === chapter?.videoId);
    return service && chapter && video ? { service, chapter, video, start: chapter.start } : null;
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
        setSelection(next); setTime(next?.start ?? 0); setReady(true);
        if (next) {
          document.title = `${next.chapter?.title ?? next.service.title} | RECS Replay`;
          if (next.chapter) window.history.replaceState({}, '', watchUrl(base, { chapter: next.chapter.id }));
        }
      } catch {
        if (generation.current === version) { setSelection(null); setReady(true); setLinkError(true); }
      }
    };
    void sync();
    window.addEventListener('popstate', sync);
    return () => { generation.current++; abort?.abort(); window.removeEventListener('popstate', sync); };
  }, [services, base, attempt]);

  function choose(chapter: DisplayChapter) {
    generation.current++;
    const next = resolveSelection(services, { chapter: chapter.id });
    if (!next) return;
    window.history.pushState({}, '', watchUrl(base, { chapter: chapter.id }));
    setSelection(next); setTime(next.start); setReady(true); setLinkError(false);
    document.title = `${chapter.title} | RECS Replay`;
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
  const title = chapter?.title ?? service.title;
  const range = { id: chapter?.id ?? `${video.id}:${start}`, start: chapter?.start ?? start, end: chapter?.end, resumeAt: start };
  const shareUrl = chapter ? watchUrl(base, { chapter: chapter.id }) : watchUrl(base, { service: service.id, video: video.id });
  const references = chapter?.scripture ?? [...new Set(service.chapters.filter((item) => item.videoId === video.id).flatMap((item) => item.scripture))];
  const displayReferences = chapter?.scriptureDisplay ?? references.map((reference) => {
    const source = service.chapters.find((item) => item.videoId === video.id && item.scripture.includes(reference));
    return source?.scriptureDisplay?.[source.scripture.indexOf(reference)] ?? reference;
  });
  return <main id="main" className="watch-main" tabIndex={-1}>
    <div className="playback-layout">
      <a className="icon-button back-button playback-back" href={serviceUrl(base, service.id)} aria-label="Back to service"><Icon name="back" /></a>
      <YouTubePlayer key={video.id} videoId={video.id} serviceId={service.id} title={title} range={range} onTime={setTime} />
      <section className="playback-details" aria-labelledby="recording-title">
        <h1 id="recording-title">{title}</h1>
        {chapter?.parentId && <p className="metadata">Part of <a href={watchUrl(base, { chapter: chapter.parentId })}>{chapter.parentTitle}</a></p>}
        {service.sermonDescription && <p className="sermon-description">{service.sermonDescription}</p>}
        <p className="metadata">{displayType(chapter?.type ?? service.type)}{references.length > 0 && <> | <ScriptureLinks references={references.slice(0, 2)} displayReferences={displayReferences.slice(0, 2)} /></>} | {formatTime(chapter ? chapter.end - chapter.start : video.duration)}</p>
        {references.length > 2 && <details className="additional-references"><summary>All {references.length} Scripture References</summary><ScriptureLinks references={references} displayReferences={displayReferences} /></details>}
        <p className="metadata"><time dateTime={service.date}>{formatDate(service.date)}</time>{chapter?.speaker && <> · {chapter.speaker}</>}{service.videos.length > 1 && <> · Recording {service.videos.findIndex((item) => item.id === video.id) + 1} of {service.videos.length}</>}</p>
        {service.preview && <p className="preview-label">Unreviewed preview</p>}
        <div className="action-row"><a className="text-link" href={serviceUrl(base, service.id)}>View full service</a><a className="text-link" href={youtubeUrl(video.id, chapter?.start ?? start)}>Watch on YouTube</a><CopyLink href={shareUrl} /><CorrectionLinks target={chapter ? { chapterId: chapter.id } : { serviceId: service.id, videoId: video.id }} base={base} /></div>
      </section>
       <Chapters service={service} videoId={video.id} time={time} onChoose={choose} base={base} />
    </div>
  </main>;
}
