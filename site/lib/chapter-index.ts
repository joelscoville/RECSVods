/** Browser-safe chapter artifacts. Metadata loading never waits for BSB or the model. */
import { z } from 'zod';
import { CHAPTER_VECTOR_CONFIG, decodeChapterVectors } from './chapter-vectors';
import { parseScriptureReference } from './scripture';
import type { SearchChapter } from './types';

export interface ChapterMetadata {
  schemaVersion: 2;
  model: typeof CHAPTER_VECTOR_CONFIG;
  chapters: SearchChapter[];
}
export interface ScriptureIndex {
  schemaVersion: 1;
  references: Record<string, string[]>;
  verses: Record<string, string>;
}
export type LegacyChapterMap = Record<string, string>;
export type ChapterVectors = ReturnType<typeof decodeChapterVectors>;

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const text = z.string().trim().min(1);
const reference = text.refine((value) => parseScriptureReference(value)?.canonical === value);
/** Deliberately excludes even the optional browser-only verseText property. */
export const PublicChapterSchema = z.object({
  id, serviceId: id, serviceTitle: text, videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  start: z.number().finite().nonnegative(), end: z.number().finite().positive(),
  type: id, title: text, summary: text, keywords: z.array(text).max(10),
  parentId: id.optional(), parentTitle: text.optional(),
  topics: z.array(text), scripture: z.array(reference), scriptureDisplay: z.array(text).optional(),
  speaker: text.optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  series: z.object({ id, name: text }).strict().optional(), preview: z.boolean(),
}).strict().superRefine((chapter, ctx) => {
  if (chapter.end <= chapter.start) ctx.addIssue({ code: 'custom', message: 'Invalid chapter bounds' });
  if (Boolean(chapter.parentId) !== Boolean(chapter.parentTitle)) ctx.addIssue({ code: 'custom', message: 'Subsection parent identity and title must align' });
  if (chapter.scriptureDisplay && (chapter.scriptureDisplay.length !== chapter.scripture.length
    || chapter.scriptureDisplay.some((value, i) => parseScriptureReference(value)?.canonical !== chapter.scripture[i]))) {
    ctx.addIssue({ code: 'custom', message: 'Scripture display references must align' });
  }
});

/** Key order is immaterial; additional model keys are rejected. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
  return Object.keys(aa).length === Object.keys(bb).length
    && Object.keys(aa).every((key) => Object.hasOwn(bb, key) && sameJson(aa[key], bb[key]));
}

export function parseChapterMetadata(value: unknown): ChapterMetadata {
  const data = z.object({ schemaVersion: z.literal(2), model: z.unknown(),
    chapters: z.array(PublicChapterSchema) }).strict().parse(value);
  if (!sameJson(data.model, CHAPTER_VECTOR_CONFIG)) throw new Error('Incompatible chapter vector model');
  if (new Set(data.chapters.map((chapter) => chapter.id)).size !== data.chapters.length) throw new Error('Duplicate chapter ID');
  for (const chapter of data.chapters) if (chapter.parentId) {
    const parent = data.chapters.find((candidate) => candidate.id === chapter.parentId);
    if (!parent || parent.parentId || parent.serviceId !== chapter.serviceId || parent.videoId !== chapter.videoId
      || parent.title !== chapter.parentTitle || chapter.start < parent.start || chapter.end > parent.end) throw new Error('Invalid public subsection parent');
  }
  return { ...data, model: CHAPTER_VECTOR_CONFIG };
}

export function parseScriptureIndex(value: unknown): ScriptureIndex {
  const data = z.object({ schemaVersion: z.literal(1), references: z.record(z.string(), z.array(z.string())),
    verses: z.record(z.string(), z.string()) }).strict().parse(value);
  const used = new Set<string>();
  for (const [ref, keys] of Object.entries(data.references)) {
    if (parseScriptureReference(ref)?.canonical !== ref || new Set(keys).size !== keys.length) throw new Error('Invalid scripture reference mapping');
    for (const key of keys) {
      const parsed = parseScriptureReference(key);
      if (!parsed || parsed.canonical !== key || !/^.+ \d+:\d+$/.test(key) || !Object.hasOwn(data.verses, key)) {
        throw new Error('Invalid or missing BSB verse key');
      }
      used.add(key);
    }
  }
  if (Object.keys(data.verses).some((key) => !used.has(key))) throw new Error('Unreferenced BSB verse');
  return data;
}

export function parseLegacyChapterMap(value: unknown): LegacyChapterMap {
  return z.record(id, id).parse(value);
}

function artifactUrl(base: string, name: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}generated/${name}`;
}

/** Static hosts may send .gz as raw bytes OR decode it using Content-Encoding.
 * Sniff bytes, not headers, to avoid double-decompression. Older browsers use raw files.
 */
async function loadArtifact<T>(base: string, name: string, decode: (bytes: Uint8Array) => T, signal?: AbortSignal): Promise<T> {
  const fetchBytes = async (filename: string) => {
    const response = await fetch(artifactUrl(base, filename), { signal });
    if (!response.ok) throw new Error(`Unable to load ${filename}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const bytes = await fetchBytes(`${name}.gz`);
      if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return decode(bytes);
      const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
      return decode(new Uint8Array(await new Response(stream).arrayBuffer()));
    } catch (error) {
      if (signal?.aborted || (error as Error).name === 'AbortError') throw error;
      // A missing/corrupt gzip companion must not disable ordinary static hosting.
    }
  }
  return decode(await fetchBytes(name));
}
async function loadJson<T>(base: string, name: string, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
  return loadArtifact(base, name, (bytes) => parse(JSON.parse(new TextDecoder().decode(bytes))), signal);
}

export async function loadChapterMetadata(base: string, signal?: AbortSignal): Promise<ChapterMetadata> {
  return loadJson(base, 'chapters.json', parseChapterMetadata, signal);
}
export async function loadScriptureIndex(base: string, signal?: AbortSignal): Promise<ScriptureIndex> {
  return loadJson(base, 'scripture.json', parseScriptureIndex, signal);
}
/** Returns copies; hidden BSB search text must never be displayed as ESV or reserialized. */
export function enrichChapters(chapters: readonly SearchChapter[], scripture: ScriptureIndex): SearchChapter[] {
  return chapters.map((chapter) => {
    const { verseText: _previous, ...metadata } = chapter;
    const keys = new Set(chapter.scripture.flatMap((ref) => scripture.references[parseScriptureReference(ref)?.canonical ?? ref] ?? []));
    const verseText = [...keys].map((key) => scripture.verses[key]).filter(Boolean).join('\n');
    return { ...metadata, ...(verseText ? { verseText } : {}) };
  });
}
export async function loadChapterVectors(base: string, signal?: AbortSignal): Promise<ChapterVectors> {
  return loadArtifact(base, 'vectors.bin', decodeChapterVectors, signal);
}
/** Fetch only when handling an old ?id= URL; unknown/ineligible IDs resolve to undefined. */
export async function resolveLegacyChapter(base: string, legacyId: string, signal?: AbortSignal): Promise<string | undefined> {
  const mapping = await loadJson(base, 'legacy-chapters.json', parseLegacyChapterMap, signal);
  return Object.hasOwn(mapping, legacyId) ? mapping[legacyId] : undefined;
}
