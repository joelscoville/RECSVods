import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { publicQuirks } from '../site/lib/video-quirks';
import { UploadSchema } from '../site/lib/recording-schema';
import { parseQuirksArgs } from '../scripts/video-quirks';
import { homeItems } from '../site/components/archive-display';
import YouTubePlayer from '../site/components/YouTubePlayer';
import VideoQuirks from '../site/components/VideoQuirks';
import { display, stored } from './recording-fixtures';

describe('playback quirks', () => {
  it('are plain flags on an upload, set by a person', () => {
    const upload = { youtubeId: 'AAAAAAAAAAA', uploadDuration: '1:30:00', uploadQuirks: ['video_freezes', 'audio_choppy'] };
    expect(UploadSchema.parse(upload).uploadQuirks).toEqual(['video_freezes', 'audio_choppy']);
    expect(publicQuirks(['audio_left_only'])).toEqual([{ kind: 'audio_left_only' }]);
    for (const uploadQuirks of [['unknown'], ['embed_blocked'], [], [{ kind: 'audio_choppy' }]]) expect(UploadSchema.safeParse({ ...upload, uploadQuirks }).success).toBe(false);
  });
  it('show on the recording card without changing what is published', () => {
    const recordings = display([stored({ uploads: [{ youtubeId: 'AAAAAAAAAAA', uploadDuration: '1:30:00', uploadQuirks: ['audio_choppy'] }] })]);
    expect(recordings[0].uploads[0].quirks).toEqual([{ kind: 'audio_choppy' }]);
    expect(homeItems(recordings, '/')[0].quirks).toEqual([{ kind: 'audio_choppy' }]);
  });
  it('audio checks only write reports, and the command takes no other options', () => {
    expect(parseQuirksArgs(['check-audio', '--video', 'AAAAAAAAAAA', '--youtube'])).toEqual({ command: 'check-audio', videoId: 'AAAAAAAAAAA', source: { kind: 'youtube' } });
    expect(parseQuirksArgs(['check-audio', '--video', 'AAAAAAAAAAA', '--file', 'a.mp4'])).toMatchObject({ source: { kind: 'file', filename: 'a.mp4' } });
    expect(parseQuirksArgs(['report'])).toEqual({ command: 'report' });
    for (const args of [['check-audio', '--video', 'AAAAAAAAAAA', '--youtube', '--apply'], ['check-audio', '--video', 'AAAAAAAAAAA'],
      ['check-audio', '--video', 'AAAAAAAAAAA', '--youtube', '--file', 'a.mp4'], ['check-audio', '--video', 'bad', '--youtube'], ['flag', '--video', 'AAAAAAAAAAA']]) {
      expect(() => parseQuirksArgs(args)).toThrow();
    }
  });
});

it('tries the embedded player first, and shows simple recording notes', () => {
  const html = renderToStaticMarkup(createElement(YouTubePlayer, { uploads: display()[0].uploads, recordingId: '2026-09-06', title: 'Fixture', range: { id: 'x', start: 42.5 }, seekRequest: 0, onTime: () => {} }));
  // "Watch on YouTube" appears only if YouTube actually refuses; until then it is the ordinary Play button.
  expect(html).toContain('Play Fixture'); expect(html).not.toContain('Watch on YouTube'); expect(html).not.toContain('<iframe');
  const notes = renderToStaticMarkup(createElement(VideoQuirks, { quirks: publicQuirks(['video_unavailable', 'audio_left_only']) }));
  expect(notes).toContain('Audio on the left only'); expect(notes).not.toMatch(/Checked|Reported|sample|measurement/);
});
