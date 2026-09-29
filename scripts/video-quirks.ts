import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isMap, isScalar, isSeq } from 'yaml';
import { loadArchive, YoutubeIdSchema, type Service, type Video } from '../site/lib/archive';
import { editServiceDocument, serviceFilename } from '../site/lib/service-document';
import { QuirkKindSchema, type QuirkKind } from '../site/lib/video-quirks';
import { AudioObservationSchema, embeddingAdditions, embeddingRemovalsToReview } from './video-observations';
import { readAudioReport, writeAudioReport, writeEmbedReport } from './check-reports';
import { checkArchiveEmbeds, DEFAULT_EMBED_BUDGET_SECONDS, MAX_EMBED_BUDGET_SECONDS } from './embed-checks';
import { assertCommandOptions } from './cli-options';

const HELP = `Usage: pnpm quirks <command> [options]
  report [--all | --video ID]                  List active flags and their check-report locations
  flag --video ID --kind KIND [--note TEXT]    Add a flag to service.yaml; optional note becomes a comment
  clear --video ID --kind KIND                Explicitly remove a flag
  check-embeds (--all | --video ID) [--apply]  Write reports; --apply only ADDS confirmed restrictions
               [--budget-seconds N]          Shared probing budget: 1–900 seconds, default 600
               [--start-at ID]               With --all, start here and wrap through the archive
  check-audio --video ID (--file PATH | --youtube)
                                               Write a sampled-audio report; never changes flags
  validate                                   Validate flags as part of the service schema

Kinds: ${QuirkKindSchema.options.join(', ')}
Checks write readable documents in docs/checks/. Timeouts never change flags.
Successful checks suggest removals for human review; they never erase existing flags.
Embedding checks use batches of at most 50. Unchecked IDs and nextStartAt are reported
when the budget runs out (exit 2); cleanup may take additional time.
Audio checks try three 6-second candidates, then up to 30 seconds of audible content.`;

type VideoSelection = { kind: 'all' } | { kind: 'video'; videoId: string };
type AudioSource = { kind: 'youtube' } | { kind: 'file'; filename: string };
export type QuirksCommand =
  | { command: 'help' | 'validate' }
  | { command: 'report'; selection: VideoSelection }
  | { command: 'flag'; videoId: string; kind: QuirkKind; note?: string }
  | { command: 'clear'; videoId: string; kind: QuirkKind }
  | { command: 'check-embeds'; selection: VideoSelection; apply: boolean; budgetSeconds: number; startAt?: string }
  | { command: 'check-audio'; videoId: string; source: AudioSource };

export function parseQuirksArgs(args: readonly string[]): QuirksCommand {
  const [command, ...rest] = args.filter(arg => arg !== '--');
  const { values, tokens } = parseArgs({ args: rest, strict: true, tokens: true, options: {
    all: { type: 'boolean' }, video: { type: 'string' }, kind: { type: 'string' }, note: { type: 'string' },
    apply: { type: 'boolean' }, file: { type: 'string' }, youtube: { type: 'boolean' },
    'budget-seconds': { type: 'string' }, 'start-at': { type: 'string' },
  } });
  const allowed = (...names: string[]) => assertCommandOptions(tokens, names, HELP);
  const videoId = () => {
    if (!values.video) throw new Error(HELP);
    return YoutubeIdSchema.parse(values.video);
  };
  const selection = (required: boolean): VideoSelection => {
    if (values.video !== undefined) {
      if (values.all) throw new Error('Choose --video or --all');
      return { kind: 'video', videoId: videoId() };
    }
    if (required && !values.all) throw new Error(HELP);
    return { kind: 'all' };
  };
  switch (command) {
    case 'help':
    case '--help':
      allowed();
      return { command: 'help' };
    case 'validate':
      allowed();
      return { command };
    case 'report':
      allowed('all', 'video');
      return { command, selection: selection(false) };
    case 'flag':
      allowed('video', 'kind', 'note');
      return { command, videoId: videoId(), kind: QuirkKindSchema.parse(values.kind), note: values.note };
    case 'clear':
      allowed('video', 'kind');
      return { command, videoId: videoId(), kind: QuirkKindSchema.parse(values.kind) };
    case 'check-embeds': {
      allowed('all', 'video', 'apply', 'budget-seconds', 'start-at');
      const target = selection(true);
      const enteredBudget = values['budget-seconds'];
      const budgetSeconds = enteredBudget === undefined ? DEFAULT_EMBED_BUDGET_SECONDS : Number(enteredBudget);
      if (enteredBudget !== undefined && !/^\d+$/.test(enteredBudget) || !Number.isInteger(budgetSeconds) || budgetSeconds < 1 || budgetSeconds > MAX_EMBED_BUDGET_SECONDS) {
        throw new Error(`Embed budget must be 1–${MAX_EMBED_BUDGET_SECONDS} whole seconds`);
      }
      const startAt = values['start-at'];
      if (startAt !== undefined) {
        if (target.kind !== 'all') throw new Error('--start-at requires --all');
        YoutubeIdSchema.parse(startAt);
      }
      return { command, selection: target, apply: values.apply ?? false, budgetSeconds, startAt };
    }
    case 'check-audio': {
      allowed('video', 'file', 'youtube');
      if (values.youtube) {
        if (values.file !== undefined) throw new Error(HELP);
        return { command, videoId: videoId(), source: { kind: 'youtube' } };
      }
      if (!values.file) throw new Error(HELP);
      return { command, videoId: videoId(), source: { kind: 'file', filename: values.file } };
    }
    default: throw new Error(HELP);
  }
}
export function setVideoQuirks(root: string, service: Service, videoId: string, next: readonly QuirkKind[], options: { expected?: string; note?: string; noteKind?: QuirkKind } = {}): void {
  const kinds = next.map(kind => QuirkKindSchema.parse(kind));
  if (new Set(kinds).size !== kinds.length) throw new Error('Duplicate quirk');
  if (options.note !== undefined && (!options.note.trim() || options.note.length > 240)) throw new Error('Keep the review comment between 1 and 240 characters');
  editServiceDocument(root, service, document => {
    const videos = document.get('videos');
    if (!isSeq(videos)) throw new Error('Missing videos');
    const video = videos.items.find(item => isMap(item) && item.get('id') === videoId);
    if (!isMap(video)) throw new Error('Video does not belong to this service');
    if (!kinds.length) {
      video.delete('quirks');
      return;
    }
    let sequence = video.get('quirks');
    if (!isSeq(sequence)) {
      video.set('quirks', document.createNode([]));
      sequence = video.get('quirks');
    }
    if (!isSeq(sequence)) throw new Error('Expected a quirk list');
    sequence.items = sequence.items.filter(item => isScalar(item) && kinds.some(kind => kind === item.value));
    for (const kind of kinds) {
      if (!sequence.items.some(item => isScalar(item) && item.value === kind)) sequence.add(document.createNode(kind));
    }
    if (options.note && options.noteKind) {
      const item = sequence.items.find(item => isScalar(item) && item.value === options.noteKind);
      if (isScalar(item)) item.comment = ` ${options.note.trim()}`;
    }
  }, options.expected);
}
interface ArchiveVideo extends Video { service: Service }
type VideoIndex = ReadonlyMap<string, ArchiveVideo>;
function findVideo(videos: VideoIndex, videoId: string): ArchiveVideo {
  const video = videos.get(videoId);
  if (!video) throw new Error('Select an exact video ID already in the archive');
  return video;
}
function selectVideos(videos: VideoIndex, selection: VideoSelection): ArchiveVideo[] {
  if (selection.kind === 'video') return [findVideo(videos, selection.videoId)];
  return [...videos.keys()].sort().map(id => findVideo(videos, id));
}
function reportQuirks(videos: readonly ArchiveVideo[]): void {
  console.log(JSON.stringify(videos.map(video => ({ videoId: video.id, quirks: video.quirks ?? [], report: `docs/checks/${video.service.id}.md` })), null, 2));
}
export async function checkEmbeddingRestrictions(root: string, videos: VideoIndex, options: Extract<QuirksCommand, { command: 'check-embeds' }>) {
  const selected = selectVideos(videos, options.selection);
  const services = new Map(selected.map(video => [video.service.id, video.service]));
  const before = new Map([...services.values()].map(service => [service.id, readFileSync(serviceFilename(root, service), 'utf8')]));
  const { results, ...coverage } = await checkArchiveEmbeds(selected.map(video => video.id), options);
  const changes = results.map(({ videoId, observation }) => {
    const flags = findVideo(videos, videoId).quirks ?? [];
    return { videoId, observation, additions: embeddingAdditions(flags, observation), removalsToReview: embeddingRemovalsToReview(flags, observation) };
  });
  if (options.apply) {
    const additions = changes.filter(change => change.additions.length);
    // Check all affected snapshots before editing; then atomically update each service.
    for (const change of additions) {
      const service = findVideo(videos, change.videoId).service;
      if (readFileSync(serviceFilename(root, service), 'utf8') !== before.get(service.id)) {
        throw new Error(`${service.id}: source changed during the check; no flags applied`);
      }
    }
    for (const change of additions) {
      const video = findVideo(videos, change.videoId);
      setVideoQuirks(root, video.service, video.id, [...(video.quirks ?? []), ...change.additions], { expected: before.get(video.service.id) });
      before.set(video.service.id, readFileSync(serviceFilename(root, video.service), 'utf8'));
    }
  }
  for (const change of changes) {
    const video = findVideo(videos, change.videoId);
    writeEmbedReport(root, video.service.id, video.id, change.observation, video.quirks ?? [], change.additions, change.removalsToReview, options.apply);
  }
  console.log(JSON.stringify({ applied: options.apply, results: changes, ...coverage }, null, 2));
  if (coverage.skippedVideoIds.length || results.some(result => result.observation.outcome === 'inconclusive')) process.exitCode = 2;
}
export function checkAudioSample(root: string, video: ArchiveVideo, source: AudioSource): void {
  const sermon = video.service.chapters.filter(chapter => chapter.video_id === video.id && chapter.type === 'sermon' && !chapter.parent_id);
  const args = [path.join(root, 'scripts/probe_audio.py'), '--video', video.id, '--duration', String(video.duration), '--start', String(sermon[0]?.start ?? 0), '--end', String(sermon.at(-1)?.end ?? video.duration)];
  const previous = readAudioReport(root, video.service.id, video.id);
  if (previous?.sample) args.push('--sample-start', String(previous.sample.start));
  if (source.kind === 'youtube') args.push('--youtube');
  else args.push('--file', source.filename);
  const output = execFileSync('python3', args, { cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const observation = AudioObservationSchema.parse(JSON.parse(output));
  writeAudioReport(root, video.service.id, video.id, observation);
  console.log(JSON.stringify({ videoId: video.id, recordedQuirks: video.quirks ?? [], observation, report: `docs/checks/${video.service.id}.md`, applied: false }, null, 2));
  if (observation.outcome === 'inconclusive') process.exitCode = 2;
}
function changeQuirk(root: string, video: ArchiveVideo, options: Extract<QuirksCommand, { command: 'flag' | 'clear' }>): void {
  const previous = video.quirks ?? [];
  const next = options.command === 'flag' ? [...new Set([...previous, options.kind])] : previous.filter(kind => kind !== options.kind);
  const note = options.command === 'flag' ? options.note : undefined;
  setVideoQuirks(root, video.service, video.id, next, { note, noteKind: options.kind });
  console.log(JSON.stringify({ videoId: video.id, quirks: next, source: `services/${video.service.date.slice(0, 4)}/${video.service.id}/service.yaml` }, null, 2));
}
export async function quirksCli(args = process.argv.slice(2), root = process.cwd()) {
  const options = parseQuirksArgs(args);
  if (options.command === 'help') {
    console.log(HELP);
    return;
  }
  const services = loadArchive(root);
  const videos: VideoIndex = new Map(services.flatMap(service => service.videos.map(video => [video.id, { ...video, service }] as const)));
  switch (options.command) {
    case 'validate': console.log(`Quirks valid in ${services.length} service files`); return;
    case 'report': reportQuirks(selectVideos(videos, options.selection)); return;
    case 'check-embeds': await checkEmbeddingRestrictions(root, videos, options); return;
    case 'check-audio': checkAudioSample(root, findVideo(videos, options.videoId), options.source); return;
    case 'flag':
    case 'clear': changeQuirk(root, findVideo(videos, options.videoId), options); return;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await quirksCli(); } catch (error) {
    console.error(error instanceof Error && !('stderr' in error) ? error.message : 'Quirk check failed; private tool details withheld.'); process.exitCode = 1;
  }
}
