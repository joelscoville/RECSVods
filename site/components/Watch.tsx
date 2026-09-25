import { useEffect, useState } from 'react';
import type { SearchPassage } from '../lib/types';
import type { DisplayService, DisplaySection } from './archive-display';
import { displayType, formatDate, formatTime, readWatchTarget, serviceUrl, siteUrl, watchUrl, youtubeUrl, type WatchTarget } from '../lib/urls';
import Chapters from './Chapters';
import YouTubePlayer from './YouTubePlayer';
import CopyLink from './CopyLink';
import Icon from './Icon';
import ScriptureLinks from './ScriptureLinks';

interface Selection { service: DisplayService; video: DisplayService['videos'][number]; passage?: SearchPassage; start: number }
function resolveSelection(services: DisplayService[], target: WatchTarget): Selection | null {
  if (target.id) {
    const service = services.find((item) => item.passages.some((passage) => passage.id === target.id));
    const passage = service?.passages.find((item) => item.id === target.id);
    const video = service?.videos.find((item) => item.id === passage?.videoId);
    return service && passage && video ? { service, passage, video, start: passage.start } : null;
  }
  const service = target.service ? services.find((item) => item.id === target.service) : services.find((item) => item.videos.some((video) => video.id === target.video));
  const video = target.video ? service?.videos.find((item) => item.id === target.video) : service?.videos[0];
  return service && video ? { service, video, start: Math.min(target.start ?? 0, Math.max(0, video.duration - 1)) } : null;
}

export default function Watch({ services, base }: { services: DisplayService[]; base: string }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(0);
  useEffect(() => {
    const sync = () => {
      const next = resolveSelection(services, readWatchTarget(window.location.search));
      setSelection(next); setTime(next?.start ?? 0); setReady(true);
      if (next) document.title = `${next.passage?.title ?? next.service.title} | RECS Replay`;
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [services]);

  function choose(target: WatchTarget) {
    const next = resolveSelection(services, target);
    if (!next) return;
    window.history.pushState({}, '', watchUrl(base, target));
    setSelection(next); setTime(next.start);
    document.title = `${next.passage?.title ?? next.service.title} | RECS Replay`;
  }

  if (!selection) return <main id="main" className="page-width empty-archive" tabIndex={-1}>
    <a className="text-link" href={siteUrl(base)}><Icon name="back" />Back to home</a>
    <h1>{!ready ? 'Watch a recording' : services.length ? 'Recording not found' : 'No published recordings yet'}</h1>
    <p>{!ready ? 'Choose a passage or service from the archive.' : services.length ? 'This link does not match a published passage or recording. Browse the archive to find one.' : 'Recordings will be available here once they are ready to publish.'}</p>
    {services.length > 0 && <ul className="plain-service-list">{services.map((service) => <li key={service.id}><a href={serviceUrl(base, service.id)}>{service.title} · {formatDate(service.date)}</a></li>)}</ul>}
    <noscript><p>Playback needs JavaScript. Open a service page for its direct YouTube links.</p></noscript>
  </main>;

  const { service, video, passage, start } = selection;
  const title = passage?.title ?? service.title;
  const range = { id: passage?.id ?? `${video.id}:${start}`, start, end: passage?.end };
  const shareUrl = passage ? watchUrl(base, { id: passage.id }) : watchUrl(base, { service: service.id, video: video.id, start });
  const chooseChapter = (section: DisplaySection) => choose({ service: service.id, video: section.videoId, start: section.start });
  const references = passage?.scripture ?? [...new Set(service.passages.filter((item) => item.videoId === video.id).flatMap((item) => item.scripture))];

  return <main id="main" className="watch-main" tabIndex={-1}>
    <div className="playback-layout">
      <a className="icon-button back-button playback-back" href={serviceUrl(base, service.id)} aria-label="Back to service"><Icon name="back" /></a>
      <YouTubePlayer key={video.id} videoId={video.id} serviceId={service.id} title={title} range={range} onTime={setTime} />
      <section className="playback-details" aria-labelledby="recording-title">
        <h1 id="recording-title">{title}</h1>
        <p className="metadata">{displayType(passage?.type ?? service.type)}{references.length > 0 && <> | <ScriptureLinks references={references} /></>} | {formatTime(passage ? passage.end - passage.start : video.duration)}</p>
        <p className="metadata"><time dateTime={service.date}>{formatDate(service.date)}</time>{passage?.speaker && <> · {passage.speaker}</>}{service.videos.length > 1 && <> · Video {video.sequence} of {service.videos.length}</>}</p>
        {passage && <p className="playback-summary">{passage.summary}</p>}
        {service.preview && <p className="preview-label">Unreviewed preview</p>}
        <div className="action-row"><a className="text-link" href={serviceUrl(base, service.id)}>View full service</a><a className="text-link" href={youtubeUrl(video.id, passage?.start ?? start)}>Watch on YouTube</a><CopyLink href={shareUrl} /></div>
      </section>
      <Chapters service={service} videoId={video.id} time={time} onChoose={chooseChapter} />
    </div>
    {passage && <section className="transcript-panel page-width" aria-labelledby="transcript-title"><h2 id="transcript-title">Passage transcript</h2><p className="transcript-note">{passage.preview ? 'Unreviewed transcription. ' : ''}Bracketed notes identify uncertain wording or omitted readings.</p><p className="transcript-text">{passage.transcript}</p></section>}
    {service.passages.length > 0 && <section className="watch-passages page-width" aria-labelledby="passages-title"><details><summary id="passages-title">Browse all {service.passages.length} passages in this service</summary><p>Play a shorter passage with a pause at its endpoint.</p><ul className="compact-passage-list">{service.passages.map((item) => <li key={item.id}><a href={watchUrl(base, { id: item.id })} aria-current={passage?.id === item.id ? 'true' : undefined} onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); choose({ id: item.id }); document.getElementById('recording-title')?.scrollIntoView({ block: 'center' }); } }}><span>{formatTime(item.start)}–{formatTime(item.end)}</span><strong>{item.title}</strong>{passage?.id === item.id && <span>Selected passage</span>}</a></li>)}</ul></details></section>}
  </main>;
}
