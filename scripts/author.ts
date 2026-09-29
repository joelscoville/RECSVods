import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Document, isSeq } from 'yaml';
import { ChapterSchema, loadArchive, ServiceSchema, type Service } from '../site/lib/archive';
import { editServiceDocument, quoteClockNodes, serviceFilename } from '../site/lib/service-document';
import { formatTimecode, parseTimecode } from '../site/lib/timecode';
import { CHAPTER_TYPE_HELP, SERVICE_TYPE_HELP } from '../site/lib/service-types';
import { QUIRK_LABELS } from '../site/lib/video-quirks';
import { loadServiceChapterVectors } from './chapter-vectors';
import { validateServiceOutline } from './validate-outlines';
import { formatReviewTable } from './check-reports';

const HELP = `Usage:
  pnpm author types
  pnpm author check <service-id | --all>
  pnpm author add-chapter <service-id> --video ID --title "Chapter Title" --type sermon
    --start "42:54.62" --end "48:19" --summary "A concise account of this chapter."
    [--parent EXISTING_ID] [--apply]

add-chapter prints a proposal unless --apply is present. IDs are generated once and never renumbered.
Editing an approved service with this command returns it to needs_review. Nothing approves content.
See docs/editing-services.md for the review steps and optional fields.`;

export function proposeChapter(services: readonly Service[], serviceId: string, values: { video: string; title: string; type: string; start: string; end: string; summary: string; parent?: string }, reserved: Iterable<string> = []) {
  const service = services.find(service => service.id === serviceId);
  if (!service) throw new Error(`Unknown service ${serviceId}`);
  const used = new Set([...reserved, ...services.flatMap(service => [service.id, ...service.videos.map(video => video.id), ...service.chapters.map(chapter => chapter.id)])]);
  const slug = values.title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/, '') || 'chapter';
  const stem = `${serviceId}-${slug}`; let id = stem, suffix = 2;
  while (used.has(id)) id = `${stem}-${suffix++}`;
  const chapter = ChapterSchema.parse({ id, video_id: values.video, title: values.title, type: values.type, start: parseTimecode(values.start), end: parseTimecode(values.end),
    summary: values.summary, keywords: [], topics: [], scripture: [], ...(values.parent ? { parent_id: values.parent } : {}) });
  const result = ServiceSchema.parse({ ...service, chapters: [...service.chapters, chapter] });
  validateServiceOutline(result);
  return chapter;
}
export function checkAuthoring(service: Service, root = process.cwd()) {
  const issues: string[] = [];
  try { validateServiceOutline(service); } catch (error) { issues.push(String(error instanceof Error ? error.message : error)); }
  if (service.chapters.length) try { loadServiceChapterVectors(serviceFilename(root, service)); }
  catch { issues.push(`Search vectors need attention. Run pnpm chapters:vectors generate --service ${service.id} --transcripts-dir <private-evidence-directory>, then recheck. Do not hand-edit vector files or replace missing evidence with empty rows.`); }
  return { serviceId: service.id, title: service.title, ready: issues.length === 0, issues, editorialStatus: service.editorial_status };
}
export function authorCli(args = process.argv.slice(2), root = process.cwd()): void {
  const [command, selector, ...rest] = args.filter(arg => arg !== '--');
  if (command === 'types' && !selector) {
    for (const [label, values] of [['Recording types', SERVICE_TYPE_HELP], ['Chapter types', CHAPTER_TYPE_HELP], ['Quirks', QUIRK_LABELS]] as const) {
      console.log(`\n${label}\n${Object.entries(values).map(([key, description]) => `  ${key}: ${description}`).join('\n')}`);
    }
    return;
  }
  if (command === 'help' || command === '--help') { console.log(HELP); return; }
  if (!['check', 'add-chapter'].includes(command) || !selector) throw new Error(HELP);
  const services = loadArchive(root);
  if (command === 'check') {
    if (rest.length) throw new Error(HELP);
    const selected = selector === '--all' ? services : services.filter(service => service.id === selector);
    if (!selected.length) throw new Error(`Unknown service ${selector}`);
    const reports = selected.map(service => checkAuthoring(service, root));
    for (const report of reports) {
      console.log(`${report.ready ? 'READY FOR HUMAN REVIEW' : 'NEEDS ATTENTION'}: ${report.serviceId} — ${report.title}\n  Editorial status: ${report.editorialStatus}`);
      report.issues.forEach(issue => console.log(`  - ${issue}`));
    }
    if (selected.length === 1) console.log(`\n${formatReviewTable(selected[0])}\n\nRead nearby YAML comments, check the published metadata/navigation, then commit your corrections before running the human editorial:approve command. Passing checks does not approve the service.`);
    if (reports.some(report => !report.ready)) process.exitCode = 1;
    return;
  }
  const values = new Map<string, string>(); let apply = false;
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (key === '--apply') { if (apply) throw new Error(HELP); apply = true; continue; }
    if (!['--video', '--title', '--type', '--start', '--end', '--summary', '--parent'].includes(key) || values.has(key) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(HELP);
    values.set(key, rest[++i]);
  }
  for (const key of ['--video', '--title', '--type', '--start', '--end', '--summary']) if (!values.has(key)) throw new Error(`Missing ${key}\n${HELP}`);
  const reserved = new Set<string>();
  for (const filename of ['services/legacy-chapters.json', ...services.map(service => `services/${service.date.slice(0, 4)}/${service.id}/legacy-chapters.json`)]) {
    if (existsSync(path.join(root, filename))) Object.keys(JSON.parse(readFileSync(path.join(root, filename), 'utf8'))).forEach(id => reserved.add(id));
  }
  const chapter = proposeChapter(services, selector, { video: values.get('--video')!, title: values.get('--title')!, type: values.get('--type')!, start: values.get('--start')!, end: values.get('--end')!, summary: values.get('--summary')!, parent: values.get('--parent') }, reserved);
  const sourceChapter = { ...chapter, start: formatTimecode(chapter.start), end: formatTimecode(chapter.end) };
  const proposal = new Document({ chapters: [sourceChapter] }); quoteClockNodes(proposal);
  if (!apply) { console.log(`${proposal.toString({ lineWidth: 100 })}\nProposal only. Add --apply to insert this chapter.`); return; }
  const service = services.find(service => service.id === selector)!;
  const before = readFileSync(serviceFilename(root, service), 'utf8');
  editServiceDocument(root, service, document => {
    const chapters = document.get('chapters'); if (!isSeq(chapters)) throw new Error('Missing chapter list');
    const sequence = service.videos.find(video => video.id === chapter.video_id)!.sequence;
    const index = service.chapters.findIndex(item => {
      const other = service.videos.find(video => video.id === item.video_id)!.sequence;
      return other > sequence || other === sequence && item.start > chapter.start;
    });
    chapters.items.splice(index < 0 ? chapters.items.length : index, 0, document.createNode(sourceChapter));
    if (service.editorial_status === 'reviewed') { document.set('editorial_status', 'needs_review'); document.delete('reviewed_by'); document.delete('reviewed_at'); }
  }, before);
  console.log(`Added ${chapter.id}. Run pnpm author check ${service.id} before review/publication.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { authorCli(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
