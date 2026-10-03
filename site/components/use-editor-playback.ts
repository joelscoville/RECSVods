import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { mountFilePlayer, mountRecordingPlayer, unavailableAt, type PlayerAdapter } from '../lib/player';
import { formatClock, lengthOf, type EditorRecording } from '../lib/recording-editor';
import { uploadSpans } from '../lib/recording-schema';

export function requestedEditorTime(length: number): number | undefined {
  if (typeof window === 'undefined') return;
  const value = new URLSearchParams(window.location.search).get('t');
  return value?.trim() && Number.isFinite(Number(value)) ? Math.min(Math.max(0, Number(value)), length) : undefined;
}
export interface EditorSeekOptions { play?: boolean; live?: boolean; reveal?: boolean }

/** Owns media adapters, clock polling, pending seeks, preview stops, and cleanup. */
export function useEditorPlayback(base: EditorRecording, root: RefObject<HTMLDivElement | null>) {
  const { recording } = base, length = useMemo(() => lengthOf(base), [base]);
  const uploads = useMemo(() => uploadSpans(recording).map(span => ({ id: span.upload.youtubeId, start: span.start, end: span.end,
    offset: span.offset, duration: span.upload.uploadDuration, unavailable: span.upload.uploadUnavailable })), [recording]);
  const [time, setTime] = useState(() => requestedEditorTime(length) ?? 0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [player, setPlayer] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle'), [playerError, setPlayerError] = useState('');
  const [file, setFile] = useState<File>(), [fileWarning, setFileWarning] = useState<string>();
  const adapter = useRef<PlayerAdapter | null>(null), abort = useRef<AbortController | null>(null), host = useRef<HTMLDivElement>(null);
  const settleUntil = useRef(0), lastSeek = useRef(0), stopAt = useRef<number>(undefined);
  const load = useCallback(async (start: number, local: File | null | undefined = file) => {
    abort.current?.abort(); adapter.current?.destroy(); adapter.current = null;
    if (!host.current) return;
    const request = new AbortController(); abort.current = request;
    setPlayer('loading'); setPlayerError(''); setFileWarning(undefined);
    const onError = (message: string) => { if (!request.signal.aborted) { setPlayerError(message); setPlayer('error'); } };
    try {
      let mounted: PlayerAdapter;
      if (local) {
        const played = await mountFilePlayer(host.current, { file: local, title: recording.recordingTitle, start, onError });
        if (Math.abs(played.duration - length) > 2) setFileWarning(`This file is ${formatClock(played.duration)} long, but the recording is ${formatClock(length)}. Times follow the YouTube recording, so they only line up with a copy of it.`);
        mounted = played;
      } else mounted = await mountRecordingPlayer(host.current, { uploads, title: recording.recordingTitle, start, signal: request.signal, controls: false, onError, onAutoplayBlocked() {},
        onLoading() { if (!request.signal.aborted) setPlayer('loading'); },
        onAvailability(span) { if (!request.signal.aborted) { setPlayer('ready'); if (span) { setTime(span.time); setPlaying(false); } } },
      });
      if (request.signal.aborted) { mounted.destroy(); return; }
      adapter.current = mounted;
      mounted.seekTo(start, true); settleUntil.current = performance.now() + 600;
      if (speed !== 1) mounted.setPlaybackRate?.(speed);
      mounted.playVideo(); setPlayer('ready'); root.current?.focus({ preventScroll: true });
    } catch (failure) { if (!request.signal.aborted) onError(failure instanceof Error ? failure.message : 'The player could not be loaded.'); }
  }, [file, recording.recordingTitle, uploads, length, speed, root]);
  useEffect(() => {
    setTime(requestedEditorTime(length) ?? 0); setPlaying(false); setPlayer('idle'); setFile(undefined); setFileWarning(undefined); stopAt.current = undefined;
    return () => { abort.current?.abort(); adapter.current?.destroy(); adapter.current = null; };
  }, [base, length]);
  useEffect(() => {
    const timer = setInterval(() => {
      const current = adapter.current;
      if (!current) return;
      const active = current.getPlayerState() === 1; setPlaying(active);
      if (performance.now() < settleUntil.current) return;
      const value = current.getCurrentTime(); if (!Number.isFinite(value)) return;
      setTime(value);
      if (stopAt.current !== undefined && active && value >= stopAt.current) { current.pauseVideo(); stopAt.current = undefined; }
    }, 80);
    return () => clearInterval(timer);
  }, []);
  const seek = useCallback((seconds: number, options: EditorSeekOptions = {}) => {
    const target = Math.min(Math.max(0, seconds), Math.max(0, length - 0.05));
    setTime(target); settleUntil.current = performance.now() + 600;
    const current = adapter.current;
    if (!current) { if (options.play) void load(target); return; }
    const now = performance.now();
    if (options.live && now - lastSeek.current < 80) return;
    lastSeek.current = now; current.seekTo(target, !options.live);
    if (options.play) current.playVideo();
  }, [length, load]);
  const togglePlay = () => {
    stopAt.current = undefined;
    if (!adapter.current) { void load(time); return; }
    if (adapter.current.getPlayerState() === 1) adapter.current.pauseVideo(); else adapter.current.playVideo();
  };
  return { time, playing, speed, player, playerError, file, fileWarning, host, uploads, load, seek, togglePlay,
    unavailable: file ? undefined : unavailableAt(uploads, time),
    useFile: (chosen: File) => { setFile(chosen); void load(time, chosen); },
    useYouTube: () => { setFile(undefined); void load(time, null); },
    changeSpeed: (rate: number) => { setSpeed(rate); adapter.current?.setPlaybackRate?.(rate); },
    stopAfter: (at: number) => { stopAt.current = at; },
    commitSeek: () => { settleUntil.current = performance.now() + 600; adapter.current?.seekTo(time, true); },
  };
}
