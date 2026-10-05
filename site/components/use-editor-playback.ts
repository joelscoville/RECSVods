import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  mountFilePlayer,
  mountRecordingPlayer,
  unavailableAt,
  type PlayerAdapter,
} from '../lib/player';
import {
  formatClock,
  lengthOf,
  type EditorRecording,
} from '../lib/recording-editor';
import { uploadSpans } from '../lib/recording-schema';

const CLOCK_POLL_INTERVAL_MS = 80;
const LIVE_SEEK_INTERVAL_MS = 80;
const SEEK_SETTLE_DELAY_MS = 600;
const RATE_CONFIRMATION_DELAY_MS = 1200;
const FILE_DURATION_TOLERANCE_SECONDS = 2;
const RECORDING_END_MARGIN_SECONDS = 0.05;
const PLAYING = 1;
const RATE_READY_STATES = [PLAYING, 2, 5];

export function requestedEditorTime(length: number): number | undefined {
  if (typeof window === 'undefined') {
    return;
  }

  const requestedTime = new URLSearchParams(window.location.search).get('t');
  if (!requestedTime?.trim() || !Number.isFinite(Number(requestedTime))) {
    return;
  }

  return Math.min(Math.max(0, Number(requestedTime)), length);
}

export interface EditorSeekOptions {
  play?: boolean;
  live?: boolean;
  reveal?: boolean;
}

/** Owns media adapters, clock polling, pending seeks, preview stops, and cleanup. */
export function useEditorPlayback(
  base: EditorRecording,
  root: RefObject<HTMLDivElement | null>,
) {
  const { recording } = base;
  const length = useMemo(() => lengthOf(base), [base]);
  const uploads = useMemo(() => {
    return uploadSpans(recording).map((span) => ({
      id: span.upload.youtubeId,
      start: span.start,
      end: span.end,
      offset: span.offset,
      duration: span.upload.uploadDuration,
      unavailable: span.upload.uploadUnavailable,
    }));
  }, [recording]);

  const [playbackSeconds, setPlaybackSeconds] = useState(
    () => requestedEditorTime(length) ?? 0,
  );
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [playerStatus, setPlayerStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [playerError, setPlayerError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File>();
  const [fileWarning, setFileWarning] = useState<string>();
  const [availableSpeeds, setAvailableSpeeds] = useState<number[]>([]);
  const [speedNotice, setSpeedNotice] = useState<string>();

  const requestedSpeed = useRef(1);
  const rateConfirmationAt = useRef<number | undefined>(undefined);
  const activePlayer = useRef<PlayerAdapter | null>(null);
  const pendingPlayerLoad = useRef<AbortController | null>(null);
  const playerContainer = useRef<HTMLDivElement>(null);
  const seekSettlesAt = useRef(0);
  const lastSeekAt = useRef(0);
  const previewEndSeconds = useRef<number>(undefined);

  // Omitted source keeps the selected file. Explicit null switches to YouTube.
  const loadPlayback = useCallback(
    async (
      startSeconds: number,
      localFile: File | null | undefined = selectedFile,
    ) => {
      pendingPlayerLoad.current?.abort();
      activePlayer.current?.destroy();
      activePlayer.current = null;

      if (!playerContainer.current) {
        return;
      }

      const request = new AbortController();
      pendingPlayerLoad.current = request;
      setPlayerStatus('loading');
      setPlayerError('');
      setFileWarning(undefined);
      setAvailableSpeeds([]);
      setSpeedNotice(undefined);

      function reportPlayerError(message: string) {
        if (request.signal.aborted) {
          return;
        }
        setPlayerError(message);
        setPlayerStatus('error');
      }

      async function createPlayer(): Promise<PlayerAdapter> {
        if (localFile) {
          const player = await mountFilePlayer(playerContainer.current!, {
            file: localFile,
            title: recording.recordingTitle,
            start: startSeconds,
            onError: reportPlayerError,
          });
          const durationDifference = Math.abs(player.duration - length);
          if (durationDifference > FILE_DURATION_TOLERANCE_SECONDS) {
            setFileWarning(
              `This file is ${formatClock(player.duration)} long, but the recording is ${formatClock(length)}. Times follow the YouTube recording, so they only line up with a copy of it.`,
            );
          }
          return player;
        }

        return mountRecordingPlayer(playerContainer.current!, {
          uploads,
          title: recording.recordingTitle,
          start: startSeconds,
          signal: request.signal,
          controls: false,
          onError: reportPlayerError,
          onAutoplayBlocked() {},
          onLoading() {
            if (!request.signal.aborted) {
              setPlayerStatus('loading');
              rateConfirmationAt.current = undefined;
            }
          },
          onAvailability(span) {
            if (request.signal.aborted) {
              return;
            }
            setPlayerStatus('ready');
            if (span) {
              setPlaybackSeconds(span.time);
              setPlaying(false);
            }
          },
          onPlaybackRateReady() {
            if (!request.signal.aborted) {
              rateConfirmationAt.current =
                performance.now() + RATE_CONFIRMATION_DELAY_MS;
            }
          },
          onPlaybackRateChange(rate) {
            if (!request.signal.aborted && rate === requestedSpeed.current) {
              setSpeed(rate);
            }
          },
        });
      }

      try {
        const player = await createPlayer();
        if (request.signal.aborted) {
          player.destroy();
          return;
        }

        activePlayer.current = player;
        player.seekTo(startSeconds, true);
        seekSettlesAt.current = performance.now() + SEEK_SETTLE_DELAY_MS;
        player.setPlaybackRate?.(requestedSpeed.current);
        player.playVideo();
        setPlayerStatus('ready');
        root.current?.focus({ preventScroll: true });
      } catch (failure) {
        if (!request.signal.aborted) {
          reportPlayerError(
            failure instanceof Error
              ? failure.message
              : 'The player could not be loaded.',
          );
        }
      }
    },
    [selectedFile, recording.recordingTitle, uploads, length, root],
  );

  useEffect(() => {
    setPlaybackSeconds(requestedEditorTime(length) ?? 0);
    setPlaying(false);
    setPlayerStatus('idle');
    setSelectedFile(undefined);
    setFileWarning(undefined);
    previewEndSeconds.current = undefined;
    requestedSpeed.current = 1;
    rateConfirmationAt.current = undefined;
    setSpeed(1);
    setAvailableSpeeds([]);
    setSpeedNotice(undefined);

    return () => {
      pendingPlayerLoad.current?.abort();
      activePlayer.current?.destroy();
      activePlayer.current = null;
    };
  }, [base, length]);

  useEffect(() => {
    function updatePlaybackRate(player: PlayerAdapter, mediaState: number) {
      // Loading rates are temporary. Confirmation starts after the target media is ready.
      const rateReady =
        player.isPlaybackRateReady?.() ??
        RATE_READY_STATES.includes(mediaState);
      if (!rateReady) {
        rateConfirmationAt.current = undefined;
      } else {
        rateConfirmationAt.current ??=
          performance.now() + RATE_CONFIRMATION_DELAY_MS;
      }

      const rates = rateReady
        ? (player.getAvailablePlaybackRates?.() ?? [])
        : [];
      setAvailableSpeeds((previous) => {
        const unchanged =
          previous.length === rates.length &&
          previous.every((rate, index) => rate === rates[index]);
        return unchanged ? previous : rates;
      });

      const actualRate = player.getPlaybackRate?.();
      const confirmationExpired =
        rateConfirmationAt.current !== undefined &&
        performance.now() >= rateConfirmationAt.current;
      if (!rateReady || !actualRate || !Number.isFinite(actualRate)) {
        return;
      }
      if (actualRate !== requestedSpeed.current && !confirmationExpired) {
        return;
      }

      setSpeed(actualRate);
      if (actualRate !== requestedSpeed.current) {
        setSpeedNotice(
          `This video is playing at ${actualRate}×; ${requestedSpeed.current}× could not be applied.`,
        );
        requestedSpeed.current = actualRate;
        player.setPlaybackRate?.(actualRate);
      }
    }

    function pollPlayback() {
      const player = activePlayer.current;
      if (!player) {
        return;
      }

      const mediaState = player.getPlayerState();
      const isPlaying = mediaState === PLAYING;
      setPlaying(isPlaying);
      updatePlaybackRate(player, mediaState);

      if (performance.now() < seekSettlesAt.current) {
        return;
      }
      const currentSeconds = player.getCurrentTime();
      if (!Number.isFinite(currentSeconds)) {
        return;
      }

      setPlaybackSeconds(currentSeconds);
      if (
        previewEndSeconds.current !== undefined &&
        isPlaying &&
        currentSeconds >= previewEndSeconds.current
      ) {
        player.pauseVideo();
        previewEndSeconds.current = undefined;
      }
    }

    const timer = setInterval(pollPlayback, CLOCK_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const seek = useCallback(
    (seconds: number, options: EditorSeekOptions = {}) => {
      const target = Math.min(
        Math.max(0, seconds),
        Math.max(0, length - RECORDING_END_MARGIN_SECONDS),
      );
      setPlaybackSeconds(target);
      seekSettlesAt.current = performance.now() + SEEK_SETTLE_DELAY_MS;
      rateConfirmationAt.current = undefined;

      const player = activePlayer.current;
      if (!player) {
        if (options.play) {
          void loadPlayback(target);
        }
        return;
      }

      const now = performance.now();
      if (options.live && now - lastSeekAt.current < LIVE_SEEK_INTERVAL_MS) {
        return;
      }
      lastSeekAt.current = now;
      player.seekTo(target, !options.live);
      if (options.play) {
        player.playVideo();
      }
    },
    [length, loadPlayback],
  );

  function togglePlay() {
    previewEndSeconds.current = undefined;
    const player = activePlayer.current;
    if (!player) {
      void loadPlayback(playbackSeconds);
      return;
    }
    if (player.getPlayerState() === PLAYING) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }

  function selectLocalFile(file: File) {
    setSelectedFile(file);
    void loadPlayback(playbackSeconds, file);
  }

  function switchToYouTube() {
    setSelectedFile(undefined);
    void loadPlayback(playbackSeconds, null);
  }

  function changeSpeed(rate: number) {
    requestedSpeed.current = rate;
    setSpeedNotice(undefined);
    rateConfirmationAt.current = undefined;
    if (!activePlayer.current) {
      setSpeed(rate);
    } else {
      activePlayer.current.setPlaybackRate?.(rate);
    }
  }

  function stopAfter(seconds: number) {
    previewEndSeconds.current = seconds;
  }

  function commitSeek() {
    seekSettlesAt.current = performance.now() + SEEK_SETTLE_DELAY_MS;
    activePlayer.current?.seekTo(playbackSeconds, true);
  }

  return {
    time: playbackSeconds,
    playing,
    speed,
    availableSpeeds,
    speedNotice,
    player: playerStatus,
    playerError,
    file: selectedFile,
    fileWarning,
    host: playerContainer,
    uploads,
    load: loadPlayback,
    seek,
    togglePlay,
    unavailable: selectedFile
      ? undefined
      : unavailableAt(uploads, playbackSeconds),
    useFile: selectLocalFile,
    useYouTube: switchToYouTube,
    changeSpeed,
    stopAfter,
    commitSeek,
  };
}
