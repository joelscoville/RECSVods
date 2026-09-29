import { describe, expect, it } from 'vitest';
import { authorCli, parseAuthorArgs } from '../scripts/author';
import { parseQuirksArgs, quirksCli } from '../scripts/video-quirks';

const id = 'AAAAAAAAAAA';
const chapterArgs = ['add-chapter', 'fixture', '--video', id, '--title', 'A New Chapter', '--type', 'sermon', '--start', '42:54.62', '--end', '48:19', '--summary', 'A concise synopsis.'];

describe('typed author commands', () => {
  it('keeps proposal/apply explicit and preserves the human clock inputs', () => {
    expect(parseAuthorArgs(chapterArgs)).toEqual({ command: 'add-chapter', serviceId: 'fixture', apply: false, chapter: {
      video: id, title: 'A New Chapter', type: 'sermon', start: '42:54.62', end: '48:19', summary: 'A concise synopsis.',
    } });
    expect(parseAuthorArgs([...chapterArgs, '--parent', 'stable-id', '--apply'])).toMatchObject({ apply: true, chapter: { parent: 'stable-id' } });
    expect(parseAuthorArgs(['check', '--all'])).toEqual({ command: 'check', selector: '--all' });
    expect(parseAuthorArgs(['types'])).toEqual({ command: 'types' });
    expect(parseAuthorArgs(['--', '--help'])).toEqual({ command: 'help' });
  });
  it.each([
    [], ['check'], ['types', 'unexpected'], ['help', 'unexpected'], ['check', '--all', '--apply'],
    [...chapterArgs, '--apply', '--apply'], [...chapterArgs, '--title', 'Duplicate'],
    [...chapterArgs, '--parent'], [...chapterArgs, '--unknown'], chapterArgs.slice(0, -2),
  ].map(args => ({ args })))('rejects malformed arguments $args before opening the archive', ({ args }) => {
    expect(() => authorCli(args, '/nonexistent-authoring-test-root')).toThrow();
    expect(() => parseAuthorArgs(args)).toThrow();
  });
});

describe('typed quirk commands', () => {
  it('models mutually exclusive targets and audio sources', () => {
    expect(parseQuirksArgs(['report'])).toEqual({ command: 'report', selection: { kind: 'all' } });
    expect(parseQuirksArgs(['check-embeds', '--all'])).toEqual({ command: 'check-embeds', selection: { kind: 'all' }, apply: false, budgetSeconds: 600 });
    expect(parseQuirksArgs(['check-embeds', '--all', '--apply', '--budget-seconds', '120', '--start-at', id])).toMatchObject({ apply: true, budgetSeconds: 120, startAt: id });
    expect(parseQuirksArgs(['check-audio', '--video', id, '--file', '/local/source with spaces.mkv'])).toEqual({ command: 'check-audio', videoId: id, source: { kind: 'file', filename: '/local/source with spaces.mkv' } });
    expect(parseQuirksArgs(['check-audio', '--video', id, '--youtube'])).toEqual({ command: 'check-audio', videoId: id, source: { kind: 'youtube' } });
    expect(parseQuirksArgs(['flag', '--video', id, '--kind', 'audio_choppy', '--note', 'Listen here'])).toMatchObject({ command: 'flag', videoId: id, kind: 'audio_choppy', note: 'Listen here' });
    expect(parseQuirksArgs(['clear', '--video', id, '--kind', 'audio_choppy'])).toEqual({ command: 'clear', videoId: id, kind: 'audio_choppy' });
  });
  it.each([
    [], ['validate', '--all'], ['report', '--apply'], ['check-embeds'],
    ['check-embeds', '--all', '--video', id], ['check-embeds', '--all', '--all'],
    ['check-embeds', '--all', '--budget-seconds', '0'], ['check-embeds', '--all', '--budget-seconds', '901'],
    ['check-embeds', '--all', '--budget-seconds', '1.5'], ['check-embeds', '--all', '--budget-seconds', 'NaN'],
    ['check-embeds', '--video', id, '--start-at', id], ['check-embeds', '--all', '--start-at', 'bad-id'],
    ['flag', '--kind', 'audio_choppy'], ['flag', '--video', id, '--kind', 'undefined_kind'],
    ['flag', '--video', id, '--kind', 'audio_choppy', '--video', id],
    ['clear', '--video', id, '--kind', 'audio_choppy', '--note', 'Not supported'],
    ['check-audio', '--video', id], ['check-audio', '--video', id, '--file', ''],
    ['check-audio', '--video', id, '--file', 'source.mkv', '--youtube'],
    ['check-audio', '--video', id, '--file', '', '--youtube'],
    ['check-audio', '--video', id, '--youtube', '--apply'], ['help', '--all'], ['report', '--video'],
  ].map(args => ({ args })))('rejects malformed arguments $args without any archive or probe work', async ({ args }) => {
    expect(() => parseQuirksArgs(args)).toThrow();
    await expect(quirksCli(args, '/nonexistent-quirks-test-root')).rejects.not.toThrow('ENOENT');
  });
});
