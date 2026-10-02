/** Playback quirks: list them, or sample an upload's audio into a check report. Flags themselves are
 * edited by hand in the recording file (`uploadQuirks`), after someone has listened. */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadRecordings, type StoredRecording } from '../site/lib/recordings';
import { chapterEnd, uploadSpans, type Upload } from '../site/lib/recording-schema';
import { QuirkKindSchema } from '../site/lib/video-quirks';
import { AudioObservationSchema } from './video-observations';
import { readAudioReport, writeAudioReport } from './check-reports';
import { assertCommandOptions } from './cli-options';

const HELP = `Usage: pnpm quirks <command> [options]
  report                                       List the flags in every recording file
  check-audio --video ID (--file PATH | --youtube)
                                               Write a sampled-audio report to docs/checks/; never changes flags

Flags (${QuirkKindSchema.options.join(', ')}) are set by hand as uploadQuirks in services/<id>.yaml.
Audio checks try three 6-second candidates, then up to 30 seconds of audible content.`;

type AudioSource = { kind: 'youtube' } | { kind: 'file'; filename: string };
export type QuirksCommand = { command: 'help' | 'report' } | { command: 'check-audio'; videoId: string; source: AudioSource };

export function parseQuirksArgs(args: readonly string[]): QuirksCommand {
  const [command, ...rest] = args.filter(arg => arg !== '--');
  const { values, tokens } = parseArgs({ args: rest, strict: true, tokens: true, options: {
    video: { type: 'string' }, file: { type: 'string' }, youtube: { type: 'boolean' },
  } });
  const allowed = (...names: string[]) => assertCommandOptions(tokens, names, HELP);
  switch (command) {
    case 'help': case '--help': case undefined: allowed(); return { command: 'help' };
    case 'report': allowed(); return { command: 'report' };
    case 'check-audio': {
      allowed('video', 'file', 'youtube');
      if (!values.video || !/^[A-Za-z0-9_-]{11}$/.test(values.video)) throw new Error(HELP);
      if (values.youtube && values.file === undefined) return { command, videoId: values.video, source: { kind: 'youtube' } };
      if (!values.youtube && values.file) return { command, videoId: values.video, source: { kind: 'file', filename: values.file } };
      throw new Error(HELP);
    }
    default: throw new Error(HELP);
  }
}

interface Found { recording: StoredRecording; upload: Upload; /** The sermon, in this upload's own time, if it is in it. */ sermon?: { start: number; end: number } }
function findUpload(recordings: readonly StoredRecording[], videoId: string): Found {
  for (const recording of recordings) {
    const span = uploadSpans(recording).find(item => item.upload.youtubeId === videoId);
    if (!span) continue;
    const index = recording.chapters.findIndex(chapter => chapter.chapterKind === 'sermon');
    const local = (time: number) => Math.min(span.upload.uploadDuration, Math.max(0, span.offset + time - span.start));
    const sermon = index < 0 ? undefined : { start: local(recording.chapters[index].chapterStart), end: local(chapterEnd(recording, index)) };
    return { recording, upload: span.upload, ...(sermon && sermon.end > sermon.start ? { sermon } : {}) };
  }
  throw new Error('Select an exact upload ID already in a recording file');
}
export function checkAudioSample(root: string, found: Found, source: AudioSource): void {
  const { recording, upload, sermon } = found, id = upload.youtubeId;
  const args = [path.join(root, 'scripts/probe_audio.py'), '--video', id, '--duration', String(upload.uploadDuration),
    '--start', String(sermon?.start ?? 0), '--end', String(sermon?.end ?? upload.uploadDuration)];
  const previous = readAudioReport(root, recording.recordingId, id);
  if (previous?.sample) args.push('--sample-start', String(previous.sample.start));
  if (source.kind === 'youtube') args.push('--youtube');
  else args.push('--file', source.filename);
  const output = execFileSync('python3', args, { cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const observation = AudioObservationSchema.parse(JSON.parse(output));
  writeAudioReport(root, recording.recordingId, id, observation);
  console.log(JSON.stringify({ videoId: id, recordedQuirks: upload.uploadQuirks ?? [], observation, report: `docs/checks/${recording.recordingId}.md`, applied: false }, null, 2));
  if (observation.outcome === 'inconclusive') process.exitCode = 2;
}
export async function quirksCli(args = process.argv.slice(2), root = process.cwd()) {
  const options = parseQuirksArgs(args);
  if (options.command === 'help') { console.log(HELP); return; }
  const { recordings } = loadRecordings(root);
  if (options.command !== 'check-audio') {
    console.log(JSON.stringify(recordings.flatMap(recording => recording.uploads.map(upload => ({
      recording: recording.recordingId, videoId: upload.youtubeId, quirks: upload.uploadQuirks ?? [], report: `docs/checks/${recording.recordingId}.md` }))), null, 2));
    return;
  }
  checkAudioSample(root, findUpload(recordings, options.videoId), options.source);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await quirksCli(); } catch (error) {
    console.error(error instanceof Error && !('stderr' in error) ? error.message : 'Quirk check failed; private tool details withheld.'); process.exitCode = 1;
  }
}
