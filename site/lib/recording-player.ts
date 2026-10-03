import type { PlayerAdapter, YouTubePlayer } from './player';

export interface RecordingUpload { id: string; start: number; end: number; offset: number; duration: number; unavailable?: boolean }
export interface UnavailableSpan {
  id: string; start: number; end: number; time: number; previous?: number; next?: number;
}
export interface RecordingAdapter extends PlayerAdapter {
  readonly uploadId: string;
  readonly unavailable: UnavailableSpan | undefined;
  uploadTime(time: number): { id: string; time: number };
}
export function unavailableAt(uploads: readonly RecordingUpload[], time: number): UnavailableSpan | undefined {
  const index = uploads.findIndex(upload => time >= upload.start && time < upload.end);
  const upload = uploads[index];
  if (!upload?.unavailable) return;
  return { id: upload.id, start: upload.start, end: upload.end, time,
    previous: uploads.slice(0, index).reverse().find(upload => !upload.unavailable)?.start,
    next: uploads.slice(index + 1).find(upload => !upload.unavailable)?.start };
}

/** The recording clock includes unavailable spans. Never request their media or
 * silently skip them: hold the requested time and wait for explicit navigation. */
export async function createRecordingPlayer(options: {
  uploads: readonly RecordingUpload[]; start: number;
  mount: (upload: RecordingUpload, localTime: number, onState: (state: number) => void) => Promise<YouTubePlayer>;
  onError: (message: string) => void;
  onAvailability?: (span: UnavailableSpan | undefined) => void;
  onLoading?: () => void;
}): Promise<RecordingAdapter> {
  const { uploads } = options;
  if (!uploads.length) throw new Error('A recording needs at least one upload');
  const locate = (time: number) => {
    const found = uploads.findIndex(upload => time < upload.end), index = found < 0 ? uploads.length - 1 : found;
    const upload = uploads[index];
    return { index, local: Math.min(upload.offset + Math.max(0, time - upload.start), upload.duration) };
  };
  let current = locate(options.start).index, heldTime = options.start, loadedIndex = -1;
  let player: YouTubePlayer | undefined, pending: Promise<YouTubePlayer> | undefined;
  let destroyed = false, generation = 0, switching = false, wantsPlay = false, rate = 1;
  const report = (error: unknown, request: number) => {
    if (!destroyed && request === generation) options.onError(error instanceof Error ? error.message : 'The player could not be loaded.');
  };
  const stateChanged = (state: number) => {
    if (destroyed || !player || uploads[current].unavailable) return;
    if (state === 1 || state === 2 || state === 5) switching = false;
    if (state === 5 && wantsPlay) player.playVideo();
    if (state === 0 && current < uploads.length - 1) {
      const task = position(uploads[current + 1].start, true, true), request = generation;
      void task.catch(error => report(error, request));
    }
  };
  async function position(time: number, play: boolean, allowSeekAhead: boolean) {
    const request = ++generation;
    heldTime = Math.max(0, Math.min(time, uploads.at(-1)!.end));
    const target = locate(heldTime); current = target.index;
    wantsPlay = play;
    if (uploads[current].unavailable) {
      wantsPlay = false; switching = false; player?.pauseVideo();
      // End-of-recording seeks still belong to the last upload.
      options.onAvailability?.(unavailableAt(uploads, Math.min(heldTime, uploads.at(-1)!.end - 0.000001)));
      return;
    }
    switching = true;
    if (!player) {
      options.onLoading?.();
      if (!pending) {
        const mountIndex = current;
        pending = options.mount(uploads[mountIndex], target.local, stateChanged).then(instance => {
          if (destroyed) { instance.destroy(); return instance; }
          player = instance; loadedIndex = mountIndex;
          if (uploads[current].unavailable) instance.pauseVideo();
          return instance;
        }).finally(() => { pending = undefined; });
      }
      await pending;
    }
    if (destroyed || request !== generation || !player) return;
    if (loadedIndex !== current) {
      loadedIndex = current;
      const value = { videoId: uploads[current].id, startSeconds: target.local };
      if (wantsPlay) player.loadVideoById(value); else player.cueVideoById(value);
    } else {
      player.seekTo(target.local, allowSeekAhead);
      switching = false;
      if (wantsPlay) player.playVideo(); else player.pauseVideo();
    }
    if (rate !== 1) player.setPlaybackRate?.(rate);
    options.onAvailability?.(undefined);
  }
  const adapter: RecordingAdapter = {
    get uploadId() { return uploads[current].id; },
    get unavailable() { return uploads[current].unavailable ? unavailableAt(uploads, Math.min(heldTime, uploads.at(-1)!.end - 0.000001)) : undefined; },
    uploadTime(time) { const target = locate(time); return { id: uploads[target.index].id, time: target.local }; },
    seekTo(time, allowSeekAhead) {
      const task = position(time, player?.getPlayerState() === 1 || wantsPlay, allowSeekAhead), request = generation;
      void task.catch(error => report(error, request));
    },
    playVideo() { if (uploads[current].unavailable || destroyed) return; wantsPlay = true; if (!switching) player?.playVideo(); },
    pauseVideo() { wantsPlay = false; player?.pauseVideo(); },
    getCurrentTime() { return !player || switching || uploads[current].unavailable ? heldTime : uploads[current].start + Math.max(0, player.getCurrentTime() - uploads[current].offset); },
    getPlayerState() { return uploads[current].unavailable ? 2 : switching ? 3 : player?.getPlayerState() ?? 2; },
    setPlaybackRate(value) { rate = value; player?.setPlaybackRate?.(value); },
    destroy() { destroyed = true; generation++; player?.destroy(); },
  };
  await position(options.start, false, true);
  return adapter;
}
