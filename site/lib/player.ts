export interface PlayerAdapter {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
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

interface YouTubePlayer extends PlayerAdapter { getIframe(): HTMLIFrameElement }
interface YouTubeAPI {
  Player: new (element: HTMLElement, options: {
    videoId: string; host: string; width: string; height: string;
    playerVars: Record<string, string | number>;
    events: { onReady(event: { target: YouTubePlayer }): void; onError(event: { data: number }): void; onAutoplayBlocked(): void };
  }) => YouTubePlayer;
}
type YouTubeWindow = Window & { YT?: YouTubeAPI; onYouTubeIframeAPIReady?: () => void };
let apiPromise: Promise<YouTubeAPI> | undefined;

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
  onError(message: string): void; onAutoplayBlocked(): void;
}): Promise<PlayerAdapter> {
  const api = await loadYouTubeAPI();
  if (options.signal?.aborted) throw new Error('Playback cancelled');
  const host = document.createElement('div');
  container.replaceChildren(host);
  return new Promise((resolve, reject) => {
    let ready = false;
    const timeout = setTimeout(() => fail('YouTube did not respond. Please retry.'), 20_000);
    const fail = (message: string) => {
      clearTimeout(timeout);
      options.onError(message);
      if (!ready) { player.destroy(); reject(new Error(message)); }
    };
    const player = new api.Player(host, {
      videoId: options.videoId, host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%',
      playerVars: { controls: 1, playsinline: 1, rel: 0, start: Math.floor(options.start), origin: window.location.origin },
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
        onError({ data }) { fail(data === 100 || data === 101 || data === 150 ? 'This recording is unavailable in the embedded player. Try watching on YouTube.' : 'YouTube could not play this recording. Retry or watch on YouTube.'); },
        onAutoplayBlocked: options.onAutoplayBlocked,
      },
    });
    options.signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      player.destroy();
      if (!ready) reject(new Error('Playback cancelled'));
    }, { once: true });
  });
}
