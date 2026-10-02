import { useEffect, useId, useRef, useState } from 'react';
import type { DisplayEntry, DisplayRecording } from './archive-display';
import { sermonOf } from '../lib/display';
import { formatDate, formatDuration, readWatchTarget, serviceUrl, siteUrl, watchUrl, type WatchTarget } from '../lib/urls';
import Chapters from './Chapters';
import YouTubePlayer, { youtubeAt, type PlaybackChoice } from './YouTubePlayer';
import CopyLink from './CopyLink';
import Icon from './Icon';
import { ScriptureLine } from './ScriptureLinks';
import CorrectionLinks from './CorrectionLinks';
import VideoQuirks from './VideoQuirks';

/** A named chapter or subchapter, never a key-point range. */
interface Selection { recording: DisplayRecording; start: number; focus?: DisplayEntry }
/** Where playback softly stops: the end of the sermon, the end of the focused point or part, or nowhere. */
type Stop = 'none' | 'sermon' | 'focus';

export function resolveSelection(recordings: readonly DisplayRecording[], target: WatchTarget): Selection | null {
  const recording = recordings.find((item) => item.id === target.recording);
  if (!recording) return null;
  const focus = target.focus ? recording.entries.find((entry) => entry.id === target.focus) : undefined;
  // Without a time, a recording opens at its sermon. Links carry whole seconds, so a focused point or part
  // opens exactly at its start rather than a fraction before it (in the entry before).
  const requested = focus && (target.start === undefined || Math.abs(target.start - focus.start) < 1) ? focus.start
    : target.start ?? 0;
  return { recording, start: Math.min(Math.max(0, requested), Math.max(0, recording.length - 1)), ...(focus ? { focus } : {}) };
}

/** `servicePages` is false where the recording pages do not exist (the developer view of drafts). */
export default function Watch({ recordings, base, servicePages = true, homeHref }: { recordings: DisplayRecording[]; base: string; servicePages?: boolean; homeHref?: string }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(0);
  const [seekRequest, setSeekRequest] = useState(0);
  // One key-point state drives both the panel toggle (desktop) and the footer toggle (phones).
  const [showSubsections, setShowSubsections] = useState(false);
  const [stop, setStop] = useState<Stop>('none');
  const [resumeAt, setResumeAt] = useState<number>();
  const [offer, setOffer] = useState(false);
  const outlineId = useId();
  const generation = useRef(0);
  useEffect(() => {
    const sync = () => {
      ++generation.current;
      const next = resolveSelection(recordings, readWatchTarget(window.location.search));
      setSelection(next); setTime(next?.start ?? 0); setSeekRequest(value => value + 1); setReady(true);
      setStop('none'); setResumeAt(undefined); setOffer(Boolean(next));
      if (next?.focus?.parentId) setShowSubsections(true);
      if (next) document.title = `${next.recording.title} | RECS Replay`;
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => { generation.current++; window.removeEventListener('popstate', sync); };
  }, [recordings, base]);

  function go(next: Selection, nextStop: Stop) {
    generation.current++;
    const url = watchUrl(base, { recording: next.recording.id, start: next.start, focus: next.focus?.id });
    if (window.location.pathname + window.location.search !== url) window.history.pushState({}, '', url);
    setSeekRequest(value => value + 1);
    setSelection(next); setTime(next.start); setReady(true);
    setStop(nextStop); setResumeAt(undefined); setOffer(true);
  }
  function choose(entry: DisplayEntry, nextStop: Stop = 'none') {
    if (!selection) return;
    go({ recording: selection.recording, start: entry.start, focus: entry }, nextStop);
  }

  if (!selection) return <main id="main" className="page-width empty-archive" tabIndex={-1}>
    <a className="text-link" href={homeHref ?? siteUrl(base)}><Icon name="back" />Back to home</a>
    <h1>{!ready ? 'Watch a recording' : recordings.length ? 'Recording not found' : 'No published recordings yet'}</h1>
    <p role="status">{!ready ? 'Loading the selected recording…' : recordings.length ? 'This link does not match a published recording. Browse the archive to find one.' : 'Recordings will be available here once they are ready to publish.'}</p>
    {recordings.length > 0 && <ul className="plain-service-list">{recordings.map((recording) => <li key={recording.id}><a href={servicePages ? serviceUrl(base, recording.id) : watchUrl(base, { recording: recording.id })}>{recording.title} · {formatDate(recording.date)}</a></li>)}</ul>}
    <noscript><p>Playback needs JavaScript. Open a recording page for its direct YouTube links.</p></noscript>
  </main>;

  const { recording, start, focus } = selection;
  const sermon = sermonOf(recording);
  const range = {
    id: `${recording.id}:${start}:${stop}`,
    start: stop === 'focus' && focus ? focus.start : stop === 'sermon' && sermon ? sermon.start : start,
    end: stop === 'focus' && focus ? focus.end : stop === 'sermon' && sermon ? sermon.end : undefined,
    // Changing only the stop keeps the playback position, so the player does not jump back.
    resumeAt: resumeAt ?? start,
  };
  const endLabel = stop === 'sermon' ? 'the end of the sermon' : `the end of “${focus?.title ?? 'this part'}”`;
  const inSermon = sermon && time >= sermon.start && time < sermon.end;
  const choices: PlaybackChoice[] = !offer ? [] : [
    ...(start > 1 || stop !== 'none' ? [{ label: 'Full service instead', onChoose: () => go({ recording, start: 0 }, 'none') }] : []),
    ...(focus && (focus.parentId || focus.type !== 'sermon') && stop !== 'focus' ? [{ label: 'Chapter only', onChoose: () => choose(focus, 'focus') }]
      : sermon && stop !== 'sermon' ? [{ label: 'Sermon only', onChoose: () => { if (inSermon) { setResumeAt(time); setStop('sermon'); } else choose(sermon, 'sermon'); } }] : []),
  ];
  // YouTube links cannot enforce a soft stop: offer navigation instead.
  const externalChoices: PlaybackChoice[] = [
    ...(focus ? [{ label: `Go to “${focus.title}”`, onChoose: () => choose(focus, 'focus') }] : []),
    ...(start > 1 ? [{ label: 'Start full service', onChoose: () => go({ recording, start: 0 }, 'none') }] : []),
  ];
  const shareUrl = watchUrl(base, { recording: recording.id, start, focus: focus?.id });
  const quirks = [...new Map(recording.uploads.flatMap((upload) => upload.quirks ?? []).map((flag) => [flag.kind, flag])).values()];
  return <main id="main" className="watch-main" tabIndex={-1}>
    <div className="playback-layout">
      <YouTubePlayer key={recording.id} uploads={recording.uploads} recordingId={recording.id} title={recording.title} range={range} seekRequest={seekRequest} onTime={setTime} endLabel={endLabel} choices={choices} externalChoices={externalChoices} />
      <section className="playback-details" aria-labelledby="recording-title">
        <div className="playback-identity">
          <h1 id="recording-title">{recording.title}</h1>
          <p className="metadata"><time dateTime={recording.date}>{formatDate(recording.date)}</time>{recording.speaker && <> · {recording.speaker}</>}</p>
          <p className="metadata">{sermon ? 'Service' : 'Recording'} · <span className="nowrap"><span className="meta-label">Duration</span> {formatDuration(recording.length)}</span></p>
          {recording.preview && <p className="preview-label">Unreviewed preview</p>}
        </div>
        {recording.scripture.length > 0 && <ScriptureLine references={recording.scripture} displayReferences={recording.scriptureDisplay} />}
        {recording.description && <SermonDescription text={recording.description} />}
        <VideoQuirks quirks={quirks} />
      </section>
      <Chapters recording={recording} time={time} onChoose={(entry) => choose(entry)} base={base} selectedId={focus?.id} subsections={{ shown: showSubsections, toggle: () => setShowSubsections((shown) => !shown) }} listId={outlineId} />
      {/* After the chapters on mobile; placed beneath the details on desktop. */}
      <div className="playback-footer" role="group" aria-label="Recording actions">
        <div className="playback-actions">
          <div className="action-row">{recording.entries.some((entry) => entry.parentId) && <button type="button" className="button button-secondary subsection-button" aria-expanded={showSubsections} aria-controls={outlineId} onClick={() => setShowSubsections((shown) => !shown)}>{showSubsections ? 'Hide Subchapters' : 'Show Subchapters'}</button>}{servicePages && <a className="button button-secondary" href={serviceUrl(base, recording.id)}>View full service</a>}<a className="button" href={youtubeAt(recording.uploads, time)}>Watch on YouTube</a><CopyLink href={shareUrl} /></div>
          {servicePages && <div className="action-row correction-row"><CorrectionLinks recordingId={recording.id} start={time} base={base} /></div>}
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
