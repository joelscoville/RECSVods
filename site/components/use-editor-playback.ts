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
  const [availableSpeeds, setAvailableSpeeds] = useState<number[]>([]), [speedNotice, setSpeedNotice] = useState<string>();
  const requestedSpeed = useRef(1), speedSettlesAt = useRef<number | undefined>(undefined);
  const adapter = useRef<PlayerAdapter | null>(null), abort = useRef<AbortController | null>(null), host = useRef<HTMLDivElement>(null);
  const settleUntil = useRef(0), lastSeek = useRef(0), stopAt = useRef<number>(undefined);
  const load = useCallback(async (start: number, local: File | null | undefined = file) => {
    abort.current?.abort(); adapter.current?.destroy(); adapter.current = null;
    if (!host.current) return;
    const request = new AbortController(); abort.current = request;
    setPlayer('loading'); setPlayerError(''); setFileWarning(undefined); setAvailableSpeeds([]); setSpeedNotice(undefined);
    const onError = (message: string) => { if (!request.signal.aborted) { setPlayerError(message); setPlayer('error'); } };
    try {
      let mounted: PlayerAdapter;
      if (local) {
        const played = await mountFilePlayer(host.current, { file: local, title: recording.recordingTitle, start, onError });
        if (Math.abs(played.duration - length) > 2) setFileWarning(`This file is ${formatClock(played.duration)} long, but the recording is ${formatClock(length)}. Times follow the YouTube recording, so they only line up with a copy of it.`);
        mounted = played;
      } else mounted = await mountRecordingPlayer(host.current, { uploads, title: recording.recordingTitle, start, signal: request.signal, controls: false, onError, onAutoplayBlocked() {},
        onLoading() { if (!request.signal.aborted) { setPlayer('loading'); speedSettlesAt.current = undefined; } },
        onAvailability(span) { if (!request.signal.aborted) { setPlayer('ready'); if (span) { setTime(span.time); setPlaying(false); } } },
        onPlaybackRateReady() { if (!request.signal.aborted) speedSettlesAt.current = performance.now() + 1200; },
        onPlaybackRateChange(rate) { if (!request.signal.aborted && rate === requestedSpeed.current) setSpeed(rate); },
      });
      if (request.signal.aborted) { mounted.destroy(); return; }
      adapter.current = mounted;
      mounted.seekTo(start, true); settleUntil.current = performance.now() + 600;
      mounted.setPlaybackRate?.(requestedSpeed.current);
      mounted.playVideo(); setPlayer('ready'); root.current?.focus({ preventScroll: true });
    } catch (failure) { if (!request.signal.aborted) onError(failure instanceof Error ? failure.message : 'The player could not be loaded.'); }
  }, [file, recording.recordingTitle, uploads, length, root]);
  useEffect(() => {
    setTime(requestedEditorTime(length) ?? 0); setPlaying(false); setPlayer('idle'); setFile(undefined); setFileWarning(undefined); stopAt.current = undefined;
    requestedSpeed.current = 1; speedSettlesAt.current = undefined; setSpeed(1); setAvailableSpeeds([]); setSpeedNotice(undefined);
    return () => { abort.current?.abort(); adapter.current?.destroy(); adapter.current = null; };
  }, [base, length]);
  useEffect(() => {
    const timer = setInterval(() => {
      const current = adapter.current;
      if (!current) return;
      const mediaState = current.getPlayerState(), active = mediaState === 1; setPlaying(active);
      // A temporary provider rate while loading is not a rejection. The adapter
      // starts a fresh confirmation window after reapplying the target's rate.
      const rateReady = current.isPlaybackRateReady?.() ?? [1, 2, 5].includes(mediaState);
      if (!rateReady) speedSettlesAt.current = undefined;
      else speedSettlesAt.current ??= performance.now() + 1200;
      const rates = rateReady ? current.getAvailablePlaybackRates?.() ?? [] : [];
      setAvailableSpeeds(previous => previous.length === rates.length && previous.every((rate, i) => rate === rates[i]) ? previous : rates);
      const actualRate = current.getPlaybackRate?.();
      const rejectionDue = speedSettlesAt.current !== undefined && performance.now() >= speedSettlesAt.current;
      if (rateReady && actualRate && Number.isFinite(actualRate) && (actualRate === requestedSpeed.current || rejectionDue)) {
        setSpeed(actualRate);
        if (actualRate !== requestedSpeed.current) {
          setSpeedNotice(`This video is playing at ${actualRate}×; ${requestedSpeed.current}× could not be applied.`);
          requestedSpeed.current = actualRate;
          current.setPlaybackRate?.(actualRate);
        }
      }
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
    speedSettlesAt.current = undefined;
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
  return { time, playing, speed, availableSpeeds, speedNotice, player, playerError, file, fileWarning, host, uploads, load, seek, togglePlay,
    unavailable: file ? undefined : unavailableAt(uploads, time),
    useFile: (chosen: File) => { setFile(chosen); void load(time, chosen); },
    useYouTube: () => { setFile(undefined); void load(time, null); },
    changeSpeed: (rate: number) => {
      requestedSpeed.current = rate; setSpeedNotice(undefined); speedSettlesAt.current = undefined;
      if (!adapter.current) setSpeed(rate);
      else adapter.current.setPlaybackRate?.(rate);
    },
    stopAfter: (at: number) => { stopAt.current = at; },
    commitSeek: () => { settleUntil.current = performance.now() + 600; adapter.current?.seekTo(time, true); },
  };
}
