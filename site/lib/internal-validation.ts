/** Preservation checks are deliberately separate from the chapter-only public loader. */
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseYaml, parseWithPath, ServiceSourceSchema } from './archive';
import { LegacyServiceSourceSchema, type LegacyServiceSource } from './legacy-schema';
import { PRESERVATION_FILE } from './preservation';

export const MIGRATION_NOTE = 'Chapter-search migration: original passages preserved in passages.internal.yaml; chapter summaries are initial seeds and keywords are spoken-text candidates requiring human review. No editorial approval implied.';
export const OUTLINE_NOTE = 'Concise service outline: original chapter metadata and boundaries preserved in chapters.internal.yaml; public groups and selective subsections follow the sermon argument and service context. Agent interpretation remains needs_review.';
export type RawLegacyService = LegacyServiceSource;
export function originalLegacy(text: string, filename: string): RawLegacyService {
  const raw = parseYaml(text, filename);
  parseWithPath(LegacyServiceSourceSchema, raw, filename);
  // Validation must not apply schema defaults, trim text, or normalize original fields.
  return raw as RawLegacyService;
}
export function internalPassages(text: string, filename: string): LegacyServiceSource['passages'] {
  const raw = parseYaml(text, filename) as { passages?: unknown };
  if (!raw || Object.keys(raw).length !== 1 || !Array.isArray(raw.passages)) throw new Error(`${filename}: expected only original passages`);
  return raw.passages as LegacyServiceSource['passages'];
}
export function assertPassagesPreserved(original: LegacyServiceSource['passages'], text: string, filename: string): void {
  if (!isDeepStrictEqual(original, internalPassages(text, filename))) throw new Error(`${filename}: conflicting internal material; every original passage field and transcript byte must be preserved`);
}
export function preservedChapters(text: string, filename: string): Record<string, unknown>[] {
  const value = parseYaml(text, filename) as { chapters?: unknown };
  if (!value || Object.keys(value).length !== 1 || !Array.isArray(value.chapters)) throw new Error(`${filename}: expected only preserved chapters`);
  return value.chapters as Record<string, unknown>[];
}
export function outlineLegacyMap(original: RawLegacyService, chapters: readonly { id: string; parent_id?: string; source_chapters?: string[] }[]): Record<string, string> {
  const publicIds = new Set(chapters.map((chapter) => chapter.id));
  const targets = new Map<string, string>();
  for (const chapter of chapters.filter((chapter) => !chapter.parent_id)) for (const id of chapter.source_chapters ?? [chapter.id]) targets.set(id, chapter.id);
  for (const chapter of chapters.filter((chapter) => chapter.parent_id)) for (const id of chapter.source_chapters ?? [chapter.id]) targets.set(id, chapter.id);
  const pairs = [...original.sections.filter((section) => !publicIds.has(section.id)).map((section) => [section.id, targets.get(section.id)]),
    ...original.passages.map((passage) => [passage.id, targets.get(passage.section_id)])];
  if (pairs.some(([, target]) => !target)) throw new Error('Every preserved identifier must resolve to a public group or subsection');
  return Object.fromEntries(pairs) as Record<string, string>;
}
export function assertMigrationPreserved(original: RawLegacyService, text: string, internal: string, filename: string, chapterInternal?: string): void {
  const raw = parseYaml(text, filename) as Record<string, unknown>;
  parseWithPath(ServiceSourceSchema, raw, filename);
  const { sections, passages, ...metadata } = original;
  const { chapters, ...currentMetadata } = raw;
  const expectedMetadata = { ...metadata, review_notes: [...(metadata.review_notes ?? []), MIGRATION_NOTE] };
  if (chapterInternal) {
    const notes = currentMetadata.review_notes as string[];
    if (!Array.isArray(notes) || !isDeepStrictEqual(notes.slice(0, expectedMetadata.review_notes.length), expectedMetadata.review_notes)
      || notes[expectedMetadata.review_notes.length] !== OUTLINE_NOTE) throw new Error(`${filename}: original notes or outline migration note missing`);
    currentMetadata.review_notes = expectedMetadata.review_notes;
    delete currentMetadata.sermon_description;
  }
  if (!isDeepStrictEqual(expectedMetadata, currentMetadata)) throw new Error(`${filename}: original service metadata/status/provenance must be preserved except the appended migration note`);
  if (original.editorial_status !== 'needs_review') throw new Error(`${filename}: migration requires needs_review; cannot migrate approved input`);
  const current = chapterInternal ? preservedChapters(chapterInternal, filename) : chapters as Record<string, unknown>[];
  if (sections.length !== current.length) throw new Error(`${filename}: original section count changed`);
  sections.forEach((section, i) => {
    const added = new Set(['summary', 'keywords', 'topics', 'scripture', 'scriptureDisplay']);
    const retained = Object.fromEntries(Object.entries(current[i]).filter(([key]) => !added.has(key)));
    if (!isDeepStrictEqual(section, retained)) throw new Error(`${filename}: original section fields changed at ${section.id}`);
  });
  if (chapterInternal) {
    const publicChapters = parseWithPath(ServiceSourceSchema, raw, filename).chapters;
    const parents = publicChapters.filter((chapter) => !chapter.parent_id);
    if (!isDeepStrictEqual(parents.flatMap((chapter) => chapter.source_chapters ?? []), sections.map((section) => section.id))) throw new Error(`${filename}: outline groups must partition originals once in order`);
    for (const chapter of publicChapters) {
      const sources = (chapter.source_chapters ?? []).map((id) => sections.find((section) => section.id === id));
      if (!sources.length || sources.some((section) => !section || section.video_id !== chapter.video_id)
        || chapter.start !== sources[0]!.start || chapter.end !== sources.at(-1)!.end) throw new Error(`${filename}: regrouped bounds must preserve source-video lineage`);
      if (chapter.parent_id && (sources.length !== 1 || chapter.id !== sources[0]!.id)) throw new Error(`${filename}: retained subsection ID/bounds must be stable`);
    }
  }
  assertPassagesPreserved(passages, internal, path.posix.join(path.posix.dirname(filename), 'passages.internal.yaml'));
}

/** Existing quarantine files are byte-immutable, even on unreviewed records. */
export function assertInternalHistory(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): void {
  if (before.has(PRESERVATION_FILE) && before.get(PRESERVATION_FILE) !== after.get(PRESERVATION_FILE)) throw new Error('The preservation seal cannot be changed or removed');
  for (const [filename, text] of before) if (filename.startsWith('services/') && filename.endsWith('.internal.yaml')) {
    if (after.get(filename) !== text) throw new Error(`${filename}: internal material preservation forbids rewriting or deleting original bytes`);
    for (const passage of filename.endsWith('/passages.internal.yaml') ? internalPassages(text, filename) : []) if (passage.transcript_file) {
      const external = path.posix.join(path.posix.dirname(filename), passage.transcript_file);
      if (!before.has(external) || before.get(external) !== after.get(external)) throw new Error(`${external}: internal transcript bytes changed or missing`);
    }
  }
  for (const [filename, text] of before) if (/^services\/\d{4}\/[^/]+\/service\.yaml$/.test(filename)) {
    const raw = parseYaml(text, filename) as Record<string, unknown>;
    if (!('passages' in raw)) continue;
    const nextText = after.get(filename);
    if (!nextText) throw new Error(`${filename}: cannot remove legacy material`);
    const next = parseYaml(nextText, filename) as Record<string, unknown>;
    if (!('chapters' in next)) continue; // Historical legacy edits retain their original guard rules.
    const internalPath = path.posix.join(path.posix.dirname(filename), 'passages.internal.yaml');
    const internal = after.get(internalPath);
    if (!internal) throw new Error(`${internalPath}: migration must preserve internal material first`);
    const original = originalLegacy(text, filename);
    assertMigrationPreserved(original, nextText, internal, filename, after.get(path.posix.join(path.posix.dirname(filename), 'chapters.internal.yaml')));
    for (const p of original.passages) if (p.transcript_file) {
      const external = path.posix.join(path.posix.dirname(filename), p.transcript_file);
      if (!before.has(external) || before.get(external) !== after.get(external)) throw new Error(`${external}: migration changed original transcript bytes`);
    }
  }
}
