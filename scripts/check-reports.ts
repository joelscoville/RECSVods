/** Readable diagnostic documents. Site builds never read these files. */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { processingFields } from '../site/lib/processing-provenance';
import { formatTimecode } from '../site/lib/timecode';
import { AudioObservationSchema, type AudioObservation, type EmbedObservation } from './video-observations';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/), videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const ProcessingContextSchema = z.object({ serviceId: id,
  videos: z.record(videoId, z.object(processingFields).strict()),
  chapters: z.record(id, z.object({ source_chapters: z.array(id).min(1).optional(), confidence: z.number().min(0).max(1).optional() }).strict()),
}).strict();
export type ProcessingContext = z.infer<typeof ProcessingContextSchema>;
const escape = (value: string) => value.replace(/[|<>`]/g, character => ({ '|': '\\|', '<': '&lt;', '>': '&gt;', '`': '\\`' })[character]!);
export function reportFilename(root: string, serviceId: string): string {
  id.parse(serviceId);
  let directory = realpathSync(root);
  for (const component of ['docs', 'checks']) {
    directory = path.join(directory, component);
    if (lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Check-report directories must not be symlinks');
  }
  const filename = path.join(directory, `${serviceId}.md`);
  if (lstatSync(filename, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Check report must not be a symlink');
  return filename;
}
export function reportSection(text: string, key: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('Invalid report section');
  const start = `<!-- recs-${key} -->`, end = `<!-- /recs-${key} -->`;
  const from = text.indexOf(start), to = text.indexOf(end);
  if (from === -1 && to === -1) return undefined;
  if (from === -1 || to < from || text.indexOf(start, from + 1) !== -1 || text.indexOf(end, to + 1) !== -1) throw new Error('Malformed generated check-report section');
  return text.slice(from + start.length, to).trim();
}
function payload(section: string): unknown {
  const match = /```json\n([\s\S]*?)\n```/.exec(section);
  if (!match) throw new Error('Missing diagnostic appendix');
  return JSON.parse(match[1]);
}
export function readProcessingContext(root: string, serviceId: string): ProcessingContext | undefined {
  const filename = reportFilename(root, serviceId);
  if (!existsSync(filename)) return undefined;
  const section = reportSection(readFileSync(filename, 'utf8'), 'processing');
  if (!section) return undefined;
  const context = ProcessingContextSchema.parse(payload(section));
  if (context.serviceId !== serviceId) throw new Error('Processing report belongs to another service');
  return context;
}
export function writeReportSection(root: string, serviceId: string, key: string, content: string): void {
  const filename = reportFilename(root, serviceId);
  const before = existsSync(filename) ? readFileSync(filename, 'utf8') : `# Checks and processing reference — ${serviceId}\n\nThis document records technical checks. Active metadata and playback quirks belong in \`service.yaml\`.\n`;
  const old = reportSection(before, key);
  const start = `<!-- recs-${key} -->`, end = `<!-- /recs-${key} -->`, block = `${start}\n${content.trim()}\n${end}`;
  const after = old === undefined ? `${before.trimEnd()}\n\n${block}\n` : before.slice(0, before.indexOf(start)) + block + before.slice(before.indexOf(end) + end.length);
  mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, after, { flag: 'wx' }); renameSync(temporary, filename); }
  finally { rmSync(temporary, { force: true }); }
}
export function processingReport(context: ProcessingContext): string {
  return `## Processing reference\n\nGenerated provenance and migration lineage, retained for explicit vector regeneration and investigation. The website does not load this appendix. Human review does not require checking hardware settings or hashes.\n\n<details>\n<summary>Processing provenance and original chapter lineage</summary>\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\n</details>`;
}
export function writeEmbedReport(root: string, serviceId: string, video: string, observation: EmbedObservation, flags: readonly string[], additions: readonly string[], removals: readonly string[], applied: boolean): void {
  videoId.parse(video);
  writeReportSection(root, serviceId, `embed-${video}`, `## Embedding check — ${video}\n\n| Check | Result |\n| --- | --- |\n| Checked at | ${observation.checkedAt} |\n| Result | ${observation.outcome} |\n| YouTube error | ${observation.errorCode ?? 'None'} |\n| Detail | ${observation.reason ?? 'Not supplied'} |\n| Recorded quirks before this check | ${flags.join(', ') || 'None recorded'} |\n| ${applied ? 'Flags added' : 'Suggested additions'} | ${additions.join(', ') || 'None'} |\n| Existing flags to review for removal | ${removals.join(', ') || 'None'} |\n\nAn inconclusive check makes no metadata changes. Successful playback does not automatically remove an existing flag. This result reflects the checker’s browser and network, not every region.`);
}
export function writeAudioReport(root: string, serviceId: string, video: string, observation: AudioObservation): void {
  videoId.parse(video);
  const range = observation.sample ? `${formatTimecode(observation.sample.start)}–${formatTimecode(observation.sample.end)}` : 'No usable sample';
  writeReportSection(root, serviceId, `audio-${video}`, `## Audio check — ${video}\n\n| Check | Result |\n| --- | --- |\n| Checked at | ${observation.checkedAt} |\n| Source | ${observation.source} |\n| Result | ${observation.outcome} |\n| Sample | ${range} |\n| Candidates tried | ${observation.candidates} |\n| Possible issues | ${observation.detected.join(', ') || 'None detected in this sample'} |\n| Detail | ${observation.reason ?? 'Analysis completed'} |\n\nThese are sampled measurements, not certification of the whole recording. Listen to confirm any suggested audio quirk. No active flags were added or removed.\n\n<details>\n<summary>Measurements and reproducible sample location</summary>\n\n\`\`\`json\n${JSON.stringify(observation, null, 2)}\n\`\`\`\n\n</details>`);
}
export function readAudioReport(root: string, serviceId: string, video: string): AudioObservation | undefined {
  videoId.parse(video);
  const filename = reportFilename(root, serviceId);
  if (!existsSync(filename)) return undefined;
  const section = reportSection(readFileSync(filename, 'utf8'), `audio-${video}`);
  return section ? AudioObservationSchema.parse(payload(section)) : undefined;
}
export function formatReviewTable(service: { chapters: { id: string; title: string; video_id: string; start: number; end: number; type: string }[] }): string {
  return '| Chapter | Start | End | Type | Source |\n| --- | --- | --- | --- | --- |\n' + service.chapters.map(chapter =>
    `| ${escape(chapter.title)} (\`${chapter.id}\`) | [${formatTimecode(chapter.start)}](https://www.youtube.com/watch?v=${chapter.video_id}&t=${Math.floor(chapter.start)}) | [${formatTimecode(chapter.end)}](https://www.youtube.com/watch?v=${chapter.video_id}&t=${Math.floor(chapter.end)}) | ${chapter.type} | \`${chapter.video_id}\` |`).join('\n');
}
