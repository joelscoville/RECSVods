import { createRecordingPlayer, type RecordingAdapter, type RecordingUpload, type UnavailableSpan } from './recording-player';
export { unavailableAt } from './recording-player';
export type { RecordingAdapter, RecordingUpload, UnavailableSpan } from './recording-player';

export interface PlayerAdapter {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  /** Supported by the YouTube player; optional so simple test doubles need not implement it. */
  setPlaybackRate?(rate: number): void;
  getPlaybackRate?(): number;
  getAvailablePlaybackRates?(): number[];
  destroy(): void;
}
export interface PlaybackRange { id: string; start: number; end?: number; resumeAt?: number }
export interface ChapterController {
  setChapter(range: PlaybackRange, play?: boolean): void;
  tick(): boolean;
  replay(): void;
  continueWatching(): void;
  readonly ended: boolean;
}

/** A soft boundary: never rewinds a manual seek and only pauses an actively playing video once. */
export function createChapterController(player: PlayerAdapter, onEnd: () => void = () => {}): ChapterController {
  let range: PlaybackRange | undefined;
  let ended = false;
  let boundaryEnabled = true;
  return {
    setChapter(next, play = true) {
      if (!Number.isFinite(next.start) || next.start < 0 || (next.end !== undefined && (!Number.isFinite(next.end) || next.end <= next.start))) throw new Error('Invalid playback range');
      range = { ...next };
      ended = false;
      boundaryEnabled = true;
      const resume = next.resumeAt;
      player.seekTo(resume !== undefined && Number.isFinite(resume) && resume >= next.start && (next.end === undefined || resume < next.end) ? resume : next.start, true);
      if (play) player.playVideo();
    },
    tick() {
      if (!range || range.end === undefined || !boundaryEnabled || ended || player.getPlayerState() !== 1) return false;
      const time = player.getCurrentTime();
      if (!Number.isFinite(time) || time < range.end) return false;
      ended = true;
      player.pauseVideo();
      onEnd();
      return true;
    },
    replay() {
      if (!range) return;
      ended = false;
      boundaryEnabled = true;
      player.seekTo(range.start, true);
      player.playVideo();
    },
    continueWatching() {
      boundaryEnabled = false;
      ended = false;
      player.playVideo();
    },
    get ended() { return ended; },
  };
}

export interface YouTubePlayer extends PlayerAdapter {
  getIframe(): HTMLIFrameElement;
  loadVideoById(options: { videoId: string; startSeconds: number }): void;
  cueVideoById(options: { videoId: string; startSeconds: number }): void;
}
interface YouTubeAPI {
  Player: new (element: HTMLElement, options: {
    videoId: string; host: string; width: string; height: string;
    playerVars: Record<string, string | number>;
    events: { onReady(event: { target: YouTubePlayer }): void; onError(event: { data: number }): void; onAutoplayBlocked(): void; onStateChange?(event: { data: number }): void };
  }) => YouTubePlayer;
}
type YouTubeWindow = Window & { YT?: YouTubeAPI; onYouTubeIframeAPIReady?: () => void };
let apiPromise: Promise<YouTubeAPI> | undefined;

export function youtubeErrorMessage(code: number): string {
  if (code === 101 || code === 150) return 'YouTube has blocked embedded playback for this recording. Open it on YouTube instead.';
  if (code === 100) return 'This recording is unavailable on YouTube. It may be private or removed.';
  if (code === 153) return 'YouTube could not verify this player’s website. Retry or open the recording on YouTube.';
  return 'YouTube could not play this recording. Retry or watch on YouTube.';
}

function loadYouTubeAPI(): Promise<YouTubeAPI> {
  const browser = window as YouTubeWindow;
  if (browser.YT?.Player) return Promise.resolve(browser.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const previous = browser.onYouTubeIframeAPIReady;
    const fail = () => {
      clearTimeout(timeout);
      script.remove();
      browser.onYouTubeIframeAPIReady = previous;
      apiPromise = undefined;
      reject(new Error('YouTube could not be loaded. Check your connection and retry.'));
    };
    const timeout = setTimeout(fail, 20_000);
    browser.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      previous?.();
      if (browser.YT?.Player) resolve(browser.YT);
      else fail();
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = fail;
    document.head.append(script);
  });
  return apiPromise;
}

/** Call only following a user play action. Native YouTube controls own captions and fullscreen. */
export async function mountYouTubePlayer(container: HTMLElement, options: {
  videoId: string; title: string; start: number; signal?: AbortSignal;
  onError(message: string, code?: number): void; onAutoplayBlocked(): void;
  /** False hides YouTube's controls and keyboard handling, for pages that provide their own. */
  controls?: boolean;
  onStateChange?(state: number): void;
}): Promise<YouTubePlayer> {
  const api = await loadYouTubeAPI();
  if (options.signal?.aborted) throw new Error('Playback cancelled');
  const host = document.createElement('div');
  container.replaceChildren(host);
  return new Promise((resolve, reject) => {
    let ready = false;
    const timeout = setTimeout(() => fail('YouTube did not respond. Please retry.'), 20_000);
    const fail = (message: string, code?: number) => {
      clearTimeout(timeout);
      options.onError(message, code);
      if (!ready) { player.destroy(); reject(new Error(message)); }
    };
    const player = new api.Player(host, {
      videoId: options.videoId, host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%',
      playerVars: { controls: options.controls === false ? 0 : 1, ...(options.controls === false ? { disablekb: 1, iv_load_policy: 3 } : {}),
        playsinline: 1, rel: 0, start: Math.floor(options.start), origin: window.location.origin },
      events: {
        onReady({ target }) {
          clearTimeout(timeout);
          if (options.signal?.aborted) { target.destroy(); reject(new Error('Playback cancelled')); return; }
          ready = true;
          target.getIframe().title = options.title;
          target.getIframe().setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
          target.getIframe().focus();
          resolve(target);
        },
        onError({ data }) { fail(youtubeErrorMessage(data), data); },
        onAutoplayBlocked: options.onAutoplayBlocked,
        onStateChange({ data }) { options.onStateChange?.(data); },
      },
    });
    options.signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      player.destroy();
      if (!ready) reject(new Error('Playback cancelled'));
    }, { once: true });
  });
}

/** Plays a recording made of several uploads as one video, on the recording's own clock. When an upload ends,
 * the next one starts unless marked unavailable; seeking anywhere retains the recording time. (YouTube needs a second or two at
 * each cut; there is no gapless switch.) Call only following a user play action. */
export async function mountRecordingPlayer(container: HTMLElement, options: {
  uploads: readonly RecordingUpload[]; title: string; start: number; signal?: AbortSignal;
  onError(message: string, code?: number): void; onAutoplayBlocked(): void; controls?: boolean;
  onAvailability?: (span: UnavailableSpan | undefined) => void; onLoading?: () => void;
}): Promise<RecordingAdapter> {
  return createRecordingPlayer({ uploads: options.uploads, start: options.start,
    onError: options.onError, onAvailability: options.onAvailability, onLoading: options.onLoading,
    mount: (upload, start, onStateChange) => mountYouTubePlayer(container, {
      videoId: upload.id, title: options.title, start, signal: options.signal, controls: options.controls,
      onError: options.onError, onAutoplayBlocked: options.onAutoplayBlocked, onStateChange,
    }),
  });
}

/** A video file from the viewer's own computer, played in the page: nothing is uploaded. Same adapter as
 * YouTube, so the editor does not care which one it drives; seeking is instant and exact. */
export function mountFilePlayer(container: HTMLElement, options: {
  file: Blob; title: string; start: number; onError(message: string): void;
}): Promise<PlayerAdapter & { duration: number }> {
  const url = URL.createObjectURL(options.file);
  const video = document.createElement('video');
  video.src = url; video.preload = 'auto'; video.playsInline = true; video.title = options.title;
  container.replaceChildren(video);
  return new Promise((resolve, reject) => {
    const fail = () => { URL.revokeObjectURL(url); video.remove(); const message = 'This file could not be played. Try an MP4 (H.264) or WebM file.'; options.onError(message); reject(new Error(message)); };
    video.addEventListener('error', fail, { once: true });
    video.addEventListener('loadedmetadata', () => {
      video.removeEventListener('error', fail);
      video.addEventListener('error', () => options.onError('The file stopped playing.'));
      video.currentTime = options.start;
      resolve({
        duration: video.duration,
        seekTo(seconds) { video.currentTime = Math.max(0, seconds); },
        playVideo() { void video.play().catch(() => {}); },
        pauseVideo() { video.pause(); },
        getCurrentTime() { return video.currentTime; },
        getPlayerState() { return video.ended ? 0 : video.paused ? 2 : 1; },
        setPlaybackRate(rate) { video.playbackRate = rate; },
        getPlaybackRate() { return video.playbackRate; },
        destroy() { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); URL.revokeObjectURL(url); },
      });
    }, { once: true });
  });
}
