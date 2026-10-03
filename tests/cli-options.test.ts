import { describe, expect, it } from 'vitest';
import { assertCommandOptions } from '../scripts/cli-options';
import { parseQuirksArgs, quirksCli } from '../scripts/video-quirks';

const id = 'AAAAAAAAAAA';
describe('typed command options', () => {
  it('refuses repeated and inapplicable options', () => {
    expect(() => assertCommandOptions([{ kind: 'option', name: 'video' }], ['video'], 'usage')).not.toThrow();
    expect(() => assertCommandOptions([{ kind: 'option', name: 'video' }, { kind: 'option', name: 'video' }], ['video'], 'usage')).toThrow('usage');
    expect(() => assertCommandOptions([{ kind: 'option', name: 'apply' }], ['video'], 'usage')).toThrow('usage');
  });
  it.each([
    ['report', '--apply'], ['check-embeds', '--all'], ['flag', '--video', id, '--kind', 'audio_choppy'],
    ['check-audio', '--video', id], ['check-audio', '--video', id, '--file', ''],
    ['check-audio', '--video', id, '--file', 'source.mkv', '--youtube'], ['check-audio', '--video', id, '--youtube', '--video', id],
    ['check-audio', '--video', id, '--youtube', '--apply'], ['help', '--all'],
  ].map(args => ({ args })))('rejects malformed quirk arguments $args before reading the archive', async ({ args }) => {
    expect(() => parseQuirksArgs(args)).toThrow();
    await expect(quirksCli(args, '/nonexistent-quirks-test-root')).rejects.not.toThrow('ENOENT');
  });
});
