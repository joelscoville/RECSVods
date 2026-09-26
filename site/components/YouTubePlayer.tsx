import { useEffect, useRef, useState } from 'react';
import { createChapterController, mountYouTubePlayer, type ChapterController, type PlaybackRange, type PlayerAdapter } from '../lib/player';
import { savePlayback } from '../lib/local-state';
import { youtubeUrl } from '../lib/urls';
import Icon from './Icon';

export default function YouTubePlayer({ videoId, serviceId, title, range, onTime }: {
  videoId: string; serviceId: string; title: string; range: PlaybackRange; onTime: (time: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const adapter = useRef<PlayerAdapter | null>(null);
  const controller = useRef<ChapterController | null>(null);
  const abort = useRef<AbortController | null>(null);
  const currentRange = useRef(range);
  const timeListener = useRef(onTime);
  const seekSettlesAt = useRef(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [ended, setEnded] = useState(false);
  const [continued, setContinued] = useState(false);
  const lastTime = useRef<number | null>(null);

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
    setBlocked(false);
    lastTime.current = null;
  }, [range.id, range.start, range.end, range.resumeAt]);

  useEffect(() => {
    let lastSavedAt = 0;
    let lastReported = -1;
    const save = () => { if (lastTime.current !== null) savePlayback({ serviceId, videoId, time: lastTime.current }); };
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
  }, [serviceId, videoId]);

  async function play() {
    if (!container.current) return;
    abort.current?.abort();
    adapter.current = null;
    controller.current = null;
    const request = new AbortController();
    abort.current = request;
    setStatus('loading');
    setError('');
    setBlocked(false);
    setEnded(false);
    try {
      const player = await mountYouTubePlayer(container.current, {
        videoId, title, start: currentRange.current.resumeAt ?? currentRange.current.start, signal: request.signal,
        onError(message) { if (!request.signal.aborted) { setError(message); setStatus('error'); adapter.current?.pauseVideo(); } },
        onAutoplayBlocked() { if (!request.signal.aborted) setBlocked(true); },
      });
      if (request.signal.aborted) return;
      adapter.current = player;
      controller.current = createChapterController(player, () => setEnded(true));
      seekSettlesAt.current = Date.now() + 750;
      controller.current.setChapter(currentRange.current);
      setStatus('ready');
    } catch (failure) {
      if (!request.signal.aborted) { setError(failure instanceof Error ? failure.message : 'The player could not be loaded.'); setStatus('error'); }
    }
  }

  return <div className="player-column">
    <div className="player-stage">
      <div ref={container} className={`youtube-host ${status !== 'ready' ? 'youtube-host-hidden' : ''}`} />
      {status === 'idle' && <div className="player-consent">
        <div className="player-context"><strong>{title}</strong><span>RECS REPLAY archive</span></div>
        <button className="play-button" type="button" onClick={play} aria-label={`Play ${title}`}><Icon name="play" /></button>
        <p>Play to load YouTube. YouTube will receive connection information.</p>
      </div>}
      {status === 'loading' && <div className="player-message" role="status"><p>Loading YouTube…</p></div>}
      {status === 'error' && <div className="player-message"><p role="alert">{error}</p><div className="action-row"><button type="button" className="button button-secondary" onClick={play}>Retry player</button><a className="text-link" href={youtubeUrl(videoId, range.start)}>Watch on YouTube</a></div></div>}
    </div>
    {blocked && <div className="playback-notice"><p role="status">Your browser paused automatic playback. Press Play to start.</p><button className="button button-secondary" type="button" onClick={() => { adapter.current?.playVideo(); }}>Play recording</button></div>}
    {range.end !== undefined && status === 'ready' && <div className="chapter-controls">
      <p role="status">{ended ? 'Chapter finished. Playback is paused.' : continued ? 'Continuing through the full recording.' : 'Playback will pause at the end of this chapter.'}</p>
      <div className="action-row"><button type="button" className="button button-secondary" onClick={() => { seekSettlesAt.current = Date.now() + 750; controller.current?.replay(); setEnded(false); setContinued(false); }}>Replay chapter</button><button type="button" className="button button-secondary" onClick={() => { controller.current?.continueWatching(); setEnded(false); setContinued(true); }}>Continue watching</button></div>
    </div>}
  </div>;
}
