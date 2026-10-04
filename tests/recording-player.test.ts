import { describe, expect, it, vi } from 'vitest';
import { createRecordingPlayer, unavailableAt, type RecordingUpload } from '../site/lib/recording-player';
import type { YouTubePlayer } from '../site/lib/player';

const uploads: RecordingUpload[] = [
  { id: 'AVAILABLE01', start: 0, end: 100, offset: 0, duration: 100 },
  { id: 'MISSING0001', start: 100, end: 160, offset: 20, duration: 80, unavailable: true },
  { id: 'AVAILABLE02', start: 160, end: 220, offset: 5, duration: 65 },
];
function setup(transitionDelay = 0) {
  let time = 0, state = 2, rate = 1, loading = false;
  let onState: (state: number) => void = () => {}, onRate: (rate: number) => void = () => {};
  const change = (value: number) => { state = value; queueMicrotask(() => onState(value)); };
  const load = (value: number) => {
    state = 3; rate = 1; loading = true;
    const ready = () => { loading = false; rate = 1; change(value); };
    if (transitionDelay) setTimeout(ready, transitionDelay); else queueMicrotask(ready);
  };
  const video: YouTubePlayer = {
    seekTo: vi.fn(value => { time = value; }), playVideo: vi.fn(() => change(1)), pauseVideo: vi.fn(() => change(2)),
    loadVideoById: vi.fn(value => { time = value.startSeconds; load(1); }), cueVideoById: vi.fn(value => { time = value.startSeconds; load(5); }),
    getCurrentTime: () => time, getPlayerState: () => state, getIframe: () => null!, destroy: vi.fn(),
    setPlaybackRate: vi.fn(value => { if (!loading) { rate = value; queueMicrotask(() => onRate(value)); } }), getPlaybackRate: () => rate, getAvailablePlaybackRates: () => [0.5, 1, 1.5, 2],
  };
  const mount = vi.fn(async (_upload: RecordingUpload, local: number, listener: (state: number) => void, rateListener: (rate: number) => void) => {
    time = local; onState = listener; onRate = rateListener; return video;
  });
  return { mount, video, change, onError: vi.fn(), onAvailability: vi.fn() };
}

describe('unavailable recording spans', () => {
  it.each([true, false])('confirms rates only after a slow target is ready (playing=%s)', async playing => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    try {
      const env = setup(3000), ready = vi.fn(() => Date.now()), confirmed = vi.fn();
      const adapter = await createRecordingPlayer({ uploads, start: 20, ...env, onPlaybackRateReady: ready, onPlaybackRateChange: confirmed });
      adapter.setPlaybackRate!(2); if (playing) adapter.playVideo();
      await vi.advanceTimersByTimeAsync(0);
      ready.mockClear(); confirmed.mockClear();
      adapter.seekTo(175, true);
      // A paused notification from the old media is not proof that the new upload is ready.
      env.change(2); await vi.advanceTimersByTimeAsync(0);
      expect(adapter.isPlaybackRateReady!()).toBe(false);
      env.change(3); await vi.advanceTimersByTimeAsync(1600);
      expect(adapter.getPlaybackRate!()).toBe(1);
      expect(ready).not.toHaveBeenCalled(); expect(confirmed).not.toHaveBeenCalled();
      // Changes and another seek during buffering retain the latest preference.
      adapter.setPlaybackRate!(1.5); adapter.seekTo(180, true);
      expect(adapter.isPlaybackRateReady!()).toBe(false);
      await vi.advanceTimersByTimeAsync(1400);
      expect(adapter.isPlaybackRateReady!()).toBe(true);
      expect(adapter.getPlaybackRate!()).toBe(1.5);
      expect(ready.mock.results.at(-1)?.value).toBe(3000);
      expect(confirmed).toHaveBeenLastCalledWith(1.5);
    } finally { vi.useRealTimers(); }
  });
  it('reapplies the preference after ordinary buffering ends in a paused state', async () => {
    const env = setup(), ready = vi.fn();
    const adapter = await createRecordingPlayer({ uploads, start: 20, ...env, onPlaybackRateReady: ready });
    adapter.setPlaybackRate!(2); await Promise.resolve(); ready.mockClear();
    env.change(3); env.video.setPlaybackRate!(1); await Promise.resolve();
    expect(adapter.isPlaybackRateReady!()).toBe(false); expect(ready).not.toHaveBeenCalled();
    env.change(2); await Promise.resolve();
    expect(adapter.isPlaybackRateReady!()).toBe(true);
    expect(adapter.getPlaybackRate!()).toBe(2); expect(ready).toHaveBeenCalled();
  });
  it('reapplies a requested speed after an upload resets it asynchronously', async () => {
    const env = setup(), adapter = await createRecordingPlayer({ uploads, start: 20, ...env });
    adapter.setPlaybackRate!(2); adapter.seekTo(175, true); adapter.playVideo();
    await vi.waitFor(() => { expect(adapter.getPlayerState()).toBe(1); expect(adapter.getPlaybackRate!()).toBe(2); });
    expect(vi.mocked(env.video.setPlaybackRate!).mock.calls.filter(([value]) => value === 2).length).toBeGreaterThanOrEqual(2);
    expect(adapter.getAvailablePlaybackRates!()).toEqual([0.5, 1, 1.5, 2]);
  });
  it('does not override native watch-page speed changes without an explicit editor preference', async () => {
    const env = setup(); await createRecordingPlayer({ uploads, start: 20, ...env });
    env.video.setPlaybackRate!(1.5); env.change(1);
    await Promise.resolve();
    expect(env.video.getPlaybackRate!()).toBe(1.5);
  });
  it('holds a direct seek inside a gap without loading any provider', async () => {
    const env = setup(), adapter = await createRecordingPlayer({ uploads, start: 125, ...env });
    expect(env.mount).not.toHaveBeenCalled();
    expect(adapter.isPlaybackRateReady!()).toBe(false);
    expect(adapter.getCurrentTime()).toBe(125);
    expect(adapter.unavailable).toMatchObject({ start: 100, end: 160, previous: 0, next: 160 });
    adapter.playVideo(); expect(env.mount).not.toHaveBeenCalled(); expect(adapter.getPlayerState()).toBe(2);
    adapter.seekTo(175, true); adapter.playVideo();
    await vi.waitFor(() => expect(adapter.getPlayerState()).toBe(1));
    expect(env.mount.mock.calls[0][0].id).toBe('AVAILABLE02');
    expect(env.video.getCurrentTime()).toBe(20);
    expect(adapter.getCurrentTime()).toBe(175);
    expect(adapter.unavailable).toBeUndefined();
  });
  it('stops at an unavailable next upload rather than requesting or silently skipping it', async () => {
    const env = setup(), adapter = await createRecordingPlayer({ uploads, start: 20, ...env });
    adapter.playVideo(); env.change(0);
    await vi.waitFor(() => expect(adapter.unavailable?.time).toBe(100));
    expect(adapter.getCurrentTime()).toBe(100);
    expect(env.video.loadVideoById).not.toHaveBeenCalled(); expect(env.video.cueVideoById).not.toHaveBeenCalled();
    adapter.seekTo(160, true); adapter.playVideo();
    await vi.waitFor(() => expect(adapter.getPlayerState()).toBe(1));
    expect(env.video.cueVideoById).toHaveBeenCalledWith({ videoId: 'AVAILABLE02', startSeconds: 5 });
    expect(adapter.getCurrentTime()).toBe(160);
  });
  it('preserves paused playback on a seek out of a gap and reuses the available iframe', async () => {
    const env = setup(), adapter = await createRecordingPlayer({ uploads, start: 20, ...env });
    adapter.seekTo(110, true); adapter.seekTo(170, true);
    await vi.waitFor(() => expect(adapter.getPlayerState()).toBe(5));
    expect(env.mount).toHaveBeenCalledTimes(1);
    expect(env.video.cueVideoById).toHaveBeenCalledWith({ videoId: 'AVAILABLE02', startSeconds: 15 });
    expect(adapter.getCurrentTime()).toBe(170);
  });
  it('handles leading, trailing, consecutive and entirely unavailable uploads', async () => {
    const leading = uploads.map((upload, i) => ({ ...upload, unavailable: i !== 2 }));
    expect(unavailableAt(leading, 5)).toMatchObject({ previous: undefined, next: 160 });
    const trailing = uploads.map((upload, i) => ({ ...upload, unavailable: i !== 0 }));
    expect(unavailableAt(trailing, 200)).toMatchObject({ previous: 0, next: undefined });
    const env = setup(), adapter = await createRecordingPlayer({ uploads: uploads.map(upload => ({ ...upload, unavailable: true })), start: 0, ...env });
    adapter.seekTo(200, true); adapter.playVideo();
    expect(env.mount).not.toHaveBeenCalled(); expect(adapter.getCurrentTime()).toBe(200);
    expect(adapter.unavailable).toMatchObject({ previous: undefined, next: undefined });
  });
  it('ignores a stale lazy mount after a second seek returns to a gap', async () => {
    const env = setup(); let finish!: (video: YouTubePlayer) => void;
    const mount = vi.fn(() => new Promise<YouTubePlayer>(resolve => { finish = resolve; }));
    const adapter = await createRecordingPlayer({ ...env, uploads, start: 120, mount });
    adapter.seekTo(170, true); adapter.playVideo(); adapter.seekTo(130, true); finish(env.video);
    await vi.waitFor(() => expect(env.video.pauseVideo).toHaveBeenCalled());
    expect(adapter.getCurrentTime()).toBe(130); expect(adapter.unavailable).toBeDefined();
    expect(env.video.playVideo).not.toHaveBeenCalled();
  });
});
