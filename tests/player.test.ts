import { describe, expect, it, vi } from 'vitest';
import { createChapterController, type PlayerAdapter } from '../site/lib/player';
import { basePath, formatDuration, formatTime, readWatchTarget, searchUrl, serviceUrl, siteUrl, watchUrl, youtubeUrl } from '../site/lib/urls';
import { clearLocalState, getSavedPlayback, getSearchHistory, savePlayback, saveSearch } from '../site/lib/local-state';
import { clearSearchHistory } from '../site/lib/local-state';

function setup() {
  let time = 0;
  let state = 2;
  const adapter: PlayerAdapter = {
    seekTo: vi.fn((next: number) => { time = next; }),
    playVideo: vi.fn(() => { state = 1; }),
    pauseVideo: vi.fn(() => { state = 2; }),
    getCurrentTime: () => time,
    getPlayerState: () => state,
    destroy: vi.fn(),
  };
  const onEnd = vi.fn();
  const controller = createChapterController(adapter, onEnd);
  return { adapter, controller, onEnd, seekManually: (next: number) => { time = next; }, setState: (next: number) => { state = next; } };
}

describe('chapter playback boundaries', () => {
  it('seeks to the selected chapter start and plays through the adapter', () => {
    const { adapter, controller } = setup();
    controller.setChapter({ id: 'c1', start: 42.5, end: 70 });
    expect(adapter.seekTo).toHaveBeenCalledWith(42.5, true);
    expect(adapter.playVideo).toHaveBeenCalledOnce();
    expect(controller.tick()).toBe(false);
  });
  it('soft-pauses exactly once at the end while actually playing', () => {
    const { adapter, controller, seekManually, setState, onEnd } = setup();
    controller.setChapter({ id: 'c1', start: 10, end: 20 });
    seekManually(20);
    setState(2);
    expect(controller.tick()).toBe(false);
    setState(3);
    expect(controller.tick()).toBe(false);
    setState(1);
    expect(controller.tick()).toBe(true);
    expect(controller.ended).toBe(true);
    setState(1);
    expect(controller.tick()).toBe(false);
    expect(adapter.pauseVideo).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });
  it('leaves manual seeks before the endpoint intact, including before the chapter start', () => {
    const { adapter, controller, seekManually } = setup();
    controller.setChapter({ id: 'c1', start: 60, end: 100 });
    seekManually(4);
    controller.tick();
    seekManually(90);
    controller.tick();
    expect(adapter.seekTo).toHaveBeenCalledTimes(1);
    expect(adapter.pauseVideo).not.toHaveBeenCalled();
  });
  it('handles a seek beyond the endpoint as a single soft stop without rewinding', () => {
    const { adapter, controller, seekManually } = setup();
    controller.setChapter({ id: 'c1', start: 10, end: 20 });
    seekManually(120);
    expect(controller.tick()).toBe(true);
    expect(adapter.seekTo).toHaveBeenCalledTimes(1);
    expect(adapter.getCurrentTime()).toBe(120);
  });
  it('replay seeks back and rearms the endpoint', () => {
    const { adapter, controller, seekManually } = setup();
    controller.setChapter({ id: 'c1', start: 10, end: 20 });
    seekManually(20);
    controller.tick();
    controller.replay();
    expect(controller.ended).toBe(false);
    expect(adapter.seekTo).toHaveBeenLastCalledWith(10, true);
    seekManually(20.1);
    expect(controller.tick()).toBe(true);
    expect(adapter.pauseVideo).toHaveBeenCalledTimes(2);
  });
  it('continue disables the endpoint without seeking and replay restores it', () => {
    const { adapter, controller, seekManually } = setup();
    controller.setChapter({ id: 'c1', start: 10, end: 20 });
    seekManually(20);
    controller.tick();
    controller.continueWatching();
    seekManually(40);
    expect(controller.tick()).toBe(false);
    expect(controller.ended).toBe(false);
    expect(adapter.seekTo).toHaveBeenCalledTimes(1);
    controller.replay();
    seekManually(20);
    expect(controller.tick()).toBe(true);
  });
  it('new chapter resets continuation and seeks to its own start', () => {
    const { controller, adapter, seekManually } = setup();
    controller.setChapter({ id: 'c1', start: 10, end: 20 });
    controller.continueWatching();
    controller.setChapter({ id: 'c2', start: 40, end: 60 });
    expect(adapter.seekTo).toHaveBeenLastCalledWith(40, true);
    seekManually(60);
    expect(controller.tick()).toBe(true);
  });
  it('a recording gap without a chapter has no invented endpoint', () => {
    const { controller, adapter, seekManually } = setup();
    controller.setChapter({ id: 'c1', start: 10, end: 20 });
    controller.setChapter({ id: 'gap', start: 30 });
    seekManually(500);
    expect(controller.tick()).toBe(false);
    expect(adapter.pauseVideo).not.toHaveBeenCalled();
  });
  it('supports preparing a range without autoplay and rejects invalid ranges', () => {
    const { controller, adapter } = setup();
    controller.setChapter({ id: 'c1', start: 10, end: 20 }, false);
    expect(adapter.playVideo).not.toHaveBeenCalled();
    expect(() => controller.setChapter({ id: 'bad', start: -1 })).toThrow();
    expect(() => controller.setChapter({ id: 'bad', start: 10, end: 10 })).toThrow();
    expect(() => controller.setChapter({ id: 'bad', start: 10, end: Infinity })).toThrow();
  });
  it('does not treat an unavailable current time as a completed chapter', () => {
    const { controller, seekManually, adapter } = setup();
    controller.setChapter({ id: 'c1', start: 10, end: 20 });
    seekManually(NaN);
    expect(controller.tick()).toBe(false);
    expect(adapter.pauseVideo).not.toHaveBeenCalled();
  });
});

describe('resume and replay', () => {
  it('resumes within a chapter but replays from its full start', () => {
    const { controller, adapter, seekManually } = setup();
    controller.setChapter({ id: 'c1', start: 10, end: 60, resumeAt: 42 });
    expect(adapter.seekTo).toHaveBeenLastCalledWith(42, true);
    seekManually(60); expect(controller.tick()).toBe(true);
    controller.replay(); expect(adapter.seekTo).toHaveBeenLastCalledWith(10, true);
  });
  it.each([-1, 9, 60, 100, NaN, Infinity])('ignores unsafe resume time %s', (resumeAt) => {
    const { controller, adapter } = setup();
    controller.setChapter({ id: 'c1', start: 10, end: 60, resumeAt });
    expect(adapter.seekTo).toHaveBeenLastCalledWith(10, true);
  });
});

describe('base-aware shareable URLs', () => {
  it.each(['/', '/review/', '/review', '/review//'])('normalizes base %s without doubled slashes', (base) => {
    const expected = base === '/' ? '/' : '/review/';
    expect(basePath(base)).toBe(expected);
    expect(siteUrl(base, '/search/')).toBe(`${expected}search/`);
    expect(watchUrl(base, { recording: '2026-09-06', start: 42.9, focus: 'sermon-point-1' })).toBe(`${expected}watch/?r=2026-09-06&t=42&focus=sermon-point-1`);
  });
  it('rejects external and traversal deployment bases', () => {
    expect(() => basePath('https://external.example/')).toThrow();
    expect(() => basePath('/../')).toThrow();
  });
  it('encodes queries once and keeps empty browse routes clean', () => {
    expect(searchUrl('/review/', '')).toBe('/review/search/');
    const url = new URL(searchUrl('/review/', ' John 3:16 & hope '), 'https://example.test');
    expect(url.searchParams.get('q')).toBe('John 3:16 & hope');
    expect(url.pathname).toBe('/review/search/');
  });
  it('links by recording and time, with an optional focus', () => {
    const target = { recording: '2026-09-06', start: 87.5 };
    const url = new URL(watchUrl('/review/', target), 'https://example.test');
    expect(readWatchTarget(url.search)).toEqual({ recording: '2026-09-06', start: 87, focus: undefined });
    expect(watchUrl('/', { recording: '2026-09-06', start: 0 })).toBe('/watch/?r=2026-09-06');
    // Old chapter and passage links are no longer read.
    expect(readWatchTarget('?chapter=chapter-1&id=stable-id')).toEqual({ recording: undefined, focus: undefined, start: undefined });
    expect(readWatchTarget('?r=2026-09-06&focus=sermon-point-2').focus).toBe('sermon-point-2');
    expect(readWatchTarget('?t=-1').start).toBeUndefined();
    expect(readWatchTarget('?t=Infinity').start).toBeUndefined();
    expect(readWatchTarget('?t=1e10').start).toBeUndefined();
  });
  it('encodes service IDs and provides timestamped YouTube fallbacks', () => {
    expect(serviceUrl('/review/', 'service-1')).toBe('/review/services/service-1/');
    expect(serviceUrl('/', 'a/b')).toBe('/services/a%2Fb/');
    expect(youtubeUrl('abcdefghijk', 65.9)).toBe('https://www.youtube.com/watch?v=abcdefghijk&t=65');
    expect(formatTime(3661)).toBe('1:01:01');
    expect(formatTime(61)).toBe('1:01');
    expect(formatDuration(6628)).toBe('1 h 50 min');
    expect(formatDuration(7200)).toBe('2 h');
    expect(formatDuration(76)).toBe('1 min 16 s');
    expect(formatDuration(725)).toBe('12 min');
    expect(formatDuration(45)).toBe('45 s');
  });
});

describe('local-only history and resume state', () => {
  it('clears search history explicitly while preserving playback and unrelated storage', () => {
    const values = new Map<string, string>([['another-site-key', 'keep']]);
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }, dispatchEvent });
    try {
      saveSearch('Romans 13');
      savePlayback({ recordingId: '2026-09-06', time: 40 });
      expect(clearSearchHistory()).toBe(true);
      expect(getSearchHistory()).toEqual([]);
      expect(getSavedPlayback()).toEqual({ recordingId: '2026-09-06', time: 40 });
      expect(values.get('another-site-key')).toBe('keep');
      expect(dispatchEvent.mock.calls[0][0].type).toBe('recs-search-history-cleared');
      expect(clearSearchHistory()).toBe(true);
      expect(clearLocalState()).toBe(true);
      expect(getSavedPlayback()).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
  it('reports a failed history removal without pretending the history was cleared', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { localStorage: { getItem: () => '["Romans 13"]', removeItem: () => { throw new Error('denied'); } }, dispatchEvent });
    try {
      expect(clearSearchHistory()).toBe(false);
      expect(getSearchHistory()).toEqual(['Romans 13']);
      expect(dispatchEvent).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('deduplicates history, persists playback and clears only RECS data', () => {
    const values = new Map<string, string>([['another-site-key', 'keep']]);
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }, dispatchEvent: vi.fn() });
    try {
      saveSearch('Hope'); saveSearch('Romans 8'); saveSearch('hope');
      expect(getSearchHistory()).toEqual(['hope', 'Romans 8']);
      expect(savePlayback({ recordingId: '2026-09-06', time: 32.8 })).toBe(true);
      expect(getSavedPlayback()?.time).toBe(32);
      expect(clearLocalState()).toBe(true);
      expect(getSearchHistory()).toEqual([]);
      expect(getSavedPlayback()).toBeNull();
      expect(values.get('another-site-key')).toBe('keep');
    } finally { vi.unstubAllGlobals(); }
  });
  it('degrades safely when storage is blocked or malformed', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('denied'); } });
    try {
      expect(getSavedPlayback()).toBeNull();
      expect(getSearchHistory()).toEqual([]);
      expect(savePlayback({ recordingId: '2026-09-06', time: 32 })).toBe(false);
      expect(clearLocalState()).toBe(false);
    } finally { vi.unstubAllGlobals(); }
    vi.stubGlobal('window', { localStorage: { getItem: () => '{invalid' } });
    try { expect(getSavedPlayback()).toBeNull(); expect(getSearchHistory()).toEqual([]); } finally { vi.unstubAllGlobals(); }
  });
});
