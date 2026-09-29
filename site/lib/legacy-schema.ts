/** Private history/preservation parser. Never import this from a public archive loader. */
import path from 'node:path';
import { z } from 'zod';
import { archiveFromFiles, chapterFields, checkService, parseWithPath, parseYaml, ScriptureInputSchema,
  segmentFields, serviceFields, ServiceSourceSchema, type Service } from './archive';
import { stringify } from 'yaml';
import { HistoricalVideoSchema } from './processing-provenance';
import { normalizeScriptureReference, parseScriptureReference } from './scripture';

const OriginalText = z.string().refine((s) => Boolean(s.trim()), 'required text');
const historicalId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const originalSegment = { ...segmentFields, type: historicalId, title: OriginalText, confidence: z.number().min(0).max(1),
  review_notes: z.array(OriginalText).default([]) };
const historicalServiceFields = { ...serviceFields, type: historicalId, videos: z.array(HistoricalVideoSchema).min(1),
  sermon_title: OriginalText.optional(), review_notes: z.array(OriginalText).default([]) };
export const HistoricalChapterSchema = z.object({ ...chapterFields, type: historicalId, confidence: z.number().min(0).max(1).optional(),
  review_notes: z.array(OriginalText).default([]), source_chapters: z.array(historicalId).min(1).optional() }).strict()
  .refine(chapter => chapter.end > chapter.start, { path: ['end'], message: 'must be greater than start' })
  .refine(chapter => !chapter.scriptureDisplay || chapter.scriptureDisplay.length === chapter.scripture.length && chapter.scriptureDisplay.every((value, i) => parseScriptureReference(value)?.canonical === parseScriptureReference(chapter.scripture[i])?.canonical), { path: ['scriptureDisplay'], message: 'references must align' })
  .transform(chapter => {
    const scripture = chapter.scripture.map(normalizeScriptureReference);
    return { ...chapter, scripture, ...(scripture.some((value, i) => value !== chapter.scripture[i]) ? { scriptureDisplay: chapter.scriptureDisplay ?? [...chapter.scripture] } : {}) };
  });
export const HistoricalServiceSchema = z.object({ ...historicalServiceFields, chapters: z.array(HistoricalChapterSchema) }).strict().superRefine(checkService);
export type HistoricalService = z.infer<typeof HistoricalServiceSchema>;
export const LegacySectionSchema = z.object(originalSegment).strict().refine((s) => s.end > s.start, 'end must be greater than start');
export const LegacyPassageSourceSchema = z.object({ ...originalSegment,
  section_id: segmentFields.id, summary: OriginalText, questions: z.array(OriginalText),
  topics: z.array(segmentFields.id), scripture: z.array(ScriptureInputSchema),
  transcript: OriginalText.optional(),
  transcript_file: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_./-]+\.md$/).optional(),
}).strict().superRefine((p, ctx) => {
  if (p.end <= p.start) ctx.addIssue({ code: 'custom', path: ['end'], message: 'must be greater than start' });
  if (Boolean(p.transcript) === Boolean(p.transcript_file)) ctx.addIssue({ code: 'custom', path: ['transcript'], message: 'provide exactly one of transcript or transcript_file' });
});
export const LegacyServiceSourceSchema = z.object({ ...historicalServiceFields,
  sections: z.array(LegacySectionSchema), passages: z.array(LegacyPassageSourceSchema),
}).strict().superRefine((s, ctx) => {
  checkService({ ...s, chapters: s.sections.map((section) => ({ ...section, summary: 'History validation', keywords: [], topics: [], scripture: [] })) }, ctx);
  const ids = new Set<string>();
  s.passages.forEach((p, i) => {
    const issue = (field: string, message: string) => ctx.addIssue({ code: 'custom', path: ['passages', i, field], message });
    if (ids.has(p.id)) issue('id', 'duplicate passage ID');
    ids.add(p.id);
    const section = s.sections.find((section) => section.id === p.section_id);
    if (!section || section.video_id !== p.video_id || p.start < section.start || p.end > section.end) issue('section_id', 'passage must fit within its section on the same video');
    if (p.speaker_id && !s.speakers.some((speaker) => speaker.id === p.speaker_id)) issue('speaker_id', 'unknown speaker reference');
    if (p.topics.some((topic) => !s.topics.some((t) => t.id === topic))) issue('topics', 'unknown topic reference');
  });
});
export type LegacyServiceSource = z.infer<typeof LegacyServiceSourceSchema>;
export type HistoryService = Service | HistoricalService | LegacyServiceSource;
export function isAuthoringSource(raw: Record<string, unknown>): boolean {
  return Array.isArray(raw.videos) && typeof (raw.videos[0] as Record<string, unknown> | undefined)?.duration === 'string';
}
export function historySource(text: string, filename: string): HistoryService {
  const raw = parseYaml(text, filename) as Record<string, unknown>;
  return 'chapters' in raw ? isAuthoringSource(raw) ? parseWithPath(ServiceSourceSchema, raw, filename) : parseWithPath(HistoricalServiceSchema, raw, filename)
    : parseWithPath(LegacyServiceSourceSchema, raw, filename);
}

/** Validate old Git trees and mixed migration history without enabling a public fallback. */
export function historyArchiveFromFiles(files: ReadonlyMap<string, string>): HistoryService[] {
  const projected = new Map(files); const services: HistoryService[] = [];
  const passageIds = new Set<string>();
  for (const [filename, text] of files) if (/^services\/\d{4}\/[^/]+\/service\.yaml$/.test(filename)) {
    const source = historySource(text, filename);
    if ('passages' in source) {
      for (const p of source.passages) {
        if (passageIds.has(p.id)) throw new Error(`${filename}: duplicate global ID ${p.id}`);
        passageIds.add(p.id);
        if (p.transcript_file && !files.get(path.posix.join(path.posix.dirname(filename), p.transcript_file))?.trim()) throw new Error(`${filename}: missing transcript_file ${p.transcript_file}`);
      }
      const { sections, passages: _passages, ...metadata } = source;
      projected.set(filename, stringify({ ...metadata, chapters: sections.map((s) => ({ ...s, summary: 'History validation', keywords: [], topics: [], scripture: [] })) }));
    }
    services.push(source);
  }
  const validated = archiveFromFiles(projected, (text, filename) => {
    const result = historySource(text, filename);
    if (!('chapters' in result)) throw new Error('Expected chapter history projection');
    return result;
  });
  for (const s of validated) for (const item of [s, ...s.videos, ...s.chapters]) if (passageIds.has(item.id)) throw new Error(`duplicate global ID ${item.id}`);
  return services;
}
