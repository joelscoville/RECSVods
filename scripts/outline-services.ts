import { existsSync, linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { stringify } from 'yaml';
import { z } from 'zod';
import { loadArchive, parseYaml, ServiceSourceSchema, type Chapter, type Service } from '../site/lib/archive';
import { assertMigrationPreserved, MIGRATION_NOTE, OUTLINE_NOTE, outlineLegacyMap, preservedChapters } from '../site/lib/internal-validation';
import { readMigrationBaseline } from './migrate-chapters';

const text = z.string().trim().min(1), id = text.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const keywords = z.array(text).max(10).refine(values => new Set(values).size === values.length, 'duplicate keywords');
const minor = new Set('a an and as at but by for from in into nor of on or per the to via with without within through over under about against along before after between among amid despite onto than toward towards upon versus vs yet if so while when'.split(' '));
export function isTitleCase(title: string): boolean {
  const words = title.split(/[\s—–]+/u).filter(Boolean);
  return words.every((word, i) => (i > 0 && i < words.length - 1 && minor.has(word))
    || /^[^\p{L}]*[\p{Lu}\p{N}]/u.test(word));
}
const title = text.refine(isTitleCase, 'public titles must use Title Case');
export const OutlinePlanSchema = z.object({
  service_id: id, sermon_description: text.optional(), review_notes: z.array(text),
  groups: z.array(z.object({ id, title, type: id, source_chapters: z.array(id).min(1), summary: text, keywords,
    cues: z.array(z.object({ source_id: id, title, summary: text, keywords }).strict()).max(3),
  }).strict()).min(1),
}).strict();
export type OutlinePlan = z.infer<typeof OutlinePlanSchema>;

/** Only evidence-backed contiguous membership determines bounds; the plan cannot invent a clock. */
export function deriveOutline(source: Service, value: unknown, candidates?: Map<string, string[]>): Service {
  const plan = OutlinePlanSchema.parse(value);
  if (plan.service_id !== source.id || source.editorial_status !== 'needs_review') throw new Error('Outline requires its exact needs_review service');
  if (!isDeepStrictEqual(plan.groups.flatMap(group => group.source_chapters), source.chapters.map(chapter => chapter.id))) {
    throw new Error('Outline groups must cover every original chapter exactly once in order');
  }
  const oldIds = new Set(source.chapters.map(chapter => chapter.id));
  if (plan.groups.some(group => oldIds.has(group.id))) throw new Error('New group IDs must not overwrite preserved chapter IDs');
  if (plan.groups.some(group => group.type === 'sermon') && !plan.sermon_description) throw new Error('An evidenced sermon requires one holistic description');
  const get = (id: string) => source.chapters.find(chapter => chapter.id === id)!;
  const union = (chapters: Chapter[], field: 'topics' | 'scripture') => [...new Set(chapters.flatMap(chapter => chapter[field]))];
  const verifyWords = (words: string[], originals: Chapter[]) => {
    if (!candidates) return;
    const allowed = new Set(originals.flatMap(chapter => [...chapter.keywords, ...(candidates.get(chapter.id) ?? [])]));
    if (words.some(word => !allowed.has(word))) throw new Error('Outline keyword lacks supplied spoken evidence');
  };
  const chapters: Chapter[] = [];
  for (const group of plan.groups) {
    const originals = group.source_chapters.map(get), first = originals[0], last = originals.at(-1)!;
    if (originals.some(chapter => chapter.video_id !== first.video_id)) throw new Error('A group cannot cross physical uploads');
    verifyWords(group.keywords, originals);
    const parent: Chapter = { id: group.id, video_id: first.video_id, start: first.start, end: last.end,
      title: group.title, type: group.type, summary: group.summary, keywords: group.keywords,
      topics: union(originals, 'topics'), scripture: union(originals, 'scripture'), source_chapters: group.source_chapters,
      review_notes: [], ...(first.speaker_id && originals.every(chapter => chapter.speaker_id === first.speaker_id) ? { speaker_id: first.speaker_id } : {}),
    };
    chapters.push(parent);
    const selected = new Set<string>();
    for (const cue of group.cues) {
      if (!group.source_chapters.includes(cue.source_id) || selected.has(cue.source_id)) throw new Error('A cue must uniquely belong to its parent');
      selected.add(cue.source_id);
      const original = get(cue.source_id);
      verifyWords(cue.keywords, [original]);
      chapters.push({ ...original, id: original.id, title: cue.title, summary: cue.summary, keywords: cue.keywords,
        parent_id: parent.id, source_chapters: [original.id] });
    }
  }
  const result = { ...source, ...(plan.sermon_description ? { sermon_description: plan.sermon_description } : {}),
    chapters, review_notes: [...source.review_notes, OUTLINE_NOTE, ...plan.review_notes] };
  ServiceSourceSchema.parse(result);
  return result;
}

function replace(filename: string, before: string | undefined, after: string) {
  if (before === after) return;
  const temp = `${filename}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, after, { flag: 'wx' });
    if (before === undefined) linkSync(temp, filename);
    else {
      if (readFileSync(filename, 'utf8') !== before) throw new Error('Source changed during outline migration');
      renameSync(temp, filename);
    }
  } finally { rmSync(temp, { force: true }); }
}

export function migrateOutlines(root: string, options: { apply: boolean; service?: string; baseline?: string }) {
  loadArchive(root); // Entire source tree must be valid and symlink-free before mutation.
  const baseline = readMigrationBaseline(root, options.baseline ?? '540abab');
  const selected = baseline.sources.filter(item => !options.service || item.original.id === options.service);
  if (!selected.length) throw new Error('No matching baseline service');
  const pending = selected.map(({ filename, original }) => {
    const directory = path.join(root, path.dirname(filename)), absolute = path.join(root, filename);
    const current = readFileSync(absolute, 'utf8');
    const internalPath = path.join(directory, 'chapters.internal.yaml');
    const existing = existsSync(internalPath) ? readFileSync(internalPath, 'utf8') : undefined;
    const raw = parseYaml(current, filename) as Service;
    const chapterInternal = existing ?? stringify({ chapters: raw.chapters }, { lineWidth: 0 });
    const { sections: _sections, passages: _passages, ...metadata } = original;
    const stage = { ...metadata, review_notes: [...(metadata.review_notes ?? []), MIGRATION_NOTE],
      chapters: preservedChapters(chapterInternal, internalPath) } as Service;
    ServiceSourceSchema.parse(stage);
    const plan = JSON.parse(readFileSync(path.join(root, '.local/outline-plans', `${original.id}.json`), 'utf8'));
    const review = JSON.parse(readFileSync(path.join(root, '.local/chapter-review', `${original.id}.json`), 'utf8')) as {
      chapters: { id: string; keyword_candidates: string[] }[];
    };
    let next: Service;
    try { next = deriveOutline(stage, plan, new Map(review.chapters.map(chapter => [chapter.id, chapter.keyword_candidates]))); }
    catch (error) { throw new Error(`${original.id}: ${error instanceof Error ? error.message : String(error)}`); }
    const nextText = isDeepStrictEqual(raw, next) ? current : stringify(next, { lineWidth: 100 });
    const passages = readFileSync(path.join(directory, 'passages.internal.yaml'), 'utf8');
    // Prove the newly saved internal section record against the immutable pre-migration Git source.
    assertMigrationPreserved(original, nextText, passages, filename, chapterInternal);
    if (existing && raw.review_notes.includes(OUTLINE_NOTE)) assertMigrationPreserved(original, current, passages, filename, existing);
    else {
      assertMigrationPreserved(original, current, passages, filename);
      if (!isDeepStrictEqual(raw.chapters, preservedChapters(chapterInternal, internalPath))) throw new Error('Preserved chapter snapshot differs from unfinished source');
    }
    const mapPath = path.join(directory, 'legacy-chapters.json');
    const mapBefore = readFileSync(mapPath, 'utf8');
    const mapText = `${JSON.stringify(outlineLegacyMap(original, next.chapters), null, 2)}\n`;
    return { id: original.id, absolute, current, nextText, internalPath, existing, chapterInternal, mapPath, mapBefore, mapText,
      groups: next.chapters.filter(chapter => !chapter.parent_id).length, cues: next.chapters.filter(chapter => chapter.parent_id).length };
  });
  // All plans preflight before writes; originals land before any public changes.
  if (options.apply) for (const item of pending) {
    if (!item.existing) replace(item.internalPath, undefined, item.chapterInternal);
    replace(item.mapPath, item.mapBefore, item.mapText);
    replace(item.absolute, item.current, item.nextText);
  }
  return { applied: options.apply, services: pending.length, groups: pending.reduce((n, item) => n + item.groups, 0),
    cues: pending.reduce((n, item) => n + item.cues, 0), records: pending.map(({ id, groups, cues }) => ({ id, groups, cues })) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (!['--check', '--apply'].includes(args[0]) || !(args.length === 2 && args[1] === '--all'
      || args.length === 3 && args[1] === '--service' && /^[A-Za-z0-9_-]+$/.test(args[2]))) throw new Error('Usage: outline-services.ts --check|--apply --all|--service <id>');
    console.log(JSON.stringify(migrateOutlines(process.cwd(), { apply: args[0] === '--apply', service: args[1] === '--service' ? args[2] : undefined }), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
