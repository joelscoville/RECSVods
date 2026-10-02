import { describe, expect, it } from 'vitest';
import { lineAt, parseTranscript } from '../site/lib/transcript';

describe('transcript files', () => {
  it('reads the archive’s canonical JSON and (faster-)whisper segments', () => {
    const text = JSON.stringify({ schema_version: 1, youtube_id: 'abcdefghijk', segments: [
      { start: 3, end: 5, text: ' Second line ' }, { start: 1, end: 3, text: 'First line', words: [] }, { start: 6, end: 7, text: '   ' },
    ] });
    expect(parseTranscript('a.json', text)).toEqual({ name: 'a.json', videoId: 'abcdefghijk', lines: [
      { start: 1, end: 3, text: 'First line' }, { start: 3, end: 5, text: 'Second line' }] });
  });
  it('reads whisper.cpp JSON, with millisecond offsets or clock timestamps', () => {
    const text = JSON.stringify({ transcription: [
      { offsets: { from: 1500, to: 4000 }, text: ' Grace and peace.' },
      { timestamps: { from: '00:00:04,000', to: '00:00:06,250' }, text: ' Amen.' },
    ] });
    expect(parseTranscript('w.json', text).lines).toEqual([{ start: 1.5, end: 4, text: 'Grace and peace.' }, { start: 4, end: 6.25, text: 'Amen.' }]);
  });
  it('reads SRT and WebVTT, dropping markup and YouTube’s rolling repeats', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,500\nHello <i>there</i>\n\n2\n00:00:02,500 --> 00:00:04,000\nfriends &amp; family\n';
    expect(parseTranscript('a.srt', srt).lines).toEqual([{ start: 1, end: 2.5, text: 'Hello there' }, { start: 2.5, end: 4, text: 'friends & family' }]);
    const vtt = 'WEBVTT\nKind: captions\n\n00:01.000 --> 00:03.000 align:start position:0%\nlet us pray\n\n00:03.000 --> 00:05.000\nlet us pray\n\n00:05.000 --> 00:07.000\nlet us pray together now\n';
    expect(parseTranscript('a.vtt', vtt).lines).toEqual([{ start: 1, end: 5, text: 'let us pray' }, { start: 5, end: 7, text: 'together now' }]);
  });
  it('explains files it cannot use', () => {
    expect(() => parseTranscript('a.txt', 'just some words')).toThrow(/transcript JSON, .srt or .vtt/);
    expect(() => parseTranscript('a.json', '{"items": []}')).toThrow(/no transcript segments/);
    expect(() => parseTranscript('a.vtt', 'WEBVTT\n\n')).toThrow();
  });
  it('finds the line being spoken', () => {
    const lines = [{ start: 0, end: 2, text: 'a' }, { start: 2, end: 4, text: 'b' }, { start: 10, end: 12, text: 'c' }];
    expect([lineAt(lines, -1), lineAt(lines, 0), lineAt(lines, 3), lineAt(lines, 7), lineAt(lines, 99)]).toEqual([-1, 0, 1, 1, 2]);
  });
});
