import { useEffect, useRef, useState } from 'react';
import { createChapterController, mountRecordingPlayer, unavailableAt, type UnavailableSpan, type ChapterController, type PlaybackRange, type RecordingAdapter, type RecordingUpload } from '../lib/player';
import UnavailableRecording from './UnavailableRecording';
import { savePlayback } from '../lib/local-state';
import { formatTime, youtubeUrl } from '../lib/urls';

/** A YouTube link to a moment of the recording: the right upload, at the right second. */
export function youtubeAt(uploads: readonly RecordingUpload[], time: number): string {
  const found = uploads.findIndex(upload => time < upload.end), upload = uploads[found === -1 ? uploads.length - 1 : found];
  return youtubeUrl(upload.id, upload.offset + Math.max(0, time - upload.start));
}
import Icon from './Icon';

/** A way to watch the recording differently, offered under the player (e.g. "Chapter only"). */
export interface PlaybackChoice { label: string; onChoose: () => void }
/** The playback choices fade after this long without a click, key press or focus inside them. */
const CHOICES_IDLE_MS = 5000;

/** Plays a whole recording, however many uploads it took, on the recording's own clock. */
export default function YouTubePlayer({ uploads, recordingId, title, range, seekRequest, onTime, onNavigate, endLabel = 'the end of this chapter', choices = [], externalChoices = [] }: {
  uploads: readonly RecordingUpload[]; recordingId: string; title: string; range: PlaybackRange; seekRequest: number; onTime: (time: number) => void;
  onNavigate: (time: number) => void;
  /** Where the soft stop falls, completing "Playback will stop at …". */
  endLabel?: string; choices?: PlaybackChoice[];
  externalChoices?: PlaybackChoice[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const adapter = useRef<RecordingAdapter | null>(null);
  const controller = useRef<ChapterController | null>(null);
  const abort = useRef<AbortController | null>(null);
  const currentRange = useRef(range);
  const timeListener = useRef(onTime);
  const seekSettlesAt = useRef(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<number>();
  const [unavailable, setUnavailable] = useState<UnavailableSpan>();
  const [blocked, setBlocked] = useState(false);
  const [ended, setEnded] = useState(false);
  const [continued, setContinued] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [touched, setTouched] = useState(0);
  const lastTime = useRef<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Phones: landscape shows the player full screen, and fullscreen turns the phone to landscape.
    // Browsers may refuse fullscreen without a tap; the landscape layout still fills the screen.
    const phone = matchMedia('(max-width: 1023px) and (pointer: coarse)');
    const landscape = matchMedia('(orientation: landscape)');
    const orientation = screen.orientation as (ScreenOrientation & { lock?: (type: string) => Promise<void> }) | undefined;
    const rotated = () => {
      if (!phone.matches || !stage.current) return;
      if (landscape.matches) {
        stage.current.closest('.playback-layout')?.scrollIntoView({ block: 'start' });
        if (!document.fullscreenElement) stage.current.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
      } else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
    const fullscreen = () => {
      if (!phone.matches) return;
      if (document.fullscreenElement) orientation?.lock?.('landscape').catch(() => {});
      else orientation?.unlock?.();
    };
    if (phone.matches && landscape.matches) stage.current?.closest('.playback-layout')?.scrollIntoView({ block: 'start' });
    landscape.addEventListener('change', rotated);
    document.addEventListener('fullscreenchange', fullscreen);
    return () => { landscape.removeEventListener('change', rotated); document.removeEventListener('fullscreenchange', fullscreen); };
  }, []);

  useEffect(() => {
    // onReady fires while the host is still visibility:hidden. Hand keyboard
    // focus to the native controls only after React reveals the ready iframe.
    if (status === 'ready') container.current?.querySelector('iframe')?.focus();
  }, [status]);

  useEffect(() => { timeListener.current = onTime; }, [onTime]);
  useEffect(() => {
    currentRange.current = range;
    seekSettlesAt.current = Date.now() + 750;
    controller.current?.setChapter(range);
    setEnded(false);
    setContinued(false);
    setDismissed(false);
    setLeaving(false);
    setBlocked(false);
    lastTime.current = null;
  }, [range.id, range.start, range.end, range.resumeAt, seekRequest]);

  useEffect(() => {
    let lastSavedAt = 0;
    let lastReported = -1;
    const save = () => { if (lastTime.current !== null) savePlayback({ recordingId, time: lastTime.current }); };
    const timer = setInterval(() => {
      const player = adapter.current;
      if (!player || Date.now() < seekSettlesAt.current) return;
      const time = player.getCurrentTime();
      if (!Number.isFinite(time)) return;
      if (Math.floor(time) !== lastReported) { timeListener.current(time); lastReported = Math.floor(time); }
      const playerState = player.getPlayerState();
      if (playerState === 1 || playerState === 0) {
        lastTime.current = time;
        if (playerState === 1) setBlocked(false);
        if (Date.now() - lastSavedAt > 5000) { save(); lastSavedAt = Date.now(); }
      }
      if (controller.current?.tick()) save();
    }, 250);
    window.addEventListener('pagehide', save);
    return () => {
      save();
      clearInterval(timer);
      window.removeEventListener('pagehide', save);
      abort.current?.abort();
      adapter.current = null;
      controller.current = null;
    };
  }, [recordingId]);

  async function play() {
    window.dispatchEvent(new Event('recs-playback-start'));
    if (!container.current) return;
    abort.current?.abort();
    adapter.current?.destroy();
    adapter.current = null;
    controller.current = null;
    const request = new AbortController();
    abort.current = request;
    setStatus('loading');
    setError('');
    setErrorCode(undefined);
    setBlocked(false);
    setEnded(false);
    try {
      const player = await mountRecordingPlayer(container.current, {
        uploads, title, start: currentRange.current.resumeAt ?? currentRange.current.start, signal: request.signal,
        onError(message, code) { if (!request.signal.aborted) { setError(message); setErrorCode(code); setStatus('error'); adapter.current?.pauseVideo(); } },
        onAutoplayBlocked() { if (!request.signal.aborted) setBlocked(true); },
        onLoading() { if (!request.signal.aborted) setStatus('loading'); },
        onAvailability(span) {
          if (request.signal.aborted) return;
          setUnavailable(span); setStatus('ready');
          if (span) { timeListener.current(span.time); lastTime.current = span.time; setBlocked(false); }
        },
      });
      if (request.signal.aborted) return;
      adapter.current = player;
      // Reaching the stop brings the choices back and keeps them until the viewer acts.
      controller.current = createChapterController(player, () => { setEnded(true); setDismissed(false); setLeaving(false); });
      seekSettlesAt.current = Date.now() + 750;
      controller.current.setChapter(currentRange.current);
      setStatus('ready');
    } catch (failure) {
      if (!request.signal.aborted) { setError(failure instanceof Error ? failure.message : 'The player could not be loaded.'); setStatus('error'); }
    }
  }

  const missing = unavailable ?? (status === 'idle' ? unavailableAt(uploads, range.resumeAt ?? range.start) : undefined);
  const offered = status === 'ready' && !missing && !dismissed && (range.end !== undefined || choices.length > 0);
  useEffect(() => {
    if (!offered || leaving || ended) return;
    const timer = setTimeout(() => setLeaving(true), CHOICES_IDLE_MS);
    return () => clearTimeout(timer);
  }, [offered, leaving, ended, touched, range.id]);
  const keep = () => setTouched((count) => count + 1);

  return <div className="player-column">
    <div className="player-stage" ref={stage}>
      <div ref={container} className={`youtube-host ${status !== 'ready' || missing ? 'youtube-host-hidden' : ''}`} />
      {missing && <div className="player-message unavailable-message"><UnavailableRecording span={missing} onGo={time => { setUnavailable(undefined); onNavigate(time); }} /></div>}
      {status === 'idle' && !missing && <div className="player-consent">
        <div className="player-context"><strong>{title}</strong></div>
        <button className="play-button" type="button" onClick={play} aria-label={`Play ${title}`}><Icon name="play" /></button>
        <p>Play to load YouTube. YouTube will receive connection information.</p>
      </div>}
      {status === 'loading' && !missing && <div className="player-message" role="status"><p>Loading YouTube…</p></div>}
      {/* Only when YouTube actually refuses or fails: the recording still opens on YouTube itself. */}
      {status === 'error' && !missing && <div className="player-message external-playback">
        <h2>Watch on YouTube</h2>
        <p role="alert">{error}</p>{errorCode !== undefined && <p className="player-error-code">YouTube error {errorCode}</p>}
        <div className="action-row"><a className="button" href={youtubeAt(uploads, lastTime.current ?? range.resumeAt ?? range.start)}>Watch on YouTube from {formatTime(lastTime.current ?? range.resumeAt ?? range.start)}</a>
          <button type="button" className="button button-secondary" onClick={play}>Try again</button></div>
        {externalChoices.length > 0 && <div className="action-row">{externalChoices.map(choice => <button type="button" className="button button-secondary" key={choice.label} onClick={choice.onChoose}>{choice.label}</button>)}</div>}
      </div>}
    </div>
    {blocked && <div className="playback-notice"><p role="status">Your browser paused automatic playback. Press Play to start.</p><button className="button button-secondary" type="button" onClick={() => { adapter.current?.playVideo(); }}>Play recording</button></div>}
    {/* Where playback stops and other ways to watch; fades after a few idle seconds, returns at the stop. */}
    {offered && <div className={`chapter-controls${leaving ? ' is-leaving' : ''}`} onAnimationEnd={() => setDismissed(true)} onPointerDown={keep} onKeyDown={keep} onFocus={keep}>
      <p role="status">{ended ? `Paused at ${endLabel}.` : continued || range.end === undefined ? 'Playing to the end of the recording.' : `Playback will stop at ${endLabel}.`}</p>
      <div className="action-row">
        {range.end !== undefined && !continued && <button type="button" className="button button-secondary" onClick={() => { controller.current?.continueWatching(); setEnded(false); setContinued(true); keep(); }}>Keep playing</button>}
        {choices.map((choice) => <button key={choice.label} type="button" className="button button-secondary" onClick={choice.onChoose}>{choice.label}</button>)}
      </div>
    </div>}
  </div>;
}
