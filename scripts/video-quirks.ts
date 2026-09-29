import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMap, isScalar, isSeq } from 'yaml';
import { loadArchive, type Service } from '../site/lib/archive';
import { editServiceDocument, serviceFilename } from '../site/lib/service-document';
import { QuirkKindSchema, type QuirkKind } from '../site/lib/video-quirks';
import { AudioObservationSchema, embeddingAdditions, embeddingRemovalsToReview } from './video-observations';
import { readAudioReport, writeAudioReport, writeEmbedReport } from './check-reports';
import { probeEmbeds } from './probe-embeds';

const HELP = `Usage: pnpm quirks <command> [options]
  report [--all | --video ID]                  List active flags and their check-report locations
  flag --video ID --kind KIND [--note TEXT]    Add a flag to service.yaml; optional note becomes a comment
  clear --video ID --kind KIND                Explicitly remove a flag
  check-embeds (--all | --video ID) [--apply]  Write reports; --apply only ADDS confirmed restrictions
  check-audio --video ID (--file PATH | --youtube)
                                               Write a sampled-audio report; never changes flags
  validate                                   Validate flags as part of the service schema

Kinds: ${QuirkKindSchema.options.join(', ')}
Checks write readable documents in docs/checks/. Timeouts never change flags.
Successful checks suggest removals for human review; they never erase existing flags.
Audio checks try three 6-second candidates, then up to 30 seconds of audible content.`;
function flags(args: string[]): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--all', '--video', '--kind', '--note', '--apply', '--file', '--youtube'].includes(key) || result.has(key)) throw new Error(HELP);
    if (['--all', '--apply', '--youtube'].includes(key)) result.set(key, true);
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(HELP); result.set(key, value); }
  }
  return result;
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
    if (!kinds.length) { video.delete('quirks'); return; }
    let sequence = video.get('quirks');
    if (!isSeq(sequence)) { video.set('quirks', document.createNode([])); sequence = video.get('quirks'); }
    if (!isSeq(sequence)) throw new Error('Expected a quirk list');
    sequence.items = sequence.items.filter(item => isScalar(item) && kinds.includes(item.value as QuirkKind));
    for (const kind of kinds) if (!sequence.items.some(item => isScalar(item) && item.value === kind)) sequence.add(document.createNode(kind));
    if (options.note && options.noteKind) {
      const item = sequence.items.find(item => isScalar(item) && item.value === options.noteKind);
      if (isScalar(item)) item.comment = ` ${options.note.trim()}`;
    }
  }, options.expected);
}
export async function quirksCli(args = process.argv.slice(2), root = process.cwd()) {
  const [command, ...rest] = args.filter(arg => arg !== '--');
  if (command === '--help' || command === 'help') { console.log(HELP); return; }
  if (!['report', 'flag', 'clear', 'check-embeds', 'check-audio', 'validate'].includes(command)) throw new Error(HELP);
  const options = flags(rest), services = loadArchive(root);
  const videos = new Map(services.flatMap(service => service.videos.map(video => [video.id, { ...video, service }] as const)));
  const requested = options.get('--video');
  if (requested !== undefined && (typeof requested !== 'string' || !videos.has(requested))) throw new Error('Select an exact video ID already in the archive');
  if (requested && options.has('--all')) throw new Error('Choose --video or --all');
  if (command === 'validate') { if (options.size) throw new Error(HELP); console.log(`Quirks valid in ${services.length} service files`); return; }
  const allowed = command === 'report' ? ['--video', '--all'] : command === 'check-embeds' ? ['--video', '--all', '--apply']
    : command === 'check-audio' ? ['--video', '--file', '--youtube'] : ['--video', '--kind', ...(command === 'flag' ? ['--note'] : [])];
  if ([...options.keys()].some(key => !allowed.includes(key))) throw new Error(HELP);
  const ids = requested ? [requested as string] : [...videos.keys()].sort();
  if (command === 'report') {
    console.log(JSON.stringify(ids.map(id => ({ videoId: id, quirks: videos.get(id)!.quirks ?? [], report: `docs/checks/${videos.get(id)!.service.id}.md` })), null, 2)); return;
  }
  if (command === 'check-embeds') {
    if (!requested && !options.has('--all')) throw new Error(HELP);
    const before = new Map(services.map(service => [service.id, readFileSync(serviceFilename(root, service), 'utf8')]));
    const results = await probeEmbeds(ids);
    const changes = results.map(({ videoId, observation }) => ({ videoId, observation,
      additions: embeddingAdditions(videos.get(videoId)!.quirks ?? [], observation), removalsToReview: embeddingRemovalsToReview(videos.get(videoId)!.quirks ?? [], observation) }));
    if (options.has('--apply')) {
      // Check all affected source snapshots first, then atomically edit each service.
      for (const change of changes.filter(change => change.additions.length)) {
        const service = videos.get(change.videoId)!.service;
        if (readFileSync(serviceFilename(root, service), 'utf8') !== before.get(service.id)) throw new Error(`${service.id}: source changed during the check; no flags applied`);
      }
      for (const change of changes.filter(change => change.additions.length)) {
        const video = videos.get(change.videoId)!;
        setVideoQuirks(root, video.service, video.id, [...(video.quirks ?? []), ...change.additions], { expected: before.get(video.service.id) });
        before.set(video.service.id, readFileSync(serviceFilename(root, video.service), 'utf8'));
      }
    }
    for (const change of changes) {
      const video = videos.get(change.videoId)!;
      writeEmbedReport(root, video.service.id, video.id, change.observation, video.quirks ?? [], change.additions, change.removalsToReview, options.has('--apply'));
    }
    console.log(JSON.stringify({ applied: options.has('--apply'), results: changes }, null, 2));
    if (results.some(result => result.observation.outcome === 'inconclusive')) process.exitCode = 2;
    return;
  }
  if (!requested) throw new Error(HELP);
  const id = requested as string, video = videos.get(id)!;
  if (command === 'check-audio') {
    if (Boolean(options.get('--file')) === options.has('--youtube')) throw new Error(HELP);
    const sermon = video.service.chapters.filter(chapter => chapter.video_id === id && chapter.type === 'sermon' && !chapter.parent_id);
    const args = [path.join(root, 'scripts/probe_audio.py'), '--video', id, '--duration', String(video.duration), '--start', String(sermon[0]?.start ?? 0), '--end', String(sermon.at(-1)?.end ?? video.duration)];
    const previous = readAudioReport(root, video.service.id, id);
    if (previous?.sample) args.push('--sample-start', String(previous.sample.start));
    if (options.has('--youtube')) args.push('--youtube'); else args.push('--file', String(options.get('--file')));
    const output = execFileSync('python3', args, { cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const observation = AudioObservationSchema.parse(JSON.parse(output));
    writeAudioReport(root, video.service.id, id, observation);
    console.log(JSON.stringify({ videoId: id, recordedQuirks: video.quirks ?? [], observation, report: `docs/checks/${video.service.id}.md`, applied: false }, null, 2));
    if (observation.outcome === 'inconclusive') process.exitCode = 2;
    return;
  }
  const kind = QuirkKindSchema.parse(options.get('--kind'));
  const next = command === 'flag' ? [...new Set([...(video.quirks ?? []), kind])] : (video.quirks ?? []).filter(item => item !== kind);
  setVideoQuirks(root, video.service, id, next, { note: options.get('--note') as string | undefined, noteKind: kind });
  console.log(JSON.stringify({ videoId: id, quirks: next, source: `services/${video.service.date.slice(0, 4)}/${video.service.id}/service.yaml` }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await quirksCli(); } catch (error) {
    console.error(error instanceof Error && !('stderr' in error) ? error.message : 'Quirk check failed; private tool details withheld.'); process.exitCode = 1;
  }
}
