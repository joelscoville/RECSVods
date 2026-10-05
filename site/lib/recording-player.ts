import type { PlayerAdapter, YouTubePlayer } from './player';

export interface RecordingUpload {
  id: string;
  start: number;
  end: number;
  offset: number;
  duration: number;
  unavailable?: boolean;
}

export interface UnavailableSpan {
  id: string;
  start: number;
  end: number;
  time: number;
  previous?: number;
  next?: number;
}

export interface RecordingAdapter extends PlayerAdapter {
  readonly uploadId: string;
  readonly unavailable: UnavailableSpan | undefined;
  uploadTime(time: number): { id: string; time: number };
}

/** Recording-clock conversion has no knowledge of player loading or readiness. */
export function locateRecordingUpload(
  uploads: readonly RecordingUpload[],
  time: number,
) {
  const found = uploads.findIndex((upload) => time < upload.end);
  const index = found < 0 ? uploads.length - 1 : found;
  const upload = uploads[index];
  const localTime = Math.min(
    upload.offset + Math.max(0, time - upload.start),
    upload.duration,
  );
  return { index, localTime };
}

export function unavailableAt(
  uploads: readonly RecordingUpload[],
  time: number,
): UnavailableSpan | undefined {
  const index = uploads.findIndex(
    (upload) => time >= upload.start && time < upload.end,
  );
  const upload = uploads[index];
  if (!upload?.unavailable) {
    return;
  }
  return {
    id: upload.id,
    start: upload.start,
    end: upload.end,
    time,
    previous: uploads
      .slice(0, index)
      .reverse()
      .find((upload) => !upload.unavailable)?.start,
    next: uploads.slice(index + 1).find((upload) => !upload.unavailable)?.start,
  };
}

interface RecordingPlayerOptions {
  uploads: readonly RecordingUpload[];
  start: number;
  mount: (
    upload: RecordingUpload,
    localTime: number,
    onState: (state: number) => void,
    onRate: (rate: number) => void,
  ) => Promise<YouTubePlayer>;
  onError: (message: string) => void;
  onAvailability?: (span: UnavailableSpan | undefined) => void;
  onLoading?: () => void;
  onPlaybackRateReady?: () => void;
  onPlaybackRateChange?: (rate: number) => void;
}

interface MediaLifecycle {
  /** Latest requested upload, even while another upload is still mounted. */
  requestedUpload: number;
  /** Source most recently assigned to the provider; it need not be ready yet. */
  loadedUpload: number;
  readiness: 'settled' | 'awaiting-target';
  player?: YouTubePlayer;
  pendingMount?: Promise<YouTubePlayer>;
  generation: number;
  destroyed: boolean;
}

const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;
const CUED = 5;

/** One adapter owns the requested source, assigned source, and target-media readiness.
 *
 * Seek: hold the requested recording time → stop at an unavailable span, or await
 * mounting/source assignment → seek/cue/load. PLAYING or CUED settles a switch;
 * an old PAUSED notification does not. A seek within an already pending upload
 * keeps waiting for that media. Speed preferences apply only when media is ready.
 *
 * Every position request advances generation. A mount can serve a newer request,
 * but only the latest continuation may position it. Destruction invalidates all
 * continuations and destroys any player that finishes mounting afterwards.
 */
export async function createRecordingPlayer(
  options: RecordingPlayerOptions,
): Promise<RecordingAdapter> {
  const { uploads } = options;
  if (!uploads.length) {
    throw new Error('A recording needs at least one upload');
  }

  const media: MediaLifecycle = {
    requestedUpload: locateRecordingUpload(uploads, options.start).index,
    loadedUpload: -1,
    readiness: 'settled',
    generation: 0,
    destroyed: false,
  };
  const playback = {
    heldTime: options.start,
    wantsPlay: false,
    rate: 1,
    rateRequested: false,
  };
  const recordingEnd = uploads.at(-1)!.end;

  function targetMediaIsReady(): boolean {
    return (
      !media.destroyed &&
      media.readiness === 'settled' &&
      !uploads[media.requestedUpload].unavailable &&
      Boolean(
        media.player &&
        [PLAYING, PAUSED, CUED].includes(media.player.getPlayerState()),
      )
    );
  }

  function restorePlaybackRate() {
    if (!targetMediaIsReady() || !media.player) {
      return;
    }
    if (
      playback.rateRequested &&
      media.player.getPlaybackRate?.() !== playback.rate
    ) {
      media.player.setPlaybackRate?.(playback.rate);
    }
    options.onPlaybackRateReady?.();
  }

  function rateChanged(actual: number) {
    if (targetMediaIsReady() && Number.isFinite(actual) && actual > 0) {
      options.onPlaybackRateChange?.(actual);
    }
  }

  function report(error: unknown, request: number) {
    if (!media.destroyed && request === media.generation) {
      options.onError(
        error instanceof Error
          ? error.message
          : 'The player could not be loaded.',
      );
    }
  }

  function requestedUnavailableSpan() {
    // End-of-recording seeks still belong to the last upload.
    return unavailableAt(
      uploads,
      Math.min(playback.heldTime, recordingEnd - 0.000001),
    );
  }

  function holdUnavailableUpload() {
    playback.wantsPlay = false;
    media.readiness = 'settled';
    media.player?.pauseVideo();
    options.onAvailability?.(requestedUnavailableSpan());
  }

  function stateChanged(state: number) {
    if (
      media.destroyed ||
      !media.player ||
      uploads[media.requestedUpload].unavailable
    ) {
      return;
    }
    if (state === PLAYING || state === CUED) {
      media.readiness = 'settled';
    }
    if (state === PLAYING || state === PAUSED || state === CUED) {
      restorePlaybackRate();
    }
    if (state === CUED && playback.wantsPlay) {
      media.player.playVideo();
    }
    if (state === ENDED && media.requestedUpload < uploads.length - 1) {
      const task = position(
        uploads[media.requestedUpload + 1].start,
        true,
        true,
      );
      const request = media.generation;
      void task.catch((error) => report(error, request));
    }
  }

  function mountRequestedUpload(localTime: number): Promise<YouTubePlayer> {
    if (!media.pendingMount) {
      const mountIndex = media.requestedUpload;
      media.pendingMount = options
        .mount(uploads[mountIndex], localTime, stateChanged, rateChanged)
        .then((instance) => {
          if (media.destroyed) {
            instance.destroy();
            return instance;
          }
          media.player = instance;
          media.loadedUpload = mountIndex;
          if (uploads[media.requestedUpload].unavailable) {
            instance.pauseVideo();
          }
          return instance;
        })
        .finally(() => {
          media.pendingMount = undefined;
        });
    }
    return media.pendingMount;
  }

  function assignOrSeek(
    localTime: number,
    allowSeekAhead: boolean,
    awaitingSameUpload: boolean,
  ) {
    const player = media.player!;
    if (media.loadedUpload !== media.requestedUpload) {
      media.loadedUpload = media.requestedUpload;
      const target = {
        videoId: uploads[media.requestedUpload].id,
        startSeconds: localTime,
      };
      if (playback.wantsPlay) {
        player.loadVideoById(target);
      } else {
        player.cueVideoById(target);
      }
    } else {
      player.seekTo(localTime, allowSeekAhead);
      media.readiness = awaitingSameUpload ? 'awaiting-target' : 'settled';
      if (!awaitingSameUpload) {
        if (playback.wantsPlay) player.playVideo();
        else player.pauseVideo();
      }
    }
  }

  async function position(
    time: number,
    play: boolean,
    allowSeekAhead: boolean,
  ) {
    const request = ++media.generation;
    playback.heldTime = Math.max(0, Math.min(time, recordingEnd));
    const target = locateRecordingUpload(uploads, playback.heldTime);
    const awaitingSameUpload = Boolean(
      media.player &&
      media.readiness === 'awaiting-target' &&
      media.loadedUpload === target.index,
    );
    media.requestedUpload = target.index;
    playback.wantsPlay = play;

    if (uploads[media.requestedUpload].unavailable) {
      holdUnavailableUpload();
      return;
    }

    media.readiness = 'awaiting-target';
    if (!media.player) {
      options.onLoading?.();
      await mountRequestedUpload(target.localTime);
    }
    if (media.destroyed || request !== media.generation || !media.player) {
      return;
    }

    assignOrSeek(target.localTime, allowSeekAhead, awaitingSameUpload);
    restorePlaybackRate();
    options.onAvailability?.(undefined);
  }

  const adapter: RecordingAdapter = {
    get uploadId() {
      return uploads[media.requestedUpload].id;
    },
    get unavailable() {
      return uploads[media.requestedUpload].unavailable
        ? requestedUnavailableSpan()
        : undefined;
    },
    uploadTime(time) {
      const target = locateRecordingUpload(uploads, time);
      return { id: uploads[target.index].id, time: target.localTime };
    },
    seekTo(time, allowSeekAhead) {
      const wantsPlay =
        media.player?.getPlayerState() === PLAYING || playback.wantsPlay;
      const task = position(time, wantsPlay, allowSeekAhead);
      const request = media.generation;
      void task.catch((error) => report(error, request));
    },
    playVideo() {
      if (uploads[media.requestedUpload].unavailable || media.destroyed) return;
      playback.wantsPlay = true;
      if (media.readiness === 'settled') media.player?.playVideo();
    },
    pauseVideo() {
      playback.wantsPlay = false;
      media.player?.pauseVideo();
    },
    getCurrentTime() {
      if (
        !media.player ||
        media.readiness === 'awaiting-target' ||
        uploads[media.requestedUpload].unavailable
      ) {
        return playback.heldTime;
      }
      const upload = uploads[media.requestedUpload];
      return (
        upload.start +
        Math.max(0, media.player.getCurrentTime() - upload.offset)
      );
    },
    getPlayerState() {
      if (uploads[media.requestedUpload].unavailable) return PAUSED;
      if (media.readiness === 'awaiting-target') return BUFFERING;
      return media.player?.getPlayerState() ?? PAUSED;
    },
    setPlaybackRate(value) {
      playback.rate = value;
      playback.rateRequested = true;
      restorePlaybackRate();
    },
    getPlaybackRate() {
      return media.player?.getPlaybackRate?.() ?? playback.rate;
    },
    getAvailablePlaybackRates() {
      return media.player?.getAvailablePlaybackRates?.() ?? [];
    },
    isPlaybackRateReady: targetMediaIsReady,
    destroy() {
      media.destroyed = true;
      media.generation++;
      media.player?.destroy();
    },
  };
  await position(options.start, false, true);
  return adapter;
}
